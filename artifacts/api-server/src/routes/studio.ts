/**
 * Booking-app server API (replaces the per-browser localStorage). STEP 1: account auth.
 * register / login / me / logout / reset — passwords scrypt-hashed, sessions via opaque tokens.
 * Classes, bookings, wallets, members & purchases follow in the next steps.
 */
import { Router, json, type Request, type Response } from "express";
import { db, studioUsers, studioClasses, studioMembers, studioWallets, studioCreditLots, studioBookings, studioPurchases, studioVideos, studioVideoPlans, studioVideoAccess, studioCodes, studioLocations, studioSettings, type StudioUser } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { loginBlocked, loginFailure, loginSuccess, clientIp } from "../lib/login-guard.js";
import { createSession, getSessionUser, deleteSession, tokenFrom, publicUser, seedStaffAccounts } from "../lib/studio-auth.js";
import { sendBookingEmail, sendPaymentEmail } from "../lib/email.js";
import { type Wallet, type CreditLot, ymd, applyMonthlyReset, sumActiveCredits, pickLotToConsume, soonestExpiry, lotActive, creditDecision, isPast, bookTooEarly, bookOpensOn, cancelClosed, purchaseWalletUpdate, addMonths } from "../lib/studio-rules.js";
import { verifyStripeSession, stripeRefund, cancelStripeSubscription } from "./stripe.js";
import { getInvoiceSettings, createInvoice, renderInvoiceHtml, renderInvoicePdf } from "../lib/invoice.js";
import { reqBaseUrl } from "../lib/req-url.js";
import { ensureCalendar } from "../lib/calendar.js";
import { gcalConfigured, authUrlUser, gcalStatusUser, disconnectGcalUser, pushAllTeachers } from "../lib/gcal.js";

const router = Router();
const body = json({ limit: "64kb" });
const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const pid = (req: { params: Record<string, string> }) => Number(req.params.id);

// Resolve the logged-in user for a request, or write a 401 and return null.
async function authed(req: Request, res: Response): Promise<StudioUser | null> {
  const projectId = pid(req as any);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return null; }
  const u = await getSessionUser(projectId, tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return null; }
  return u;
}

// `exec` is either the db handle or a transaction — so wallet changes can join a booking transaction.
type Exec = typeof db;

// DB wallet row → in-memory Wallet (applying a monthly reset, persisted, if the month rolled over).
async function loadWallet(projectId: number, email: string, exec: Exec = db): Promise<Wallet> {
  const nowMonth = ymd(new Date()).slice(0, 7);
  const today = ymd(new Date());
  const [r] = await exec.select().from(studioWallets).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, email)));
  const lots = await loadLots(projectId, email, exec, r);
  const credits = sumActiveCredits(lots, today);
  const creditsUntil = soonestExpiry(lots, today);
  if (!r) return { credits, membership: null, unlimited: false, monthlyLimit: null, monthlyRemaining: null, monthlyPeriod: nowMonth, validUntil: null, creditsUntil, needsPayment: false };
  const w: Wallet = { credits, membership: r.membership, unlimited: r.unlimited === "true", monthlyLimit: r.monthlyLimit, monthlyRemaining: r.monthlyRemaining, monthlyPeriod: r.monthlyPeriod, validUntil: r.validUntil, creditsUntil, needsPayment: r.needsPayment === "true" };
  const reset = applyMonthlyReset(w, nowMonth);
  if (reset.changed) {
    await exec.update(studioWallets).set({ monthlyRemaining: reset.monthlyRemaining, monthlyPeriod: reset.monthlyPeriod, updatedAt: new Date() }).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, email)));
    w.monthlyRemaining = reset.monthlyRemaining; w.monthlyPeriod = reset.monthlyPeriod;
  }
  return w;
}

// All credit "potjes" for a customer: each bought strippenkaart batch + the legacy single bucket
// (studio_wallets.credits + creditsUntil) as a synthetic lot 0. walletRow may be passed to avoid a re-read.
async function loadLots(projectId: number, email: string, exec: Exec = db, walletRow?: typeof studioWallets.$inferSelect): Promise<CreditLot[]> {
  const r = walletRow !== undefined ? walletRow : (await exec.select().from(studioWallets).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, email))))[0];
  const dbLots = (await exec.select().from(studioCreditLots).where(and(eq(studioCreditLots.projectId, projectId), eq(studioCreditLots.email, email)))).map((l) => ({ id: l.id, credits: l.credits, expiresAt: l.expiresAt }));
  return (r && r.credits > 0) ? [{ id: 0, credits: r.credits, expiresAt: r.creditsUntil || "" }, ...dbLots] : dbLots;
}

// Spend one credit from the soonest-expiring batch. Returns the lot id spent (0 = legacy bucket), or -1.
async function spendCredit(projectId: number, email: string, exec: Exec = db): Promise<number> {
  const lots = await loadLots(projectId, email, exec);
  const lotId = pickLotToConsume(lots, ymd(new Date()));
  if (lotId == null) return -1;
  if (lotId === 0) { await bumpWallet(projectId, email, "credits", -1, exec); return 0; }
  const [l] = await exec.select().from(studioCreditLots).where(and(eq(studioCreditLots.projectId, projectId), eq(studioCreditLots.id, lotId)));
  if (l) await exec.update(studioCreditLots).set({ credits: Math.max(0, l.credits - 1) }).where(eq(studioCreditLots.id, lotId));
  return lotId;
}

// Refund one credit to the exact batch it came from — but only if that batch is still valid; an expired
// batch forfeits the credit (the strippenkaart is simply over). lotId 0 = legacy bucket.
async function refundCreditToLot(projectId: number, email: string, lotId: number, exec: Exec = db): Promise<void> {
  const today = ymd(new Date());
  if (lotId === 0) {
    const [r] = await exec.select().from(studioWallets).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, email)));
    if (r && (!r.creditsUntil || r.creditsUntil >= today)) await bumpWallet(projectId, email, "credits", 1, exec);
    return;
  }
  const [l] = await exec.select().from(studioCreditLots).where(and(eq(studioCreditLots.projectId, projectId), eq(studioCreditLots.id, lotId)));
  if (l && (!l.expiresAt || l.expiresAt >= today)) await exec.update(studioCreditLots).set({ credits: l.credits + 1 }).where(eq(studioCreditLots.id, lotId));
}

// Adjust credits / monthly allotment by a delta (e.g. -1 on booking, +1 on cancel). Creates the row if missing.
async function bumpWallet(projectId: number, email: string, field: "credits" | "monthlyRemaining", delta: number, exec: Exec = db): Promise<void> {
  const [r] = await exec.select().from(studioWallets).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, email)));
  if (!r) { await exec.insert(studioWallets).values({ projectId, email, credits: field === "credits" ? Math.max(0, delta) : 0 }); return; }
  const cur = (field === "credits" ? r.credits : (r.monthlyRemaining ?? 0)) || 0;
  let next = cur + delta;
  if (next < 0) next = 0;
  if (field === "monthlyRemaining" && r.monthlyLimit != null) next = Math.min(r.monthlyLimit, next);
  await exec.update(studioWallets).set({ [field]: next, updatedAt: new Date() } as any).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, email)));
}

const clsOut = (c: typeof studioClasses.$inferSelect) => ({ id: c.id, title: c.title, teacherEmail: c.teacherEmail, teacher: c.teacher, date: c.date, time: c.time, endTime: c.endTime, cap: c.cap, price: c.price, mode: c.mode, level: c.level, description: c.description, onlineLink: c.onlineLink, onlineInfo: c.onlineInfo, bookDays: c.bookDays, cancelHours: c.cancelHours, locationId: c.locationId });
const memOut = (m: typeof studioMembers.$inferSelect) => ({ id: m.id, name: m.name, type: m.type, unlimited: m.unlimited === "true", credits: m.credits, price: m.price, validDays: m.validDays, recurring: m.recurring === "true", commitMonths: m.commitMonths, resetMonthly: m.resetMonthly === "true" });
const bkOut = (b: typeof studioBookings.$inferSelect) => ({ id: b.id, classId: b.classId, date: b.date, bookerEmail: b.bookerEmail, name: b.name, status: b.status, payment: b.payment, usedCredit: b.usedCredit === "true", usedMonthly: b.usedMonthly === "true", present: b.present === "true", noShow: b.noShow === "true", amount: b.amount, paymentIntent: b.paymentIntent, refunded: b.refunded === "true", refundedAmount: b.refundedAmount });

// Promote the first waitlister for a freed spot, e-mail them, and return their e-mail (or null).
async function promoteFirstWaitlist(projectId: number, classId: number, date: string, c?: typeof studioClasses.$inferSelect): Promise<string | null> {
  const wl = await db.select().from(studioBookings).where(and(eq(studioBookings.projectId, projectId), eq(studioBookings.classId, classId), eq(studioBookings.date, date), eq(studioBookings.status, "waitlist")));
  const first = wl.sort((a, b) => a.id - b.id)[0];
  if (!first) return null;
  await db.update(studioBookings).set({ status: "booked", promotedAt: ymd(new Date()) }).where(eq(studioBookings.id, first.id));
  try { await sendBookingEmail(projectId, first.bookerEmail, "promoted", { name: first.name, classTitle: c?.title || "les", date: first.date, time: c?.time || "", mode: c?.mode, onlineLink: c?.onlineLink, onlineInfo: c?.onlineInfo } as any); } catch { /* best-effort */ }
  return first.bookerEmail;
}

// Create + e-mail a paid invoice (best-effort; only if the studio configured invoicing).
async function issueInvoice(projectId: number, name: string, email: string, description: string, amount: number): Promise<void> {
  try {
    const s = await getInvoiceSettings(projectId);
    if (!s.configured) return;
    const inv = await createInvoice(projectId, { customerName: name, customerEmail: email, description, total: amount, method: "Stripe" });
    const html = renderInvoiceHtml(s, inv);
    let pdf: string | undefined;
    try { pdf = renderInvoicePdf(s, inv).toString("base64"); } catch { pdf = undefined; }
    await sendPaymentEmail(projectId, email, html, inv.number, pdf);
  } catch (err) { logger.warn({ err, projectId }, "[studio] invoice/email failed"); }
}

// Create + e-mail a credit note (correction invoice with a NEGATIVE total) when money is refunded,
// so the bookkeeping stays correct automatically. Best-effort; only if invoicing is configured.
async function issueCreditNote(projectId: number, name: string, email: string, description: string, amount: number): Promise<void> {
  try {
    const s = await getInvoiceSettings(projectId);
    if (!s.configured || !(amount > 0)) return;
    const inv = await createInvoice(projectId, { customerName: name, customerEmail: email, description: "Creditnota — " + description, total: -Math.abs(amount), method: "Stripe terugbetaling", status: "Creditnota" });
    const html = renderInvoiceHtml(s, inv);
    let pdf: string | undefined;
    try { pdf = renderInvoicePdf(s, inv).toString("base64"); } catch { pdf = undefined; }
    await sendPaymentEmail(projectId, email, html, inv.number, pdf);
  } catch (err) { logger.warn({ err, projectId }, "[studio] credit note failed"); }
}
const walletOut = (w: Wallet) => ({ credits: w.credits, membership: w.membership, unlimited: w.unlimited, monthlyLimit: w.monthlyLimit, monthlyRemaining: w.monthlyRemaining, validUntil: w.validUntil, creditsUntil: w.creditsUntil, needsPayment: w.needsPayment });

// Self-service registration (client accounts). Admin/teacher accounts are seeded separately.
router.post("/projects/:id/studio/register", body, async (req, res) => {
  const projectId = pid(req); if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const phone = String(req.body?.phone ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!name || !isEmail(email) || !password) { res.status(400).json({ error: "Vul je naam, een geldig e-mailadres en een wachtwoord in." }); return; }
  if (phone.replace(/[^0-9]/g, "").length < 8) { res.status(400).json({ error: "Vul een geldig telefoonnummer in." }); return; }
  try {
    const [existing] = await db.select().from(studioUsers).where(and(eq(studioUsers.projectId, projectId), eq(studioUsers.email, email)));
    if (existing) { res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres." }); return; }
    const [u] = await db.insert(studioUsers).values({ projectId, role: "client", name, email, phone, passwordHash: hashPassword(password) }).returning();
    const token = await createSession(projectId, u.id);
    try { await sendBookingEmail(projectId, email, "welcome", { name }); } catch { /* email is best-effort */ }
    res.json({ ok: true, token, user: publicUser(u) });
  } catch (err) { logger.error({ err, projectId }, "[studio] register failed"); res.status(500).json({ error: "Registreren mislukt." }); }
});

router.post("/projects/:id/studio/login", body, async (req, res) => {
  const projectId = pid(req); if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const guardKeys = [`studio:${projectId}:${email}`, `ip:${clientIp(req as any)}`];
  const wait = loginBlocked(guardKeys);
  if (wait) { res.status(429).json({ error: `Te veel inlogpogingen. Probeer over ${Math.ceil(wait / 60)} minuten opnieuw.` }); return; }
  try {
    const [u] = await db.select().from(studioUsers).where(and(eq(studioUsers.projectId, projectId), eq(studioUsers.email, email)));
    if (!u || !verifyPassword(password, u.passwordHash)) { loginFailure(guardKeys); res.status(401).json({ error: "Onjuist e-mailadres of wachtwoord." }); return; }
    loginSuccess(guardKeys);
    const token = await createSession(projectId, u.id);
    res.json({ ok: true, token, user: publicUser(u) });
  } catch (err) { logger.error({ err, projectId }, "[studio] login failed"); res.status(500).json({ error: "Inloggen mislukt." }); }
});

// Idempotently seed the chat-configured admin/teacher logins (the booking app sends its baked
// accounts once on load). Open like register/login; it only creates accounts that don't exist yet.
router.post("/projects/:id/studio/seed-staff", body, async (req, res) => {
  const projectId = pid(req as any); if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    // SECURITY: this endpoint is unauthenticated (the booking app calls it on load), so for a project
    // that has no admin yet it may bootstrap the baked logins. Once an admin exists it may NEVER seed
    // on an unauthenticated call — EXCEPT for a logged-in admin, who may add teacher accounts here
    // (this is what the "Behandelaar/Docent toevoegen" button uses). It never overwrites passwords.
    const accounts = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
    const [hasAdmin] = await db.select().from(studioUsers).where(and(eq(studioUsers.projectId, projectId), eq(studioUsers.role, "admin")));
    if (hasAdmin) {
      const requester = await getSessionUser(projectId, tokenFrom(req as any));
      if (!requester || requester.role !== "admin") { res.json({ ok: true, created: 0 }); return; }
      // An authenticated admin may only add teachers this way (no admin/self-elevation, no overwrite).
      const teachers = accounts.map((a: { name?: string; email?: string; password?: string }) => ({ ...a, role: "teacher" }));
      const created = await seedStaffAccounts(projectId, teachers, false);
      res.json({ ok: true, created });
      return;
    }
    const created = await seedStaffAccounts(projectId, accounts, false);
    res.json({ ok: true, created });
  } catch (err) { logger.error({ err, projectId }, "[studio] seed-staff failed"); res.status(500).json({ error: "Seeden mislukt." }); }
});

// Validate a stored token on app load (re-hydrate the session).
router.get("/projects/:id/studio/me", async (req, res) => {
  const projectId = pid(req); if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const u = await getSessionUser(projectId, tokenFrom(req));
    if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
    res.json({ ok: true, user: publicUser(u) });
  } catch (err) { logger.error({ err, projectId }, "[studio] me failed"); res.status(500).json({ error: "Sessie ophalen mislukt." }); }
});

router.post("/projects/:id/studio/logout", body, async (req, res) => {
  try { await deleteSession(tokenFrom(req)); } catch { /* ignore */ }
  res.json({ ok: true });
});

// Password reset: set a new temp password + e-mail it. Always the same response (no account leak).
router.post("/projects/:id/studio/reset", body, async (req, res) => {
  const projectId = pid(req); if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  try {
    if (isEmail(email)) {
      const [u] = await db.select().from(studioUsers).where(and(eq(studioUsers.projectId, projectId), eq(studioUsers.email, email)));
      if (u) {
        const np = Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);
        await db.update(studioUsers).set({ passwordHash: hashPassword(np) }).where(eq(studioUsers.id, u.id));
        try { await sendBookingEmail(projectId, email, "reset", { name: u.name, password: np }); } catch { /* best-effort */ }
      }
    }
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] reset failed"); res.status(500).json({ error: "Reset mislukt." }); }
});

// ── Per-staff Google Calendar coupling ────────────────────────────────────
// A logged-in staff member (teacher or admin) connects their OWN Google account; only their own
// appointments sync. Separate from the studio-wide /gcal/* routes (which stay admin/project-level).
const gcalBaseUrl = (req: Request) => process.env.PUBLIC_API_URL || reqBaseUrl(req as any);

router.get("/projects/:id/studio/my-gcal/status", async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req);
  try { res.json(await gcalStatusUser(projectId, u.email)); }
  catch (err) { logger.error({ err, projectId }, "[studio] my-gcal status failed"); res.status(500).json({ error: "Status mislukt." }); }
});

router.post("/projects/:id/studio/my-gcal/connect", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req);
  if (!gcalConfigured()) { res.status(503).json({ error: "Google Agenda is nog niet ingesteld door het platform." }); return; }
  try {
    const { token } = await ensureCalendar(projectId, gcalBaseUrl(req));
    res.json({ url: authUrlUser(projectId, token, u.email, gcalBaseUrl(req)) });
  } catch (err) { logger.error({ err, projectId }, "[studio] my-gcal connect failed"); res.status(500).json({ error: "Koppelen mislukt." }); }
});

router.post("/projects/:id/studio/my-gcal/disconnect", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req);
  try { await disconnectGcalUser(projectId, u.email); res.json({ ok: true }); }
  catch (err) { logger.error({ err, projectId }, "[studio] my-gcal disconnect failed"); res.status(500).json({ error: "Ontkoppelen mislukt." }); }
});

// Kassa/Betalingen: confirm a Stripe payment (from Tap-to-Pay in the Stripe app) as reconciled — link
// it to an appointment/behandeling (name) or a walk-in ("Losse verkoop") and record it in the sales so
// omzet/cijfers add up. Idempotent on the Stripe charge id (paymentIntent), so re-confirming is safe.
router.post("/projects/:id/studio/pos-confirm", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req);
  const paymentIntent = String(req.body?.paymentIntent ?? "").trim().slice(0, 120);
  const amountCents = Math.round(Number(req.body?.amount) || 0);       // Stripe amount is in cents
  const name = (String(req.body?.name ?? "").trim().slice(0, 120)) || "Kassa";
  const method = (String(req.body?.method ?? "pin").trim().slice(0, 20)) || "pin";
  const date = (String(req.body?.date ?? "").slice(0, 10)) || ymd(new Date());
  if (!paymentIntent || amountCents <= 0) { res.status(400).json({ error: "Ongeldige betaling." }); return; }
  try {
    const [ex] = await db.select().from(studioPurchases).where(and(eq(studioPurchases.projectId, projectId), eq(studioPurchases.paymentIntent, paymentIntent)));
    if (ex) { res.json({ ok: true, already: true }); return; }
    await db.insert(studioPurchases).values({ projectId, email: "", type: method, name, amount: amountCents / 100, paymentIntent, date });
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] pos-confirm failed"); res.status(500).json({ error: "Opslaan mislukt." }); }
});

// ── Data + booking endpoints ──────────────────────────────────────────────

// Role-aware snapshot used to hydrate the booking app (replaces reading localStorage).
router.get("/projects/:id/studio/state", async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req as any);
  try {
    const classes = await db.select().from(studioClasses).where(eq(studioClasses.projectId, projectId));
    const members = await db.select().from(studioMembers).where(eq(studioMembers.projectId, projectId));
    const allBookings = await db.select().from(studioBookings).where(eq(studioBookings.projectId, projectId));
    // Per-occurrence counts (privacy-friendly: clients get counts, not everyone's bookings).
    const counts: Record<string, { booked: number; waitlist: number }> = {};
    for (const b of allBookings) {
      if (b.status !== "booked" && b.status !== "waitlist") continue;
      const k = b.classId + "|" + b.date; (counts[k] ||= { booked: 0, waitlist: 0 });
      if (b.status === "booked") counts[k].booked++; else counts[k].waitlist++;
    }
    const wallet = await loadWallet(projectId, u.email);
    const today0 = ymd(new Date());
    const creditLots = (await loadLots(projectId, u.email)).filter((l) => lotActive(l, today0)).map((l) => ({ credits: l.credits, expiresAt: l.expiresAt }));
    const myBookings = allBookings.filter((b) => b.bookerEmail === u.email && b.status !== "cancelled").map(bkOut);
    const videos = await db.select().from(studioVideos).where(eq(studioVideos.projectId, projectId));
    const videoPlans = await db.select().from(studioVideoPlans).where(eq(studioVideoPlans.projectId, projectId));
    const today = ymd(new Date());
    const access = await db.select().from(studioVideoAccess).where(and(eq(studioVideoAccess.projectId, projectId), eq(studioVideoAccess.email, u.email)));
    // The current user's running subscriptions/memberships — for the client "Abonnementen" tab.
    const myPurch = await db.select().from(studioPurchases).where(and(eq(studioPurchases.projectId, projectId), eq(studioPurchases.email, u.email)));
    const classSubs = myPurch.filter((p) => p.type === "abonnement" && p.subscription && p.refunded !== "true").map((p) => ({ kind: "class", name: p.name, subscription: p.subscription, commitUntil: p.commitUntil || "" }));
    // A still-active membership without a (recurring) Stripe subscription — still cancellable in-app.
    const [wRow] = await db.select().from(studioWallets).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, u.email)));
    const membershipInfo = (!classSubs.length && wRow && wRow.membership && (!wRow.validUntil || wRow.validUntil >= today))
      ? [{ kind: "membership", name: wRow.membership, validUntil: wRow.validUntil || "", commitUntil: wRow.commitUntil || "" }] : [];
    const mySubs = [
      ...access.filter((a) => a.subscription && (!a.validUntil || a.validUntil >= today)).map((a) => ({ kind: "video", category: a.category, validUntil: a.validUntil })),
      ...classSubs,
      ...membershipInfo,
    ];
    const locations = await db.select().from(studioLocations).where(and(eq(studioLocations.projectId, projectId), eq(studioLocations.active, "true")));
    const out: Record<string, unknown> = {
      user: publicUser(u), classes: classes.map(clsOut), members: members.map(memOut), counts, wallet: { ...walletOut(wallet), creditLots }, myBookings,
      locations: locations.map((l) => ({ id: l.id, name: l.name, address: l.address })),
      videos: videos.map((v) => ({ id: v.id, category: v.category, title: v.title, url: v.url, weekNo: v.weekNo })),
      videoPlans: videoPlans.map((p) => ({ category: p.category, price: p.price, validDays: p.validDays })),
      videoAccess: access.filter((a) => !a.validUntil || a.validUntil >= today).map((a) => ({ category: a.category, startedAt: a.startedAt })),
      mySubs,
    };
    if (u.role === "admin" || u.role === "teacher") out.bookings = allBookings.map(bkOut);
    if (u.role === "admin") {
      const users = await db.select().from(studioUsers).where(eq(studioUsers.projectId, projectId));
      out.users = users.map(publicUser);
      const purchases = await db.select().from(studioPurchases).where(eq(studioPurchases.projectId, projectId));
      out.purchases = purchases.map((p) => ({ id: p.id, email: p.email, type: p.type, name: p.name, amount: p.amount, paymentIntent: p.paymentIntent, subscription: p.subscription, refunded: p.refunded === "true", refundedAmount: p.refundedAmount, commitUntil: p.commitUntil || "", date: p.date }));
      const codes = await db.select().from(studioCodes).where(eq(studioCodes.projectId, projectId));
      out.codes = codes.map((c) => ({ id: c.id, code: c.code, kind: c.kind, value: c.value, balance: c.balance, expiresAt: c.expiresAt, maxUses: c.maxUses, uses: c.uses }));
      const [st] = await db.select().from(studioSettings).where(eq(studioSettings.projectId, projectId));
      let svc: unknown[] = []; try { svc = JSON.parse(st?.services || "[]"); if (!Array.isArray(svc)) svc = []; } catch { svc = []; }
      out.settings = { ownerReport: st?.ownerReport || "off", reviewUrl: st?.reviewUrl || "", services: svc };
      // Subscriber payment status: who has a running (monthly) membership and whether it's still paid.
      // validUntil is bumped +32d on each Stripe invoice.paid; needsPayment is set on repeated failure.
      const nameByEmail: Record<string, string> = {}; users.forEach((uu) => { nameByEmail[uu.email] = uu.name; });
      const wallets = await db.select().from(studioWallets).where(eq(studioWallets.projectId, projectId));
      out.subscribers = wallets.filter((w) => w.membership).map((w) => {
        const status = w.needsPayment === "true" ? "failed" : (w.unlimited === "true" || !w.validUntil ? "active" : (w.validUntil >= today ? "active" : "expired"));
        return { email: w.email, name: nameByEmail[w.email] || "", membership: w.membership, validUntil: w.validUntil || "", status };
      });
    }
    res.json(out);
  } catch (err) { logger.error({ err, projectId }, "[studio] state failed"); res.status(500).json({ error: "Laden mislukt." }); }
});

// PUBLIC (no login): the read-only week agenda a visitor sees before logging in. Only the schedule
// + free/full counts + locations — no personal data. Booking itself still requires a login.
router.get("/projects/:id/studio/public", async (req, res) => {
  const projectId = pid(req as any); if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const classes = await db.select().from(studioClasses).where(eq(studioClasses.projectId, projectId));
    const allBookings = await db.select().from(studioBookings).where(eq(studioBookings.projectId, projectId));
    const counts: Record<string, { booked: number; waitlist: number }> = {};
    for (const b of allBookings) {
      if (b.status !== "booked" && b.status !== "waitlist") continue;
      const k = b.classId + "|" + b.date; (counts[k] ||= { booked: 0, waitlist: 0 });
      if (b.status === "booked") counts[k].booked++; else counts[k].waitlist++;
    }
    const locations = await db.select().from(studioLocations).where(and(eq(studioLocations.projectId, projectId), eq(studioLocations.active, "true")));
    // Hide online join links from the public agenda (only logged-in, booked customers should see them).
    res.json({ classes: classes.map((c) => ({ ...clsOut(c), onlineLink: "", onlineInfo: "" })), counts, locations: locations.map((l) => ({ id: l.id, name: l.name, address: l.address })) });
  } catch (err) { logger.error({ err, projectId }, "[studio] public state failed"); res.status(500).json({ error: "Laden mislukt." }); }
});

// Create a lesson (admin picks the teacher; a teacher always creates for themselves).
router.post("/projects/:id/studio/classes", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role === "client") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const b = req.body || {};
  const date = String(b.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "Ongeldige datum." }); return; }
  try {
    const teacherEmail = u.role === "teacher" ? u.email : String(b.teacherEmail || "").toLowerCase();
    let teacherName = "";
    if (teacherEmail) { const [t] = await db.select().from(studioUsers).where(and(eq(studioUsers.projectId, projectId), eq(studioUsers.email, teacherEmail))); teacherName = t?.name || String(b.teacher || ""); }
    const mode = ["fysiek", "online", "hybride"].includes(b.mode) ? b.mode : "fysiek";
    // Recurring weekly schedule: repeatWeeks > 1 creates the same lesson every 7 days for that many weeks.
    const weeks = Math.min(52, Math.max(1, parseInt(b.repeatWeeks, 10) || 1));
    const common = {
      projectId, title: String(b.title || "").trim() || "Les", teacherEmail, teacher: teacherName,
      time: String(b.time || "09:00"), endTime: String(b.endTime || ""), cap: Math.max(1, parseInt(b.cap, 10) || 12), price: Math.max(0, Number(b.price) || 0),
      mode, level: String(b.level || "").slice(0, 40), description: String(b.description || "").slice(0, 600), onlineLink: String(b.onlineLink || ""), onlineInfo: String(b.onlineInfo || ""),
      bookDays: Math.max(0, parseInt(b.bookDays, 10) || 0), cancelHours: Math.max(0, parseInt(b.cancelHours, 10) || 0),
      locationId: Math.max(0, parseInt(b.locationId, 10) || 0),
    };
    let first: typeof studioClasses.$inferSelect | null = null;
    for (let i = 0; i < weeks; i++) {
      const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + i * 7);
      const [c] = await db.insert(studioClasses).values({ ...common, date: ymd(d) }).returning();
      if (!first) first = c;
    }
    void pushAllTeachers(projectId); // sync every connected staff/admin Google Calendar (no-op if none)
    res.json({ ok: true, class: first ? clsOut(first) : null, count: weeks });
  } catch (err) { logger.error({ err, projectId }, "[studio] create class failed"); res.status(500).json({ error: "Les toevoegen mislukt." }); }
});

router.delete("/projects/:id/studio/classes/:cid", async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role === "client") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const cid = Number(req.params.cid);
  try {
    const [c] = await db.select().from(studioClasses).where(and(eq(studioClasses.projectId, projectId), eq(studioClasses.id, cid)));
    if (!c) { res.status(404).json({ error: "Les niet gevonden." }); return; }
    if (u.role === "teacher" && c.teacherEmail !== u.email) { res.status(403).json({ error: "Niet jouw les." }); return; }
    await db.delete(studioClasses).where(eq(studioClasses.id, cid));
    void pushAllTeachers(projectId); // sync every connected staff/admin Google Calendar (removes the event)
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] delete class failed"); res.status(500).json({ error: "Verwijderen mislukt." }); }
});

// Create a membership type for sale (admin only).
router.post("/projects/:id/studio/members", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role !== "admin") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const b = req.body || {};
  try {
    const type = b.type === "abonnement" ? "abonnement" : "strippenkaart";
    const unlimited = type === "abonnement" && (b.unlimited === true || b.lim === "onbeperkt");
    // Vaste looptijd alleen voor abonnementen (maandelijks vast contract): 0 (vrij), 6, 12 of 24 maanden.
    const commitMonths = type === "abonnement" ? ([6, 12, 24].includes(parseInt(b.commitMonths, 10)) ? parseInt(b.commitMonths, 10) : 0) : 0;
    const resetMonthly = b.resetMonthly === true || b.resetMonthly === "true";
    const [m] = await db.insert(studioMembers).values({
      projectId, name: String(b.name || "").trim() || "Lidmaatschap", type, unlimited: unlimited ? "true" : "false",
      credits: unlimited ? null : (parseInt(b.credits, 10) || (type === "strippenkaart" ? 10 : 8)),
      price: Math.max(0, Number(b.price) || 0), validDays: parseInt(b.validDays, 10) || (type === "abonnement" ? 30 : 180),
      recurring: type === "abonnement" ? "true" : "false",
      commitMonths, resetMonthly: resetMonthly ? "true" : "false",
    }).returning();
    res.json({ ok: true, member: memOut(m) });
  } catch (err) { logger.error({ err, projectId }, "[studio] create member failed"); res.status(500).json({ error: "Toevoegen mislukt." }); }
});

router.delete("/projects/:id/studio/members/:mid", async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role !== "admin") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const mid = Number(req.params.mid);
  try { await db.delete(studioMembers).where(and(eq(studioMembers.projectId, projectId), eq(studioMembers.id, mid))); res.json({ ok: true }); }
  catch (err) { logger.error({ err, projectId }, "[studio] delete member failed"); res.status(500).json({ error: "Verwijderen mislukt." }); }
});

// Book a lesson (tegoed). Capacity is enforced inside a transaction that locks the class row, so two
// people can't grab the same last spot. Booking window + tegoed are checked server-side.
router.post("/projects/:id/studio/book", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req as any); const b = req.body || {};
  const classId = Number(b.classId); const date = String(b.date || "");
  const wantWaitlist = b.waitlist === true;
  const payment = b.payment === "stripe" ? "stripe" : "tegoed";
  try {
    const [c] = await db.select().from(studioClasses).where(and(eq(studioClasses.projectId, projectId), eq(studioClasses.id, classId)));
    if (!c) { res.status(404).json({ error: "Les niet gevonden." }); return; }
    const now = Date.now();
    if (isPast(date, c.time, now)) { res.status(400).json({ error: "Deze les is al geweest." }); return; }
    if (bookTooEarly(c.bookDays, date, c.time, now)) { res.status(400).json({ error: "Boeken kan pas vanaf " + bookOpensOn(c.bookDays, date, c.time) + " (" + c.bookDays + " dagen voor de les)." }); return; }
    // Stripe-paid bookings are created after /stripe/verify — wired in step 3 (front-end swap).
    if (payment === "stripe") { res.status(400).json({ error: "Stripe-betaling wordt in een latere stap gekoppeld." }); return; }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM studio_classes WHERE id=${classId} AND project_id=${projectId} FOR UPDATE`);
      const existing = await tx.select().from(studioBookings).where(and(eq(studioBookings.projectId, projectId), eq(studioBookings.classId, classId), eq(studioBookings.date, date)));
      if (existing.some((x) => x.bookerEmail === u.email && (x.status === "booked" || x.status === "waitlist"))) return { error: "Je staat al ingeschreven voor deze les." };
      const full = existing.filter((x) => x.status === "booked").length >= c.cap;
      if (full && !wantWaitlist) return { full: true as const };
      const status = full ? "waitlist" : "booked";
      let usedCredit = false, usedMonthly = false, usedLotId = 0;
      if (status === "booked") {
        const w = await loadWallet(projectId, u.email, tx);
        const dec = creditDecision(w, ymd(new Date()));
        if (!dec.ok) return { error: dec.reason };
        if (dec.type === "credit") { usedLotId = await spendCredit(projectId, u.email, tx); usedCredit = true; if (usedLotId < 0) return { error: "Je tegoed is op of verlopen." }; }
        else if (dec.type === "monthly") { await bumpWallet(projectId, u.email, "monthlyRemaining", -1, tx); usedMonthly = true; }
      }
      const [nb] = await tx.insert(studioBookings).values({ projectId, classId, date, bookerEmail: u.email, name: u.name, status, payment: "tegoed", usedCredit: usedCredit ? "true" : "false", creditLotId: usedLotId, usedMonthly: usedMonthly ? "true" : "false" }).returning();
      return { booking: nb, status };
    });
    if ("error" in result && result.error) { res.status(400).json({ error: result.error }); return; }
    if ("full" in result && result.full) { res.status(409).json({ error: "Deze les is vol.", full: true }); return; }
    const r = result as { booking: typeof studioBookings.$inferSelect; status: string };
    if (r.status === "booked") { try { await sendBookingEmail(projectId, u.email, "booking", { name: u.name, classTitle: c.title, date, time: c.time, mode: c.mode, onlineLink: c.onlineLink, onlineInfo: c.onlineInfo } as any); } catch { /* best-effort */ } }
    res.json({ ok: true, booking: bkOut(r.booking), status: r.status });
  } catch (err) { logger.error({ err, projectId }, "[studio] book failed"); res.status(500).json({ error: "Boeken mislukt." }); }
});

// Cancel a booking (or leave the waitlist). Refunds tegoed, then promotes the first waitlister.
router.post("/projects/:id/studio/cancel", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req as any); const bookingId = Number(req.body?.bookingId);
  try {
    const [bk] = await db.select().from(studioBookings).where(and(eq(studioBookings.projectId, projectId), eq(studioBookings.id, bookingId)));
    if (!bk) { res.status(404).json({ error: "Boeking niet gevonden." }); return; }
    const isAdmin = u.role === "admin";
    if (bk.bookerEmail !== u.email && !isAdmin && u.role !== "teacher") { res.status(403).json({ error: "Geen rechten." }); return; }
    if (bk.status === "cancelled") { res.json({ ok: true }); return; }
    const [c] = await db.select().from(studioClasses).where(and(eq(studioClasses.projectId, projectId), eq(studioClasses.id, bk.classId)));
    if (bk.status === "booked" && c && cancelClosed(c.cancelHours, bk.date, c.time, Date.now()) && !isAdmin) {
      res.status(400).json({ error: "Annuleren kan tot " + c.cancelHours + " uur voor de les — die termijn is verstreken. Neem contact op met de studio." }); return;
    }
    const wasBooked = bk.status === "booked";
    // A no-show forfeits the credit — never refund it on a later cancel.
    const refundCredit = wasBooked && bk.noShow !== "true";
    if (refundCredit && bk.usedCredit === "true") await refundCreditToLot(projectId, bk.bookerEmail, bk.creditLotId, db);
    if (refundCredit && bk.usedMonthly === "true") await bumpWallet(projectId, bk.bookerEmail, "monthlyRemaining", 1);
    await db.update(studioBookings).set({ status: "cancelled", cancelledAt: ymd(new Date()) }).where(eq(studioBookings.id, bookingId));
    try { await sendBookingEmail(projectId, bk.bookerEmail, "cancel", { name: bk.name, classTitle: c?.title || "les", date: bk.date } as any); } catch { /* best-effort */ }
    const promoted = wasBooked ? await promoteFirstWaitlist(projectId, bk.classId, bk.date, c) : null;
    res.json({ ok: true, promoted });
  } catch (err) { logger.error({ err, projectId }, "[studio] cancel failed"); res.status(500).json({ error: "Annuleren mislukt." }); }
});

// Toggle attendance (admin/teacher).
router.post("/projects/:id/studio/present", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role === "client") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const bookingId = Number(req.body?.bookingId);
  try {
    const [bk] = await db.select().from(studioBookings).where(and(eq(studioBookings.projectId, projectId), eq(studioBookings.id, bookingId)));
    if (!bk) { res.status(404).json({ error: "Boeking niet gevonden." }); return; }
    const next = bk.present !== "true";
    await db.update(studioBookings).set({ present: next ? "true" : "false" }).where(eq(studioBookings.id, bookingId));
    res.json({ ok: true, present: next });
  } catch (err) { logger.error({ err, projectId }, "[studio] present failed"); res.status(500).json({ error: "Bijwerken mislukt." }); }
});

// Toggle no-show (admin/teacher). A no-show keeps the consumed credit (it is NOT refunded), so the
// client loses that class. Marking it also clears "present". Purely a marker — no money is charged.
router.post("/projects/:id/studio/noshow", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role === "client") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const bookingId = Number(req.body?.bookingId);
  try {
    const [bk] = await db.select().from(studioBookings).where(and(eq(studioBookings.projectId, projectId), eq(studioBookings.id, bookingId)));
    if (!bk) { res.status(404).json({ error: "Boeking niet gevonden." }); return; }
    const next = bk.noShow !== "true";
    await db.update(studioBookings).set({ noShow: next ? "true" : "false", present: next ? "false" : bk.present }).where(eq(studioBookings.id, bookingId));
    res.json({ ok: true, noShow: next });
  } catch (err) { logger.error({ err, projectId }, "[studio] noshow failed"); res.status(500).json({ error: "Bijwerken mislukt." }); }
});

// ── Stripe-backed actions (step 4): finalize a paid booking/purchase + refunds ──

// Finalize after returning from Stripe Checkout. Verifies the session was really paid, then creates
// the booking (kind 'book') or grants the strippenkaart/abonnement (kind 'buy') server-side.
// Idempotent on the Stripe paymentIntent, so a page refresh can't double-apply.
router.post("/projects/:id/studio/stripe/finalize", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req as any); const b = req.body || {};
  const sessionId = String(b.session_id || ""); const kind = b.kind;
  if (!sessionId) { res.status(400).json({ error: "missing session_id" }); return; }
  try {
    const v = await verifyStripeSession(projectId, sessionId);
    if (!v.paid) { res.status(400).json({ error: "Betaling kon niet bevestigd worden — er is niets toegekend." }); return; }
    const amount = (v.amountTotal || 0) / 100;
    if (kind === "book") {
      const classId = Number(b.classId); const date = String(b.date || "");
      const [c] = await db.select().from(studioClasses).where(and(eq(studioClasses.projectId, projectId), eq(studioClasses.id, classId)));
      if (!c) { res.status(404).json({ error: "Les niet gevonden." }); return; }
      if (v.paymentIntent) { const dup = await db.select().from(studioBookings).where(and(eq(studioBookings.projectId, projectId), eq(studioBookings.paymentIntent, v.paymentIntent))); if (dup.length) { res.json({ ok: true, already: true }); return; } }
      const [nb] = await db.insert(studioBookings).values({ projectId, classId, date, bookerEmail: u.email, name: u.name, status: "booked", payment: "stripe", amount, paymentIntent: v.paymentIntent || "" }).returning();
      await issueInvoice(projectId, u.name, u.email, "Losse les — " + c.title + (date ? " " + date : ""), amount);
      try { await sendBookingEmail(projectId, u.email, "booking", { name: u.name, classTitle: c.title, date, time: c.time, mode: c.mode, onlineLink: c.onlineLink, onlineInfo: c.onlineInfo } as any); } catch { /* best-effort */ }
      res.json({ ok: true, booking: bkOut(nb) }); return;
    }
    if (kind === "buy") {
      const memberId = Number(b.memberId);
      const [m] = await db.select().from(studioMembers).where(and(eq(studioMembers.projectId, projectId), eq(studioMembers.id, memberId)));
      if (!m) { res.status(404).json({ error: "Lidmaatschap niet gevonden." }); return; }
      if (v.paymentIntent) { const dup = await db.select().from(studioPurchases).where(and(eq(studioPurchases.projectId, projectId), eq(studioPurchases.paymentIntent, v.paymentIntent))); if (dup.length) { res.json({ ok: true, already: true }); return; } }
      const nowMonth = ymd(new Date()).slice(0, 7);
      const today = ymd(new Date());
      const validUntil = ymd(new Date(Date.now() + (m.validDays || 30) * 86400000));
      // Vaste looptijd (maandelijks vast contract): klant kan pas opzeggen na commitMonths maanden.
      const commitUntil = m.commitMonths > 0 ? addMonths(today, m.commitMonths) : "";
      // Gewone strippenkaart → eigen potje (credit lot) met eigen vervaldatum. Abonnement of
      // "tegoed vervalt elke maand" → wallet-update (membership / maandbundel) zoals voorheen.
      const plainStrippenkaart = m.type !== "abonnement" && m.resetMonthly !== "true";
      if (plainStrippenkaart) {
        await db.insert(studioCreditLots).values({ projectId, email: u.email, credits: m.credits || 0, expiresAt: validUntil, source: m.name });
      } else {
        const [w] = await db.select().from(studioWallets).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, u.email)));
        const upd = purchaseWalletUpdate({ name: m.name, type: m.type, unlimited: m.unlimited === "true", credits: m.credits, resetMonthly: m.resetMonthly === "true" }, w?.credits || 0, validUntil, nowMonth, w?.creditsUntil || null);
        const set = { credits: upd.credits, membership: upd.membership, unlimited: upd.unlimited ? "true" : "false", monthlyLimit: upd.monthlyLimit, monthlyRemaining: upd.monthlyRemaining, monthlyPeriod: upd.monthlyPeriod, validUntil: upd.validUntil, creditsUntil: upd.creditsUntil, commitUntil: commitUntil || null, needsPayment: "false", updatedAt: new Date() };
        if (w) await db.update(studioWallets).set(set).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, u.email)));
        else await db.insert(studioWallets).values({ projectId, email: u.email, ...set });
      }
      await db.insert(studioPurchases).values({ projectId, email: u.email, type: m.type, name: m.name, amount, paymentIntent: v.paymentIntent || "", subscription: v.subscription || "", commitUntil, date: ymd(new Date()) });
      await issueInvoice(projectId, u.name, u.email, (m.type === "abonnement" ? "Abonnement" : "Strippenkaart") + " — " + m.name, amount);
      await redeemCode(projectId, upperCode(b.code), Number(b.discount) || 0);
      res.json({ ok: true }); return;
    }
    if (kind === "video") {
      const category = String(b.category || "");
      if (!["yoga", "mindfulness", "pilates"].includes(category)) { res.status(400).json({ error: "Onbekende categorie." }); return; }
      if (v.subscription) { const dup = await db.select().from(studioVideoAccess).where(eq(studioVideoAccess.subscription, String(v.subscription))); if (dup.length) { res.json({ ok: true, already: true }); return; } }
      // Recurring: grant ~a month; the webhook (invoice.paid) extends it on each automatic renewal.
      const validUntil = ymd(new Date(Date.now() + 32 * 86400000));
      const subscription = String(v.subscription || "");
      const [ex] = await db.select().from(studioVideoAccess).where(and(eq(studioVideoAccess.projectId, projectId), eq(studioVideoAccess.email, u.email), eq(studioVideoAccess.category, category)));
      // startedAt is set once (first time access begins) so the weekly drip keeps counting from there.
      if (ex) await db.update(studioVideoAccess).set({ validUntil, subscription, startedAt: ex.startedAt || ymd(new Date()), updatedAt: new Date() }).where(eq(studioVideoAccess.id, ex.id));
      else await db.insert(studioVideoAccess).values({ projectId, email: u.email, category, validUntil, subscription, startedAt: ymd(new Date()) });
      await db.insert(studioPurchases).values({ projectId, email: u.email, type: "video", name: "Video-abonnement " + category, amount, paymentIntent: v.paymentIntent || "", subscription: v.subscription || "", date: ymd(new Date()) });
      await issueInvoice(projectId, u.name, u.email, "Video-abonnement — " + category, amount);
      await redeemCode(projectId, upperCode(b.code), Number(b.discount) || 0);
      res.json({ ok: true }); return;
    }
    res.status(400).json({ error: "Onbekend type." });
  } catch (err) { logger.error({ err, projectId }, "[studio] finalize failed"); res.status(500).json({ error: "Afronden mislukt." }); }
});

// Refund a Stripe-paid single-class booking (admin): refund at Stripe, cancel + promote waitlist.
router.post("/projects/:id/studio/refund-booking", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role !== "admin") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const bookingId = Number(req.body?.bookingId);
  try {
    const [bk] = await db.select().from(studioBookings).where(and(eq(studioBookings.projectId, projectId), eq(studioBookings.id, bookingId)));
    if (!bk) { res.status(404).json({ error: "Boeking niet gevonden." }); return; }
    if (!bk.paymentIntent) { res.status(400).json({ error: "Geen Stripe-betaling om terug te storten." }); return; }
    if (bk.refunded === "true") { res.json({ ok: true, already: true }); return; }
    const r = await stripeRefund(projectId, { paymentIntent: bk.paymentIntent, amount: bk.amount });
    if (!r.ok) { res.status(502).json({ error: r.error || "Terugbetalen mislukt." }); return; }
    await db.update(studioBookings).set({ refunded: "true", refundedAmount: r.amount, status: "cancelled", cancelledAt: ymd(new Date()) }).where(eq(studioBookings.id, bookingId));
    const [c] = await db.select().from(studioClasses).where(and(eq(studioClasses.projectId, projectId), eq(studioClasses.id, bk.classId)));
    await issueCreditNote(projectId, bk.name, bk.bookerEmail, "Losse les" + (c?.title ? " — " + c.title : ""), r.amount || bk.amount);
    try { await sendBookingEmail(projectId, bk.bookerEmail, "cancel", { name: bk.name, classTitle: c?.title || "les", date: bk.date } as any); } catch { /* best-effort */ }
    await promoteFirstWaitlist(projectId, bk.classId, bk.date, c);
    res.json({ ok: true, amount: r.amount });
  } catch (err) { logger.error({ err, projectId }, "[studio] refund-booking failed"); res.status(500).json({ error: "Terugbetalen mislukt." }); }
});

// Refund a strippenkaart/abonnement purchase (admin). Strippenkaart: partial amount allowed.
router.post("/projects/:id/studio/refund-purchase", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role !== "admin") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const b = req.body || {}; const purchaseId = Number(b.purchaseId);
  try {
    const [p] = await db.select().from(studioPurchases).where(and(eq(studioPurchases.projectId, projectId), eq(studioPurchases.id, purchaseId)));
    if (!p) { res.status(404).json({ error: "Aankoop niet gevonden." }); return; }
    if (p.refunded === "true") { res.json({ ok: true, already: true }); return; }
    let r;
    if (p.type === "abonnement" && p.subscription) {
      r = await stripeRefund(projectId, { subscription: p.subscription, amount: b.amount != null ? Number(b.amount) : undefined });
    } else {
      if (!p.paymentIntent) { res.status(400).json({ error: "Geen betaling gevonden." }); return; }
      const amt = b.amount != null ? Number(b.amount) : p.amount;
      if (!(amt > 0)) { res.status(400).json({ error: "Ongeldig bedrag." }); return; }
      if (amt > p.amount + 0.001) { res.status(400).json({ error: "Bedrag is hoger dan betaald." }); return; }
      r = await stripeRefund(projectId, { paymentIntent: p.paymentIntent, amount: amt });
    }
    if (!r.ok) { res.status(502).json({ error: r.error || "Terugbetalen mislukt." }); return; }
    await db.update(studioPurchases).set({ refunded: "true", refundedAmount: r.amount }).where(eq(studioPurchases.id, purchaseId));
    const [pu] = await db.select().from(studioUsers).where(and(eq(studioUsers.projectId, projectId), eq(studioUsers.email, p.email)));
    await issueCreditNote(projectId, pu?.name || p.email, p.email, (p.type === "abonnement" ? "Abonnement" : "Strippenkaart") + (p.name ? " — " + p.name : ""), r.amount ?? p.amount);
    res.json({ ok: true, amount: r.amount });
  } catch (err) { logger.error({ err, projectId }, "[studio] refund-purchase failed"); res.status(500).json({ error: "Terugbetalen mislukt." }); }
});

// ── Video library (links) + per-category subscription price ──
const VIDEO_CATS = ["yoga", "mindfulness", "pilates"];

router.post("/projects/:id/studio/videos", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role === "client") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const b = req.body || {};
  const category = VIDEO_CATS.includes(b.category) ? b.category : "yoga";
  const title = String(b.title ?? "").trim() || "Video";
  const url = String(b.url ?? "").trim();
  const weekNo = Math.max(1, parseInt(b.weekNo, 10) || 1);
  if (!/^https?:\/\//i.test(url)) { res.status(400).json({ error: "Geef een geldige video-link (https://…)." }); return; }
  try {
    const [v] = await db.insert(studioVideos).values({ projectId, category, title, url, weekNo }).returning();
    res.json({ ok: true, video: { id: v.id, category: v.category, title: v.title, url: v.url, weekNo: v.weekNo } });
  } catch (err) { logger.error({ err, projectId }, "[studio] add video failed"); res.status(500).json({ error: "Toevoegen mislukt." }); }
});

router.delete("/projects/:id/studio/videos/:vid", async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role === "client") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const vid = Number(req.params.vid);
  try { await db.delete(studioVideos).where(and(eq(studioVideos.projectId, projectId), eq(studioVideos.id, vid))); res.json({ ok: true }); }
  catch (err) { logger.error({ err, projectId }, "[studio] delete video failed"); res.status(500).json({ error: "Verwijderen mislukt." }); }
});

// Set the subscription price for a category (admin/teacher). Buying + access gating arrives in step 2.
router.post("/projects/:id/studio/video-plan", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role === "client") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const b = req.body || {};
  if (!VIDEO_CATS.includes(b.category)) { res.status(400).json({ error: "Onbekende categorie." }); return; }
  const price = Math.max(0, Number(b.price) || 0);
  const validDays = Math.max(1, parseInt(b.validDays, 10) || 30);
  try {
    const [ex] = await db.select().from(studioVideoPlans).where(and(eq(studioVideoPlans.projectId, projectId), eq(studioVideoPlans.category, b.category)));
    if (ex) await db.update(studioVideoPlans).set({ price, validDays, updatedAt: new Date() }).where(and(eq(studioVideoPlans.projectId, projectId), eq(studioVideoPlans.category, b.category)));
    else await db.insert(studioVideoPlans).values({ projectId, category: b.category, price, validDays });
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] video-plan failed"); res.status(500).json({ error: "Opslaan mislukt." }); }
});

// Cancel the client's own recurring class (lessen) subscription. Stops at period end.
router.post("/projects/:id/studio/cancel-membership", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req as any); const subscription = String(req.body?.subscription || "");
  try {
    const [p] = await db.select().from(studioPurchases).where(and(eq(studioPurchases.projectId, projectId), eq(studioPurchases.email, u.email), eq(studioPurchases.subscription, subscription)));
    if (!p || !p.subscription) { res.status(400).json({ error: "Geen lopend abonnement gevonden." }); return; }
    // Vaste looptijd: klant mag niet eerder opzeggen dan het einde van het contract (admin wél, via terugbetalen).
    if (p.commitUntil && p.commitUntil > ymd(new Date())) {
      const d = p.commitUntil.split("-"); const nl = d.length === 3 ? d[2] + "-" + d[1] + "-" + d[0] : p.commitUntil;
      res.status(400).json({ error: "Je zit nog vast aan je contract tot " + nl + ". Opzeggen kan daarna. Neem contact op met de studio voor vragen." }); return;
    }
    await cancelStripeSubscription(projectId, p.subscription);
    await db.update(studioPurchases).set({ subscription: "" }).where(eq(studioPurchases.id, p.id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] cancel-membership failed"); res.status(500).json({ error: "Opzeggen mislukt." }); }
});

// End a (non-recurring) membership the client holds — there's no Stripe sub to cancel, so we simply
// stop the membership now. Respects a fixed-term contract (commitUntil) just like cancel-membership.
router.post("/projects/:id/studio/end-membership", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req as any);
  try {
    const [w] = await db.select().from(studioWallets).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, u.email)));
    if (!w || !w.membership) { res.status(400).json({ error: "Je hebt geen lopend abonnement." }); return; }
    if (w.commitUntil && w.commitUntil > ymd(new Date())) {
      const d = w.commitUntil.split("-"); const nl = d.length === 3 ? d[2] + "-" + d[1] + "-" + d[0] : w.commitUntil;
      res.status(400).json({ error: "Je zit nog vast aan je contract tot " + nl + "." }); return;
    }
    await db.update(studioWallets).set({ membership: null, unlimited: "false", monthlyLimit: null, monthlyRemaining: null, validUntil: ymd(new Date()), commitUntil: null, updatedAt: new Date() }).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, u.email)));
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] end-membership failed"); res.status(500).json({ error: "Beëindigen mislukt." }); }
});

// Cancel a recurring video subscription (the customer themselves, or admin). Stops at period end.
router.post("/projects/:id/studio/video-cancel", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req as any); const category = String(req.body?.category || "");
  try {
    const [a] = await db.select().from(studioVideoAccess).where(and(eq(studioVideoAccess.projectId, projectId), eq(studioVideoAccess.email, u.email), eq(studioVideoAccess.category, category)));
    if (!a || !a.subscription) { res.status(400).json({ error: "Geen lopend abonnement gevonden." }); return; }
    await cancelStripeSubscription(projectId, a.subscription);
    // Stop tracking renewals; access stays valid until the already-paid period ends (validUntil).
    await db.update(studioVideoAccess).set({ subscription: "", updatedAt: new Date() }).where(eq(studioVideoAccess.id, a.id));
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] video-cancel failed"); res.status(500).json({ error: "Opzeggen mislukt." }); }
});

// ── Discount codes / promos / gift cards ──
const upperCode = (s: unknown) => String(s || "").trim().toUpperCase();
async function lookupCode(projectId: number, code: string) {
  if (!code) return null;
  const [c] = await db.select().from(studioCodes).where(and(eq(studioCodes.projectId, projectId), eq(studioCodes.code, code)));
  return c || null;
}
function codeDiscount(c: typeof studioCodes.$inferSelect | null, amount: number): { discount: number; error?: string } {
  if (!c || c.active !== "true") return { discount: 0, error: "Onbekende code." };
  if (c.expiresAt && c.expiresAt < ymd(new Date())) return { discount: 0, error: "Code is verlopen." };
  if (c.maxUses > 0 && c.uses >= c.maxUses) return { discount: 0, error: "Code is niet meer geldig." };
  let d = 0;
  if (c.kind === "percent") d = amount * (c.value || 0) / 100;
  else if (c.kind === "fixed") d = Math.min(c.value || 0, amount);
  else if (c.kind === "gift") { if ((c.balance || 0) <= 0) return { discount: 0, error: "Deze cadeaubon is leeg." }; d = Math.min(c.balance, amount); }
  d = Math.max(0, Math.min(d, amount));
  return { discount: Math.round(d * 100) / 100 };
}
async function redeemCode(projectId: number, code: string, discount: number) {
  if (!code) return;
  const c = await lookupCode(projectId, code); if (!c) return;
  const set: Record<string, unknown> = { uses: c.uses + 1 };
  if (c.kind === "gift") set.balance = Math.max(0, Math.round((c.balance - (discount || 0)) * 100) / 100);
  await db.update(studioCodes).set(set).where(eq(studioCodes.id, c.id));
}

// Validate a code against an amount (no side effects) — used at checkout to show the discounted price.
router.post("/projects/:id/studio/code/validate", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  const projectId = pid(req as any); const code = upperCode(req.body?.code); const amount = Math.max(0, Number(req.body?.amount) || 0);
  const c = await lookupCode(projectId, code);
  const r = codeDiscount(c, amount);
  if (r.error) { res.status(400).json({ error: r.error }); return; }
  res.json({ ok: true, code, kind: c!.kind, discount: r.discount, newAmount: Math.round((amount - r.discount) * 100) / 100 });
});

router.post("/projects/:id/studio/codes", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role !== "admin") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const b = req.body || {};
  const code = upperCode(b.code); if (!code) { res.status(400).json({ error: "Geef een code op." }); return; }
  const kind = ["percent", "fixed", "gift"].includes(b.kind) ? b.kind : "percent";
  const value = Math.max(0, Number(b.value) || 0);
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(b.expiresAt) ? b.expiresAt : "";
  const maxUses = Math.max(0, parseInt(b.maxUses, 10) || 0);
  try {
    const [ex] = await db.select().from(studioCodes).where(and(eq(studioCodes.projectId, projectId), eq(studioCodes.code, code)));
    if (ex) await db.update(studioCodes).set({ kind, value, balance: kind === "gift" ? value : 0, expiresAt, maxUses, active: "true" }).where(eq(studioCodes.id, ex.id));
    else await db.insert(studioCodes).values({ projectId, code, kind, value, balance: kind === "gift" ? value : 0, expiresAt, maxUses });
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] create code failed"); res.status(500).json({ error: "Opslaan mislukt." }); }
});

router.delete("/projects/:id/studio/codes/:cid", async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role !== "admin") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const cid = Number(req.params.cid);
  try { await db.delete(studioCodes).where(and(eq(studioCodes.projectId, projectId), eq(studioCodes.id, cid))); res.json({ ok: true }); }
  catch (err) { logger.error({ err, projectId }, "[studio] delete code failed"); res.status(500).json({ error: "Verwijderen mislukt." }); }
});

// ── Studio settings (admin toggles) ──
router.post("/projects/:id/studio/settings", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role !== "admin") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const b = req.body || {};
  const ownerReport = ["off", "weekly", "monthly"].includes(b.ownerReport) ? b.ownerReport : undefined;
  // Treatment/dienst catalog: [{name, price, duration}] — normalised + capped (name+price only required).
  let services: string | undefined;
  if (Array.isArray(b.services)) {
    const clean = b.services.slice(0, 200).map((s: any) => ({
      name: String(s?.name ?? "").trim().slice(0, 120),
      price: Math.max(0, Math.round((Number(s?.price) || 0) * 100) / 100),
      duration: Math.max(0, Math.round(Number(s?.duration) || 0)),
    })).filter((s: any) => s.name);
    services = JSON.stringify(clean);
  }
  try {
    const [ex] = await db.select().from(studioSettings).where(eq(studioSettings.projectId, projectId));
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (ownerReport !== undefined) patch.ownerReport = ownerReport;
    if (b.reviewUrl !== undefined) patch.reviewUrl = String(b.reviewUrl || "").trim().slice(0, 500);
    if (services !== undefined) patch.services = services;
    if (ex) await db.update(studioSettings).set(patch).where(eq(studioSettings.projectId, projectId));
    else await db.insert(studioSettings).values({ projectId, ownerReport: ownerReport || "off", reviewUrl: String(b.reviewUrl || "").trim().slice(0, 500), services: services || "[]" });
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] settings failed"); res.status(500).json({ error: "Opslaan mislukt." }); }
});

// ── Locations (multi-location, admin) ──
router.post("/projects/:id/studio/locations", body, async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role !== "admin") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const b = req.body || {};
  const name = String(b.name || "").trim(); if (!name) { res.status(400).json({ error: "Geef een naam op." }); return; }
  const address = String(b.address || "").trim();
  try {
    if (b.id) await db.update(studioLocations).set({ name, address }).where(and(eq(studioLocations.projectId, projectId), eq(studioLocations.id, Number(b.id))));
    else await db.insert(studioLocations).values({ projectId, name, address });
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] create location failed"); res.status(500).json({ error: "Opslaan mislukt." }); }
});

router.delete("/projects/:id/studio/locations/:lid", async (req, res) => {
  const u = await authed(req, res); if (!u) return;
  if (u.role !== "admin") { res.status(403).json({ error: "Geen rechten." }); return; }
  const projectId = pid(req as any); const lid = Number(req.params.lid);
  try {
    await db.delete(studioLocations).where(and(eq(studioLocations.projectId, projectId), eq(studioLocations.id, lid)));
    // Classes that pointed here fall back to "no specific location".
    await db.update(studioClasses).set({ locationId: 0 }).where(and(eq(studioClasses.projectId, projectId), eq(studioClasses.locationId, lid)));
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[studio] delete location failed"); res.status(500).json({ error: "Verwijderen mislukt." }); }
});

export default router;
