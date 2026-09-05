/**
 * Nebula Assistent — the mobile PWA voice front-end for Claude Code.
 *
 * You talk (mic → Whisper → Dutch text), the text is fired straight into your live server-side Claude
 * Code session (the same persistent PTY the web editor uses, so changes go live without the web app
 * open), and Claude talks back out loud (its reply is read from the terminal buffer → speech synthesis).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ClaudeTerminal, type ClaudeTerminalHandle } from "@/components/claude-terminal";
import { getToken, setToken } from "@/lib/session";
import { Mic, Square, Volume2, VolumeX, Send, Loader2, ChevronDown } from "lucide-react";

type Project = { id: number; name: string };

const LAST_KEY = "nebula_assistant_project";

function pickAudioMime(): string {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"];
  for (const c of cands) { try { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignore */ } }
  return "";
}

export default function Assistant() {
  const [authState, setAuthState] = useState<"checking" | "in" | "out">("checking");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const termRef = useRef<ClaudeTerminalHandle>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false); // Claude is werken/nadenken

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const [ttsOn, setTtsOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>("");

  // login form state
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

  // ---- auth + projects ----
  useEffect(() => {
    if (!getToken()) { setAuthState("out"); return; }
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((me) => {
      if (!me || !me.user?.id) { setAuthState("out"); return; }
      setAuthState("in");
      loadProjects();
    }).catch(() => setAuthState("out"));
  }, []);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoginBusy(true); setLoginErr("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const j = await r.json();
      if (!r.ok || !j.token) { setLoginErr(j.error || "Inloggen mislukt."); return; }
      setToken(j.token);
      setPassword("");
      setAuthState("in");
      loadProjects();
    } catch { setLoginErr("Inloggen mislukt — controleer je verbinding."); }
    finally { setLoginBusy(false); }
  }

  useEffect(() => { if (projectId) { try { localStorage.setItem(LAST_KEY, String(projectId)); } catch { /* ignore */ } } }, [projectId]);

  const currentName = useMemo(() => projects.find((p) => p.id === projectId)?.name || "Kies project", [projects, projectId]);

  // ---- speech OUT (Claude praat terug) ----
  const lastSpokenRef = useRef("");
  function speak(text: string) {
    if (!ttsOn || !text) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (text === lastSpokenRef.current) return;
    lastSpokenRef.current = text;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "nl-NL";
      const nl = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("nl"));
      if (nl) u.voice = nl;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
  function stopSpeaking() { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } setSpeaking(false); }

  // ---- send to Claude ----
  function sendToClaude(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const ok = termRef.current?.send(clean + "\r");
    if (!ok) { setNotice("Nog niet verbonden met Claude — momentje…"); setTimeout(() => setNotice(""), 2500); return; }
    setHeard(clean);
    setBusy(true);
  }

  // ---- speech IN (mic → Whisper) ----
  async function startRecording() {
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMime();
      mimeRef.current = mime;
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
        await transcribe(blob);
      };
      recorderRef.current = mr;
      mr.start(250); // timeslice → chunks accumulate steadily (more robust on iOS/Android)
      setRecording(true);
    } catch {
      setNotice("Geen toegang tot de microfoon. Sta het toe in je browser-instellingen.");
      setTimeout(() => setNotice(""), 4000);
    }
  }
  function stopRecording() { try { recorderRef.current?.stop(); } catch { /* ignore */ } setRecording(false); }

  async function transcribe(blob: Blob) {
    if (blob.size < 600) { setNotice("Niets opgenomen — houd de knop langer vast en praat."); setTimeout(() => setNotice(""), 3500); return; }
    setTranscribing(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
      const r = await fetch("/api/voice/transcribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: dataUrl }),
      });
      let j: { text?: string; error?: string } = {};
      try { j = await r.json(); } catch { /* non-JSON error body */ }
      if (!r.ok) {
        const msg = j.error
          || (r.status === 413 ? "Opname te groot voor de server."
            : r.status === 503 ? "Spraak-naar-tekst staat nog niet aan op de server (OpenAI-sleutel ontbreekt)."
            : r.status === 401 ? "Je bent uitgelogd — log opnieuw in."
            : `Transcriptie mislukt (fout ${r.status}).`);
        setNotice(msg); setTimeout(() => setNotice(""), 5000); return;
      }
      const text = String(j.text || "").trim();
      if (!text) { setNotice("Niets verstaan — probeer opnieuw, iets luider."); setTimeout(() => setNotice(""), 3000); return; }
      sendToClaude(text);
    } catch {
      setNotice("Geen verbinding met de server.");
      setTimeout(() => setNotice(""), 3000);
    } finally { setTranscribing(false); }
  }

  // Warm the voice list (Safari populates async).
  useEffect(() => { try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ } }, []);

  if (authState === "checking") {
    return <div className="min-h-[100dvh] grid place-items-center bg-[#0f0e14] text-white/60"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (authState === "out") {
    return (
      <div className="grid place-items-center bg-[#0f0e14] px-6" style={{ minHeight: "100dvh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <form onSubmit={doLogin} className="w-full max-w-sm">
          <div className="text-center mb-7">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-white/10 grid place-items-center mb-4"><Mic className="h-7 w-7 text-white" /></div>
            <div className="text-2xl font-semibold text-white">Nebula Assistent</div>
            <p className="mt-2 text-white/55 text-sm leading-relaxed">Log in met je eigen account. Daarna is de app gekoppeld en kun je praten met Claude.</p>
          </div>
          <input
            type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mailadres"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[15px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/25 mb-3"
          />
          <input
            type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Wachtwoord"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[15px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
          />
          {loginErr && <p className="mt-3 text-[13px] text-rose-300">{loginErr}</p>}
          <button type="submit" disabled={loginBusy} className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white text-black font-semibold py-3 disabled:opacity-50">
            {loginBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Inloggen
          </button>
          <p className="mt-5 text-center text-[13px] text-white/40">
            Nog geen account? <a href="/" className="text-white/70 underline">Maak er een aan op nebulabookings.com</a>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-[#0f0e14] text-white" style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Header */}
      <header className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-3 border-b border-white/10">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold tracking-tight">Nebula Assistent</div>
          <button onClick={() => setPickerOpen((v) => !v)} className="mt-0.5 flex items-center gap-1 text-[12px] text-white/55 max-w-[62vw] truncate">
            <span className="truncate">{currentName}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border ${connected ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/10" : "border-white/15 text-white/50"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-white/40"}`} />
            {connected ? "verbonden" : "verbinden…"}
          </span>
          <button onClick={() => { const n = !ttsOn; setTtsOn(n); if (!n) stopSpeaking(); }} className={`h-9 w-9 grid place-items-center rounded-full border ${ttsOn ? "border-white/20 text-white" : "border-white/10 text-white/40"}`} aria-label="Stem aan/uit">
            {ttsOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Project picker sheet */}
      {pickerOpen && (
        <div className="absolute inset-0 z-20 bg-black/50" onClick={() => setPickerOpen(false)}>
          <div className="absolute left-0 right-0 top-0 bg-[#17151f] border-b border-white/10 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <div className="px-4 py-3 text-[12px] uppercase tracking-wide text-white/40">Kies een website</div>
            {projects.length === 0 && <div className="px-4 pb-4 text-sm text-white/50">Nog geen projecten.</div>}
            {projects.map((p) => (
              <button key={p.id} onClick={() => { setProjectId(p.id); setPickerOpen(false); lastSpokenRef.current = ""; }}
                className={`w-full text-left px-4 py-3 text-sm border-t border-white/5 ${p.id === projectId ? "text-white bg-white/5" : "text-white/70"}`}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Live Claude terminal (the engine) */}
      <div className="flex-1 min-h-0 relative">
        {projectId ? (
          <ClaudeTerminal
            key={projectId}
            ref={termRef}
            projectId={projectId}
            className="absolute inset-0"
            onStatus={(s) => { setConnected(s === "open"); }}
            onAssistantText={(text) => { setBusy(false); speak(text); }}
            onFilesChanged={() => { /* live via DB↔disk bridge */ }}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-white/40 text-sm">Kies eerst een website hierboven.</div>
        )}
        {/* Heard / speaking chips */}
        {(heard || speaking || busy) && (
          <div className="absolute left-3 right-3 bottom-3 flex flex-col gap-1.5 pointer-events-none">
            {heard && <div className="self-end max-w-[85%] text-[13px] bg-white/10 backdrop-blur rounded-2xl rounded-br-md px-3 py-1.5">{heard}</div>}
            {(speaking || busy) && (
              <div className="self-start inline-flex items-center gap-2 text-[12px] text-white/70 bg-black/40 backdrop-blur rounded-full px-3 py-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {speaking ? "Claude praat…" : "Claude werkt…"}
              </div>
            )}
          </div>
        )}
      </div>

      {notice && <div className="shrink-0 px-4 py-2 text-[12px] text-amber-300 bg-amber-500/10 border-t border-amber-500/20">{notice}</div>}

      {/* Voice + text bar */}
      <div className="shrink-0 px-3 pt-2 pb-3 border-t border-white/10 flex items-center gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) { sendToClaude(typed); setTyped(""); } }}
          placeholder="Typ of houd de knop ingedrukt…"
          className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-[14px] placeholder:text-white/30 focus:outline-none focus:border-white/25"
        />
        {typed.trim() ? (
          <button onClick={() => { sendToClaude(typed); setTyped(""); }} className="h-11 w-11 shrink-0 grid place-items-center rounded-full bg-white text-black">
            <Send className="h-4.5 w-4.5" />
          </button>
        ) : (
          <button
            onClick={() => (recording ? stopRecording() : startRecording())}
            disabled={transcribing || !projectId}
            className={`h-14 w-14 shrink-0 grid place-items-center rounded-full transition-all ${recording ? "bg-rose-500 scale-105 shadow-[0_0_0_6px_rgba(244,63,94,0.25)]" : "bg-white text-black"} disabled:opacity-40`}
            aria-label={recording ? "Stop opname" : "Start opname"}
          >
            {transcribing ? <Loader2 className="h-6 w-6 animate-spin text-white" /> : recording ? <Square className="h-5 w-5 text-white" fill="currentColor" /> : <Mic className="h-6 w-6" />}
          </button>
        )}
      </div>
    </div>
  );
}
