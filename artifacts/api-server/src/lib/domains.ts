/**
 * Custom-domain backend basis. Customers connect their own domain (CNAME → customers.nebulabookings.com);
 * the app recognises the incoming Host header and serves the matching project's site.
 * No Cloudflare / SSL automation here — just the data model, a real DNS check, and Host lookup.
 */
import { db, domains, projects } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveCname } from "node:dns/promises";
import { logger } from "./logger";

// Where customers point their domain (CNAME target). Override via env when deployed.
export const CUSTOMERS_TARGET = (process.env.CUSTOMERS_TARGET || "customers.nebulabookings.com").toLowerCase();
export const PLATFORM_HOST = (process.env.PLATFORM_HOST || "nebulabookings.com").toLowerCase();
// Hosts that are the platform itself — never treated as a customer site.
const RESERVED = new Set([PLATFORM_HOST, "www." + PLATFORM_HOST, CUSTOMERS_TARGET, "localhost", "127.0.0.1", "0.0.0.0"]);

/** Lowercase, strip port + trailing dot. */
export function normalizeHost(host: string): string {
  return String(host || "").trim().toLowerCase().split(":")[0].replace(/\.$/, "");
}
export function isReserved(host: string): boolean {
  const h = normalizeHost(host);
  return !h || RESERVED.has(h);
}
function validDomain(d: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(d) && !d.endsWith("-");
}

export type DomainRow = typeof domains.$inferSelect;

/** Add a domain to a project (status pending). Throws on bad format / duplicate / unknown project. */
export async function addDomain(projectId: number, raw: string): Promise<DomainRow> {
  const domain = normalizeHost(raw);
  if (!validDomain(domain)) throw new Error("Ongeldige domeinnaam.");
  if (isReserved(domain)) throw new Error("Dit is een platform-domein en kan niet gekoppeld worden.");
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!proj) throw new Error("Project niet gevonden.");
  const [existing] = await db.select().from(domains).where(eq(domains.domain, domain));
  if (existing) throw new Error(existing.projectId === projectId ? "Dit domein is al toegevoegd." : "Dit domein is al aan een ander project gekoppeld.");
  const [row] = await db.insert(domains).values({ projectId, domain, status: "pending" }).returning();
  return row;
}

export async function listDomains(projectId: number): Promise<DomainRow[]> {
  return (await db.select().from(domains).where(eq(domains.projectId, projectId))).reverse();
}

export async function deleteDomain(projectId: number, id: number): Promise<boolean> {
  const [row] = await db.select().from(domains).where(eq(domains.id, id));
  if (!row || row.projectId !== projectId) return false;
  await db.delete(domains).where(eq(domains.id, id));
  return true;
}

/** The project to serve for an incoming Host (only ACTIVE domains are served). */
export async function findActiveByHost(host: string): Promise<{ projectId: number } | null> {
  const h = normalizeHost(host);
  if (!h || isReserved(h)) return null;
  const [row] = await db.select().from(domains).where(eq(domains.domain, h));
  return row && row.status === "active" ? { projectId: row.projectId } : null;
}

/**
 * Real DNS check: does the domain CNAME to customers.nebulabookings.com? If so → verified + active.
 * (Apex domains can't use a CNAME; those need an A-record flow we'll add later.)
 */
export async function verifyDomain(projectId: number, id: number): Promise<{ ok: boolean; status: string; detail: string }> {
  const [row] = await db.select().from(domains).where(eq(domains.id, id));
  if (!row || row.projectId !== projectId) return { ok: false, status: "pending", detail: "Domein niet gevonden." };
  let targets: string[] = [];
  try { targets = (await resolveCname(row.domain)).map((t) => t.toLowerCase().replace(/\.$/, "")); }
  catch (err) { logger.warn({ err: (err as Error)?.message, domain: row.domain }, "[domains] cname lookup failed"); }
  const ok = targets.some((t) => t === CUSTOMERS_TARGET || t.endsWith("." + CUSTOMERS_TARGET));
  if (ok) {
    await db.update(domains).set({ status: "active", verifiedAt: new Date(), updatedAt: new Date() }).where(eq(domains.id, id));
    return { ok: true, status: "active", detail: "Domein geverifieerd en live." };
  }
  return { ok: false, status: row.status, detail: `Geen CNAME naar ${CUSTOMERS_TARGET} gevonden. Voeg een CNAME toe en probeer opnieuw (DNS kan even duren).` };
}
