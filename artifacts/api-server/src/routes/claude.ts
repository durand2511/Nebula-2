/** Claude Code-koppeling: status + ontkoppelen. The terminal itself is a WebSocket (see lib/claude-terminal.ts). */
import { Router, type IRouter } from "express";
import { getSessionUser, tokenFrom } from "../lib/platform-auth.js";
import { isClaudeConnected, disconnectClaude, writeSessionRef, deleteSessionRef } from "../lib/claude-terminal.js";
import { captureRegion, screenshotAvailable, warmup } from "../lib/screenshot.js";
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

// Pre-warm the shared Chromium when the user enters "Markeren" mode, so the actual capture only
// pays for navigation + screenshot, not the launch. Fire-and-forget; always answers ok.
router.post("/claude/shot/warm", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  void warmup();
  res.json({ ok: true });
});

// Server-side region screenshot (headless Chromium) — captures real pixels incl. cross-origin/CDN
// images, which an in-browser screenshot can't. Returns a data URL for the attachment tray.
router.post("/claude/shot", express.json({ limit: "1mb" }), async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const projectId = Number(req.body?.projectId) || 0;
  if (!(await ownsProject(u.id, projectId))) { res.status(403).json({ error: "Geen toegang tot dit project." }); return; }
  const page = String(req.body?.page || "index.html").slice(0, 200);
  const clip = req.body?.clip || {};
  const viewport = req.body?.viewport || {};
  try {
    if (!screenshotAvailable()) { res.status(503).json({ error: "no-chromium" }); return; }
    const buf = await captureRegion({
      projectId, page,
      clip: { x: Number(clip.x) || 0, y: Number(clip.y) || 0, width: Number(clip.width) || 0, height: Number(clip.height) || 0 },
      viewport: { width: Number(viewport.width) || 1200, height: Number(viewport.height) || 900 },
    });
    res.json({ ok: true, dataUrl: `data:image/png;base64,${Buffer.from(buf).toString("base64")}` });
  } catch (err) {
    const msg = (err as Error).message === "no-chromium" ? "no-chromium" : "Screenshot mislukt.";
    logger.warn({ err, projectId }, "[claude] server screenshot failed");
    res.status(msg === "no-chromium" ? 503 : 500).json({ error: msg });
  }
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
