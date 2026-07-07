/**
 * SEO/AEO content-engine routes: status, manual generate (full pipeline), auto on/off + settings,
 * drafts review/publish, and the periodic update/refresh of existing articles.
 */
import { Router, json } from "express";
import { db, projectSeo, seoArticles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { publishArticle, publishedToday, improveArticle, publishDraft, publishManualArticle } from "../lib/seo.js";
import { projectOwnerSubscribed } from "../lib/billing.js";

const router = Router();

const SEO_PAYWALL = "De SEO-tekstgenerator en automatische SEO zijn onderdeel van het abonnement (€69,99/maand). Abonneer je in je profiel om AI-artikelen te genereren en automatisch te publiceren.";

// Manually publish a blog post (no AI): the studio writes title + body (+ optional image).
router.post("/projects/:id/blog/manual", json({ limit: "512kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!title || !body) { res.status(400).json({ error: "Titel en tekst zijn verplicht." }); return; }
  try {
    const r = await publishManualArticle(projectId, { title, body, image: typeof req.body?.image === "string" ? req.body.image : "" }, new Date().toISOString());
    res.json({ ok: true, slug: r.slug });
  } catch (err) { logger.error({ err, projectId }, "[seo] manual blog failed"); res.status(500).json({ error: "Publiceren mislukt." }); }
});

router.get("/projects/:id/seo", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const [row] = await db.select().from(projectSeo).where(eq(projectSeo.projectId, projectId));
    const arts = await db.select().from(seoArticles).where(eq(seoArticles.projectId, projectId));
    res.json({
      autoEnabled: row?.autoEnabled === "true",
      cadenceDays: row?.cadenceDays ?? 7,
      maxPerDay: row?.maxPerDay ?? 2,
      autoPublishMin: row?.autoPublishMin ?? 85,
      lastRunAt: row?.lastRunAt ?? null,
      articleCount: arts.length,
      publishedCount: arts.filter((a) => a.status === "published").length,
      draftCount: arts.filter((a) => a.status === "draft").length,
      publishedToday: await publishedToday(projectId),
    });
  } catch (err) { logger.error({ err, projectId }, "[seo] status failed"); res.status(500).json({ error: "Status mislukt" }); }
});

// Manual generate: runs the full pipeline and publishes only if the quality gate allows.
router.post("/projects/:id/seo/article", json({ limit: "64kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (!(await projectOwnerSubscribed(projectId))) { res.status(402).json({ error: SEO_PAYWALL }); return; }
  try {
    const r = await publishArticle(projectId, new Date().toISOString(), { mode: "manual" });
    if (!r) { res.status(400).json({ error: "Kon geen artikel genereren (geen website-content gevonden?)." }); return; }
    res.json({ ok: true, title: r.title, slug: r.slug, score: r.qualityScore, status: r.status, recommendation: r.publishRecommendation, notes: r.improvementNotes, wordCount: r.wordCount });
  } catch (err) { logger.error({ err, projectId }, "[seo] generate failed"); res.status(500).json({ error: "Genereren mislukt" }); }
});

// List articles (for a drafts/published overview).
router.get("/projects/:id/seo/articles", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const arts = await db.select().from(seoArticles).where(eq(seoArticles.projectId, projectId));
    res.json(arts.map((a) => ({ id: a.id, title: a.title, slug: a.slug, status: a.status, score: a.score, intent: a.intent, createdAt: a.createdAt })).reverse());
  } catch (err) { logger.error({ err, projectId }, "[seo] list failed"); res.status(500).json({ error: "Lijst mislukt" }); }
});

// Publish a stored draft (override the gate after human review).
router.post("/projects/:id/seo/articles/:articleId/publish", async (req, res) => {
  const projectId = Number(req.params.id), articleId = Number(req.params.articleId);
  if (isNaN(projectId) || isNaN(articleId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const ok = await publishDraft(projectId, articleId, new Date().toISOString());
    if (!ok) { res.status(400).json({ error: "Concept niet gevonden." }); return; }
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[seo] publish draft failed"); res.status(500).json({ error: "Publiceren mislukt" }); }
});

// Update/refresh: improve the oldest published article (or a specific one).
router.post("/projects/:id/seo/refresh", json({ limit: "16kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (!(await projectOwnerSubscribed(projectId))) { res.status(402).json({ error: SEO_PAYWALL }); return; }
  try {
    const r = await improveArticle(projectId, new Date().toISOString(), req.body?.articleId ? Number(req.body.articleId) : undefined);
    if (!r) { res.status(400).json({ error: "Geen artikel om te verversen." }); return; }
    res.json({ ok: true, ...r });
  } catch (err) { logger.error({ err, projectId }, "[seo] refresh failed"); res.status(500).json({ error: "Verversen mislukt" }); }
});

// Auto on/off + settings (cadence, max/day, auto-publish threshold).
router.post("/projects/:id/seo/auto", json({ limit: "16kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const enabled = req.body?.enabled === true;
  if (enabled && !(await projectOwnerSubscribed(projectId))) { res.status(402).json({ error: SEO_PAYWALL }); return; }
  const cadenceDays = Math.max(1, Math.min(30, Number(req.body?.cadenceDays) || 7));
  const maxPerDay = Math.max(1, Math.min(10, Number(req.body?.maxPerDay) || 2));
  const autoPublishMin = Math.max(50, Math.min(100, Number(req.body?.autoPublishMin) || 70));
  try {
    const set = { autoEnabled: enabled ? "true" : "false", cadenceDays, maxPerDay, autoPublishMin, updatedAt: new Date() };
    await db.insert(projectSeo).values({ projectId, ...set }).onConflictDoUpdate({ target: projectSeo.projectId, set });
    res.json({ ok: true, autoEnabled: enabled, cadenceDays, maxPerDay, autoPublishMin });
  } catch (err) { logger.error({ err, projectId }, "[seo] auto toggle failed"); res.status(500).json({ error: "Instellen mislukt" }); }
});

export default router;
