/** Claude Code-koppeling: status + ontkoppelen. The terminal itself is a WebSocket (see lib/claude-terminal.ts). */
import { Router, type IRouter } from "express";
import { getSessionUser, tokenFrom } from "../lib/platform-auth.js";
import { isClaudeConnected, disconnectClaude, writeSessionRef, deleteSessionRef } from "../lib/claude-terminal.js";
import { db, projects } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import express from "express";

const router: IRouter = Router();

// Ownership guard: the project must belong to the logged-in user (never another customer's project).
async function ownsProject(userId: number, projectId: number): Promise<boolean> {
  if (!projectId) return false;
  const [p] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
  return !!p && (p.ownerId == null || p.ownerId === userId);
}

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

// Save a reference image (screenshot of a marked area, or an uploaded image) into the user's live
// session workspace so Claude can read it. Larger body limit for the base64 image.
router.post("/claude/ref", express.json({ limit: "12mb" }), async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const projectId = Number(req.body?.projectId) || 0;
  if (!(await ownsProject(u.id, projectId))) { res.status(403).json({ error: "Geen toegang tot dit project." }); return; }
  const dataUrl = String(req.body?.dataUrl || "");
  const name = req.body?.name ? String(req.body.name) : undefined;
  const r = await writeSessionRef(u.id, projectId, dataUrl, name);
  if ("error" in r) { res.status(400).json(r); return; }
  res.json({ ok: true, path: r.path });
});

router.post("/claude/ref/delete", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const projectId = Number(req.body?.projectId) || 0;
  if (!(await ownsProject(u.id, projectId))) { res.status(403).json({ error: "Geen toegang tot dit project." }); return; }
  const r = await deleteSessionRef(u.id, projectId, String(req.body?.path || ""));
  res.json(r);
});

export default router;
