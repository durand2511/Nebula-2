/**
 * Serve a project's website on a connected custom domain: map the request path to a file in
 * project_files (/ → index.html, /booking-app.html → that file, /blog/x.html → that file) and
 * return it. Simple MVP renderer — serves the stored files as-is.
 */
import { db, projectFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { getPublishedFiles } from "./site-publish.js";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml", ics: "text/calendar; charset=utf-8",
};

// Third-party hosts that are NOT the imported site's own domain — never treat these as "internal".
const THIRD_PARTY = /(google|gstatic|googletagmanager|googlesyndication|doubleclick|gmpg\.org|wpconsent|wa\.me|whatsapp|facebook|fbcdn|instagram|youtube|youtu\.be|vimeo|twitter|x\.com|linkedin|tiktok|fonts\.|cdn|jsdelivr|unpkg|cloudflare|jquery|gravatar|schema\.org|w3\.org|wordpress\.org|websitedesigner\.nu)/i;

/** The imported site's original domain = the most frequent first-party host among its <a href> links. */
function detectOriginDomain(html: string): string {
  const counts: Record<string, number> = {};
  const re = /\bhref=["']https?:\/\/([^/"'?#\s]+)/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const h = m[1].toLowerCase().replace(/^www\./, "");
    if (THIRD_PARTY.test(h) || !h.includes(".")) continue;
    counts[h] = (counts[h] || 0) + 1;
  }
  let best = "", n = 0;
  for (const h of Object.keys(counts)) if (counts[h] > n) { n = counts[h]; best = h; }
  return n >= 3 ? best : ""; // need a few links to be confident it's the site's own domain
}

/**
 * Rewrite absolute links that point to the imported site's ORIGINAL domain into local paths, so
 * navigation stays on the NEW (published) domain. Only links whose target page exists locally are
 * rewritten; unknown pages keep their original absolute URL (they only live on the old site).
 */
export function rewriteInternalLinks(html: string, paths: string[]): string {
  const orig = detectOriginDomain(html);
  if (!orig) return html;
  const slugs = new Set(paths.filter((p) => /\.html$/i.test(p)).map((p) => p.replace(/\.html$/i, "").toLowerCase()));
  const re = new RegExp('(\\b(?:href|action)=)(["\'])https?:\\/\\/(?:www\\.)?' + orig.replace(/[.]/g, "\\.") + '(\\/[^"\']*)?\\2', "gi");
  return html.replace(re, (full, attr, q, rawPath) => {
    const raw = String(rawPath || "/");
    const hash = raw.includes("#") ? raw.slice(raw.indexOf("#")) : "";
    const slug = raw.split("#")[0].split("?")[0].replace(/^\/+|\/+$/g, "").toLowerCase();
    if (slug === "") return `${attr}${q}/${hash}${q}`;          // homepage
    if (slugs.has(slug)) return `${attr}${q}/${slug}${hash}${q}`; // local page (serveProjectSite resolves .html)
    return full;                                                  // not imported locally → leave original
  });
}

export async function serveProjectSite(projectId: number, req: Request, res: Response): Promise<void> {
  // Serve the PUBLISHED snapshot when present (draft → publish). Fall back to live files for
  // projects that haven't used publish yet (back-compat — they stay live as before).
  const published = await getPublishedFiles(projectId);
  const rows = published
    ? Object.entries(published).map(([path, f]) => ({ path, content: f.content, language: f.language }))
    : await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  if (!rows.length) { res.status(404).send("Site niet gevonden."); return; }
  let p = decodeURIComponent((req.path || "/").replace(/^\/+/, ""));
  if (p === "" || p.endsWith("/")) p += "index.html";
  let file = rows.find((f) => f.path === p);
  if (!file && !/\.[a-z0-9]+$/i.test(p)) file = rows.find((f) => f.path === p + ".html"); // extensionless → .html
  if (!file) file = rows.find((f) => f.path === "index.html");                            // fallback: homepage
  if (!file) { res.status(404).send("Pagina niet gevonden."); return; }
  const ext = (file.path.split(".").pop() || "html").toLowerCase();
  res.setHeader("Content-Type", TYPES[ext] || "text/plain; charset=utf-8");
  let content = file.content;
  // On a published custom domain / subdomain the URL has no `/projects/<id>/` segment, so the
  // booking app can't read its project id from the path. Inject it as a global so the server-backed
  // features (booking, login, payments) work. The booking app's projId() prefers window.__BA_PID__.
  if (ext === "html") {
    // Keep navigation on the new domain: rewrite links to the imported site's original domain.
    content = rewriteInternalLinks(content, rows.map((r) => r.path));
    const tag = `<script>window.__BA_PID__=${projectId};</script>`;
    if (/<head[^>]*>/i.test(content)) content = content.replace(/<head[^>]*>/i, (m) => m + tag);
    else if (/<body[^>]*>/i.test(content)) content = content.replace(/<body[^>]*>/i, (m) => m + tag);
    else content = tag + content;
  }
  res.send(content);
}
