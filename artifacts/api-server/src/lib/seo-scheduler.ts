/**
 * Auto-publish scheduler for the SEO engine. Runs SERVER-SIDE (independent of any browser/website
 * being open): for each project with auto ON it publishes up to `maxPerDay` articles per day
 * (default 2), spaced evenly (~24h / maxPerDay apart). As long as the API server runs, it keeps
 * generating. Best-effort; never throws.
 */
import { db, projectSeo } from "@workspace/db";
import { eq } from "drizzle-orm";
import { publishArticle, publishedToday, getSettings } from "./seo.js";
import { logger } from "./logger";

let started = false;

async function tick(): Promise<void> {
  try {
    const rows = await db.select().from(projectSeo).where(eq(projectSeo.autoEnabled, "true"));
    const now = Date.now();
    for (const row of rows) {
      try {
        const perDay = Math.max(1, (await getSettings(row.projectId)).maxPerDay); // default 2/day
        // Already hit today's target?
        if ((await publishedToday(row.projectId)) >= perDay) continue;
        // Space the articles out across the day (e.g. 2/day → ~12h apart).
        const minGapMs = Math.floor(86400000 / perDay);
        if (row.lastRunAt && now - new Date(row.lastRunAt).getTime() < minGapMs) continue;
        const result = await publishArticle(row.projectId, new Date().toISOString(), { mode: "auto" });
        await db.update(projectSeo).set({ lastRunAt: new Date(), updatedAt: new Date() }).where(eq(projectSeo.projectId, row.projectId));
        logger.info({ projectId: row.projectId, perDay, status: result?.status, score: result?.qualityScore, slug: result?.slug }, "[seo-scheduler] run");
      } catch (err) {
        logger.warn({ err, projectId: row.projectId }, "[seo-scheduler] project failed");
        await db.update(projectSeo).set({ lastRunAt: new Date() }).where(eq(projectSeo.projectId, row.projectId)).catch(() => {});
      }
    }
  } catch (err) {
    logger.warn({ err }, "[seo-scheduler] tick failed");
  }
}

export function startSeoScheduler(): void {
  if (started) return;
  started = true;
  setInterval(() => void tick(), 30 * 60 * 1000); // every 30 min — catches each spacing window promptly
  setTimeout(() => void tick(), 30_000); // first run shortly after boot
}
