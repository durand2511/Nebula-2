/**
 * Nebula Assistent — mobile PWA voice front-end for Claude Code, in the platform's light look.
 *
 * Tap the Nebula logo → it rotates + breathes while listening → you talk → it auto-stops on silence →
 * Whisper transcribes → the text is fired into your live server-side Claude Code session → Claude edits
 * your site and speaks its reply back (read from the terminal buffer). Hands-free: after Claude answers
 * it listens again until you tap the logo to stop. The terminal itself runs invisibly as the engine.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ClaudeTerminal, type ClaudeTerminalHandle } from "@/components/claude-terminal";
import { getToken, setToken } from "@/lib/session";
import { bgUrl } from "@/lib/background";
import logoUrl from "../assets/nebula-logo.png";
import { Volume2, VolumeX, Send, Loader2, ChevronDown, X } from "lucide-react";

type Project = { id: number; name: string };
type Msg = { id: number; role: "you" | "claude"; text: string };
type Mode = "idle" | "listening" | "processing" | "speaking";

const LAST_KEY = "nebula_assistant_project";

function pickAudioMime(): string {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"];
  for (const c of cands) { try { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignore */ } }
  return "";
}

export default function Assistant() {
  const [authState, setAuthState] = useState<"checking" | "out" | "in">("checking");
  const [showForm, setShowForm] = useState(false); // welcome → tap "Inloggen" → form (keeps iOS autofill from auto-popping on open)
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const termRef = useRef<ClaudeTerminalHandle>(null);
  const everConnRef = useRef(false);
  const [connected, setConnected] = useState(false);

  const [mode, setMode] = useState<Mode>("idle");
  const modeRef = useRef<Mode>("idle");
  const setModeS = (m: Mode) => { modeRef.current = m; setMode(m); };
  const [conversation, setConversation] = useState(false);
  const convRef = useRef(false);
  const setConv = (v: boolean) => { convRef.current = v; setConversation(v); };

  const [messages, setMessages] = useState<Msg[]>([]);
  const [ttsOn, setTtsOn] = useState(true);
  const ttsRef = useRef(true); ttsRef.current = ttsOn;
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // media refs
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replyFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idCounter = useRef(0);

  const flash = (m: string, ms = 4000) => { setNotice(m); window.setTimeout(() => setNotice((n) => (n === m ? "" : n)), ms); };
  const addMsg = (role: Msg["role"], text: string) => setMessages((prev) => [...prev, { id: ++idCounter.current, role, text }]);

  // ---- auth + projects ----
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState("");

  function loadProjects() {
    fetch("/api/projects").then((r) => r.json()).then((rows: Project[]) => {
      const list = Array.isArray(rows) ? rows : [];
      setProjects(list);
      const last = Number(localStorage.getItem(LAST_KEY) || 0);
      const chosen = list.find((p) => p.id === last) || list[0];
      if (chosen) setProjectId(chosen.id);
    }).catch(() => {});
  }

  useEffect(() => {
    if (!getToken()) { setAuthState("out"); return; }
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((me) => {
      if (!me || !me.user?.id) { setAuthState("out"); return; }
      setAuthState("in"); loadProjects();
    }).catch(() => setAuthState("out"));
  }, []);

  useEffect(() => { if (projectId) { try { localStorage.setItem(LAST_KEY, String(projectId)); } catch { /* ignore */ } } }, [projectId]);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, mode]);
  useEffect(() => { try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ } }, []);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoginBusy(true); setLoginErr("");
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) });
      const j = await r.json();
      if (!r.ok || !j.token) { setLoginErr(j.error || "Inloggen mislukt."); return; }
      setToken(j.token); setPassword(""); setAuthState("in"); loadProjects();
    } catch { setLoginErr("Inloggen mislukt — controleer je verbinding."); }
    finally { setLoginBusy(false); }
  }

  const currentName = useMemo(() => projects.find((p) => p.id === projectId)?.name || "Kies website", [projects, projectId]);

  // ---- speech OUT ----
  function speak(text: string) {
    if (!ttsRef.current || !text) { if (convRef.current) startListen(); return; }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { if (convRef.current) startListen(); return; }
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "nl-NL";
      const nl = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("nl"));
      if (nl) u.voice = nl;
      setModeS("speaking");
      u.onend = () => { if (convRef.current) startListen(); else setModeS("idle"); };
      u.onerror = () => { if (convRef.current) startListen(); else setModeS("idle"); };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { if (convRef.current) startListen(); else setModeS("idle"); }
  }
  function stopSpeaking() { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }

  // Claude finished a reply (clean prose from the terminal buffer).
  function onClaudeReply(text: string) {
    if (replyFallbackRef.current) { clearTimeout(replyFallbackRef.current); replyFallbackRef.current = null; }
    addMsg("claude", text);
    speak(text);
  }

  // ---- send to Claude ----
  function sendToClaude(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const ok = termRef.current?.send(clean + "\r");
    if (!ok) { flash("Nog niet verbonden met Claude — momentje…", 2500); if (convRef.current) window.setTimeout(() => sendToClaude(clean), 1500); return; }
    addMsg("you", clean);
    setModeS("processing");
    // Fallback: if Claude produces no clean prose reply, resume listening after a while so we never stall.
    if (replyFallbackRef.current) clearTimeout(replyFallbackRef.current);
    replyFallbackRef.current = setTimeout(() => { if (convRef.current && modeRef.current === "processing") startListen(); else if (modeRef.current === "processing") setModeS("idle"); }, 30000);
  }

  // ---- speech IN (hands-free) ----
  async function ensureStream(): Promise<MediaStream | null> {
    if (streamRef.current) return streamRef.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = s;
      return s;
    } catch {
      flash("Geen toegang tot de microfoon. Sta het toe in je instellingen.", 5000);
      setConv(false); setModeS("idle");
      return null;
    }
  }

  async function startListen() {
    stopSpeaking();
    if (!convRef.current) return;
    const stream = await ensureStream();
    if (!stream) return;

    const mime = pickAudioMime();
    mimeRef.current = mime;
    let mr: MediaRecorder;
    try { mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch { flash("Opnemen wordt niet ondersteund op deze telefoon.", 5000); setConv(false); setModeS("idle"); return; }
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    let sent = false;
    mr.onstop = async () => {
      if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      if (sent) await transcribe(blob);
      else if (convRef.current) setModeS("idle"); // heard nothing → wait for the user
    };
    recorderRef.current = mr;
    mr.start(200);
    setModeS("listening");

    // Voice-activity detection: stop shortly after the speaker goes quiet, and give up if no speech.
    const ac = audioCtxRef.current || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    audioCtxRef.current = ac;
    try { if (ac.state === "suspended") await ac.resume(); } catch { /* ignore */ }
    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser(); analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const started = Date.now();
    let speech = false, lastLoud = Date.now();
    vadTimerRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (let i = 0; i < data.length; i++) { const x = (data[i] - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / data.length);
      const now = Date.now();
      if (rms > 0.03) { speech = true; lastLoud = now; }
      const finish = () => { sent = speech; try { src.disconnect(); } catch { /* ignore */ } try { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* ignore */ } };
      if (speech && now - lastLoud > 1300) { finish(); }             // spoke, then went quiet → send
      else if (!speech && now - started > 7000) { finish(); if (convRef.current) { flash("Ik hoorde niets — tik het logo om opnieuw te starten.", 3500); setConv(false); } }
      else if (now - started > 30000) { finish(); }                  // hard cap
    }, 80);
  }

  function stopListenHard() {
    if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
    try { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* ignore */ }
  }

  function releaseMic() {
    stopListenHard();
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
  }

  function toggleConversation() {
    if (convRef.current) { setConv(false); stopSpeaking(); stopListenHard(); releaseMic(); setModeS("idle"); }
    else { setConv(true); startListen(); }
  }

  async function transcribe(blob: Blob) {
    if (blob.size < 600) { if (convRef.current) startListen(); return; }
    setModeS("processing");
    try {
      const dataUrl: string = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = reject; fr.readAsDataURL(blob); });
      const r = await fetch("/api/voice/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: dataUrl }) });
      let j: { text?: string; error?: string } = {};
      try { j = await r.json(); } catch { /* non-JSON */ }
      if (!r.ok) {
        const msg = j.error || (r.status === 413 ? "Opname te groot." : r.status === 503 ? "Spraak staat nog niet aan op de server (OpenAI-sleutel ontbreekt)." : r.status === 401 ? "Je bent uitgelogd — log opnieuw in." : `Transcriptie mislukt (fout ${r.status}).`);
        flash(msg, 5000); setConv(false); setModeS("idle"); return;
      }
      const text = String(j.text || "").trim();
      if (!text) { if (convRef.current) startListen(); else setModeS("idle"); return; }
      sendToClaude(text);
    } catch {
      flash("Geen verbinding met de server.", 3500); setModeS("idle");
    }
  }

  useEffect(() => () => { releaseMic(); stopSpeaking(); if (replyFallbackRef.current) clearTimeout(replyFallbackRef.current); }, []);

  // ================= RENDER =================
  const bgLayer = (
    <>
      <div className="fixed inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url(${bgUrl})` }} aria-hidden="true" />
      <div className="fixed inset-0 -z-10 bg-white/75 backdrop-blur-[2px]" aria-hidden="true" />
    </>
  );

  if (authState === "checking") {
    return <div className="grid place-items-center text-foreground/50" style={{ minHeight: "100dvh" }}>{bgLayer}<Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (authState === "out") {
    return (
      <div className="light grid place-items-center px-6 text-foreground" style={{ minHeight: "100dvh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {bgLayer}
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card/85 backdrop-blur-xl shadow-xl p-8">
          <div className="text-center">
            <img src={logoUrl} alt="Nebula" className="h-16 w-auto mx-auto" />
            <h1 className="mt-4 text-2xl font-serif font-semibold tracking-tight">Nebula Assistent</h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">Praat met Claude en pas je website aan vanaf je telefoon.</p>
          </div>
          {!showForm ? (
            <div className="mt-7">
              <button onClick={() => setShowForm(true)} className="w-full rounded-full bg-foreground text-background font-semibold py-3 hover:opacity-90 transition">Inloggen</button>
              <p className="mt-4 text-center text-[13px] text-muted-foreground">Nog geen account? <a href="/" className="text-foreground underline underline-offset-2">Aanmaken op nebulabookings.com</a></p>
            </div>
          ) : (
            <form onSubmit={doLogin} className="mt-6">
              <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mailadres"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring/40 mb-3" />
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Wachtwoord"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring/40" />
              {loginErr && <p className="mt-3 text-[13px] text-rose-600">{loginErr}</p>}
              <button type="submit" disabled={loginBusy} className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background font-semibold py-3 disabled:opacity-50">
                {loginBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Inloggen
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const listening = mode === "listening";
  const statusLabel = mode === "listening" ? "Luisteren…" : mode === "processing" ? "Claude werkt…" : mode === "speaking" ? "Claude praat…" : conversation ? "Even stil…" : "Tik het logo en praat";

  return (
    <div className="light flex flex-col text-foreground" style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {bgLayer}
      <style>{`
        @keyframes nebulaSpin { 0%{transform:rotate(0deg) scale(1)} 50%{transform:rotate(180deg) scale(1.14)} 100%{transform:rotate(360deg) scale(1)} }
        @keyframes nebulaBreath { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
      `}</style>

      {/* Header */}
      <header className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <img src={logoUrl} alt="" className="h-7 w-auto" />
          <button onClick={() => setPickerOpen(true)} className="flex items-center gap-1 text-[13px] text-foreground/70 max-w-[46vw] truncate">
            <span className="truncate font-medium">{currentName}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border ${connected ? "border-emerald-500/30 text-emerald-700 bg-emerald-500/10" : "border-border text-muted-foreground bg-card/70"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />{connected ? "verbonden" : "verbinden…"}
          </span>
          <button onClick={() => { const n = !ttsOn; setTtsOn(n); if (!n) stopSpeaking(); }} className={`h-9 w-9 grid place-items-center rounded-full border ${ttsOn ? "border-border bg-card/70 text-foreground" : "border-border bg-card/40 text-muted-foreground"}`} aria-label="Stem aan/uit">
            {ttsOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
        {messages.length === 0 && (
          <div className="h-full grid place-items-center text-center px-6">
            <div>
              <p className="text-[15px] text-muted-foreground max-w-xs mx-auto leading-relaxed">Zeg wat er anders moet aan je website — bijvoorbeeld <span className="text-foreground">“maak de kop groter”</span> of <span className="text-foreground">“hoeveel bezoekers had ik deze week?”</span></p>
            </div>
          </div>
        )}
        {messages.map((m) => (
          m.role === "you" ? (
            <div key={m.id} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground text-background px-3.5 py-2 text-[14px] leading-snug">{m.text}</div></div>
          ) : (
            <div key={m.id} className="flex justify-start"><div className="max-w-[85%] rounded-2xl rounded-bl-md bg-card border border-border px-3.5 py-2 text-[14px] leading-snug shadow-sm">{m.text}</div></div>
          )
        ))}
      </div>

      {notice && <div className="shrink-0 mx-4 mb-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2">{notice}</div>}

      {/* Logo mic + text fallback */}
      <div className="shrink-0 px-4 pt-1 pb-4 flex flex-col items-center gap-3">
        <button
          onClick={toggleConversation}
          disabled={!projectId}
          className="relative h-28 w-28 grid place-items-center rounded-full disabled:opacity-40"
          aria-label={conversation ? "Stop" : "Start praten"}
        >
          {listening && <span className="absolute inset-0 rounded-full bg-sky-400/30 animate-ping" />}
          {(mode === "processing" || mode === "speaking") && <span className="absolute inset-0 rounded-full border-2 border-sky-400/50 border-t-transparent animate-spin" />}
          <span className={`relative h-24 w-24 grid place-items-center rounded-full shadow-xl transition-colors ${listening ? "bg-sky-500" : conversation ? "bg-sky-500/90" : "bg-card border border-border"}`}>
            <img
              src={logoUrl}
              alt="Nebula"
              className="h-14 w-auto"
              style={{ animation: listening ? "nebulaSpin 2.8s ease-in-out infinite" : (mode === "speaking" ? "nebulaBreath 1.6s ease-in-out infinite" : "none"), filter: (listening || conversation) ? "brightness(0) invert(1)" : "none" }}
            />
          </span>
        </button>
        <div className="text-[13px] text-muted-foreground h-5 flex items-center gap-2">
          {mode === "processing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {statusLabel}
        </div>
        <div className="w-full max-w-md flex items-center gap-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) { sendToClaude(typed); setTyped(""); } }}
            placeholder="…of typ het" className="flex-1 min-w-0 rounded-full border border-border bg-card/80 px-4 py-2.5 text-[14px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30" />
          {typed.trim() && <button onClick={() => { sendToClaude(typed); setTyped(""); }} className="h-10 w-10 shrink-0 grid place-items-center rounded-full bg-foreground text-background"><Send className="h-4 w-4" /></button>}
        </div>
      </div>

      {/* Project picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-30 bg-black/30" onClick={() => setPickerOpen(false)}>
          <div className="absolute left-3 right-3 top-3 rounded-2xl border border-border bg-card shadow-2xl max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ marginTop: "env(safe-area-inset-top)" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-[12px] uppercase tracking-wide text-muted-foreground">Kies een website</span>
              <button onClick={() => setPickerOpen(false)} className="text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>
            {projects.length === 0 && <div className="px-4 py-4 text-sm text-muted-foreground">Nog geen projecten.</div>}
            {projects.map((p) => (
              <button key={p.id} onClick={() => { if (p.id !== projectId) { setConv(false); releaseMic(); stopSpeaking(); setMessages([]); setModeS("idle"); } setProjectId(p.id); setPickerOpen(false); }}
                className={`w-full text-left px-4 py-3 text-sm border-b border-border/60 ${p.id === projectId ? "font-medium bg-muted/50" : "text-foreground/80"}`}>{p.name}</button>
            ))}
          </div>
        </div>
      )}

      {/* Hidden engine: the real Claude Code terminal, off-screen but full-size so the WS, send() and
          reply extraction all work. This page is just its voice skin. */}
      {projectId > 0 && (
        <div aria-hidden="true" style={{ position: "fixed", left: -99999, top: 0, width: 820, height: 560, opacity: 0, pointerEvents: "none", zIndex: -1, overflow: "hidden" }}>
          <ClaudeTerminal
            key={projectId}
            ref={termRef}
            projectId={projectId}
            className="absolute inset-0"
            onStatus={(s) => { if (s === "open") { everConnRef.current = true; setConnected(true); } else if (!everConnRef.current) setConnected(false); }}
            onConnected={(c) => { if (c) { everConnRef.current = true; setConnected(true); } }}
            onAssistantText={(text) => onClaudeReply(text)}
          />
        </div>
      )}
    </div>
  );
}
