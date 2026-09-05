/**
 * Voice transcription for the mobile assistant (PWA): the phone records audio and posts it as a base64
 * data URL; we forward it to OpenAI Whisper with language=nl and return clean Dutch text, which the app
 * then drops straight into the user's live Claude Code session.
 */
import { Router, type IRouter } from "express";
import express from "express";
import { getSessionUser, tokenFrom } from "../lib/platform-auth.js";
import { runAgentEdit } from "../lib/agent-editor.js";
import { isClaudeConnected, prepareUserClaudeEnv } from "../lib/claude-terminal.js";
import { buildVoiceTools } from "../lib/voice-tools.js";
import { getSubdomain, listDomains, PLATFORM_HOST } from "../lib/domains.js";
import { publishSite, isPublished } from "../lib/site-publish.js";
import { db, projects } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// The live domain to show / speak: a connected custom domain wins, otherwise the free Nebula subdomain.
async function liveDomain(projectId: number): Promise<string | null> {
  try {
    const customs = (await listDomains(projectId)).filter((d) => !d.domain.endsWith("." + PLATFORM_HOST) && !d.redirectTo);
    if (customs.length) return customs[0].domain;
    const sub = await getSubdomain(projectId);
    return sub?.domain || null;
  } catch { return null; }
}

// The voice assistant is a chatty helper, not a rigid editor: it talks naturally, varies its wording,
// chats back when you're just greeting, and only edits the site when clearly asked.
const VOICE_SYSTEM_PROMPT = [
  "Je bent de spraakassistent van Nebula voor deze website. Je praat Nederlands, kort en natuurlijk — als een behulpzame, vriendelijke collega. Wissel je bewoordingen af; geef niet steeds exact hetzelfde antwoord.",
  "",
  "HOE JE REAGEERT:",
  "- Je krijgt soms 'RECENT GESPREK' mee als context. Gebruik dat om vervolgvragen te snappen ('doe dat maar', 'herhaal', 'nee anders'). Voer alleen de NIEUWE VRAAG uit; verzin geen nieuwe opdracht als je iets niet begrijpt — vraag dan kort door.",
  "- Werk SNEL en gericht: lees alleen de bestanden die je echt nodig hebt en doe precies wat gevraagd is, niets extra. Niet onnodig rondkijken.",
  "- Als de gebruiker groet of even kletst, klets kort en gezellig terug. Ga dan NIET in de bestanden graven.",
  "- Als de gebruiker een wijziging aan de site vraagt, voer die uit (lees een bestand vóór je het bewerkt) en vertel in 1–2 zinnen wat je hebt gedaan.",
  "- Houd het altijd kort genoeg om hardop voorgelezen te worden: gewone spreektaal, geen opsommingen, geen code, geen bestandsnamen, GEEN emoji's in je antwoord.",
  "",
  "DE HELE SITE, NIET ALLEEN DE HOMEPAGE:",
  "- De website heeft MEERDERE pagina's. Gebruik Glob (bijv. **/*.html) om ze allemaal te vinden en kijk verder dan alleen index.html / de landingspagina.",
  "- Bij een site-brede wijziging (kleuren, lettertype, menu, footer, contactgegevens) pas je die toe op ELKE relevante pagina — of, als het via de gedeelde CSS kan, in het CSS-bestand dat op alle pagina's geldt.",
  "",
  "WAT JE ALLEMAAL KUNT (gebruik hiervoor je gereedschap):",
  "- Statistieken / bezoekers: roep bekijk_statistieken aan (bezoekers, verkeer, wie er nu online is).",
  "- Analyse: roep bekijk_analyse aan met soort 'seo', 'toegankelijkheid' of 'snelheid'. Vraagt de gebruiker de punten op te lossen? Bekijk de analyse en pas daarna zelf de bestanden aan.",
  "- Google-posities: roep bekijk_google_posities aan (ranking/vindbaarheid in Google).",
  "- Concurrent vergelijken: roep vergelijk_concurrent aan met de URL van de concurrent.",
  "- Automatische SEO: roep zet_auto_seo aan (aan/uit).",
  "- Agenda (alleen als er een boekingssysteem is): bekijk_agenda toont de geplande lessen; voeg_les_toe zet een les in de agenda (datum jaar-maand-dag, tijd HH:MM); verwijder_les haalt een les weg. Reken data zelf uit met de datum van vandaag (zie onder).",
  "- Back-up: roep maak_backup aan.",
  "- Publiceren/deployen: roep publiceer_site aan ALLEEN als de gebruiker duidelijk om live zetten/publiceren/deployen vraagt. Zegt de gebruiker 'nog niet' of 'straks'? Doe het NIET, bevestig kort en bied aan het later te doen. Wijzigingen staan tot die tijd in concept.",
  "- Vertel na een gereedschap kort in spreektaal wat het resultaat was.",
  "",
  "Het is een kleine statische website (HTML/CSS/JS) in de huidige map. Verander alleen wat gevraagd is en laat de rest intact.",
].join("\n");

const router: IRouter = Router();

// ── Conversation memory ──────────────────────────────────────────────────────────────────────────
// Per (user, project) short-term memory so follow-ups like "doe dat maar" / "herhaal" keep context.
// In-memory, last few turns, expires after 30 min idle.
type Turn = { role: "user" | "assistant"; text: string };
const convo = new Map<string, { turns: Turn[]; at: number }>();
const CONVO_TTL = 30 * 60 * 1000;
function historyFor(key: string): Turn[] {
  const e = convo.get(key);
  if (!e) return [];
  if (Date.now() - e.at > CONVO_TTL) { convo.delete(key); return []; }
  return e.turns;
}
function remember(key: string, user: string, assistant: string): void {
  const e = convo.get(key) || { turns: [] as Turn[], at: 0 };
  e.turns.push({ role: "user", text: user }, { role: "assistant", text: assistant });
  e.turns = e.turns.slice(-8); // last 4 exchanges
  e.at = Date.now();
  convo.set(key, e);
  if (convo.size > 500) { const oldest = [...convo.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) convo.delete(oldest[0]); }
}

// ── Live progress ────────────────────────────────────────────────────────────────────────────────
// While the agent works, the app can poll /voice/progress to show "waar is Claude nu mee bezig".
const progress = new Map<string, { activity: string; at: number }>();
function setProgress(key: string, activity: string): void { progress.set(key, { activity, at: Date.now() }); }
function progressText(e: Record<string, unknown>): string | null {
  if (e.type === "status" && e.message) return String(e.message).slice(0, 120);
  if (e.type === "agent") {
    const p = e.path ? ` ${String(e.path)}` : "";
    if (e.event === "file_read") return `Bekijkt${p}`;
    if (e.event === "patch_applied" || e.event === "file_saved") return `Past${p} aan`;
  }
  return null;
}

// Strip emoji + pictographs so the text-to-speech voice doesn't read them out (or trip over them).
function stripForSpeech(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

// When a user's own-subscription run fails, skip it for a while so requests don't keep eating a slow
// fallback — use the fast, proven platform key instead.
const ownSubBroken = new Map<number, number>();
const OWN_SUB_COOLDOWN = 10 * 60 * 1000;
function ownSubBrokenUntil(userId: number): boolean {
  const t = ownSubBroken.get(userId);
  if (!t) return false;
  if (Date.now() > t) { ownSubBroken.delete(userId); return false; }
  return true;
}
function markOwnSubBroken(userId: number): void { ownSubBroken.set(userId, Date.now() + OWN_SUB_COOLDOWN); }

async function ownsProject(userId: number, projectId: number): Promise<boolean> {
  if (!projectId) return false;
  const [p] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
  return !!p && (p.ownerId == null || p.ownerId === userId);
}

const OPENAI_KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "";
const OPENAI_BASE = (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

router.post("/voice/transcribe", express.json({ limit: "30mb" }), async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  if (!OPENAI_KEY) {
    res.status(503).json({ error: "Spraak-naar-tekst staat nog niet aan op de server (OPENAI-sleutel ontbreekt)." });
    return;
  }
  try {
    const dataUrl = String(req.body?.audio || "");
    // Tolerant parse: the data URL may carry codecs (e.g. "data:audio/webm;codecs=opus;base64,…" on
    // Android) — capture the base MIME up to the first ; or , and take everything after "base64,".
    const m = dataUrl.match(/^data:([^;,]+)[^,]*base64,(.+)$/s);
    if (!m) { res.status(400).json({ error: "Geen audio ontvangen." }); return; }
    const mime = m[1] || "audio/webm";
    const buf = Buffer.from(m[2], "base64");
    if (buf.length < 800) { res.json({ text: "" }); return; } // effectively silence → nothing to transcribe

    const ext =
      mime.includes("mp4") || mime.includes("m4a") ? "m4a"
      : mime.includes("mpeg") || mime.includes("mp3") ? "mp3"
      : mime.includes("wav") ? "wav"
      : mime.includes("ogg") ? "ogg"
      : "webm";

    const form = new FormData();
    form.append("file", new Blob([buf], { type: mime }), `audio.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", "nl");
    form.append("response_format", "json");

    const r = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form as unknown as BodyInit,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      logger.error({ status: r.status, body: t.slice(0, 400) }, "[voice] whisper failed");
      res.status(502).json({ error: "Transcriptie mislukt." });
      return;
    }
    const j = (await r.json()) as { text?: string };
    res.json({ text: String(j.text || "").trim() });
  } catch (err) {
    logger.error({ err }, "[voice] transcribe error");
    res.status(500).json({ error: "Transcriptie mislukt." });
  }
});

// Natural text-to-speech: turn Claude's reply into a warm human voice (OpenAI TTS) instead of the
// robotic built-in phone voice. Returns MP3 audio the app plays back. Small request body, so it can
// ride the standard 1MB JSON parser.
router.post("/voice/speak", express.json({ limit: "256kb" }), async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  if (!OPENAI_KEY) { res.status(503).json({ error: "Stem staat nog niet aan op de server." }); return; }
  const text = String(req.body?.text || "").trim().slice(0, 1200);
  if (!text) { res.status(400).json({ error: "Geen tekst." }); return; }
  const voice = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(String(req.body?.voice)) ? String(req.body.voice) : "nova";
  try {
    const r = await fetch(`${OPENAI_BASE}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1", voice, input: text, response_format: "mp3", speed: 1.0 }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); logger.error({ status: r.status, body: t.slice(0, 300) }, "[voice] tts failed"); res.status(502).json({ error: "Stem mislukt." }); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (err) {
    logger.error({ err }, "[voice] tts error");
    res.status(500).json({ error: "Stem mislukt." });
  }
});

// Background tasks so the user can ask "hoe gaat het?" WHILE the agent keeps working. A task runs in
// the background; the app polls /voice/result for the answer. A new message while a task runs is treated
// as an interjection and answered with the live status, without disturbing the running task.
type TaskState = { running: boolean; result: { ok: boolean; text: string; domain: string | null } | null; at: number };
const tasks = new Map<string, TaskState>();
// Short, varied spoken acknowledgements so a command gets an INSTANT reply before the work is done.
const ACKS = ["Oké, ik pak het op!", "Doe ik, momentje.", "Ja hoor, komt goed.", "Oké, ik ga ermee aan de slag.", "Prima, ik regel het even.", "Komt in orde, momentje.", "Top, ik ga het doen.", "Oké, ik kijk er even naar."];
function statusReply(key: string): string {
  const a = progress.get(key)?.activity || "";
  const nice = a && a !== "Aan het werk…" ? ` Ik ben nu bezig met ${a.toLowerCase()}.` : "";
  return `Ik ben er nog mee bezig.${nice} Momentje, ik laat het weten zodra ik klaar ben.`;
}

// Run one voice task end to end (agent → auto-republish → reply). Same reliable engine as the editor.
async function executeTask(userId: number, projectId: number, message: string): Promise<{ ok: boolean; text: string; domain: string | null }> {
  const tools = buildVoiceTools(projectId);
  const vandaag = new Date().toLocaleDateString("nl-NL", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const sys = `${VOICE_SYSTEM_PROMPT}\n\nVandaag is ${vandaag}. Gebruik dit om data uit te rekenen (bijvoorbeeld 'volgende maandag' → de juiste datum in jaar-maand-dag).`;
  const convoKey = `${userId}:${projectId}`;
  const history = historyFor(convoKey);
  const historyText = history.length ? "RECENT GESPREK (alleen als context, NIET opnieuw uitvoeren):\n" + history.map((t) => `${t.role === "user" ? "Gebruiker" : "Jij"}: ${t.text}`).join("\n") + "\n\n" : "";
  const prompt = `${historyText}NIEUWE VRAAG: ${message}`;
  setProgress(convoKey, "Aan het werk…");
  const emit = (e: Record<string, unknown>) => { const t = progressText(e); if (t) setProgress(convoKey, t); };
  const base = { projectId, prompt, emit, systemPromptOverride: sys, mcpServers: tools.mcpServers, extraAllowedTools: tools.allowedTools, model: "claude-haiku-4-5-20251001", maxTurns: 40 } as const;

  async function runOnce(extra: Record<string, unknown>, ms: number) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try { return await runAgentEdit({ ...base, ...extra, abortController: ac }); }
    finally { clearTimeout(timer); }
  }
  async function run() {
    if (!ownSubBrokenUntil(userId) && await isClaudeConnected(userId)) {
      const own = await prepareUserClaudeEnv(userId);
      if (own.connected) {
        try { return await runOnce({ subprocessEnv: own.env, model: null }, 90000); }
        catch (err) { markOwnSubBroken(userId); logger.warn({ err, projectId }, "[voice] own-subscription run failed — using platform key for a while"); }
      }
    }
    try { return await runOnce({}, 120000); }
    catch (err) { logger.warn({ err, projectId }, "[voice] platform Haiku run failed — retrying on Sonnet"); return await runOnce({ model: "claude-sonnet-4-5" }, 120000); }
  }
  const r = await run();
  const edited = r.changed.length + r.created.length + r.deleted.length;
  if (edited > 0) { try { if (await isPublished(projectId)) await publishSite(projectId); } catch (err) { logger.warn({ err, projectId }, "[voice] auto-republish failed"); } }
  const domain = await liveDomain(projectId);
  const text = stripForSpeech((r.finalText || "").trim()) || (edited > 0 ? "Klaar, ik heb het aangepast." : "Oké!");
  remember(convoKey, message, text);
  return { ok: r.ok, text, domain };
}

router.post("/voice/ask", express.json({ limit: "256kb" }), async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const projectId = Number(req.body?.projectId) || 0;
  const message = String(req.body?.message || "").trim().slice(0, 2000);
  if (!message) { res.status(400).json({ error: "Geen bericht." }); return; }
  if (!(await ownsProject(u.id, projectId))) { res.status(403).json({ error: "Geen toegang tot dit project." }); return; }
  const key = `${u.id}:${projectId}`;
  // Already working? Answer the interjection with the live status; leave the running task alone.
  if (tasks.get(key)?.running) { res.json({ busy: true, text: statusReply(key) }); return; }
  // Otherwise start the task in the background and return IMMEDIATELY with a short spoken ack (varied),
  // so the user hears "oké, ik pak het op" right away instead of waiting/loading. The app then polls
  // /voice/result for the real answer.
  tasks.set(key, { running: true, result: null, at: Date.now() });
  executeTask(u.id, projectId, message)
    .then((result) => tasks.set(key, { running: false, result, at: Date.now() }))
    .catch((err) => { logger.error({ err, projectId }, "[voice] task failed"); tasks.set(key, { running: false, result: { ok: false, text: "Ik kon dit even niet uitvoeren. Probeer het opnieuw.", domain: null }, at: Date.now() }); progress.delete(key); });
  const ack = ACKS[Math.floor(Math.random() * ACKS.length)];
  res.json({ busy: false, started: true, ack });
});

// The app polls this for the final answer while the task runs in the background.
router.get("/voice/result", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const projectId = Number(req.query.projectId) || 0;
  const key = `${u.id}:${projectId}`;
  const t = tasks.get(key);
  if (!t) { res.json({ running: false, done: false }); return; }
  if (t.running) { res.json({ running: true, activity: progress.get(key)?.activity || "" }); return; }
  tasks.delete(key); progress.delete(key);
  res.json({ running: false, done: true, text: t.result?.text || "Oké!", domain: t.result?.domain ?? null });
});

// Publish status for the app header: the live domain (custom > Nebula subdomain), or null.
router.get("/voice/publish-status", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const projectId = Number(req.query.projectId) || 0;
  if (!(await ownsProject(u.id, projectId))) { res.status(403).json({ error: "Geen toegang." }); return; }
  res.json({ domain: await liveDomain(projectId) });
});

export default router;
