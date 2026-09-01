/** Claude Code-koppeling: status + ontkoppelen. The terminal itself is a WebSocket (see lib/claude-terminal.ts). */
import { Router, type IRouter } from "express";
import { getSessionUser, tokenFrom } from "../lib/platform-auth.js";
import { isClaudeConnected, disconnectClaude } from "../lib/claude-terminal.js";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/claude/status", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  res.json({ connected: await isClaudeConnected(u.id) });
});

router.post("/claude/disconnect", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  try { await disconnectClaude(u.id); res.json({ ok: true }); }
  catch (err) { logger.error({ err }, "[claude] disconnect failed"); res.status(500).json({ error: "Ontkoppelen mislukt." }); }
});

export default router;
