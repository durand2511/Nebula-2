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
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
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

export default router;
