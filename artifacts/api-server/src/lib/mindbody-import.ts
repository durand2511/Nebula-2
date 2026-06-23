/**
 * Mindbody CSV migration (MVP, server-side). Parses a Mindbody export (clients / class packs /
 * memberships) with tolerant header matching, upserts customers (deduped on e-mail), creates
 * entitlements with computed status, and returns a summary. NO credit-card data is ever read/stored.
 * Pure helpers (parseCsv, pickField, parseDate, pack/membership status) are unit-testable.
 */
import { db, importCustomers, importEntitlements } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

export type ImportType = "clients" | "class_packs" | "memberships" | "combined";

// ── pure helpers ──
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  const s = String(text || "").replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => { const o: Record<string, string> = {}; headers.forEach((h, i) => (o[h] = (r[i] ?? "").trim())); return o; });
}

// Find a field value by trying known header aliases. Matching ignores case/spaces/hyphens, so
// "E-mail Address" matches alias "email". Exact (normalized) match first, then contains-fallback.
export function pickField(rowObj: Record<string, string>, aliases: string[]): string {
  const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const entries = Object.keys(rowObj).map((k) => ({ n: norm(k), v: rowObj[k] }));
  for (const a of aliases) { const an = norm(a); const hit = entries.find((e) => e.n === an && e.v !== ""); if (hit) return hit.v; }
  for (const a of aliases) { const an = norm(a); const hit = entries.find((e) => e.n.includes(an) && e.v !== ""); if (hit) return hit.v; }
  return "";
}

const ALIASES = {
  email: ["email", "e-mail", "email address", "client email", "e-mailadres"],
  firstName: ["first name", "firstname", "first", "voornaam"],
  lastName: ["last name", "lastname", "last", "achternaam", "surname"],
  phone: ["phone", "mobile phone", "cell phone", "telephone", "phone number", "telefoon", "mobile"],
  notes: ["notes", "note", "memo", "comments"],
  name: ["pricing option", "name", "class pack", "package", "product", "membership", "contract", "description"],
  total: ["count", "total", "quantity", "sessions", "classes", "number of sessions"],
  remaining: ["remaining", "visits remaining", "sessions remaining", "count remaining", "remaining sessions"],
  used: ["used", "visits used", "sessions used"],
  expires: ["expiration date", "expires", "expiration", "end date", "expiry date", "valid until"],
  price: ["price", "amount", "rate", "monthly price"],
  start: ["start date", "begin date", "activation date", "purchase date"],
  end: ["end date", "contract end", "termination date"],
  nextPayment: ["next payment", "next billing date", "next autopay", "next payment date", "next bill date"],
  perMonth: ["classes per month", "monthly limit", "sessions per month", "included sessions", "monthly sessions"],
  usedThisMonth: ["used this month", "sessions used this month"],
  remainingThisMonth: ["remaining this month", "sessions remaining this month"],
};

export function parseDate(v: string): Date | null {
  const t = String(v || "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);            // yyyy-mm-dd
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);      // m/d/yyyy or d-m-yyyy (assume m/d/y, Mindbody is US)
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[1] - 1, +m[2]); }
  const d = new Date(t); return isNaN(d.getTime()) ? null : d;
}
const num = (v: string): number | null => { const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10); return isNaN(n) ? null : n; };
const money = (v: string): number | null => { const n = parseFloat(String(v).replace(/[^0-9.,]/g, "").replace(",", ".")); return isNaN(n) ? null : n; };
const past = (d: Date | null) => !!d && d.getTime() < Date.now();

export function computePackStatus(remaining: number | null, expires: Date | null): "active" | "expired" | "depleted" {
  if (remaining != null && remaining <= 0) return "depleted";
  if (past(expires)) return "expired";
  return "active";
}
// No card is imported → a membership needs a payment method before renewal (payment_required handled
// at renewal time — see Stripe TODO). During its current valid period we honor it as active.
export function computeMembershipStatus(end: Date | null): "active" | "expired" {
  return past(end) ? "expired" : "active";
}

export type ImportSummary = {
  type: ImportType; rows: number; created: number; updated: number;
  packsActive: number; membershipsFound: number; expiredOrDepleted: number;
  errors: { row: number; message: string }[];
};

async function upsertCustomer(projectId: number, email: string, fields: Partial<{ firstName: string; lastName: string; phone: string; notes: string }>): Promise<"created" | "updated"> {
  const [existing] = await db.select().from(importCustomers).where(and(eq(importCustomers.projectId, projectId), eq(importCustomers.email, email)));
  if (existing) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["firstName", "lastName", "phone", "notes"] as const) if (fields[k]) set[k] = fields[k];
    await db.update(importCustomers).set(set).where(eq(importCustomers.id, existing.id));
    return "updated";
  }
  await db.insert(importCustomers).values({ projectId, email, firstName: fields.firstName || "", lastName: fields.lastName || "", phone: fields.phone || "", notes: fields.notes || "" });
  return "created";
}

// Decide what an "everything-in-one-file" row represents: a class pack, a membership, or just a
// customer. First an explicit type/category column, then the product name, then which columns exist.
export function classifyRow(r: Record<string, string>): "class_pack" | "membership" | null {
  const typeVal = pickField(r, ["type", "category", "kind", "item type", "product type", "soort", "membership type"]).toLowerCase();
  if (/member|abonnement|subscription|contract|lidmaat/.test(typeVal)) return "membership";
  if (/pack|strippen|credit|bundle|pass|punch|rit/.test(typeVal)) return "class_pack";
  const name = pickField(r, ALIASES.name).toLowerCase();
  if (/unlimited|onbeperkt|member|abonnement|subscription|monthly|per month|per maand/.test(name)) return "membership";
  if (/pack|strippen|credit|bundle|pass|punch|rit|\bclasses?\b|\blessen?\b/.test(name)) return "class_pack";
  if (pickField(r, ALIASES.perMonth) || pickField(r, ALIASES.nextPayment)) return "membership";
  if (pickField(r, ALIASES.total) || pickField(r, ALIASES.remaining) || pickField(r, ALIASES.used)) return "class_pack";
  return null; // only a customer, no entitlement on this row
}

async function insertPack(projectId: number, email: string, r: Record<string, string>, sum: ImportSummary): Promise<void> {
  const name = pickField(r, ALIASES.name) || "Class Pack";
  const total = num(pickField(r, ALIASES.total));
  let remaining = num(pickField(r, ALIASES.remaining));
  const used = num(pickField(r, ALIASES.used));
  if (remaining == null && total != null && used != null) remaining = total - used;
  const expires = parseDate(pickField(r, ALIASES.expires));
  const status = computePackStatus(remaining, expires);
  await db.insert(importEntitlements).values({ projectId, email, kind: "class_pack", name, status, total, remaining, expiresAt: expires, raw: safeRaw(r) });
  if (status === "active") sum.packsActive++; else sum.expiredOrDepleted++;
}

async function insertMembership(projectId: number, email: string, r: Record<string, string>, sum: ImportSummary): Promise<void> {
  const name = pickField(r, ALIASES.name) || "Membership";
  const unlimited = /unlimited|onbeperkt/i.test(name);
  const perMonth = unlimited ? null : num(pickField(r, ALIASES.perMonth));
  let remainingThisMonth = num(pickField(r, ALIASES.remainingThisMonth));
  const usedThisMonth = num(pickField(r, ALIASES.usedThisMonth));
  if (remainingThisMonth == null && perMonth != null && usedThisMonth != null) remainingThisMonth = perMonth - usedThisMonth;
  if (remainingThisMonth == null && perMonth != null) remainingThisMonth = perMonth;
  const start = parseDate(pickField(r, ALIASES.start));
  const end = parseDate(pickField(r, ALIASES.end));
  const status = computeMembershipStatus(end);
  await db.insert(importEntitlements).values({
    projectId, email, kind: "membership", name, status,
    unlimited: unlimited ? "true" : "false", perMonth, remaining: remainingThisMonth,
    price: money(pickField(r, ALIASES.price)), startsAt: start, expiresAt: end,
    nextPaymentAt: parseDate(pickField(r, ALIASES.nextPayment)),
    needsPayment: "true", // no card imported (Stripe payment-method linking comes later)
    raw: safeRaw(r),
  });
  if (status === "active") sum.membershipsFound++; else sum.expiredOrDepleted++;
}

/** Parse + import one CSV of a given type. "combined" = one file with everything (auto-classified). */
export async function importCsv(projectId: number, type: ImportType, csvText: string): Promise<ImportSummary> {
  const rows = parseCsv(csvText);
  const sum: ImportSummary = { type, rows: rows.length, created: 0, updated: 0, packsActive: 0, membershipsFound: 0, expiredOrDepleted: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const email = pickField(r, ALIASES.email).toLowerCase();
    try {
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("ontbrekend/ongeldig e-mailadres");
      // Always ensure a customer exists (so packs/memberships attach to someone).
      const res = await upsertCustomer(projectId, email, {
        firstName: pickField(r, ALIASES.firstName), lastName: pickField(r, ALIASES.lastName),
        phone: pickField(r, ALIASES.phone), notes: pickField(r, ALIASES.notes),
      });
      if (res === "created") sum.created++; else sum.updated++;

      if (type === "class_packs") await insertPack(projectId, email, r, sum);
      else if (type === "memberships") await insertMembership(projectId, email, r, sum);
      else if (type === "combined") {
        const kind = classifyRow(r);
        if (kind === "class_pack") await insertPack(projectId, email, r, sum);
        else if (kind === "membership") await insertMembership(projectId, email, r, sum);
        // kind === null → only a customer row, nothing else to add
      }
    } catch (err) {
      sum.errors.push({ row: i + 2, message: (err as Error)?.message || "fout" }); // +2: header + 1-based
    }
  }
  logger.info({ projectId, type, rows: sum.rows, created: sum.created, updated: sum.updated, errors: sum.errors.length }, "[import] done");
  return sum;
}

// Strip anything that looks like card data before storing the raw row (defense in depth).
function safeRaw(r: Record<string, string>): string {
  const clean: Record<string, string> = {};
  for (const k of Object.keys(r)) { if (/card|cvv|cvc|ccnum|credit|iban|account number|routing/i.test(k)) continue; clean[k] = r[k]; }
  try { return JSON.stringify(clean).slice(0, 4000); } catch { return ""; }
}
