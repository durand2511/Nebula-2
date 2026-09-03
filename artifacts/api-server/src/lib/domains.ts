/**
 * Custom-domain backend basis. Customers connect their own domain (CNAME → customers.nebulabookings.com);
 * the app recognises the incoming Host header and serves the matching project's site.
 * No Cloudflare / SSL automation here — just the data model, a real DNS check, and Host lookup.
 */
import { db, domains, projects } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveCname, resolve4 } from "node:dns/promises";
import { logger } from "./logger";
import { addRenderDomain, renderConfigured } from "./render.js";

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
export async function addDomain(projectId: number, raw: string, redirectTo?: string): Promise<DomainRow> {
  const domain = normalizeHost(raw);
  if (!validDomain(domain)) throw new Error("Ongeldige domeinnaam.");
  if (isReserved(domain)) throw new Error("Dit is een platform-domein en kan niet gekoppeld worden.");
  // Optional SEO-redirect target ("host" of "host/pad"): the host router 301's this domain there
  // once it verifies — used for expired domains with backlinks (e.g. webdesigncolor.com → platform).
  const rt = String(redirectTo || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (rt && !/^[a-z0-9][a-z0-9.-]+[a-z0-9](\/[a-z0-9._~\/-]*)?$/.test(rt)) throw new Error("Ongeldig redirect-doel.");
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!proj) throw new Error("Project niet gevonden.");
  const [existing] = await db.select().from(domains).where(eq(domains.domain, domain));
  if (existing) throw new Error(existing.projectId === projectId ? "Dit domein is al toegevoegd." : "Dit domein is al aan een ander project gekoppeld.");
  const [row] = await db.insert(domains).values({ projectId, domain, status: "pending", ...(rt ? { redirectTo: rt } : {}) }).returning();
  // Pre-register with Render so the TLS cert starts provisioning while the customer sets up DNS.
  if (renderConfigured()) { try { await addRenderDomain(domain); } catch { /* best-effort */ } }
  return row;
}

export async function listDomains(projectId: number): Promise<DomainRow[]> {
  return (await db.select().from(domains).where(eq(domains.projectId, projectId))).reverse();
}

const slugify = (s: string) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** The project's free Nebula subdomain (a domains row ending in .PLATFORM_HOST), or null. */
export async function getSubdomain(projectId: number): Promise<DomainRow | null> {
  const rows = await db.select().from(domains).where(eq(domains.projectId, projectId));
  return rows.find((r) => r.domain.endsWith("." + PLATFORM_HOST)) || null;
}

/**
 * Publish the project on a free Nebula subdomain (<slug>.PLATFORM_HOST). Our own wildcard, so it's
 * live immediately (status active) — no DNS check. Re-publishing replaces the previous subdomain.
 */
export async function publishSubdomain(projectId: number, rawSlug?: string): Promise<DomainRow> {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!proj) throw new Error("Project niet gevonden.");
  let base = slugify(rawSlug || proj.name || "") || "studio-" + projectId;
  let slug = base, n = 1;
  // ensure uniqueness across all projects' subdomains
  while (true) {
    const host = slug + "." + PLATFORM_HOST;
    const [clash] = await db.select().from(domains).where(eq(domains.domain, host));
    if (!clash || clash.projectId === projectId) break;
    n++; slug = base + "-" + n;
  }
  const host = slug + "." + PLATFORM_HOST;
  // remove any previous subdomain row for this project, then add the new one (active immediately)
  const existing = await db.select().from(domains).where(eq(domains.projectId, projectId));
  for (const r of existing) if (r.domain.endsWith("." + PLATFORM_HOST) && r.domain !== host) await db.delete(domains).where(eq(domains.id, r.id));
  const [already] = await db.select().from(domains).where(eq(domains.domain, host));
  if (already) {
    const [row] = await db.update(domains).set({ status: "active", verifiedAt: new Date(), updatedAt: new Date() }).where(eq(domains.id, already.id)).returning();
    return row;
  }
  const [row] = await db.insert(domains).values({ projectId, domain: host, status: "active", verifiedAt: new Date() }).returning();
  return row;
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

/** Any domain row for a Host (any status) — lets the host router tell a PENDING (still-connecting)
 *  domain apart from a truly unknown one, so it can show a "connecting" page instead of a redirect. */
export async function findByHost(host: string): Promise<{ projectId: number; status: string; redirectTo: string } | null> {
  const h = normalizeHost(host);
  if (!h || isReserved(h)) return null;
  const [row] = await db.select().from(domains).where(eq(domains.domain, h));
  return row ? { projectId: row.projectId, status: row.status, redirectTo: row.redirectTo || "" } : null;
}

/**
 * Real DNS check. A subdomain (www./book.) verifies via CNAME → customers.nebulabookings.com.
 * A bare apex domain can't CNAME, so it verifies via A-record: its IPs must match the platform's
 * (we resolve CUSTOMERS_TARGET's A-records and compare) — works with an A-record or ALIAS/flattening.
 */
export async function verifyDomain(projectId: number, id: number): Promise<{ ok: boolean; status: string; detail: string }> {
  const [row] = await db.select().from(domains).where(eq(domains.id, id));
  if (!row || row.projectId !== projectId) return { ok: false, status: "pending", detail: "Domein niet gevonden." };
  let targets: string[] = [];
  try { targets = (await resolveCname(row.domain)).map((t) => t.toLowerCase().replace(/\.$/, "")); }
  catch (err) { logger.warn({ err: (err as Error)?.message, domain: row.domain }, "[domains] cname lookup failed"); }
  let ok = targets.some((t) => t === CUSTOMERS_TARGET || t.endsWith("." + CUSTOMERS_TARGET) || t.endsWith(".onrender.com"));
  // Apex / A-record path. Render serves every custom domain from its dedicated 216.24.57.x anycast block —
  // that's exactly what the DNS instructions tell customers to set (A → 216.24.57.1 / 216.24.57.9). We
  // accept ANY IP in that block, because the live IPs of CUSTOMERS_TARGET rotate through the block (behind
  // Cloudflare's CDN) and a strict "must equal today's IP" check wrongly rejects a correctly-set apex.
  if (!ok) {
    try {
      const [domainIps, platformIps] = await Promise.all([
        resolve4(row.domain).catch(() => [] as string[]),
        resolve4(CUSTOMERS_TARGET).catch(() => [] as string[]),
      ]);
      const isRenderIp = (ip: string) => ip.startsWith("216.24.57.");
      if (domainIps.some((ip) => isRenderIp(ip) || platformIps.includes(ip))) ok = true;
    } catch (err) { logger.warn({ err: (err as Error)?.message, domain: row.domain }, "[domains] a lookup failed"); }
  }
  if (ok) {
    await db.update(domains).set({ status: "active", verifiedAt: new Date(), updatedAt: new Date() }).where(eq(domains.id, id));
    if (renderConfigured()) { try { await addRenderDomain(row.domain); } catch { /* best-effort */ } }
    const ssl = renderConfigured() ? " SSL wordt automatisch geregeld (kan enkele minuten duren)." : "";
    return { ok: true, status: "active", detail: "Domein geverifieerd en live." + ssl };
  }
  return { ok: false, status: row.status, detail: `DNS wijst nog niet naar ${CUSTOMERS_TARGET}. Subdomein: CNAME → ${CUSTOMERS_TARGET}. Hoofddomein: A-record (of ALIAS) naar hetzelfde adres als ${CUSTOMERS_TARGET}. Probeer over een paar minuten opnieuw.` };
}
