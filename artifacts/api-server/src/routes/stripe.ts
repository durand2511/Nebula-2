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
import { Router, type IRouter, raw } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, projectStripe } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

const baseUrl = (req: { headers: Record<string, unknown> }) =>
  (typeof req.headers["origin"] === "string" && req.headers["origin"]) || "http://localhost:5173";

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

// ── 1. Onboarding: get-or-create the studio's Express account + an onboarding link ──
router.post("/projects/:id/stripe/onboard", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    let [row] = await db.select().from(projectStripe).where(eq(projectStripe.projectId, projectId));
    if (!row) {
      const acct = await stripeReq("POST", "accounts", {
        type: "express", country: "NL",
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      });
      [row] = await db.insert(projectStripe).values({ projectId, accountId: acct.id, chargesEnabled: "false" }).returning();
    }
    const link = await stripeReq("POST", "account_links", {
      account: row.accountId,
      refresh_url: `${baseUrl(req)}/projects/${projectId}`,
      return_url: `${baseUrl(req)}/projects/${projectId}`,
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
    res.json({ connected: true, chargesEnabled: enabled, accountId: row.accountId, detailsSubmitted: !!acct.details_submitted });
  } catch (err) {
    logger.error({ err, projectId }, "[stripe] status failed");
    res.status(500).json({ error: "Status ophalen mislukt" });
  }
});

// ── 3. Checkout: pay for a class / strippenkaart (one-off) or abonnement (subscription) ──
// Direct charge on the studio's connected account → money goes to the studio, no platform fee.
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
router.post("/stripe/webhook", raw({ type: "*/*" }), (req, res) => {
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
    if (event.type === "checkout.session.completed") {
      logger.info({ session: event.data?.object?.id, account: event.account }, "[stripe] payment completed");
    }
  } catch { /* ignore parse errors */ }
  res.json({ received: true });
});

export default router;
