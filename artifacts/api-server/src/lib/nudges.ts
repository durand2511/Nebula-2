/**
 * Smart-reminder scanner: a daily-ish background job that nudges clients in three situations:
 *  - lowcredits: a class pass is nearly used up (1–2 credits left)
 *  - renewal:    a monthly membership auto-renews within ~3 days (heads-up, not an action)
 *  - winback:    a client hasn't booked in 30+ days
 * Every situation is recorded in studio_nudges (unique per project+email+kind+ref) so the same
 * nudge is never sent twice. E-mail is best-effort: if a studio has no SMTP configured, nothing
 * is sent and no nudge row is written, so it retries once they connect e-mail.
 */
import { db, studioUsers, studioWallets, studioBookings, studioNudges, studioClasses, studioSettings, invoices } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendBookingEmail, type EmailKind } from "./email.js";
import { logger } from "./logger";

let started = false;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Candidate = { email: string; kind: EmailKind; ref: string; data: { credits?: number; date?: string } };

// Pure detection (exported for testing): which nudges WOULD be sent for a project right now,
// excluding ones already recorded in `sentKeys` (set of "kind|email|ref").
export async function detectNudges(projectId: number, sentKeys: Set<string>, now = new Date()): Promise<Candidate[]> {
  const users = await db.select().from(studioUsers).where(eq(studioUsers.projectId, projectId));
  const clients = users.filter((u) => u.role === "client").map((u) => u.email);
  const wallets = await db.select().from(studioWallets).where(eq(studioWallets.projectId, projectId));
  const bookings = await db.select().from(studioBookings).where(eq(studioBookings.projectId, projectId));
  const today = ymd(now);
  const p3 = new Date(now); p3.setDate(now.getDate() + 3); const in3 = ymd(p3);
  const cut = new Date(now); cut.setDate(now.getDate() - 30); const cutoff = ymd(cut);
  const out: Candidate[] = [];
  // low credits (pure class pass, not unlimited / membership)
  for (const w of wallets) {
    if (w.unlimited === "true" || w.membership) continue;
    if (w.credits >= 1 && w.credits <= 2) out.push({ email: w.email, kind: "lowcredits", ref: "low-" + w.credits, data: { credits: w.credits } });
  }
  // membership auto-renews within 3 days
  for (const w of wallets) {
    if (!w.membership || !w.validUntil) continue;
    if (w.validUntil >= today && w.validUntil <= in3) out.push({ email: w.email, kind: "renewal", ref: "renew-" + w.validUntil, data: { date: w.validUntil } });
  }
  // win-back: clients whose most recent booking is 30+ days ago (and have booked before)
  const last: Record<string, string> = {};
  for (const b of bookings) { if (!b.bookerEmail) continue; if (!last[b.bookerEmail] || b.date > last[b.bookerEmail]) last[b.bookerEmail] = b.date; }
  const monthRef = "winback-" + today.slice(0, 7);
  for (const e of clients) { if (last[e] && last[e] < cutoff) out.push({ email: e, kind: "winback", ref: monthRef, data: {} }); }
  return out.filter((c) => !sentKeys.has(c.kind + "|" + c.email + "|" + c.ref));
}

async function scanProject(projectId: number): Promise<void> {
  const existing = await db.select().from(studioNudges).where(eq(studioNudges.projectId, projectId));
  const sent = new Set(existing.map((n) => n.kind + "|" + n.email + "|" + n.ref));
  const users = await db.select().from(studioUsers).where(eq(studioUsers.projectId, projectId));
  const nameByEmail: Record<string, string> = {}; users.forEach((u) => { nameByEmail[u.email] = u.name; });
  const candidates = await detectNudges(projectId, sent);
  for (const c of candidates) {
    try {
      const ok = await sendBookingEmail(projectId, c.email, c.kind, { name: nameByEmail[c.email] || "", credits: c.data.credits, date: c.data.date });
      if (ok) await db.insert(studioNudges).values({ projectId, email: c.email, kind: c.kind, ref: c.ref }).onConflictDoNothing();
    } catch (err) { logger.warn({ err, projectId, kind: c.kind }, "[nudge] send failed"); }
  }
}

// Opt-in periodic studio summary e-mailed to the admin(s): revenue, bookings, classes, no-shows.
export async function ownerReport(projectId: number, now = new Date()): Promise<void> {
  const [st] = await db.select().from(studioSettings).where(eq(studioSettings.projectId, projectId));
  const mode = st?.ownerReport || "off";
  if (mode !== "weekly" && mode !== "monthly") return;
  let ref: string, periodLabel: string, start: Date;
  if (mode === "weekly") {
    const monOff = (now.getDay() + 6) % 7;
    const mon = new Date(now); mon.setDate(now.getDate() - monOff); mon.setHours(0, 0, 0, 0);
    ref = "ownerreport-w-" + ymd(mon); periodLabel = "afgelopen week";
    start = new Date(now); start.setDate(now.getDate() - 7);
  } else {
    ref = "ownerreport-m-" + ymd(now).slice(0, 7); periodLabel = "afgelopen maand";
    start = new Date(now); start.setDate(now.getDate() - 30);
  }
  const admins = (await db.select().from(studioUsers).where(eq(studioUsers.projectId, projectId))).filter((u) => u.role === "admin");
  if (!admins.length) return;
  // already sent this period? (any admin row with this ref)
  const existing = await db.select().from(studioNudges).where(and(eq(studioNudges.projectId, projectId), eq(studioNudges.kind, "ownerreport"), eq(studioNudges.ref, ref)));
  if (existing.length) return;
  start.setHours(0, 0, 0, 0);
  const startYmd = ymd(start);
  const invs = await db.select().from(invoices).where(eq(invoices.projectId, projectId));
  const revenue = invs.filter((i) => i.createdAt && new Date(i.createdAt) >= start).reduce((s, i) => s + (i.total || 0), 0);
  const bookings = await db.select().from(studioBookings).where(eq(studioBookings.projectId, projectId));
  const inWin = bookings.filter((b) => b.date >= startYmd && b.date <= ymd(now));
  const bookCount = inWin.filter((b) => b.status === "booked").length;
  const noShows = inWin.filter((b) => b.noShow === "true").length;
  const classes = (await db.select().from(studioClasses).where(eq(studioClasses.projectId, projectId))).filter((c) => c.date >= startYmd && c.date <= ymd(now)).length;
  const report = { periodLabel, revenue, bookings: bookCount, noShows, classes, currency: invs[0]?.currency || "EUR" };
  let anySent = false;
  for (const a of admins) { try { if (await sendBookingEmail(projectId, a.email, "ownerreport", { name: a.name, report })) anySent = true; } catch { /* best-effort */ } }
  if (anySent) await db.insert(studioNudges).values({ projectId, email: admins[0].email, kind: "ownerreport", ref }).onConflictDoNothing();
}

// Opt-in review request: once a client has attended (present) a class in the last 7 days, ask them
// once (ever) for a Google review. Only active when the studio set a review URL.
export async function reviewRequests(projectId: number, now = new Date()): Promise<void> {
  const [st] = await db.select().from(studioSettings).where(eq(studioSettings.projectId, projectId));
  const url = (st?.reviewUrl || "").trim();
  if (!url) return;
  const cut = new Date(now); cut.setDate(now.getDate() - 7); const cutoff = ymd(cut);
  const bookings = await db.select().from(studioBookings).where(and(eq(studioBookings.projectId, projectId), eq(studioBookings.present, "true")));
  const recent = bookings.filter((b) => b.date >= cutoff && b.date <= ymd(now) && b.bookerEmail);
  if (!recent.length) return;
  const asked = new Set((await db.select().from(studioNudges).where(and(eq(studioNudges.projectId, projectId), eq(studioNudges.kind, "review")))).map((n) => n.email));
  const users = await db.select().from(studioUsers).where(eq(studioUsers.projectId, projectId));
  const nameByEmail: Record<string, string> = {}; users.forEach((u) => { nameByEmail[u.email] = u.name; });
  const seen = new Set<string>();
  for (const b of recent) {
    if (asked.has(b.bookerEmail) || seen.has(b.bookerEmail)) continue;
    seen.add(b.bookerEmail);
    try {
      if (await sendBookingEmail(projectId, b.bookerEmail, "review", { name: nameByEmail[b.bookerEmail] || "", url })) {
        await db.insert(studioNudges).values({ projectId, email: b.bookerEmail, kind: "review", ref: "review" }).onConflictDoNothing();
      }
    } catch { /* best-effort */ }
  }
}

async function tick(): Promise<void> {
  try {
    const rows = await db.selectDistinct({ projectId: studioUsers.projectId }).from(studioUsers);
    for (const r of rows) {
      try { await scanProject(r.projectId); } catch (err) { logger.warn({ err, projectId: r.projectId }, "[nudge] project scan failed"); }
      try { await ownerReport(r.projectId); } catch (err) { logger.warn({ err, projectId: r.projectId }, "[nudge] owner report failed"); }
      try { await reviewRequests(r.projectId); } catch (err) { logger.warn({ err, projectId: r.projectId }, "[nudge] review request failed"); }
    }
  } catch (err) { logger.warn({ err }, "[nudge] tick failed"); }
}

export function startNudgeScheduler(): void {
  if (started) return;
  started = true;
  setInterval(() => void tick(), 6 * 60 * 60 * 1000); // every 6 hours
  setTimeout(() => void tick(), 30 * 1000);            // first run shortly after boot
}
