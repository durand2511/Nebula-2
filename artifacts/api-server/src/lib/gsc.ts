/**
 * Google Search Console coupling (OAuth). The studio connects their Google account once; the server
 * then AUTO-verifies the site (Google returns a <meta google-site-verification> tag which we inject on
 * the live site via host-site.ts) and submits the sitemap — so the owner never touches DNS or GSC by
 * hand. Separate from the Calendar coupling (project_gcal) so that keeps working untouched.
 *
 * One-time platform setup: add these scopes to the OAuth consent screen and register the redirect URI
 * <PUBLIC_API_URL>/api/gsc/callback in Google Cloud (same OAuth client as the calendar).
 */
import { db, projectGsc } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { logger } from "./logger";
import { resolvePublishedDomain } from "./seo.js";

const SCOPE = "openid email https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/siteverification";

export function gscConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/gsc/callback`;
}

function authUrl(projectId: number, nonce: string, baseUrl: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(baseUrl),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: `${projectId}.${nonce}`,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

/** Start the flow: store a fresh CSRF nonce and return the Google consent URL. */
export async function startConnect(projectId: number, baseUrl: string): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const [ex] = await db.select().from(projectGsc).where(eq(projectGsc.projectId, projectId));
  if (ex) await db.update(projectGsc).set({ nonce }).where(eq(projectGsc.projectId, projectId));
  else await db.insert(projectGsc).values({ projectId, nonce });
  return authUrl(projectId, nonce, baseUrl);
}

export async function verifyNonce(projectId: number, nonce: string): Promise<boolean> {
  const [row] = await db.select().from(projectGsc).where(eq(projectGsc.projectId, projectId));
  return !!row && !!nonce && row.nonce === nonce;
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error_description || json?.error || `Google token ${res.status}`);
  return json;
}

/** Exchange the OAuth code for tokens + persist them (keep an existing refresh_token if Google omits one). */
export async function exchangeCode(projectId: number, code: string, baseUrl: string): Promise<void> {
  const tok = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: redirectUri(baseUrl),
    grant_type: "authorization_code",
  });
  const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000);
  let email = "";
  try { if (tok.id_token) email = JSON.parse(Buffer.from(String(tok.id_token).split(".")[1], "base64").toString()).email || ""; }
  catch { /* ignore */ }
  const [existing] = await db.select().from(projectGsc).where(eq(projectGsc.projectId, projectId));
  const refreshToken = tok.refresh_token || existing?.refreshToken || "";
  if (existing) await db.update(projectGsc).set({ refreshToken, accessToken: tok.access_token || "", tokenExpiry: expiry, email: email || existing.email }).where(eq(projectGsc.projectId, projectId));
  else await db.insert(projectGsc).values({ projectId, refreshToken, accessToken: tok.access_token || "", tokenExpiry: expiry, email });
}

async function getAccessToken(projectId: number): Promise<string | null> {
  const [row] = await db.select().from(projectGsc).where(eq(projectGsc.projectId, projectId));
  if (!row || !row.refreshToken) return null;
  if (row.accessToken && row.tokenExpiry && row.tokenExpiry.getTime() > Date.now() + 60_000) return row.accessToken;
  try {
    const tok = await tokenRequest({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: row.refreshToken,
      grant_type: "refresh_token",
    });
    const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000);
    await db.update(projectGsc).set({ accessToken: tok.access_token || "", tokenExpiry: expiry }).where(eq(projectGsc.projectId, projectId));
    return tok.access_token || null;
  } catch (err) { logger.warn({ err, projectId }, "[gsc] token refresh failed"); return null; }
}

/** The injected verification tag for a project (host-site.ts puts it in the live site's <head>). */
export async function verifyTagFor(projectId: number): Promise<string> {
  const [row] = await db.select().from(projectGsc).where(eq(projectGsc.projectId, projectId));
  return row?.verifyTag || "";
}

/**
 * Auto-verify the site in Search Console (META method) and submit the sitemap. Google returns a meta
 * tag from getToken; we store it (→ injected on the live site), then ask Google to verify (it fetches
 * the homepage and finds the tag), then add the site + submit the sitemap. Best-effort, returns detail.
 */
export async function setupSearchConsole(projectId: number): Promise<{ ok: boolean; detail: string }> {
  const at = await getAccessToken(projectId);
  if (!at) return { ok: false, detail: "Niet gekoppeld." };
  const domain = await resolvePublishedDomain(projectId);
  if (!domain || /localhost|127\.0\.0\.1/.test(domain)) return { ok: false, detail: "Publiceer eerst je site (er is nog geen live domein)." };
  const siteUrl = `https://${domain}/`;
  const auth = { Authorization: `Bearer ${at}`, "Content-Type": "application/json" };
  try {
    // 1) Ask Google for the META verification token and store it so the live site starts serving it.
    const gt = await fetch("https://www.googleapis.com/siteVerification/v1/token", {
      method: "POST", headers: auth,
      body: JSON.stringify({ verificationMethod: "META", site: { type: "SITE", identifier: siteUrl } }),
    });
    const gtj: any = await gt.json().catch(() => ({}));
    const tag = gtj?.token || "";
    if (!gt.ok || !tag) { await mark(projectId, "error", "Kon verificatietoken niet ophalen."); return { ok: false, detail: gtj?.error?.message || "Kon verificatietoken niet ophalen." }; }
    await db.update(projectGsc).set({ siteUrl, verifyTag: tag }).where(eq(projectGsc.projectId, projectId));

    // 2) Ask Google to verify — it fetches the homepage and looks for the injected tag.
    const ins = await fetch("https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META", {
      method: "POST", headers: auth,
      body: JSON.stringify({ site: { type: "SITE", identifier: siteUrl } }),
    });
    if (!ins.ok) { const j: any = await ins.json().catch(() => ({})); const d = j?.error?.message || "Verificatie mislukt — staat de site live en gepubliceerd?"; await mark(projectId, "error", d); return { ok: false, detail: d }; }

    // 3) Add the property to Search Console (idempotent) and 4) submit the sitemap.
    await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}`, { method: "PUT", headers: { Authorization: `Bearer ${at}` } }).catch(() => {});
    const sitemap = encodeURIComponent(`https://${domain}/sitemap.xml`);
    await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${sitemap}`, { method: "PUT", headers: { Authorization: `Bearer ${at}` } }).catch(() => {});

    await mark(projectId, "active", "Geverifieerd en sitemap ingediend.");
    return { ok: true, detail: "Gekoppeld, geverifieerd en sitemap ingediend bij Google." };
  } catch (err) {
    logger.warn({ err, projectId }, "[gsc] setup failed");
    await mark(projectId, "error", "Er ging iets mis bij het instellen.");
    return { ok: false, detail: "Er ging iets mis bij het instellen." };
  }
}

async function mark(projectId: number, status: string, detail: string): Promise<void> {
  await db.update(projectGsc).set({ status, detail }).where(eq(projectGsc.projectId, projectId)).catch(() => {});
}

export async function gscStatus(projectId: number): Promise<{ configured: boolean; connected: boolean; email: string; status: string; detail: string; siteUrl: string }> {
  const [row] = await db.select().from(projectGsc).where(eq(projectGsc.projectId, projectId));
  return { configured: gscConfigured(), connected: !!row?.refreshToken, email: row?.email || "", status: row?.status || "pending", detail: row?.detail || "", siteUrl: row?.siteUrl || "" };
}

// Ask the Search Console API what Google actually knows about our sitemap: was it submitted, has Google
// downloaded it, how many URLs, any errors. Proof that the automatic indexing pipeline reaches Google.
export async function getSitemapStatus(projectId: number): Promise<{ ok: boolean; detail: string; sitemaps: unknown[] }> {
  const at = await getAccessToken(projectId);
  if (!at) return { ok: false, detail: "Niet gekoppeld met Google.", sitemaps: [] };
  const domain = await resolvePublishedDomain(projectId);
  if (!domain) return { ok: false, detail: "Geen gepubliceerd domein.", sitemaps: [] };
  const siteUrl = `https://${domain}/`;
  try {
    const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`, { headers: { Authorization: `Bearer ${at}` } });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, detail: j?.error?.message || `Google API ${res.status}`, sitemaps: [] };
    const sitemaps = (j.sitemap || []).map((s: any) => ({
      path: s.path,
      lastSubmitted: s.lastSubmitted || null,
      lastDownloaded: s.lastDownloaded || null,
      isPending: !!s.isPending,
      errors: Number(s.errors || 0),
      warnings: Number(s.warnings || 0),
      submittedUrls: (s.contents || []).reduce((n: number, c: any) => n + Number(c.submitted || 0), 0),
    }));
    return { ok: true, detail: sitemaps.length ? "Google kent je sitemap." : "Nog geen sitemap bij Google.", sitemaps };
  } catch (err) {
    logger.warn({ err, projectId }, "[gsc] sitemap status failed");
    return { ok: false, detail: "Kon de status niet ophalen.", sitemaps: [] };
  }
}

export async function disconnectGsc(projectId: number): Promise<void> {
  const [row] = await db.select().from(projectGsc).where(eq(projectGsc.projectId, projectId));
  if (row?.refreshToken) { try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(row.refreshToken), { method: "POST" }); } catch { /* ignore */ } }
  await db.delete(projectGsc).where(eq(projectGsc.projectId, projectId));
}
