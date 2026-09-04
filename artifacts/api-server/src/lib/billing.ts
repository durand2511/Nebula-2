/**
 * Nebula platform billing: a €69,99/mo subscription + an AI-credit wallet (in EUR). Each AI chat
 * change is charged at its real token cost × 2 (a 100% markup) and deducted from the wallet. Paid
 * subscribers get €7,50 of AI credit refilled every billing month; extra can be topped up.
 */
import { db, platformUsers, platformAiUsage, projects, type PlatformUser } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { logger } from "./logger";

export const SUBSCRIPTION_PRICE_EUR = 50; // default / legacy (= the Instap plan)

// Three subscription tiers. Cheapest → most expensive. `features` are the short bullet points shown
// on the pricing cards; access itself stays "active subscription = full access" for now (the tier
// mainly sets the price + what we promise), so upgrading is friction-free.
export type PlanId = "instap" | "pro" | "premium";
export const PLANS: { id: PlanId; name: string; price: number; tagline: string; highlight?: boolean; features: string[] }[] = [
  { id: "instap", name: "Instap", price: 50, tagline: "Alles om online te gaan",
    features: ["Website bewerken met Claude Code", "Online boekingssysteem", "Basis-SEO & eigen domein", "Publiceren zonder watermerk"] },
  { id: "pro", name: "Pro", price: 80, tagline: "Groeien met inzicht", highlight: true,
    features: ["Alles van Instap", "Bezoekers-statistieken & live online", "Klik-heatmap & conversie-tools", "Google-posities (Search Console)"] },
  { id: "premium", name: "Premium", price: 140, tagline: "Alles eruit halen",
    features: ["Alles van Pro", "A/B-testen", "Automatisering & meertalige site", "Voorrang bij support"] },
];
export function planById(id: string | null | undefined): { id: PlanId; name: string; price: number } {
  return PLANS.find((p) => p.id === id) || PLANS[0];
}
export const MONTHLY_AI_CREDIT_EUR = 7.5;     // included each billing month
export const AI_MARKUP = 2;                   // charge 100% on top of cost (×2)
const EUR_PER_USD = 0.92;

// Anthropic list prices (USD per 1M tokens). Keep in sync with the models the chat/build actually use.
const PRICES_USD: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "claude-opus-4-8": { in: 5, out: 25 },
};
const DEFAULT_PRICE = { in: 3, out: 15 };

/** Cost in EUR of one AI call, INCLUDING the ×2 markup. */
export function aiCostEur(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES_USD[model] || DEFAULT_PRICE;
  const usd = ((inputTokens || 0) * p.in + (outputTokens || 0) * p.out) / 1_000_000;
  return Math.round(usd * EUR_PER_USD * AI_MARKUP * 10000) / 10000; // 4 decimals
}

export function isSubscribed(u: Pick<PlatformUser, "subscriptionStatus"> | null | undefined): boolean {
  return !!u && u.subscriptionStatus === "active";
}

// Platform owner(s): their OWN projects get full access to paid features (SEO engine, etc.) without a
// subscription — they run the platform, they don't pay themselves. Comma/space-separated env override.
const PLATFORM_OWNER_EMAILS = new Set(
  (process.env.PLATFORM_OWNER_EMAILS || "durand2511@gmail.com").toLowerCase().split(/[,\s]+/).filter(Boolean),
);

/** Full platform access for a user: the €50/mo subscription is active, or they are the platform owner. */
export function hasPlatformAccess(u: Pick<PlatformUser, "email" | "subscriptionStatus"> | null | undefined): boolean {
  if (!u) return false;
  if (u.email && PLATFORM_OWNER_EMAILS.has(u.email.toLowerCase())) return true;
  return u.subscriptionStatus === "active";
}

/** Is the project's owner a paying subscriber (or the platform owner)? Ownerless projects = NOT subscribed. */
export async function projectOwnerSubscribed(projectId: number): Promise<boolean> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p?.ownerId) return false;
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, p.ownerId));
  if (!u) return false;
  if (u.email && PLATFORM_OWNER_EMAILS.has(u.email.toLowerCase())) return true; // platform owner → full access
  return u.subscriptionStatus === "active";
}

// Feature-access levels per subscription tier: 0 = geen abonnement (alles op slot), 1 = Instap,
// 2 = Pro, 3 = Premium. The platform owner is always level 3.
export type FeatureLevel = 0 | 1 | 2 | 3;
export function planToLevel(planId?: string | null): FeatureLevel {
  const p = String(planId || "");
  return p === "premium" ? 3 : p === "pro" ? 2 : p === "instap" ? 1 : 1; // any known/unknown active plan ≥ Instap
}
export function userFeatureLevel(u: Pick<PlatformUser, "email" | "subscriptionStatus" | "plan"> | null | undefined): FeatureLevel {
  if (!u) return 0;
  if (u.email && PLATFORM_OWNER_EMAILS.has(u.email.toLowerCase())) return 3; // platform owner → everything
  if (u.subscriptionStatus !== "active") return 0;                          // no active subscription → locked
  return planToLevel(u.plan);
}
/** The feature level of a project's OWNER (used to gate per-tier features on that project). */
export async function projectOwnerLevel(projectId: number): Promise<FeatureLevel> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p?.ownerId) return 0;
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, p.ownerId));
  return userFeatureLevel(u);
}

/** Deduct an AI change's cost from the wallet (floored at 0) + log it. Returns {cost, remaining}. */
export async function chargeAiUsage(userId: number, projectId: number | null, summary: string, model: string, usage: { input_tokens?: number; output_tokens?: number } | null | undefined): Promise<{ cost: number; remaining: number }> {
  const cost = aiCostEur(model, usage?.input_tokens || 0, usage?.output_tokens || 0);
  try {
    const [row] = await db.update(platformUsers)
      .set({ aiCredit: sql`GREATEST(0, ${platformUsers.aiCredit} - ${cost})` })
      .where(eq(platformUsers.id, userId)).returning();
    await db.insert(platformAiUsage).values({ userId, projectId: projectId ?? null, summary: summary.slice(0, 200), costEur: cost });
    return { cost, remaining: row?.aiCredit ?? 0 };
  } catch (err) { logger.warn({ err, userId }, "[billing] chargeAiUsage failed"); return { cost, remaining: 0 }; }
}

/** Add EUR to the wallet (top-up or monthly refill). For the monthly refill use mode "refill" so the
 *  balance is brought UP to at least MONTHLY_AI_CREDIT (kept if already higher); "add" stacks. */
export async function addCredit(userId: number, amount: number, mode: "add" | "refill"): Promise<void> {
  if (mode === "refill") {
    await db.update(platformUsers)
      .set({ aiCredit: sql`GREATEST(${platformUsers.aiCredit}, ${MONTHLY_AI_CREDIT_EUR})` })
      .where(eq(platformUsers.id, userId));
  } else {
    await db.update(platformUsers)
      .set({ aiCredit: sql`${platformUsers.aiCredit} + ${amount}` })
      .where(eq(platformUsers.id, userId));
  }
}

/** Charge the accumulated per-model usage of one chat edit (×2) to the wallet + log it once. */
export async function chargeTrackedUsage(userId: number, projectId: number | null, summary: string, totals: Record<string, { input: number; output: number }>): Promise<{ cost: number; remaining: number }> {
  let cost = 0;
  for (const model of Object.keys(totals)) cost += aiCostEur(model, totals[model].input, totals[model].output);
  cost = Math.round(cost * 10000) / 10000;
  if (cost <= 0) { const u = await db.select().from(platformUsers).where(eq(platformUsers.id, userId)); return { cost: 0, remaining: u[0]?.aiCredit ?? 0 }; }
  try {
    const [row] = await db.update(platformUsers).set({ aiCredit: sql`GREATEST(0, ${platformUsers.aiCredit} - ${cost})` }).where(eq(platformUsers.id, userId)).returning();
    await db.insert(platformAiUsage).values({ userId, projectId: projectId ?? null, summary: summary.slice(0, 200), costEur: cost });
    return { cost, remaining: row?.aiCredit ?? 0 };
  } catch (err) { logger.warn({ err, userId }, "[billing] chargeTrackedUsage failed"); return { cost, remaining: 0 }; }
}

// Free tier may only use the AI for booking-app / admin-login requests. Keyword gate (no extra AI cost).
export function isBookingRequest(text: string): boolean {
  return /\b(booking|boeking|boekings|reserv|afspra|agenda|les(sen)?|rooster|abonnement|strippenkaart|inschrijv|admin|inlog|login|wachtwoord|gebruikersnaam)\b/i.test(text || "");
}

export async function recentUsage(userId: number, limit = 30): Promise<{ summary: string; costEur: number; createdAt: Date }[]> {
  const rows = await db.select().from(platformAiUsage).where(eq(platformAiUsage.userId, userId)).orderBy(desc(platformAiUsage.createdAt)).limit(limit);
  return rows.map((r) => ({ summary: r.summary, costEur: r.costEur, createdAt: r.createdAt }));
}
