/**
 * Voice transcription for the mobile assistant (PWA): the phone records audio and posts it as a base64
 * data URL; we forward it to OpenAI Whisper with language=nl and return clean Dutch text, which the app
 * then drops straight into the user's live Claude Code session.
 */
import { Router, type IRouter } from "express";
import express from "express";
import { getSessionUser, tokenFrom } from "../lib/platform-auth.js";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

export default router;
