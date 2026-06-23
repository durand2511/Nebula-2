/**
 * Booking-app server API (replaces the per-browser localStorage). STEP 1: account auth.
 * register / login / me / logout / reset — passwords scrypt-hashed, sessions via opaque tokens.
 * Classes, bookings, wallets, members & purchases follow in the next steps.
 */
import { Router, json, type Request, type Response } from "express";
import { db, studioUsers, studioClasses, studioMembers, studioWallets, studioBookings, studioPurchases, type StudioUser } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createSession, getSessionUser, deleteSession, tokenFrom, publicUser, seedStaffAccounts } from "../lib/studio-auth.js";
import { sendBookingEmail, sendPaymentEmail } from "../lib/email.js";
import { type Wallet, ymd, applyMonthlyReset, creditDecision, isPast, bookTooEarly, bookOpensOn, cancelClosed, purchaseWalletUpdate } from "../lib/studio-rules.js";
import { verifyStripeSession, stripeRefund } from "./stripe.js";
import { getInvoiceSettings, createInvoice, renderInvoiceHtml, renderInvoicePdf } from "../lib/invoice.js";

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
  const [r] = await exec.select().from(studioWallets).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, email)));
  if (!r) return { credits: 0, membership: null, unlimited: false, monthlyLimit: null, monthlyRemaining: null, monthlyPeriod: nowMonth, validUntil: null, needsPayment: false };
  const w: Wallet = { credits: r.credits, membership: r.membership, unlimited: r.unlimited === "true", monthlyLimit: r.monthlyLimit, monthlyRemaining: r.monthlyRemaining, monthlyPeriod: r.monthlyPeriod, validUntil: r.validUntil, needsPayment: r.needsPayment === "true" };
  const reset = applyMonthlyReset(w, nowMonth);
  if (reset.changed) {
    await exec.update(studioWallets).set({ monthlyRemaining: reset.monthlyRemaining, monthlyPeriod: reset.monthlyPeriod, updatedAt: new Date() }).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, email)));
    w.monthlyRemaining = reset.monthlyRemaining; w.monthlyPeriod = reset.monthlyPeriod;
  }
  return w;
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

const clsOut = (c: typeof studioClasses.$inferSelect) => ({ id: c.id, title: c.title, teacherEmail: c.teacherEmail, teacher: c.teacher, date: c.date, time: c.time, cap: c.cap, price: c.price, mode: c.mode, onlineLink: c.onlineLink, onlineInfo: c.onlineInfo, bookDays: c.bookDays, cancelHours: c.cancelHours });
const memOut = (m: typeof studioMembers.$inferSelect) => ({ id: m.id, name: m.name, type: m.type, unlimited: m.unlimited === "true", credits: m.credits, price: m.price, validDays: m.validDays, recurring: m.recurring === "true" });
const bkOut = (b: typeof studioBookings.$inferSelect) => ({ id: b.id, classId: b.classId, date: b.date, bookerEmail: b.bookerEmail, name: b.name, status: b.status, payment: b.payment, usedCredit: b.usedCredit === "true", usedMonthly: b.usedMonthly === "true", present: b.present === "true", amount: b.amount, paymentIntent: b.paymentIntent, refunded: b.refunded === "true", refundedAmount: b.refundedAmount });

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
const walletOut = (w: Wallet) => ({ credits: w.credits, membership: w.membership, unlimited: w.unlimited, monthlyLimit: w.monthlyLimit, monthlyRemaining: w.monthlyRemaining, validUntil: w.validUntil, needsPayment: w.needsPayment });

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
  try {
    const [u] = await db.select().from(studioUsers).where(and(eq(studioUsers.projectId, projectId), eq(studioUsers.email, email)));
    if (!u || !verifyPassword(password, u.passwordHash)) { res.status(401).json({ error: "Onjuist e-mailadres of wachtwoord." }); return; }
    const token = await createSession(projectId, u.id);
    res.json({ ok: true, token, user: publicUser(u) });
  } catch (err) { logger.error({ err, projectId }, "[studio] login failed"); res.status(500).json({ error: "Inloggen mislukt." }); }
});

// Idempotently seed the chat-configured admin/teacher logins (the booking app sends its baked
// accounts once on load). Open like register/login; it only creates accounts that don't exist yet.
router.post("/projects/:id/studio/seed-staff", body, async (req, res) => {
  const projectId = pid(req as any); if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const accounts = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
    const created = await seedStaffAccounts(projectId, accounts);
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
    const myBookings = allBookings.filter((b) => b.bookerEmail === u.email && b.status !== "cancelled").map(bkOut);
    const out: Record<string, unknown> = { user: publicUser(u), classes: classes.map(clsOut), members: members.map(memOut), counts, wallet: walletOut(wallet), myBookings };
    if (u.role === "admin" || u.role === "teacher") out.bookings = allBookings.map(bkOut);
    if (u.role === "admin") {
      const users = await db.select().from(studioUsers).where(eq(studioUsers.projectId, projectId));
      out.users = users.map(publicUser);
      const purchases = await db.select().from(studioPurchases).where(eq(studioPurchases.projectId, projectId));
      out.purchases = purchases.map((p) => ({ id: p.id, email: p.email, type: p.type, name: p.name, amount: p.amount, paymentIntent: p.paymentIntent, subscription: p.subscription, refunded: p.refunded === "true", refundedAmount: p.refundedAmount, date: p.date }));
    }
    res.json(out);
  } catch (err) { logger.error({ err, projectId }, "[studio] state failed"); res.status(500).json({ error: "Laden mislukt." }); }
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
    const [c] = await db.insert(studioClasses).values({
      projectId, title: String(b.title || "").trim() || "Les", teacherEmail, teacher: teacherName,
      date, time: String(b.time || "09:00"), cap: Math.max(1, parseInt(b.cap, 10) || 12), price: Math.max(0, Number(b.price) || 0),
      mode, onlineLink: String(b.onlineLink || ""), onlineInfo: String(b.onlineInfo || ""),
      bookDays: Math.max(0, parseInt(b.bookDays, 10) || 0), cancelHours: Math.max(0, parseInt(b.cancelHours, 10) || 0),
    }).returning();
    res.json({ ok: true, class: clsOut(c) });
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
    const [m] = await db.insert(studioMembers).values({
      projectId, name: String(b.name || "").trim() || "Lidmaatschap", type, unlimited: unlimited ? "true" : "false",
      credits: unlimited ? null : (parseInt(b.credits, 10) || (type === "strippenkaart" ? 10 : 8)),
      price: Math.max(0, Number(b.price) || 0), validDays: parseInt(b.validDays, 10) || (type === "abonnement" ? 30 : 180),
      recurring: type === "abonnement" ? "true" : "false",
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
      let usedCredit = false, usedMonthly = false;
      if (status === "booked") {
        const w = await loadWallet(projectId, u.email, tx);
        const dec = creditDecision(w, ymd(new Date()));
        if (!dec.ok) return { error: dec.reason };
        if (dec.type === "credit") { await bumpWallet(projectId, u.email, "credits", -1, tx); usedCredit = true; }
        else if (dec.type === "monthly") { await bumpWallet(projectId, u.email, "monthlyRemaining", -1, tx); usedMonthly = true; }
      }
      const [nb] = await tx.insert(studioBookings).values({ projectId, classId, date, bookerEmail: u.email, name: u.name, status, payment: "tegoed", usedCredit: usedCredit ? "true" : "false", usedMonthly: usedMonthly ? "true" : "false" }).returning();
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
    if (wasBooked && bk.usedCredit === "true") await bumpWallet(projectId, bk.bookerEmail, "credits", 1);
    if (wasBooked && bk.usedMonthly === "true") await bumpWallet(projectId, bk.bookerEmail, "monthlyRemaining", 1);
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
      const validUntil = ymd(new Date(Date.now() + (m.validDays || 30) * 86400000));
      const [w] = await db.select().from(studioWallets).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, u.email)));
      const upd = purchaseWalletUpdate({ name: m.name, type: m.type, unlimited: m.unlimited === "true", credits: m.credits }, w?.credits || 0, validUntil, nowMonth);
      const set = { credits: upd.credits, membership: upd.membership, unlimited: upd.unlimited ? "true" : "false", monthlyLimit: upd.monthlyLimit, monthlyRemaining: upd.monthlyRemaining, monthlyPeriod: upd.monthlyPeriod, validUntil: upd.validUntil, needsPayment: "false", updatedAt: new Date() };
      if (w) await db.update(studioWallets).set(set).where(and(eq(studioWallets.projectId, projectId), eq(studioWallets.email, u.email)));
      else await db.insert(studioWallets).values({ projectId, email: u.email, ...set });
      await db.insert(studioPurchases).values({ projectId, email: u.email, type: m.type, name: m.name, amount, paymentIntent: v.paymentIntent || "", subscription: v.subscription || "", date: ymd(new Date()) });
      await issueInvoice(projectId, u.name, u.email, (m.type === "abonnement" ? "Abonnement" : "Strippenkaart") + " — " + m.name, amount);
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
    res.json({ ok: true, amount: r.amount });
  } catch (err) { logger.error({ err, projectId }, "[studio] refund-purchase failed"); res.status(500).json({ error: "Terugbetalen mislukt." }); }
});

export default router;
