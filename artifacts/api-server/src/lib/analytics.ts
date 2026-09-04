/**
 * First-party visitor analytics — records pageviews from the tiny beacon injected into published
 * sites, and aggregates them for the editor dashboard. Privacy-friendly: no cookies, no PII; the
 * visitor id is a random token stored in the visitor's own browser. Deleting is easy (drop rows).
 */
import { db, analyticsEvents, analyticsOnline } from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";

export type TrackInput = {
  projectId: number; eventId: string; visitorId?: string; path?: string; referrer?: string;
  device?: string; screenW?: number; screenH?: number; language?: string; durationMs?: number;
  goal?: string; ping?: boolean;
};

const ONLINE_MS = 90 * 1000;
// DB-backed presence: bump the visitor's seen_at on every beacon hit (view/ping/leave). One row per
// visitor per project → works across server instances and survives restarts (unlike an in-memory map).
async function touchPresence(projectId: number, visitorId: string): Promise<void> {
  if (!visitorId) return;
  try {
    await db.insert(analyticsOnline).values({ projectId, visitorId, seenAt: new Date() })
      .onConflictDoUpdate({ target: [analyticsOnline.projectId, analyticsOnline.visitorId], set: { seenAt: new Date() } });
    // Opportunistic cleanup of stale rows so the table stays small.
    if (Math.random() < 0.02) await db.delete(analyticsOnline).where(lt(analyticsOnline.seenAt, new Date(Date.now() - 6 * 60 * 60 * 1000)));
  } catch { /* best-effort */ }
}
/** Distinct visitors seen in the last ~90s (from the DB, so it's the same across all instances). */
export async function liveVisitors(projectId: number): Promise<number> {
  try {
    const [r] = await db.select({ n: sql<number>`count(distinct ${analyticsOnline.visitorId})::int` })
      .from(analyticsOnline).where(and(eq(analyticsOnline.projectId, projectId), gte(analyticsOnline.seenAt, new Date(Date.now() - ONLINE_MS))));
    return r?.n ?? 0;
  } catch { return 0; }
}

const clampStr = (s: unknown, n: number) => String(s ?? "").slice(0, n);
const num = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, 20000) : 0; };
// Session duration: cap at 2h so a forgotten background tab can't skew the average.
const dur = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, 2 * 60 * 60 * 1000) : 0; };
function hostOf(url: string): string {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; }
}
function deviceOf(v: unknown, screenW: number): string {
  const s = String(v ?? "").toLowerCase();
  if (s === "mobile" || s === "tablet" || s === "desktop") return s;
  if (screenW && screenW <= 640) return "mobile";
  if (screenW && screenW <= 1024) return "tablet";
  return "desktop";
}

/** Insert a pageview / conversion, or (on page-leave) update its duration. Pings only mark presence. */
export async function track(input: TrackInput, selfHost: string): Promise<void> {
  if (!Number.isInteger(input.projectId)) return;
  await touchPresence(input.projectId, clampStr(input.visitorId, 64));
  if (input.ping) return; // heartbeat: presence only, no pageview row
  const eventId = clampStr(input.eventId, 64);
  if (!eventId) return;
  const goal = clampStr(input.goal, 40);
  const durationMs = dur(input.durationMs);
  // A leave-beacon carries a duration but no other new data → just bump the existing row's duration.
  if (durationMs > 0) {
    const upd = await db.update(analyticsEvents)
      .set({ durationMs })
      .where(and(eq(analyticsEvents.eventId, eventId), sql`${analyticsEvents.durationMs} < ${durationMs}`))
      .returning({ id: analyticsEvents.id });
    if (upd.length) return; // updated an existing pageview
  }
  const screenW = num(input.screenW), screenH = num(input.screenH);
  const refHost = hostOf(clampStr(input.referrer, 500));
  await db.insert(analyticsEvents).values({
    projectId: input.projectId,
    eventId,
    visitorId: clampStr(input.visitorId, 64),
    path: clampStr(input.path || "/", 500),
    referrer: clampStr(input.referrer, 500),
    referrerHost: refHost && refHost !== selfHost ? refHost : "",
    device: deviceOf(input.device, screenW),
    screenW, screenH,
    language: clampStr(input.language, 12),
    durationMs, goal,
  }).onConflictDoNothing({ target: analyticsEvents.eventId });
}

export type AnalyticsSummary = {
  days: number;
  totals: { views: number; visitors: number; avgSeconds: number };
  byDay: { day: string; views: number; visitors: number }[];
  topPages: { path: string; views: number }[];
  devices: { device: string; views: number }[];
  referrers: { host: string; views: number }[];
  screens: { label: string; views: number }[];
  online: number;
  conversions: { total: number; rate: number; goals: { goal: string; count: number }[] };
  hasData: boolean;
};

export async function summary(projectId: number, days = 30): Promise<AnalyticsSummary> {
  const d = Math.min(Math.max(days, 1), 365);
  const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
  const base = and(eq(analyticsEvents.projectId, projectId), gte(analyticsEvents.createdAt, since));
  const pv = and(base, sql`${analyticsEvents.goal} = ''`);        // pageviews only
  const conv = and(base, sql`${analyticsEvents.goal} <> ''`);      // conversions only

  const [tot] = await db.select({
    views: sql<number>`count(*)::int`,
    visitors: sql<number>`count(distinct ${analyticsEvents.visitorId})::int`,
    avgMs: sql<number>`coalesce(avg(nullif(${analyticsEvents.durationMs}, 0)), 0)::int`,
  }).from(analyticsEvents).where(pv);

  const byDayRows = await db.select({
    day: sql<string>`to_char(${analyticsEvents.createdAt}, 'YYYY-MM-DD')`,
    views: sql<number>`count(*)::int`,
    visitors: sql<number>`count(distinct ${analyticsEvents.visitorId})::int`,
  }).from(analyticsEvents).where(pv).groupBy(sql`1`).orderBy(sql`1`);

  const topPages = await db.select({ path: analyticsEvents.path, views: sql<number>`count(*)::int` })
    .from(analyticsEvents).where(pv).groupBy(analyticsEvents.path).orderBy(sql`2 desc`).limit(10);

  const devices = await db.select({ device: analyticsEvents.device, views: sql<number>`count(*)::int` })
    .from(analyticsEvents).where(pv).groupBy(analyticsEvents.device).orderBy(sql`2 desc`);

  const referrers = await db.select({ host: analyticsEvents.referrerHost, views: sql<number>`count(*)::int` })
    .from(analyticsEvents).where(and(pv, sql`${analyticsEvents.referrerHost} <> ''`))
    .groupBy(analyticsEvents.referrerHost).orderBy(sql`2 desc`).limit(8);

  // Bucket screen widths into readable size classes.
  const screens = await db.select({
    label: sql<string>`case
      when ${analyticsEvents.screenW} = 0 then 'onbekend'
      when ${analyticsEvents.screenW} <= 480 then '≤480 (telefoon)'
      when ${analyticsEvents.screenW} <= 768 then '481–768 (grote telefoon)'
      when ${analyticsEvents.screenW} <= 1024 then '769–1024 (tablet)'
      when ${analyticsEvents.screenW} <= 1440 then '1025–1440 (laptop)'
      else '>1440 (groot scherm)' end`,
    views: sql<number>`count(*)::int`,
  }).from(analyticsEvents).where(pv).groupBy(sql`1`).orderBy(sql`2 desc`);

  const goalRows = await db.select({ goal: analyticsEvents.goal, count: sql<number>`count(*)::int` })
    .from(analyticsEvents).where(conv).groupBy(analyticsEvents.goal).orderBy(sql`2 desc`).limit(10);
  const convTotal = goalRows.reduce((s, g) => s + g.count, 0);

  // Fill missing days with zeros so the chart has a continuous axis.
  const byDayMap = new Map(byDayRows.map((r) => [r.day, r]));
  const byDay: AnalyticsSummary["byDay"] = [];
  for (let i = d - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const r = byDayMap.get(key);
    byDay.push({ day: key, views: r?.views ?? 0, visitors: r?.visitors ?? 0 });
  }

  const visitors = tot?.visitors ?? 0;
  return {
    days: d,
    totals: { views: tot?.views ?? 0, visitors, avgSeconds: Math.round((tot?.avgMs ?? 0) / 1000) },
    byDay: d <= 90 ? byDay : byDay.slice(-90),
    topPages, devices, referrers, screens,
    online: await liveVisitors(projectId),
    conversions: { total: convTotal, rate: visitors ? Math.round((convTotal / visitors) * 1000) / 10 : 0, goals: goalRows },
    hasData: (tot?.views ?? 0) > 0 || convTotal > 0,
  };
}
