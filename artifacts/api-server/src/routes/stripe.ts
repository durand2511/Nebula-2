/**
 * Stripe Connect (Express) — real payments for the booking app.
 *
 * Model (decided with the user): Express connected accounts (one per studio/project),
 * NO platform fee (100% to the studio via direct charges), and customers can pay for a
 * single class, a strippenkaart bundle (one-off) or an abonnement (monthly subscription).
 *
 * We call the Stripe REST API directly with fetch (no SDK dependency). Secret key lives in
 * .env (STRIPE_SECRET_KEY); the webhook signing secret in STRIPE_WEBHOOK_SECRET.
 */
import { Router, type IRouter, type Request, raw, json } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, projectStripe, projects, studioVideoAccess, studioPurchases, studioWallets, platformUsers, studioProducts, studioClasses } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendBookingEmail } from "../lib/email.js";
import { getSessionUser, tokenFrom } from "../lib/platform-auth.js";
import { getSessionUser as getStudioUser } from "../lib/studio-auth.js";
import { addCredit, recentUsage, isSubscribed, MONTHLY_AI_CREDIT_EUR, SUBSCRIPTION_PRICE_EUR } from "../lib/billing.js";
import { reqBaseUrl } from "../lib/req-url.js";
import { resolveSmtpConfig } from "../lib/email-config.js";
import { sendMail } from "../lib/smtp.js";

const router: IRouter = Router();

// Payment methods the studio should be able to accept. Capabilities must be requested on the
// connected account; iDEAL/Klarna only work for one-off payments (Stripe does not support them for
// subscriptions — there only card works). PayPal is intentionally NOT requested: Stripe rejects the
// `paypal_payments` capability for NL Express accounts ("Unknown capability"), which blocks onboarding.
const CONNECT_CAPABILITIES = {
  card_payments: { requested: true },
  transfers: { requested: true },
  ideal_payments: { requested: true },
  klarna_payments: { requested: true },
} as const;
const ONE_OFF_METHODS = ["card", "ideal", "klarna"];
const SUBSCRIPTION_METHODS = ["card"];

// Nebula platform subscription (€69,99/mo) price id (not secret) — overridable via env.
const NEBULA_PRICE = process.env.STRIPE_NEBULA_PRICE || "price_1TnJ4EH6IP6GE07dMkhROecB";
// Get-or-create the Stripe customer for a platform user (on the PLATFORM account, no Connect header).
async function ensureCustomer(u: { id: number; email: string; name: string; stripeCustomerId: string }): Promise<string> {
  if (u.stripeCustomerId) return u.stripeCustomerId;
  const c = await stripeReq("POST", "customers", { email: u.email, name: u.name, "metadata[platformUserId]": String(u.id) });
  await db.update(platformUsers).set({ stripeCustomerId: c.id }).where(eq(platformUsers.id, u.id));
  return c.id;
}

// Get-or-create the €50/mo recurring price (by lookup_key), unless a fixed price is set via env.
async function nebulaPriceId(): Promise<string> {
  const env = process.env.STRIPE_NEBULA_PRICE || "";
  if (/^price_/.test(env)) return env;
  try {
    const found = await stripeReq("GET", `prices?lookup_keys[]=nebula_monthly_50&active=true&limit=1`);
    if (found?.data?.[0]?.id) return found.data[0].id;
  } catch { /* fall through to create */ }
  const price = await stripeReq("POST", "prices", {
    currency: "eur", unit_amount: Math.round(SUBSCRIPTION_PRICE_EUR * 100),
    recurring: { interval: "month" }, lookup_key: "nebula_monthly_50",
    product_data: { name: "Nebula — volledige toegang" },
  });
  return price.id;
}

// ── Stripe REST helper ────────────────────────────────────────────────────────
function toForm(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") out.push(...toForm(item as Record<string, unknown>, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      out.push(...toForm(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function stripeReq(method: string, path: string, params?: Record<string, unknown>, account?: string): Promise<any> {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) throw new Error("STRIPE_SECRET_KEY ontbreekt in .env");
  const headers: Record<string, string> = { Authorization: `Bearer ${sk}` };
  if (account) headers["Stripe-Account"] = account;
  let body: string | undefined;
  if (params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = toForm(params).join("&");
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers, body });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

// Prefer the Origin the editor was opened on (so the studio returns to the right editor), then fall
// back to the request's live host (never a hardcoded localhost in production).
const baseUrl = (req: Request) =>
  (typeof req.headers["origin"] === "string" && req.headers["origin"]) || reqBaseUrl(req);

// ── Reusable helpers (used by the studio booking API to finalize/refund server-side) ──
async function stripeAccountId(projectId: number): Promise<string | null> {
  const [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
  return row?.accountId ?? null;
}

/** Verify a Checkout session was actually paid (so a customer can't fake it by visiting success_url). */
export async function verifyStripeSession(projectId: number, sessionId: string): Promise<{ paid: boolean; paymentIntent: string | null; subscription: string | null; amountTotal: number | null }> {
  const acct = await stripeAccountId(projectId);
  if (!acct || !sessionId) return { paid: false, paymentIntent: null, subscription: null, amountTotal: null };
  const session = await stripeReq("GET", `checkout/sessions/${encodeURIComponent(sessionId)}`, undefined, acct);
  const paid = session.payment_status === "paid" || session.status === "complete";
  return { paid, paymentIntent: session.payment_intent ?? null, subscription: session.subscription ?? null, amountTotal: typeof session.amount_total === "number" ? session.amount_total : null };
}

/** Cancel a recurring subscription at period end (no refund) — used to "opzeggen" a video plan. */
export async function cancelStripeSubscription(projectId: number, subscriptionId: string): Promise<boolean> {
  const acct = await stripeAccountId(projectId);
  if (!acct || !subscriptionId) return false;
  await stripeReq("POST", `subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: true }, acct);
  return true;
}

const ymdUTC = (d: Date) => d.toISOString().slice(0, 10);

/** Refund a one-off payment (optionally partial) or cancel+refund a subscription. */
export async function stripeRefund(projectId: number, opts: { paymentIntent?: string; subscription?: string; amount?: number }): Promise<{ ok: boolean; refunded: boolean; amount: number; cancelled?: boolean; error?: string }> {
  const acct = await stripeAccountId(projectId);
  if (!acct) return { ok: false, refunded: false, amount: 0, error: "Stripe niet gekoppeld." };
  if (opts.subscription) {
    const sub = await stripeReq("GET", `subscriptions/${encodeURIComponent(opts.subscription)}`, undefined, acct);
    try { await stripeReq("DELETE", `subscriptions/${encodeURIComponent(opts.subscription)}`, undefined, acct); } catch { /* may already be cancelled */ }
    let refunded = false, amount = 0;
    if (sub.latest_invoice) {
      const inv = await stripeReq("GET", `invoices/${encodeURIComponent(sub.latest_invoice)}`, undefined, acct);
      if (inv.payment_intent) {
        const params: Record<string, unknown> = { payment_intent: inv.payment_intent };
        if (opts.amount != null && Number(opts.amount) > 0) params.amount = Math.round(Number(opts.amount) * 100);
        const r = await stripeReq("POST", "refunds", params, acct);
        refunded = true; amount = (r.amount || 0) / 100;
      }
    }
    return { ok: true, cancelled: true, refunded, amount };
  }
  if (!opts.paymentIntent) return { ok: false, refunded: false, amount: 0, error: "Geen betaling om terug te storten." };
  const params: Record<string, unknown> = { payment_intent: opts.paymentIntent };
  if (opts.amount != null && Number(opts.amount) > 0) params.amount = Math.round(Number(opts.amount) * 100);
  const refund = await stripeReq("POST", "refunds", params, acct);
  return { ok: true, refunded: true, amount: (refund.amount || 0) / 100 };
}

// A Stripe statement_descriptor (what the customer sees on their bank statement) must be 5–22 chars,
// contain a letter, and use only latin letters/numbers/spaces (no < > \ " '). Derive it from the
// studio's name so the CUSTOMER sees the studio — not the platform — on their statement.
function toStatementDescriptor(name: string): string | null {
  let s = (name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^A-Za-z0-9 ]/g, " ")                    // only latin letters/digits/spaces
    .replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]/.test(s)) return null;                // must contain at least one letter
  if (s.length > 22) s = s.slice(0, 22).trim();
  if (s.length < 5) s = `${s} STUDIO`.slice(0, 22).trim(); // meet the 5-char minimum
  return s.length >= 5 ? s : null;
}

// Set the connected account's statement descriptor to the studio's name. Best-effort: never block
// onboarding on it. Runs automatically for every studio (new + existing) via the onboard route.
async function applyStatementDescriptor(projectId: number, accountId: string): Promise<void> {
  try {
    const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId));
    const descriptor = toStatementDescriptor(proj?.name || "");
    if (!descriptor) return;
    await stripeReq("POST", `accounts/${accountId}`, {
      settings: { payments: { statement_descriptor: descriptor } },
    });
    logger.info({ projectId, accountId, descriptor }, "[stripe] statement_descriptor set to studio name");
  } catch (err) {
    logger.warn({ err, projectId, accountId }, "[stripe] statement_descriptor update failed");
  }
}

// ── 1. Onboarding: get-or-create the studio's Express account + an onboarding link ──
router.post("/projects/:id/stripe/onboard", json({ limit: "16kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  // Stripe rejects localhost return/refresh URLs in LIVE mode. Prefer the exact page the studio is
  // on (sent by the booking app), then the request's live host — never a hardcoded localhost.
  const b = req.body || {};
  const fallback = `${baseUrl(req)}/projects/${projectId}`;
  const returnUrl = (typeof b.returnUrl === "string" && /^https?:\/\//.test(b.returnUrl) && b.returnUrl) || fallback;
  const refreshUrl = (typeof b.refreshUrl === "string" && /^https?:\/\//.test(b.refreshUrl) && b.refreshUrl) || returnUrl;
  try {
    let [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (!row) {
      const acct = await stripeReq("POST", "accounts", {
        type: "express", country: "NL",
        capabilities: CONNECT_CAPABILITIES,
      });
      [row] = await db.insert(projectStripe).values({ projectId, accountId: acct.id, chargesEnabled: "false" }).returning();
    } else {
      // Existing account: request any newly-added capabilities (iDEAL/Klarna/PayPal) so studios that
      // onboarded before these were enabled get them. Best-effort — never block onboarding on it.
      try {
        await stripeReq("POST", `accounts/${row.accountId}`, { capabilities: CONNECT_CAPABILITIES });
      } catch (err) {
        logger.warn({ err, projectId }, "[stripe] capability upgrade failed");
      }
    }
    // Put the studio's OWN name on the customer's bank statement (not the platform). Automatic for
    // every studio, new or existing. Best-effort.
    await applyStatementDescriptor(projectId, row.accountId);
    const link = await stripeReq("POST", "account_links", {
      account: row.accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    res.json({ url: link.url, accountId: row.accountId });
  } catch (err) {
    logger.error({ err, projectId }, "[stripe] onboard failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Onboarding mislukt" });
  }
});

// ── 2. Status: is the studio connected & able to accept charges? ──
router.get("/projects/:id/stripe/status", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (!row) { res.json({ connected: false }); return; }
    const acct = await stripeReq("GET", `accounts/${row.accountId}`);
    const enabled = !!acct.charges_enabled;
    if (String(enabled) !== row.chargesEnabled) {
      await db.update(projectStripe).set({ chargesEnabled: String(enabled) }).where(eq(projectStripe.projectId, projectId));
    }
    // Also surface PAYOUT readiness — a studio can accept charges but still have payouts held
    // (Stripe holds a new account's first payout ~7 days, and blocks payouts entirely when
    // verification info is still missing). Without this the studio can't tell WHY €X isn't arriving.
    const req0 = acct.requirements || {};
    res.json({
      connected: true,
      chargesEnabled: enabled,
      payoutsEnabled: !!acct.payouts_enabled,
      requirementsDue: (req0.currently_due || []).concat(req0.past_due || []),
      disabledReason: req0.disabled_reason || null,
      payoutSchedule: acct.settings?.payouts?.schedule || null,
      accountId: row.accountId,
      detailsSubmitted: !!acct.details_submitted,
    });
  } catch (err) {
    logger.error({ err, projectId }, "[stripe] status failed");
    res.status(500).json({ error: "Status ophalen mislukt" });
  }
});

// ── 2b. Dashboard: one-click login link into the studio's own Stripe Express dashboard ──
// So the studio can see their balance, payouts and payments. Works once onboarding is submitted.
router.post("/projects/:id/stripe/dashboard", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (!row) { res.status(400).json({ error: "Stripe is nog niet gekoppeld." }); return; }
    const link = await stripeReq("POST", `accounts/${row.accountId}/login_links`);
    res.json({ url: link.url });
  } catch (err) {
    // Stripe rejects login links until onboarding is submitted — surface a friendly hint.
    logger.warn({ err, projectId }, "[stripe] dashboard login link failed");
    res.status(400).json({ error: "Kon het Stripe-dashboard niet openen. Rond eerst de Stripe-onboarding af." });
  }
});

// ── 3. Checkout: pay for a class / strippenkaart (one-off) or abonnement (subscription) ──
// Direct charge on the studio's connected account → money goes to the studio, no platform fee.
// List recent successful card payments on the studio's connected account — for the dashboard's
// Betalingen/Kassa reconciliation (match Tap-to-Pay payments from the Stripe app to appointments by
// time). Admin-only.
export type ProjectPayment = { id: string; amount: number; created: number; currency: string; last4: string; brand: string };

/** Succeeded Stripe payments (PaymentIntents) for a project's connected account, or [] if none. */
export async function fetchProjectPayments(projectId: number): Promise<ProjectPayment[]> {
  const [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
  if (!row || !row.accountId) return [];
  const list = await stripeReq("GET", "payment_intents?limit=50&expand[]=data.latest_charge", undefined, row.accountId);
  const raw = Array.isArray(list.data) ? list.data : [];
  return raw
    .filter((p: any) => p && p.status === "succeeded")
    .map((p: any) => {
      const ch = p.latest_charge && typeof p.latest_charge === "object" ? p.latest_charge : null;
      const pmd = (ch && ch.payment_method_details) || {};
      return {
        id: p.id, amount: p.amount_received || p.amount, created: p.created, currency: p.currency,
        last4: pmd.card?.last4 || pmd.card_present?.last4 || "",
        brand: pmd.card?.brand || pmd.card_present?.brand || "",
      };
    });
}

// Auto-reconcile product sales: a succeeded payment whose amount EXACTLY matches a product's price (and
// doesn't match an appointment's price that day — those stay manual) is booked as a product sale and
// deducts 1 from stock. Idempotent on the Stripe payment id. When a product drops to/under its lowStock
// threshold, its supplier gets a reorder e-mail once (until restocked above the threshold).
export async function reconcileProducts(projectId: number, payments?: ProjectPayment[]): Promise<{ deducted: number }> {
  const products = await db.select().from(studioProducts).where(eq(studioProducts.projectId, projectId));
  if (!products.length) return { deducted: 0 };
  const pays = payments || await fetchProjectPayments(projectId).catch(() => []);
  if (!pays.length) return { deducted: 0 };
  const purchases = await db.select().from(studioPurchases).where(eq(studioPurchases.projectId, projectId));
  const done = new Set(purchases.filter((p) => p.paymentIntent).map((p) => p.paymentIntent));
  const classes = await db.select().from(studioClasses).where(eq(studioClasses.projectId, projectId));
  let deducted = 0; const suppliersToNotify = new Set<string>();
  for (const p of pays) {
    if (done.has(p.id)) continue;
    const amt = p.amount / 100;
    const pday = ymdUTC(new Date(p.created * 1000));
    // Leave it for manual reconcile if an appointment that day is priced the same (could be a treatment).
    if (classes.some((c) => c.date === pday && Math.abs((c.price || 0) - amt) < 0.01)) continue;
    const prod = products.find((pr) => pr.price > 0 && Math.abs(pr.price - amt) < 0.01);
    if (!prod) continue;
    await db.insert(studioPurchases).values({ projectId, email: "", type: "product", name: prod.name, amount: amt, paymentIntent: p.id, date: pday });
    const newStock = Math.max(0, prod.stock - 1);
    await db.update(studioProducts).set({ stock: newStock }).where(eq(studioProducts.id, prod.id));
    prod.stock = newStock; done.add(p.id); deducted++;
    if (newStock <= prod.lowStock && prod.supplierEmail && prod.lowNotified !== "true") suppliersToNotify.add(prod.supplierEmail);
  }
  for (const sup of suppliersToNotify) { try { await sendLowStockEmail(projectId, sup); } catch (e) { logger.warn({ err: e, projectId }, "[stock] low-stock mail failed"); } }
  return { deducted };
}

/** E-mail a supplier the list of their products at/under the low-stock threshold; mark them notified. */
async function sendLowStockEmail(projectId: number, supplierEmail: string): Promise<void> {
  const all = await db.select().from(studioProducts).where(eq(studioProducts.projectId, projectId));
  const low = all.filter((p) => p.supplierEmail.toLowerCase() === supplierEmail.toLowerCase() && p.stock <= p.lowStock && p.lowNotified !== "true");
  if (!low.length) return;
  const cfg = await resolveSmtpConfig(projectId);
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  const salon = proj?.name || "de salon";
  if (cfg) {
    const rows = low.map((p) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${p.name}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">nog ${p.stock} op voorraad</td></tr>`).join("");
    const html = `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:520px"><h2>Nabestelling — ${salon}</h2><p>De volgende producten zijn (bijna) op. Graag bijbestellen:</p><table style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table><p style="color:#888;font-size:13px">Automatisch verstuurd door ${salon}.</p></div>`;
    const text = `Nabestelling — ${salon}\n\n` + low.map((p) => `- ${p.name}: nog ${p.stock} op voorraad`).join("\n");
    try { await sendMail(cfg, { to: supplierEmail, subject: `Nabestelling voor ${salon}`, html, text, fromName: salon }); } catch (e) { logger.warn({ err: e, projectId }, "[stock] supplier mail send failed"); }
  }
  for (const p of low) await db.update(studioProducts).set({ lowNotified: "true" }).where(eq(studioProducts.id, p.id));
}

router.get("/projects/:id/stripe/payments", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const u = await getStudioUser(projectId, tokenFrom(req as any));
  if (!u || u.role !== "admin") { res.status(401).json({ error: "Niet ingelogd." }); return; }
  try {
    const [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (!row || !row.accountId) { res.json({ connected: false, payments: [] }); return; }
    const payments = await fetchProjectPayments(projectId);
    // Auto-book product sales + deduct stock (leaves appointment-priced payments for manual reconcile).
    const rec = await reconcileProducts(projectId, payments).catch(() => ({ deducted: 0 }));
    res.json({ connected: row.chargesEnabled === "true", payments, reconciled: rec.deducted });
  } catch (err) { logger.error({ err, projectId }, "[stripe] payments failed"); res.status(500).json({ error: "Betalingen ophalen mislukt.", payments: [] }); }
});

// ── Connect the studio's OWN (full/Standard) Stripe account via OAuth ──
// So the salon can use the Stripe app's Tap to Pay AND the dashboard reads those same payments (one
// account for both). One-time platform setup: STRIPE_CONNECT_CLIENT_ID (ca_…) + register the redirect
// URI "<host>/api/stripe/oauth/callback" in the Stripe Connect settings.
router.post("/projects/:id/stripe/oauth-start", json({ limit: "8kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const u = await getStudioUser(projectId, tokenFrom(req as any));
  if (!u || u.role !== "admin") { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID || "";
  if (!clientId) { res.status(503).json({ error: "Stripe-koppeling is nog niet ingesteld door het platform." }); return; }
  const base = (process.env.PUBLIC_API_URL || reqBaseUrl(req as any)).replace(/\/+$/, "");
  const p = new URLSearchParams({
    response_type: "code", client_id: clientId, scope: "read_write",
    redirect_uri: `${base}/api/stripe/oauth/callback`,
    state: `${projectId}.${Math.random().toString(36).slice(2)}`,
    "stripe_user[country]": "NL",
  });
  res.json({ url: "https://connect.stripe.com/oauth/authorize?" + p.toString() });
});

router.get("/stripe/oauth/callback", async (req, res) => {
  const page = (t: string, m: string) => `<!doctype html><meta charset="utf-8"><title>${t}</title><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f4fb"><div style="max-width:420px;text-align:center;padding:30px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.12)"><h2 style="margin:0 0 8px">${t}</h2><p style="color:#6b7280;margin:0 0 16px">${m}</p><a href="/beheer.html" style="display:inline-block;background:#5b4fe9;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600">Terug naar dashboard</a></div>`;
  try {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (String(req.query.error || "") || !code) { res.status(400).send(page("Koppeling geannuleerd", "Sluit dit venster en probeer opnieuw.")); return; }
    const projectId = Number(state.split(".")[0]);
    if (isNaN(projectId)) { res.status(400).send(page("Ongeldig", "Kon de koppeling niet verifiëren.")); return; }
    const tok = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_secret: process.env.STRIPE_SECRET_KEY || "" }).toString(),
    }).then((r) => r.json());
    const acct = tok?.stripe_user_id;
    if (!acct) { res.status(400).send(page("Koppelen mislukt", tok?.error_description || "Kon je Stripe-account niet koppelen.")); return; }
    let enabled = "false";
    try { const a = await stripeReq("GET", `accounts/${acct}`); enabled = a?.charges_enabled ? "true" : "false"; } catch { /* status best-effort */ }
    const [ex] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (ex) await db.update(projectStripe).set({ accountId: acct, chargesEnabled: enabled }).where(eq(projectStripe.projectId, projectId));
    else await db.insert(projectStripe).values({ projectId, accountId: acct, chargesEnabled: enabled });
    res.send(page("Stripe gekoppeld ✓", "Je eigen Stripe-account is gekoppeld. Je pinbetalingen verschijnen nu automatisch in je Kassa."));
  } catch (e) { logger.error({ err: e }, "[stripe] oauth callback failed"); res.status(500).send(page("Er ging iets mis", "Probeer de koppeling opnieuw.")); }
});

// Disconnect the studio's Stripe account (e.g. the wrong account was connected). Best-effort OAuth
// deauthorize, then remove the stored link so they can connect the right account.
router.post("/projects/:id/stripe/disconnect", json({ limit: "8kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const u = await getStudioUser(projectId, tokenFrom(req as any));
  if (!u || u.role !== "admin") { res.status(401).json({ error: "Niet ingelogd." }); return; }
  try {
    const [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (row?.accountId && process.env.STRIPE_CONNECT_CLIENT_ID) {
      try {
        await fetch("https://connect.stripe.com/oauth/deauthorize", {
          method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY || ""}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: process.env.STRIPE_CONNECT_CLIENT_ID, stripe_user_id: row.accountId }).toString(),
        });
      } catch (e) { logger.warn({ err: e, projectId }, "[stripe] deauthorize best-effort failed"); }
    }
    await db.delete(projectStripe).where(eq(projectStripe.projectId, projectId));
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[stripe] disconnect failed"); res.status(500).json({ error: "Ontkoppelen mislukt." }); }
});

router.post("/projects/:id/stripe/checkout", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const b = req.body ?? {};
  const kind = b.kind === "abonnement" ? "abonnement" : b.kind === "strippenkaart" ? "strippenkaart" : "les";
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : "Boeking";
  const amountCents = Math.round(Number(b.amount) * 100);
  if (!amountCents || amountCents < 50) { res.status(400).json({ error: "Ongeldig bedrag (minimaal €0,50)." }); return; }
  try {
    const [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (!row || row.chargesEnabled !== "true") {
      res.status(400).json({ error: "De studio heeft Stripe nog niet (volledig) gekoppeld." });
      return;
    }
    const recurring = kind === "abonnement";
    const priceData: Record<string, unknown> = {
      currency: "eur",
      unit_amount: amountCents,
      product_data: { name },
    };
    if (recurring) priceData.recurring = { interval: "month" };
    const session = await stripeReq("POST", "checkout/sessions", {
      mode: recurring ? "subscription" : "payment",
      payment_method_types: recurring ? SUBSCRIPTION_METHODS : ONE_OFF_METHODS,
      line_items: [{ price_data: priceData, quantity: 1 }],
      success_url: (typeof b.successUrl === "string" && b.successUrl) || `${baseUrl(req)}/projects/${projectId}?betaald=1`,
      cancel_url: (typeof b.cancelUrl === "string" && b.cancelUrl) || `${baseUrl(req)}/projects/${projectId}?geannuleerd=1`,
    }, row.accountId);
    res.json({ url: session.url, id: session.id });
  } catch (err) {
    logger.error({ err, projectId }, "[stripe] checkout failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Afrekenen mislukt" });
  }
});

// ── 3b. Verify: did this Checkout session actually get paid? ──
// Called by the app on return (?betaald=1&session_id=…) BEFORE granting the booking/credits,
// so a customer can't fake a payment by just visiting the success URL.
router.get("/projects/:id/stripe/verify", async (req, res) => {
  const projectId = Number(req.params.id);
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
  if (isNaN(projectId) || !sessionId) { res.status(400).json({ paid: false, error: "missing session_id" }); return; }
  try {
    const [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (!row) { res.json({ paid: false }); return; }
    const session = await stripeReq("GET", `checkout/sessions/${encodeURIComponent(sessionId)}`, undefined, row.accountId);
    const paid = session.payment_status === "paid" || session.status === "complete";
    // Return the payment references so the app can store them for later refunds.
    res.json({
      paid, status: session.status, paymentStatus: session.payment_status,
      paymentIntent: session.payment_intent ?? null,
      subscription: session.subscription ?? null,
      amountTotal: typeof session.amount_total === "number" ? session.amount_total : null,
    });
  } catch (err) {
    logger.error({ err, projectId }, "[stripe] verify failed");
    res.status(500).json({ paid: false, error: "verify failed" });
  }
});

// ── 3c. Refund: pay a customer back to their bank/card on cancellation. ──
// One-off (les/strippenkaart): refund the payment_intent — full, or a partial `amount` (€) the
// studio chooses. Abonnement: cancel the subscription AND refund its latest payment.
router.post("/projects/:id/stripe/refund", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const b = req.body ?? {};
  try {
    const [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (!row) { res.status(400).json({ error: "De studio heeft Stripe niet gekoppeld." }); return; }
    const acct = row.accountId;

    if (typeof b.subscription === "string" && b.subscription) {
      const sub = await stripeReq("GET", `subscriptions/${encodeURIComponent(b.subscription)}`, undefined, acct);
      try { await stripeReq("DELETE", `subscriptions/${encodeURIComponent(b.subscription)}`, undefined, acct); } catch { /* may already be cancelled */ }
      let refunded = false, amount = 0;
      if (sub.latest_invoice) {
        const inv = await stripeReq("GET", `invoices/${encodeURIComponent(sub.latest_invoice)}`, undefined, acct);
        if (inv.payment_intent) {
          const params: Record<string, unknown> = { payment_intent: inv.payment_intent };
          if (b.amount != null && Number(b.amount) > 0) params.amount = Math.round(Number(b.amount) * 100);
          const r = await stripeReq("POST", "refunds", params, acct);
          refunded = true; amount = (r.amount || 0) / 100;
        }
      }
      res.json({ ok: true, cancelled: true, refunded, amount });
      return;
    }

    const pi = typeof b.paymentIntent === "string" ? b.paymentIntent : "";
    if (!pi) { res.status(400).json({ error: "Geen betaling om terug te storten." }); return; }
    const params: Record<string, unknown> = { payment_intent: pi };
    if (b.amount != null && Number(b.amount) > 0) {
      const cents = Math.round(Number(b.amount) * 100);
      if (cents < 1) { res.status(400).json({ error: "Ongeldig bedrag." }); return; }
      params.amount = cents;
    }
    const refund = await stripeReq("POST", "refunds", params, acct);
    res.json({ ok: true, refunded: true, id: refund.id, amount: (refund.amount || 0) / 100 });
  } catch (err) {
    logger.error({ err, projectId }, "[stripe] refund failed");
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : "Terugbetalen mislukt" });
  }
});

// ── 4. Webhook: Stripe confirms payments server-side (source of truth) ──
router.post("/stripe/webhook", raw({ type: "*/*" }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers["stripe-signature"];
  const payload: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));
  if (secret && typeof sig === "string") {
    const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=") as [string, string]));
    const expected = createHmac("sha256", secret).update(`${parts.t}.${payload.toString("utf8")}`).digest("hex");
    const ok = parts.v1 && expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
    if (!ok) { res.status(400).send("invalid signature"); return; }
  }
  try {
    const event = JSON.parse(payload.toString("utf8"));
    // PLATFORM (Nebula) billing events fire on OUR account (no event.account). Connect/studio events
    // carry event.account and fall through to the studio logic below.
    if (!event.account) {
      const obj = event.data?.object || {};
      const findUser = async () => {
        const pid = obj.metadata?.platformUserId || obj.client_reference_id;
        if (pid) { const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, Number(pid))); if (u) return u; }
        const cust = obj.customer; if (cust) { const [u] = await db.select().from(platformUsers).where(eq(platformUsers.stripeCustomerId, String(cust))); if (u) return u; }
        return null;
      };
      const periodEndYmd = (sub: any) => sub?.current_period_end ? ymdUTC(new Date(sub.current_period_end * 1000)) : "";
      if (event.type === "checkout.session.completed") {
        const u = await findUser();
        if (u && obj.mode === "subscription") {
          await db.update(platformUsers).set({ subscriptionId: String(obj.subscription || ""), subscriptionStatus: "active" }).where(eq(platformUsers.id, u.id));
          await addCredit(u.id, 0, "refill"); // grant the included €7,50 right away
          logger.info({ userId: u.id }, "[billing] subscription started");
        } else if (u && obj.mode === "payment" && obj.metadata?.kind === "topup") {
          await addCredit(u.id, Number(obj.metadata?.amountEur) || 0, "add");
          logger.info({ userId: u.id, amount: obj.metadata?.amountEur }, "[billing] AI credit topped up");
        }
      } else if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
        const u = await findUser();
        if (u) {
          const pe = obj.lines?.data?.[0]?.period?.end ? ymdUTC(new Date(obj.lines.data[0].period.end * 1000)) : "";
          await db.update(platformUsers).set({ subscriptionStatus: "active", ...(pe ? { currentPeriodEnd: pe } : {}) }).where(eq(platformUsers.id, u.id));
          await addCredit(u.id, 0, "refill"); // monthly €7,50 top-up to the included amount
          logger.info({ userId: u.id }, "[billing] subscription renewed + credit refilled");
        }
      } else if (event.type === "customer.subscription.updated") {
        const u = await findUser();
        if (u) await db.update(platformUsers).set({ subscriptionStatus: obj.status === "active" || obj.status === "trialing" ? "active" : obj.status === "past_due" ? "past_due" : "canceled", currentPeriodEnd: periodEndYmd(obj) }).where(eq(platformUsers.id, u.id));
      } else if (event.type === "customer.subscription.deleted") {
        const u = await findUser();
        if (u) await db.update(platformUsers).set({ subscriptionStatus: "canceled", subscriptionId: "" }).where(eq(platformUsers.id, u.id));
      } else if (event.type === "invoice.payment_failed") {
        const u = await findUser();
        if (u) await db.update(platformUsers).set({ subscriptionStatus: "past_due" }).where(eq(platformUsers.id, u.id));
      }
      res.json({ received: true }); return;
    }
    // Recurring video subscriptions: each automatic monthly charge extends access; deletion stops it.
    if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
      const sub = event.data?.object?.subscription || event.data?.object?.lines?.data?.[0]?.subscription;
      if (sub) {
        const validUntil = ymdUTC(new Date(Date.now() + 32 * 86400000));
        // Video access: extend each subscribed category.
        await db.update(studioVideoAccess).set({ validUntil, updatedAt: new Date() }).where(eq(studioVideoAccess.subscription, String(sub)));
        // Class (lessen) abonnement: bump the buyer's wallet so the recurring membership stays active.
        const purch = await db.select().from(studioPurchases).where(eq(studioPurchases.subscription, String(sub)));
        for (const p of purch) {
          if (p.type !== "abonnement") continue;
          await db.update(studioWallets).set({ validUntil, updatedAt: new Date() }).where(and(eq(studioWallets.projectId, p.projectId), eq(studioWallets.email, p.email)));
        }
        logger.info({ sub }, "[stripe] subscription renewed (video + class access extended)");
      }
    } else if (event.type === "invoice.payment_failed") {
      // Dunning: a recurring charge failed. E-mail the customer with a link to fix their card,
      // and after 3 failed attempts cancel the subscription + flag the wallet as needing payment.
      const obj = event.data?.object || {};
      const sub = obj.subscription || obj.lines?.data?.[0]?.subscription;
      const attempts = Number(obj.attempt_count || 1);
      const payUrl = obj.hosted_invoice_url || "";
      if (sub) {
        // Resolve project + customer e-mail from our records (class abonnement or video sub).
        let projectId = 0; let email = String(obj.customer_email || "");
        const [pp] = await db.select().from(studioPurchases).where(eq(studioPurchases.subscription, String(sub)));
        if (pp) { projectId = pp.projectId; email = email || pp.email; }
        if (!projectId) { const [va] = await db.select().from(studioVideoAccess).where(eq(studioVideoAccess.subscription, String(sub))); if (va) { projectId = va.projectId; email = email || va.email; } }
        if (projectId && email) {
          try { await sendBookingEmail(projectId, email, "paymentfailed", { url: payUrl, credits: attempts }); } catch { /* best-effort */ }
        }
        if (attempts >= 3) {
          try { await cancelStripeSubscription(projectId, String(sub)); } catch { /* best-effort */ }
          await db.update(studioVideoAccess).set({ subscription: "", updatedAt: new Date() }).where(eq(studioVideoAccess.subscription, String(sub)));
          for (const p of await db.select().from(studioPurchases).where(eq(studioPurchases.subscription, String(sub)))) {
            await db.update(studioWallets).set({ needsPayment: "true", updatedAt: new Date() }).where(and(eq(studioWallets.projectId, p.projectId), eq(studioWallets.email, p.email)));
          }
          await db.update(studioPurchases).set({ subscription: "" }).where(eq(studioPurchases.subscription, String(sub)));
          logger.info({ sub, attempts }, "[stripe] subscription cancelled after repeated payment failure");
        } else {
          logger.info({ sub, attempts }, "[stripe] payment failed — dunning e-mail sent");
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data?.object?.id;
      if (sub) {
        await db.update(studioVideoAccess).set({ subscription: "", updatedAt: new Date() }).where(eq(studioVideoAccess.subscription, String(sub)));
        await db.update(studioPurchases).set({ subscription: "" }).where(eq(studioPurchases.subscription, String(sub)));
        logger.info({ sub }, "[stripe] subscription cancelled");
      }
    } else if (event.type === "checkout.session.completed") {
      logger.info({ session: event.data?.object?.id, account: event.account }, "[stripe] payment completed");
    }
  } catch (err) { logger.warn({ err }, "[stripe] webhook handling error"); }
  res.json({ received: true });
});

// ── Nebula platform billing (subscription + AI-credit top-up) ──────────────────
async function billingUser(req: unknown) {
  return getSessionUser(tokenFrom(req as { headers: Record<string, unknown>; query?: Record<string, unknown> }));
}

// Start the €50/mo platform subscription checkout (PLATFORM account — no Connect header). Uses a
// fixed Stripe price when configured; otherwise builds the €50/mo price inline. Accepts iDEAL and
// card, and collects name + billing address so a proper invoice can be issued.
router.post("/billing/subscribe", async (req, res) => {
  const u = await billingUser(req); if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  try {
    const customer = await ensureCustomer(u);
    const base = baseUrl(req as any);
    // Only use a fixed Stripe price when one is EXPLICITLY configured via env — otherwise build the
    // €50/mo price inline (the old hardcoded fallback was €69,99).
    const envPrice = process.env.STRIPE_NEBULA_PRICE || "";
    const lineItem = /^price_/.test(envPrice)
      ? { price: envPrice, quantity: 1 }
      : { quantity: 1, price_data: { currency: "eur", unit_amount: Math.round(SUBSCRIPTION_PRICE_EUR * 100), recurring: { interval: "month" }, product_data: { name: "Nebula — volledige toegang" } } };
    // Publishable key is NOT secret (it ships to the browser). Fall back to the test key so the custom
    // in-app checkout always works; set STRIPE_PUBLISHABLE_KEY on Render to your pk_live for production.
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || "pk_test_51Sk17JHyqZ2ZUEjYuhLf3UJ1asUQDhj5VhTS8YUVEtllknDO2HkqKRargBFvtSGSIWldq2M4luirH81IRsX0bc8j00dRMdgdth";
    if (pk) {
      // Custom in-app checkout via Stripe Payment Element: create an incomplete subscription and hand
      // its PaymentIntent client_secret to our own payment form (card + iDEAL).
      const priceId = await nebulaPriceId();
      const sub = await stripeReq("POST", "subscriptions", {
        customer,
        items: [{ price: priceId }],
        payment_behavior: "default_incomplete",
        // iDEAL on a recurring subscription must pair with SEPA Direct Debit: iDEAL collects the first
        // payment and sets up a SEPA mandate for renewals. Including sepa_debit makes iDEAL allowed.
        payment_settings: { payment_method_types: ["card", "ideal", "sepa_debit"], save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent"],
        metadata: { platformUserId: String(u.id) },
      });
      const pi = sub?.latest_invoice?.payment_intent;
      if (pi?.client_secret) {
        res.json({ clientSecret: pi.client_secret, publishableKey: pk, subscriptionId: sub.id });
        return;
      }
      // No client secret (shouldn't happen) → clean up and fall back to hosted.
      try { await stripeReq("DELETE", `subscriptions/${sub.id}`); } catch { /* ignore */ }
    }
    // Fallback: hosted Stripe Checkout (redirect) — €50/mo, card + iDEAL, name+address for the invoice.
    const session = await stripeReq("POST", "checkout/sessions", {
      mode: "subscription", customer, client_reference_id: String(u.id),
      payment_method_types: ["card", "ideal"],
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      line_items: [lineItem],
      subscription_data: { metadata: { platformUserId: String(u.id) } },
      success_url: `${base}/ai-editor?sub=ok`, cancel_url: `${base}/ai-editor?sub=cancel`,
    });
    res.json({ url: session.url });
  } catch (err) { logger.error({ err, userId: u.id }, "[billing] subscribe failed"); res.status(500).json({ error: err instanceof Error ? err.message : "Abonneren mislukt." }); }
});

// Top up AI credit with a self-chosen amount (one-time payment, platform account).
router.post("/billing/topup", async (req, res) => {
  const u = await billingUser(req); if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const amount = Math.max(5, Math.min(500, Number(req.body?.amount) || 0)); // €5–€500
  if (!(amount > 0)) { res.status(400).json({ error: "Ongeldig bedrag." }); return; }
  try {
    const customer = await ensureCustomer(u);
    const base = baseUrl(req as any);
    const session = await stripeReq("POST", "checkout/sessions", {
      mode: "payment", customer, client_reference_id: String(u.id),
      line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: Math.round(amount * 100), product_data: { name: "Nebula AI-tegoed" } } }],
      metadata: { kind: "topup", platformUserId: String(u.id), amountEur: String(amount) },
      payment_intent_data: { metadata: { kind: "topup", platformUserId: String(u.id), amountEur: String(amount) } },
      success_url: `${base}/ai-editor?topup=ok`, cancel_url: `${base}/ai-editor?topup=cancel`,
    });
    res.json({ url: session.url });
  } catch (err) { logger.error({ err, userId: u.id }, "[billing] topup failed"); res.status(500).json({ error: err instanceof Error ? err.message : "Bijkopen mislukt." }); }
});

// Status: subscription + AI credit + recent usage.
router.get("/billing", async (req, res) => {
  const u = await billingUser(req); if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  res.json({
    subscribed: isSubscribed(u), status: u.subscriptionStatus, currentPeriodEnd: u.currentPeriodEnd,
    aiCredit: Math.round((u.aiCredit || 0) * 100) / 100, monthlyCredit: MONTHLY_AI_CREDIT_EUR, priceEur: SUBSCRIPTION_PRICE_EUR,
    usage: await recentUsage(u.id),
  });
});

// Cancel the subscription. A real Stripe subscription is cancelled at period end (access stays until
// then). A non-Stripe entry (lifetime/admin-unlock, or none) is just cleared locally so it never
// errors with "Opzeggen mislukt".
router.post("/billing/cancel", async (req, res) => {
  const u = await billingUser(req); if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const sid = u.subscriptionId || "";
  if (/^sub_/.test(sid)) {
    try {
      await stripeReq("POST", `subscriptions/${encodeURIComponent(sid)}`, { cancel_at_period_end: true });
      res.json({ ok: true, message: "Opgezegd — je houdt toegang tot het einde van de periode." });
      return;
    } catch (err) {
      logger.warn({ err, userId: u.id }, "[billing] stripe cancel failed — clearing locally");
    }
  }
  // Lifetime/admin/none, or a Stripe subscription that no longer exists → clear our record.
  await db.update(platformUsers).set({ subscriptionStatus: "canceled", subscriptionId: "" }).where(eq(platformUsers.id, u.id));
  res.json({ ok: true, message: "Abonnement opgezegd." });
});

export default router;
