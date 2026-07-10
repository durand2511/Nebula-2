/**
 * Auto-publish scheduler for the SEO engine. Runs SERVER-SIDE (independent of any browser/website
 * being open): for each project with auto ON it publishes at most ONE article per day (hard cap),
 * at least ~24h apart. As long as the API server runs, it keeps generating. Best-effort; never throws.
 */
import { db, projectSeo } from "@workspace/db";
import { eq } from "drizzle-orm";
import { publishArticle, publishedToday, reconcileBlogPublishing, generateLocationPage } from "./seo.js";
import { projectOwnerSubscribed } from "./billing.js";
import { logger } from "./logger";

let started = false;

// On an AI hiccup (rejected/failed run) retry ~30 min later — the tick runs every 30 min, so a
// retry gap just under 30 min guarantees the very next tick picks it up. Give up after MAX_ATTEMPTS
// failed tries in a single day, then wait for the next day.
const RETRY_AFTER_MS = 25 * 60 * 1000; // ~25 min → retried on the next 30-min tick
const MAX_ATTEMPTS = 5;
const DAY_MS = 86400000;

// In-memory per-project failure counter for the current day. Not persisted: a server restart resets
// it (acceptable — restarts are rare and the boot tick just tries again). Keyed by projectId.
const failCounts = new Map<number, { day: string; count: number }>();
const dayKey = () => new Date().toISOString().slice(0, 10);

// Bump today's failure count for a project and return the new total (resetting on a new day).
function bumpFail(projectId: number): number {
  const day = dayKey();
  const rec = failCounts.get(projectId);
  const next = rec && rec.day === day ? { day, count: rec.count + 1 } : { day, count: 1 };
  failCounts.set(projectId, next);
  return next.count;
}

async function tick(): Promise<void> {
  try {
    const rows = await db.select().from(projectSeo).where(eq(projectSeo.autoEnabled, "true"));
    const now = Date.now();
    for (const row of rows) {
      try {
        // Auto SEO is a paid feature: skip projects whose owner isn't an active subscriber.
        if (!(await projectOwnerSubscribed(row.projectId))) continue;
        // Independent daily task: publish at most ONE hyperlocal location page per day (opt-in via a
        // .nebula-locations file; self-limiting + best-effort, so it never blocks the blog cycle).
        try { await generateLocationPage(row.projectId); } catch (err) { logger.warn({ err, projectId: row.projectId }, "[seo-scheduler] location failed"); }
        // HARD CAP: never publish more than 1 article per day per website.
        const perDay = 1;
        // Already published today? Then we're done for the day — clear any failure count.
        if ((await publishedToday(row.projectId)) >= perDay) { failCounts.delete(row.projectId); continue; }
        // At most one per 24h.
        const minGapMs = Math.floor(DAY_MS / perDay);
        if (row.lastRunAt && now - new Date(row.lastRunAt).getTime() < minGapMs) continue;
        // Give up for the day once we've already failed MAX_ATTEMPTS times today.
        const already = failCounts.get(row.projectId);
        if (already && already.day === dayKey() && already.count >= MAX_ATTEMPTS) continue;
        const result = await publishArticle(row.projectId, new Date().toISOString(), { mode: "auto" });
        // Only claim the full 24h slot when an article was actually PUBLISHED. If it was rejected
        // (quality gate) or generation hiccuped, retry ~30 min later — up to MAX_ATTEMPTS times —
        // instead of skipping the whole day. After the last attempt, stop until tomorrow.
        const published = result?.status === "published";
        let attempt = 0;
        let nextRun: Date;
        if (published) {
          failCounts.delete(row.projectId);
          nextRun = new Date();
        } else {
          attempt = bumpFail(row.projectId);
          const stop = attempt >= MAX_ATTEMPTS;
          nextRun = stop ? new Date() : new Date(now - minGapMs + RETRY_AFTER_MS);
        }
        await db.update(projectSeo).set({ lastRunAt: nextRun, updatedAt: new Date() }).where(eq(projectSeo.projectId, row.projectId));
        logger.info({ projectId: row.projectId, perDay, published, attempt, maxAttempts: MAX_ATTEMPTS, status: result?.status, score: result?.qualityScore, slug: result?.slug }, "[seo-scheduler] run");
      } catch (err) {
        // A thrown error is also an AI hiccup: count it and retry ~30 min later, up to MAX_ATTEMPTS.
        const attempt = bumpFail(row.projectId);
        const stop = attempt >= MAX_ATTEMPTS;
        logger.warn({ err, projectId: row.projectId, attempt, maxAttempts: MAX_ATTEMPTS, stop }, "[seo-scheduler] project failed");
        const nextRun = stop ? new Date() : new Date(now - DAY_MS + RETRY_AFTER_MS);
        await db.update(projectSeo).set({ lastRunAt: nextRun }).where(eq(projectSeo.projectId, row.projectId)).catch(() => {});
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
  // One-time self-heal on boot: push any already-published blog articles that never reached the live
  // snapshot into it (so /blog/x.html stops falling back to the homepage and Google can index them).
  setTimeout(() => void reconcileBlogPublishing(), 45_000);
}
