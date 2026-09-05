/**
 * Nebula Assistent — mobile PWA voice front-end for Claude Code, in the platform's light look.
 *
 * Pure voice: tap the big Nebula logo → it rotates + breathes while listening → you talk → it auto-stops
 * on silence → Whisper transcribes → the text is fired into your live server-side Claude Code session →
 * Claude edits your site and SPEAKS its reply back. No transcript, no typing — just the logo and Claude's
 * voice. The terminal itself runs invisibly as the engine and auto-restarts if it drops.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ClaudeTerminal, type ClaudeTerminalHandle } from "@/components/claude-terminal";
import { getToken, setToken } from "@/lib/session";
import { bgUrl } from "@/lib/background";
import logoUrl from "../assets/nebula-logo.png";
import { Volume2, VolumeX, Loader2, ChevronDown, X } from "lucide-react";

type Project = { id: number; name: string };
type Mode = "idle" | "listening" | "processing" | "speaking";

const LAST_KEY = "nebula_assistant_project";

function pickAudioMime(): string {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"];
  for (const c of cands) { try { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignore */ } }
  return "";
}

export default function Assistant() {
  const [authState, setAuthState] = useState<"checking" | "out" | "in">("checking");
  const [showForm, setShowForm] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const termRef = useRef<ClaudeTerminalHandle>(null);
  const [termKey, setTermKey] = useState(0);          // bump to force a fresh Claude session
  const everConnRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [down, setDown] = useState(false);

  const [mode, setMode] = useState<Mode>("idle");
  const modeRef = useRef<Mode>("idle");
  const setModeS = (m: Mode) => { modeRef.current = m; setMode(m); };
  const convRef = useRef(false);
  const [, force] = useState(0);
  const setConv = (v: boolean) => { convRef.current = v; force((n) => n + 1); };

  const [ttsOn, setTtsOn] = useState(true);
  const ttsRef = useRef(true); ttsRef.current = ttsOn;
  const [notice, setNotice] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replyFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (m: string, ms = 4000) => { setNotice(m); window.setTimeout(() => setNotice((n) => (n === m ? "" : n)), ms); };

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
  useEffect(() => { try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ } }, []);
  useEffect(() => () => { releaseMic(); stopSpeaking(); if (replyFallbackRef.current) clearTimeout(replyFallbackRef.current); }, []);

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

  const currentName = useMemo(() => projects.find((p) => p.id === projectId)?.name || "website", [projects, projectId]);

  // ---- speech OUT ----
  function speak(text: string) {
    if (!ttsRef.current || !text || typeof window === "undefined" || !("speechSynthesis" in window)) { if (convRef.current) startListen(); return; }
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

  function onClaudeReply(text: string) {
    if (replyFallbackRef.current) { clearTimeout(replyFallbackRef.current); replyFallbackRef.current = null; }
    speak(text);
  }

  function sendToClaude(text: string) {
    const clean = text.trim();
    if (!clean) return;
    // Voice mode: keep Claude conversational and quick — a short reply that gets read aloud, and no
    // needless file-digging when the user is just chatting or greeting.
    const msg = `[Spraakmodus: antwoord kort en vriendelijk in het Nederlands (1–2 zinnen), dit wordt voorgelezen. Voer alleen wijzigingen uit als ik daar duidelijk om vraag.] ${clean}`;
    const ok = termRef.current?.send(msg + "\r");
    if (!ok) { flash("Nog niet verbonden — momentje…", 2500); if (convRef.current) window.setTimeout(() => sendToClaude(clean), 1500); return; }
    setModeS("processing");
    if (replyFallbackRef.current) clearTimeout(replyFallbackRef.current);
    replyFallbackRef.current = setTimeout(() => { if (convRef.current && modeRef.current === "processing") startListen(); else if (modeRef.current === "processing") setModeS("idle"); }, 45000);
  }

  // ---- speech IN (hands-free) ----
  async function ensureStream(): Promise<MediaStream | null> {
    if (streamRef.current) return streamRef.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = s; return s;
    } catch { flash("Geen toegang tot de microfoon. Sta het toe in je instellingen.", 5000); setConv(false); setModeS("idle"); return null; }
  }

  async function startListen() {
    stopSpeaking();
    if (!convRef.current) return;
    const stream = await ensureStream();
    if (!stream) return;
    const mime = pickAudioMime(); mimeRef.current = mime;
    let mr: MediaRecorder;
    try { mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch { flash("Opnemen wordt niet ondersteund op deze telefoon.", 5000); setConv(false); setModeS("idle"); return; }
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    let sent = false;
    mr.onstop = async () => {
      if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      if (sent) await transcribe(blob); else if (convRef.current) setModeS("idle");
    };
    recorderRef.current = mr; mr.start(200); setModeS("listening");

    const ac = audioCtxRef.current || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    audioCtxRef.current = ac;
    try { if (ac.state === "suspended") await ac.resume(); } catch { /* ignore */ }
    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const started = Date.now(); let speech = false, lastLoud = Date.now();
    vadTimerRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (let i = 0; i < data.length; i++) { const x = (data[i] - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / data.length); const now = Date.now();
      if (rms > 0.03) { speech = true; lastLoud = now; }
      const finish = () => { sent = speech; try { src.disconnect(); } catch { /* ignore */ } try { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* ignore */ } };
      if (speech && now - lastLoud > 1300) { finish(); }
      else if (!speech && now - started > 7000) { finish(); if (convRef.current) { flash("Ik hoorde niets — tik het logo om opnieuw te starten.", 3500); setConv(false); } }
      else if (now - started > 30000) { finish(); }
    }, 80);
  }

  function stopListenHard() { if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; } try { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* ignore */ } }
  function releaseMic() { stopListenHard(); try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } streamRef.current = null; try { audioCtxRef.current?.close(); } catch { /* ignore */ } audioCtxRef.current = null; }

  // iOS Safari only lets speechSynthesis start from inside a user gesture. Prime it (speak a blank
  // utterance) on the tap so later replies — which fire after an async fetch — are allowed to speak.
  const ttsPrimedRef = useRef(false);
  function primeTTS() {
    if (ttsPrimedRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; window.speechSynthesis.speak(u); ttsPrimedRef.current = true; } catch { /* ignore */ }
  }

  function toggleConversation() {
    primeTTS();
    if (down) { setDown(false); setRestarting(true); setTermKey((k) => k + 1); setConv(true); return; } // remount → fresh Claude, then listen on connect
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
        const msg = j.error || (r.status === 413 ? "Opname te groot." : r.status === 503 ? "Spraak staat nog niet aan op de server." : r.status === 401 ? "Je bent uitgelogd — log opnieuw in." : `Transcriptie mislukt (fout ${r.status}).`);
        flash(msg, 5000); setConv(false); setModeS("idle"); return;
      }
      const text = String(j.text || "").trim();
      if (!text) { if (convRef.current) startListen(); else setModeS("idle"); return; }
      sendToClaude(text);
    } catch { flash("Geen verbinding met de server.", 3500); setModeS("idle"); }
  }

  // ---- terminal lifecycle ----
  function onTermStatus(s: string) { if (s === "open") { everConnRef.current = true; setConnected(true); setRestarting(false); setDown(false); } else if (!everConnRef.current) setConnected(false); }
  function onTermExit(_code: number, willRestart: boolean) {
    stopListenHard();
    if (willRestart) { setRestarting(true); }
    else { setDown(true); setConv(false); setModeS("idle"); setRestarting(false); if (ttsRef.current) speakOnce("Claude is even gestopt. Tik op het logo om opnieuw te starten."); }
  }
  function speakOnce(text: string) { try { const u = new SpeechSynthesisUtterance(text); u.lang = "nl-NL"; const nl = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("nl")); if (nl) u.voice = nl; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch { /* ignore */ } }

  // ================= RENDER =================
  const bgLayer = (
    <>
      <div className="fixed inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url(${bgUrl})` }} aria-hidden="true" />
      <div className="fixed inset-0 -z-10 bg-white/80 backdrop-blur-[2px]" aria-hidden="true" />
    </>
  );

  if (authState === "checking") return <div className="grid place-items-center text-foreground/50" style={{ minHeight: "100dvh" }}>{bgLayer}<Loader2 className="h-6 w-6 animate-spin" /></div>;

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
              <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mailadres" className="w-full rounded-xl border border-border bg-background px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring/40 mb-3" />
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Wachtwoord" className="w-full rounded-xl border border-border bg-background px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring/40" />
              {loginErr && <p className="mt-3 text-[13px] text-rose-600">{loginErr}</p>}
              <button type="submit" disabled={loginBusy} className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background font-semibold py-3 disabled:opacity-50">{loginBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Inloggen</button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const conversation = convRef.current;
  const listening = mode === "listening";
  const active = listening || conversation;
  const statusLabel = down ? "Claude is gestopt — tik om opnieuw te starten"
    : restarting ? "Claude start opnieuw…"
    : mode === "listening" ? "Ik luister…"
    : mode === "processing" ? "Claude is bezig…"
    : mode === "speaking" ? "Claude praat…"
    : conversation ? "Even stil…" : "Tik op het logo en praat";

  return (
    <div className="light flex flex-col text-foreground" style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {bgLayer}
      <style>{`
        @keyframes nebulaSpin { 0%{transform:rotate(0deg) scale(1)} 50%{transform:rotate(180deg) scale(1.12)} 100%{transform:rotate(360deg) scale(1)} }
        @keyframes nebulaBreath { 0%,100%{transform:scale(1)} 50%{transform:scale(1.07)} }
      `}</style>

      {/* Minimal header */}
      <header className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-3">
        <button onClick={() => setPickerOpen(true)} className="flex items-center gap-1.5 min-w-0">
          <img src={logoUrl} alt="" className="h-6 w-auto" />
          <span className="truncate text-[13px] font-medium text-foreground/70 max-w-[46vw]">{currentName}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border ${down ? "border-rose-300 text-rose-600 bg-rose-50" : restarting ? "border-amber-300 text-amber-700 bg-amber-50" : connected ? "border-emerald-500/30 text-emerald-700 bg-emerald-500/10" : "border-border text-muted-foreground bg-card/70"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${down ? "bg-rose-500" : restarting ? "bg-amber-500" : connected ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
            {down ? "gestopt" : restarting ? "herstarten" : connected ? "verbonden" : "verbinden…"}
          </span>
          <button onClick={() => { const n = !ttsOn; setTtsOn(n); if (!n) stopSpeaking(); }} className={`h-9 w-9 grid place-items-center rounded-full border ${ttsOn ? "border-border bg-card/70 text-foreground" : "border-border bg-card/40 text-muted-foreground"}`} aria-label="Stem aan/uit">
            {ttsOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* The one control: a big Nebula logo */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-8 px-6">
        <button
          onClick={toggleConversation}
          disabled={!projectId}
          className="relative grid place-items-center rounded-full disabled:opacity-40"
          style={{ width: "min(74vw, 340px)", height: "min(74vw, 340px)" }}
          aria-label={conversation ? "Stop" : "Start praten"}
        >
          {listening && <span className="absolute inset-0 rounded-full bg-sky-400/25 animate-ping" />}
          {(mode === "processing" || restarting) && <span className="absolute inset-2 rounded-full border-[3px] border-sky-400/50 border-t-transparent animate-spin" />}
          <span className={`relative grid place-items-center rounded-full shadow-2xl transition-colors ${active ? "bg-sky-500" : down ? "bg-card border border-rose-200" : "bg-card border border-border"}`} style={{ width: "82%", height: "82%" }}>
            <img
              src={logoUrl}
              alt="Nebula"
              style={{ width: "62%", height: "auto", animation: listening ? "nebulaSpin 3s ease-in-out infinite" : (mode === "speaking" ? "nebulaBreath 1.6s ease-in-out infinite" : "none"), filter: active ? "brightness(0) invert(1)" : "none" }}
            />
          </span>
        </button>

        <div className="h-6 flex items-center gap-2 text-[15px] text-foreground/70 text-center px-4">
          {mode === "processing" && <Loader2 className="h-4 w-4 animate-spin" />}
          <span>{statusLabel}</span>
        </div>
      </div>

      {notice && <div className="shrink-0 mx-4 mb-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2 text-center">{notice}</div>}

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
              <button key={p.id} onClick={() => { if (p.id !== projectId) { setConv(false); releaseMic(); stopSpeaking(); setModeS("idle"); setDown(false); everConnRef.current = false; setConnected(false); } setProjectId(p.id); setPickerOpen(false); }}
                className={`w-full text-left px-4 py-3 text-sm border-b border-border/60 ${p.id === projectId ? "font-medium bg-muted/50" : "text-foreground/80"}`}>{p.name}</button>
            ))}
          </div>
        </div>
      )}

      {/* Hidden engine: the real Claude Code terminal, off-screen but full-size so the socket, send() and
          reply extraction all work. Auto-restarts if Claude drops. */}
      {projectId > 0 && (
        <div aria-hidden="true" style={{ position: "fixed", left: -99999, top: 0, width: 820, height: 560, opacity: 0, pointerEvents: "none", zIndex: -1, overflow: "hidden" }}>
          <ClaudeTerminal
            key={`${projectId}:${termKey}`}
            ref={termRef}
            projectId={projectId}
            className="absolute inset-0"
            autoRestart
            onStatus={onTermStatus}
            onConnected={(c) => { if (c) { everConnRef.current = true; setConnected(true); } }}
            onExit={onTermExit}
            onAssistantText={(text) => onClaudeReply(text)}
          />
        </div>
      )}
    </div>
  );
}
