/**
 * Nebula Assistent — mobile PWA voice assistant.
 *
 * Pure voice: tap the big Nebula logo → it rotates + breathes while listening → you talk → it auto-stops
 * on silence → Whisper transcribes → the text goes to /api/voice/ask, which runs the Claude Agent SDK
 * (on the customer's own coupled Claude subscription) against the site and returns a clean, natural
 * reply → Claude SPEAKS it back with a warm voice. No terminal, no scraping — reliable request→answer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getToken, setToken, clearToken } from "@/lib/session";
import { bgUrl } from "@/lib/background";
import logoUrl from "../assets/nebula-logo.png";
import { Volume2, VolumeX, Loader2, ChevronDown, X, LogOut, ExternalLink, Globe } from "lucide-react";

type Project = { id: number; name: string };
type Mode = "idle" | "listening" | "processing" | "speaking";

const LAST_KEY = "nebula_assistant_project";

function pickAudioMime(): string {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"];
  for (const c of cands) { try { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignore */ } }
  return "";
}

// A tiny valid silent WAV — played once inside the first tap to UNLOCK the <audio> element, so later
// (async) speech is allowed and keeps playing even when the screen is off.
function silentWavUrl(): string {
  const sr = 8000, n = 400; const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export default function Assistant() {
  const [authState, setAuthState] = useState<"checking" | "out" | "in">("checking");
  const [showForm, setShowForm] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>(0);
  const projectRef = useRef(0); projectRef.current = projectId;
  const [pickerOpen, setPickerOpen] = useState(false);

  const [mode, setMode] = useState<Mode>("idle");
  const modeRef = useRef<Mode>("idle");
  const setModeS = (m: Mode) => { modeRef.current = m; setMode(m); };
  const convRef = useRef(false);
  const [, force] = useState(0);
  const setConv = (v: boolean) => { convRef.current = v; force((n) => n + 1); };
  const reqRef = useRef(0); // guards against a stale answer speaking after you stopped

  const [ttsOn, setTtsOn] = useState(true);
  const ttsRef = useRef(true); ttsRef.current = ttsOn;
  const [notice, setNotice] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);

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

  const [publishDomain, setPublishDomain] = useState<string | null>(null);
  useEffect(() => { if (projectId) { try { localStorage.setItem(LAST_KEY, String(projectId)); } catch { /* ignore */ } } }, [projectId]);
  useEffect(() => {
    if (!projectId) { setPublishDomain(null); return; }
    fetch(`/api/voice/publish-status?projectId=${projectId}`).then((r) => (r.ok ? r.json() : null)).then((d) => setPublishDomain(d?.domain || null)).catch(() => {});
  }, [projectId]);
  useEffect(() => { try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ } }, []);
  useEffect(() => () => { releaseMic(); stopSpeaking(); stopPolling(); }, []);

  // Phone woke up: resume audio and grab any answer that finished while the screen was off (the task
  // keeps running server-side; polling pauses when the tab is hidden).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      try { if (audioCtxRef.current?.state === "suspended") void audioCtxRef.current.resume(); } catch { /* ignore */ }
      if (taskActiveRef.current && projectRef.current) {
        fetch(`/api/voice/result?projectId=${projectRef.current}`).then((r) => r.json()).then((j) => {
          if (j && !j.running && j.done) { stopPolling(); if (j.domain !== undefined) setPublishDomain(j.domain || null); enqueueSpeak(String(j.text || "").trim() || "Klaar.", true); }
        }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

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

  function logout() {
    setConv(false); releaseMic(); stopSpeaking(); stopPolling(); setModeS("idle");
    clearToken(); setProjects([]); setProjectId(0); setPickerOpen(false); setShowForm(false); setAuthState("out");
  }

  const currentName = useMemo(() => projects.find((p) => p.id === projectId)?.name || "website", [projects, projectId]);

  // ---- speech OUT (queued so the instant ack and the final answer never overlap) ----
  const speakQ = useRef<{ text: string; final: boolean }[]>([]);
  const speakingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskActiveRef = useRef(false);
  const dropRecordingRef = useRef(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null); // real <audio> so speech keeps playing with the screen off

  // Hands-free: after Claude answers, listen again for a follow-up. The noise filter + the 7s no-speech
  // stop means it ends cleanly when you're actually done (instead of looping on background noise).
  function afterResult() { if (convRef.current) startListen(); else setModeS("idle"); }

  function enqueueSpeak(text: string, final: boolean) {
    if (!ttsRef.current || !text) { if (final) afterResult(); return; }
    speakQ.current.push({ text, final });
    if (!speakingRef.current) void drainSpeak();
  }

  async function drainSpeak() {
    speakingRef.current = true;
    setModeS("speaking");
    while (speakQ.current.length) {
      const item = speakQ.current.shift()!;
      await speakOne(item.text);
      if (item.final) { speakingRef.current = false; afterResult(); return; }
    }
    speakingRef.current = false;
    if (taskActiveRef.current) setModeS("processing");   // asides done, task still running
    else if (convRef.current) startListen();             // hands-free: listen for the next thing
    else setModeS("idle");
  }

  function speakOne(text: string): Promise<void> {
    return new Promise((resolve) => {
      void (async () => {
        try {
          const r = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: "nova" }) });
          if (r.ok) {
            const buf = await r.arrayBuffer();
            if (await playViaAudioEl(new Blob([buf], { type: "audio/mpeg" }))) { resolve(); return; } // plays with screen off
            if (await playViaContext(buf)) { resolve(); return; }                                     // proven fallback (foreground)
          }
        } catch { /* fall through to the browser voice */ }
        speakBrowserOnce(text, resolve);
      })();
    });
  }

  // Play through the <audio> element (unlike Web Audio, an <audio> that started keeps playing when the
  // screen locks — like a music app). Media Session marks it as playing media.
  function playViaAudioEl(blob: Blob): Promise<boolean> {
    return new Promise((resolve) => {
      const el = audioElRef.current;
      if (!el) { resolve(false); return; }
      const url = URL.createObjectURL(blob);
      let safety: ReturnType<typeof setTimeout> | null = null;
      const done = (ok: boolean) => { if (safety) clearTimeout(safety); el.onended = null; el.onerror = null; try { URL.revokeObjectURL(url); } catch { /* ignore */ } resolve(ok); };
      el.onended = () => done(true);
      el.onerror = () => done(false);
      try {
        el.src = url;
        try { if ("mediaSession" in navigator) { navigator.mediaSession.metadata = new MediaMetadata({ title: "Nebula Assistent", artist: "Claude" }); navigator.mediaSession.playbackState = "playing"; } } catch { /* ignore */ }
        el.play().then(() => { safety = setTimeout(() => done(true), 90000); }).catch(() => done(false));
      } catch { done(false); }
    });
  }

  // Proven foreground fallback (Web Audio) if the <audio> element can't play.
  function playViaContext(buf: ArrayBuffer): Promise<boolean> {
    return new Promise((resolve) => {
      const ac = audioCtxRef.current;
      if (!ac || ac.state === "closed") { resolve(false); return; }
      let safety: ReturnType<typeof setTimeout> | null = null;
      const done = (ok: boolean) => { if (safety) clearTimeout(safety); resolve(ok); };
      void (async () => {
        try { if (ac.state === "suspended") await ac.resume(); } catch { /* ignore */ }
        try {
          const audioBuf = await ac.decodeAudioData(buf.slice(0));
          const src = ac.createBufferSource(); src.buffer = audioBuf; src.connect(ac.destination);
          ttsSourceRef.current = src;
          safety = setTimeout(() => done(true), Math.ceil(audioBuf.duration * 1000) + 2500);
          src.onended = () => { if (ttsSourceRef.current === src) ttsSourceRef.current = null; done(true); };
          src.start();
        } catch { done(false); }
      })();
    });
  }

  function speakBrowserOnce(text: string, done: () => void) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { done(); return; }
    let called = false;
    const finish = () => { if (called) return; called = true; done(); };
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = "nl-NL";
      const voices = window.speechSynthesis.getVoices();
      const nl = voices.find((v) => /^nl/i.test(v.lang) && /google|enhanced|premium|natural|siri/i.test(v.name)) || voices.find((v) => /^nl/i.test(v.lang) && !v.localService) || voices.find((v) => /^nl/i.test(v.lang));
      if (nl) u.voice = nl;
      u.onend = finish; u.onerror = finish;
      setTimeout(finish, Math.min(15000, 1500 + text.length * 90)); // failsafe: some browsers never fire onend
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch { finish(); }
  }

  function stopSpeaking() { speakQ.current = []; speakingRef.current = false; try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } try { const el = audioElRef.current; if (el) { el.pause(); el.onended = null; el.onerror = null; } } catch { /* ignore */ } try { ttsSourceRef.current?.stop(); } catch { /* ignore */ } ttsSourceRef.current = null; }

  // ---- ask Claude: start a background task, get an INSTANT ack, poll for the real answer ----
  function stopPolling() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } if (ackTimerRef.current) { clearTimeout(ackTimerRef.current); ackTimerRef.current = null; } taskActiveRef.current = false; }

  function startPolling() {
    setModeS("processing");
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const r = await fetch(`/api/voice/result?projectId=${projectRef.current}`);
        const j = await r.json();
        if (j.running) return;              // still working in the background
        stopPolling();
        if (j.done) {
          if (j.domain !== undefined) setPublishDomain(j.domain || null);
          if (modeRef.current === "listening") { dropRecordingRef.current = true; stopListenHard(); } // don't record the answer
          enqueueSpeak(String(j.text || "").trim() || "Klaar.", true);
        }
      } catch { /* keep polling */ }
    };
    pollRef.current = setInterval(poll, 2000);
    poll();
  }

  async function askClaude(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setModeS("processing");
    try {
      const r = await fetch("/api/voice/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: projectRef.current, message: clean }) });
      let j: { started?: boolean; busy?: boolean; ack?: string; text?: string; error?: string } = {};
      try { j = await r.json(); } catch { /* non-JSON */ }
      if (!r.ok) { flash(j.error || (r.status === 401 ? "Je bent uitgelogd — log opnieuw in." : "Er ging iets mis."), 5000); if (convRef.current) startListen(); else setModeS("idle"); return; }
      if (j.busy) { enqueueSpeak(String(j.text || "").trim(), false); return; }   // interjection → instant status
      if (j.started) {
        taskActiveRef.current = true;
        startPolling();
        // Only speak the ack if the answer is SLOW (>3s). A quick chat/question just gets its natural
        // answer, no "Oké, ik hoorde…" ceremony.
        if (j.ack) { ackTimerRef.current = setTimeout(() => { ackTimerRef.current = null; if (taskActiveRef.current) enqueueSpeak(j.ack!, false); }, 5000); }
        return;
      }
    } catch {
      flash("Geen verbinding met de server.", 3500);
      if (convRef.current) startListen(); else setModeS("idle");
    }
  }

  // ---- speech IN (hands-free) ----
  async function ensureStream(): Promise<MediaStream | null> {
    if (streamRef.current) return streamRef.current;
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); streamRef.current = s; return s; }
    catch { flash("Geen toegang tot de microfoon. Sta het toe in je instellingen.", 5000); setConv(false); setModeS("idle"); return null; }
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
      if (dropRecordingRef.current) { dropRecordingRef.current = false; return; } // the answer arrived → discard this recording
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      if (sent) await transcribe(blob);
      else if (convRef.current) setModeS(taskActiveRef.current ? "processing" : "idle");
    };
    recorderRef.current = mr; mr.start(200); setModeS("listening");

    const ac = audioCtxRef.current || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    audioCtxRef.current = ac;
    try { if (ac.state === "suspended") await ac.resume(); } catch { /* ignore */ }
    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const started = Date.now();
    let ambient = 0.02, ambientN = 0;   // learned background-noise level
    let speechStarted = false, lastLoud = started, speechMs = 0;
    vadTimerRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (let i = 0; i < data.length; i++) { const x = (data[i] - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / data.length); const now = Date.now(); const elapsed = now - started;
      // First ~450ms: learn the room's background level, so we only react to speech clearly ABOVE it.
      if (elapsed < 450) { ambient = (ambient * ambientN + rms) / (ambientN + 1); ambientN++; return; }
      const threshold = Math.max(0.05, ambient * 2.5 + 0.02);
      if (rms > threshold) { speechStarted = true; lastLoud = now; speechMs += 80; }
      const finish = (send: boolean) => { sent = send; try { src.disconnect(); } catch { /* ignore */ } try { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* ignore */ } };
      if (speechStarted && now - lastLoud > 3000) { finish(speechMs > 250); }   // spoke, then 3s quiet → send if it was real speech
      else if (!speechStarted && elapsed > 7000) { finish(false); if (!taskActiveRef.current && convRef.current) setConv(false); } // only noise/silence → stop, don't keep looping
      else if (elapsed > 45000) { finish(speechMs > 250); }
    }, 80);
  }

  function stopListenHard() { if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; } try { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* ignore */ } }
  function releaseMic() { stopListenHard(); try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } streamRef.current = null; try { audioCtxRef.current?.close(); } catch { /* ignore */ } audioCtxRef.current = null; }

  const ttsPrimedRef = useRef(false);
  function primeTTS() {
    if (ttsPrimedRef.current || typeof window === "undefined") return;
    try { if ("speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; window.speechSynthesis.speak(u); } } catch { /* ignore */ }
    const el = audioElRef.current;
    if (el) { try { const url = silentWavUrl(); el.src = url; void el.play().then(() => { el.pause(); el.currentTime = 0; try { URL.revokeObjectURL(url); } catch { /* ignore */ } }).catch(() => {}); } catch { /* ignore */ } }
    ttsPrimedRef.current = true;
  }

  function toggleConversation() {
    primeTTS();
    // Working in the background? A tap = ask a quick question ("hoe gaat het?") WITHOUT stopping the work.
    if (taskActiveRef.current && modeRef.current === "processing") { startListen(); return; }
    if (convRef.current) { reqRef.current++; setConv(false); stopSpeaking(); stopListenHard(); stopPolling(); releaseMic(); setModeS("idle"); }
    else { setConv(true); startListen(); }
  }

  // When a task is running, an empty/failed capture must NOT re-open the mic — just go back to waiting.
  const backToWait = () => { if (taskActiveRef.current) setModeS("processing"); else if (convRef.current) startListen(); else setModeS("idle"); };

  // Voice "stop": the user can say "stop maar even" / "laat maar" / "wacht even" to cancel + go quiet.
  function isStopCommand(text: string): boolean {
    const t = text.toLowerCase().replace(/[.!,?]/g, "").trim();
    return /^(stop|stop maar|stop even|stop maar even|stoppen|even stoppen|hou op|houd op|hou maar op|laat maar|laat maar zitten|annuleer|annuleren|wacht|wacht even|niet doen|niks doen|nee laat maar)$/.test(t);
  }
  function doStop() {
    reqRef.current++;
    taskActiveRef.current = false;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    stopListenHard();
    setConv(false);
    speakQ.current = []; speakingRef.current = false;
    enqueueSpeak("Oké, ik stop.", true); // short confirmation, then go idle
  }

  async function transcribe(blob: Blob) {
    if (blob.size < 600) { backToWait(); return; }
    setModeS("processing");
    try {
      const dataUrl: string = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = reject; fr.readAsDataURL(blob); });
      const r = await fetch("/api/voice/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: dataUrl }) });
      let j: { text?: string; error?: string } = {};
      try { j = await r.json(); } catch { /* non-JSON */ }
      if (!r.ok) { const msg = j.error || (r.status === 413 ? "Opname te groot." : r.status === 503 ? "Spraak staat nog niet aan op de server." : r.status === 401 ? "Je bent uitgelogd — log opnieuw in." : `Transcriptie mislukt (fout ${r.status}).`); flash(msg, 5000); if (!taskActiveRef.current) setConv(false); backToWait(); return; }
      const text = String(j.text || "").trim();
      if (!text) { backToWait(); return; }
      if (isStopCommand(text)) { doStop(); return; }  // "stop maar even" → cancel + go quiet
      askClaude(text);
    } catch { flash("Geen verbinding met de server.", 3500); backToWait(); }
  }

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
              <button type="button" onClick={() => setShowForm(false)} className="mt-3 w-full text-[13px] text-muted-foreground">Terug</button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const conversation = convRef.current;
  const listening = mode === "listening";
  const active = listening || conversation;
  const statusLabel = mode === "listening" ? "Ik luister…" : mode === "processing" ? "Claude is bezig…" : mode === "speaking" ? "Claude praat…" : conversation ? "Even stil…" : "Tik op het logo en praat";

  return (
    <div className="light flex flex-col text-foreground" style={{ height: "100dvh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {bgLayer}
      {/* Hidden media element so Claude's voice keeps playing with the screen off (like a music app). */}
      <audio ref={audioElRef} playsInline preload="auto" style={{ display: "none" }} />
      <style>{`
        @keyframes nebulaSpin { 0%{transform:rotate(0deg) scale(1)} 50%{transform:rotate(180deg) scale(1.12)} 100%{transform:rotate(360deg) scale(1)} }
        @keyframes nebulaBreath { 0%,100%{transform:scale(1)} 50%{transform:scale(1.07)} }
      `}</style>

      <header className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-3">
        <button onClick={() => setPickerOpen(true)} className="flex items-center gap-1.5 min-w-0">
          <img src={logoUrl} alt="" className="h-6 w-auto shrink-0" />
          {publishDomain ? (
            <span className="flex items-center gap-1 truncate text-[13px] font-medium text-foreground/75 max-w-[52vw]"><Globe className="h-3.5 w-3.5 text-emerald-600 shrink-0" />{publishDomain}</span>
          ) : (
            <span className="truncate text-[13px] text-foreground/45 max-w-[52vw]">nog niet gepubliceerd</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
        </button>
        <button onClick={() => { const n = !ttsOn; setTtsOn(n); if (!n) stopSpeaking(); }} className={`h-9 w-9 grid place-items-center rounded-full border ${ttsOn ? "border-border bg-card/70 text-foreground" : "border-border bg-card/40 text-muted-foreground"}`} aria-label="Stem aan/uit">
          {ttsOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      </header>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-8 px-6">
        <button onClick={toggleConversation} disabled={!projectId} className="relative grid place-items-center rounded-full disabled:opacity-40" style={{ width: "min(74vw, 340px)", height: "min(74vw, 340px)" }} aria-label={conversation ? "Stop" : "Start praten"}>
          {listening && <span className="absolute inset-0 rounded-full bg-sky-400/25 animate-ping" />}
          {mode === "processing" && <span className="absolute inset-2 rounded-full border-[3px] border-sky-400/50 border-t-transparent animate-spin" />}
          <span className={`relative grid place-items-center rounded-full shadow-2xl transition-colors ${active ? "bg-sky-500" : "bg-card border border-border"}`} style={{ width: "82%", height: "82%" }}>
            <img src={logoUrl} alt="Nebula" style={{ width: "62%", height: "auto", animation: listening ? "nebulaSpin 3s ease-in-out infinite" : (mode === "speaking" ? "nebulaBreath 1.6s ease-in-out infinite" : "none"), filter: active ? "brightness(0) invert(1)" : "none" }} />
          </span>
        </button>
        <div className="h-6 flex items-center gap-2 text-[15px] text-foreground/70 text-center px-4">
          {mode === "processing" && <Loader2 className="h-4 w-4 animate-spin" />}
          <span>{statusLabel}</span>
        </div>
      </div>

      {notice && <div className="shrink-0 mx-4 mb-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2 text-center">{notice}</div>}

      {pickerOpen && (
        <div className="fixed inset-0 z-30 bg-black/30" onClick={() => setPickerOpen(false)}>
          <div className="absolute left-3 right-3 top-3 rounded-2xl border border-border bg-card shadow-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ marginTop: "env(safe-area-inset-top)" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-[13px] font-medium truncate">{currentName}</span>
              <button onClick={() => setPickerOpen(false)} className="text-muted-foreground shrink-0"><X className="h-4 w-4" /></button>
            </div>
            {/* Where the site is live */}
            <div className="px-4 py-3 border-b border-border">
              {publishDomain ? (
                <a href={`https://${publishDomain}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-emerald-700"><Globe className="h-4 w-4 shrink-0" /><span className="truncate">Live op {publishDomain}</span></a>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Globe className="h-4 w-4 shrink-0" /> Nog niet gepubliceerd — zeg “publiceer” om live te gaan.</div>
              )}
            </div>
            {projects.length > 1 && (
              <div>
                <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Wissel website</div>
                {projects.map((p) => (
                  <button key={p.id} onClick={() => { if (p.id !== projectId) { setConv(false); releaseMic(); stopSpeaking(); stopPolling(); setModeS("idle"); reqRef.current++; } setProjectId(p.id); setPickerOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm ${p.id === projectId ? "font-medium bg-muted/50" : "text-foreground/80"}`}>{p.name}</button>
                ))}
              </div>
            )}
            <div className="p-3 flex flex-col gap-1 border-t border-border">
              <a href="/" className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground/80 rounded-lg hover:bg-muted"><ExternalLink className="h-4 w-4" /> Naar nebulabookings.com</a>
              <button onClick={logout} className="flex items-center gap-2 px-3 py-2.5 text-sm text-rose-600 rounded-lg hover:bg-rose-50 text-left"><LogOut className="h-4 w-4" /> Uitloggen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
