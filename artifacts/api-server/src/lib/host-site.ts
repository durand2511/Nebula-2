/**
 * Serve a project's website on a connected custom domain: map the request path to a file in
 * project_files (/ → index.html, /booking-app.html → that file, /blog/x.html → that file) and
 * return it. Simple MVP renderer — serves the stored files as-is.
 */
import { db, projectFiles, projects, platformUsers, importAssets } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { Request, Response } from "express";
import { getPublishedFiles } from "./site-publish.js";

// A large, non-removable Nebula branding badge (injected at serve time) for FREE (unsubscribed)
// sites. Deliberately big and prominent in the corner so a free site can't be used commercially —
// subscribing (€69,99/mo) removes it entirely.
const NEBULA_BADGE = `<a href="https://nebulabookings.com" target="_blank" rel="noopener" style="position:fixed;right:24px;bottom:24px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:#fff;color:#111827;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:18px 26px;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,.30);text-decoration:none;border:3px solid #7a00df"><span style="font:800 30px/1.05 system-ui,-apple-system,Segoe UI,Roboto,sans-serif">⚡ Gemaakt met <span style="color:#7a00df">Nebula</span></span><span style="font:600 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#6b7280">Maak gratis je eigen site op nebulabookings.com</span></a>`;

// Is the project's owner a paying subscriber? (ownerless/legacy projects count as NOT subscribed.)
async function ownerSubscribed(projectId: number): Promise<boolean> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p?.ownerId) return false;
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, p.ownerId));
  return u?.subscriptionStatus === "active";
}

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

// Imported sites lazy-load images (the REAL url sits in data-src/srcset, a 1×1 data: placeholder in
// src) and rely on the theme's JS for the mobile hamburger — but that JS lives on the ORIGINAL domain
// and 404s once the domain points at Nebula, so on a phone the images stay blank and the menu won't
// open. Fix without shipping the fragile WordPress JS: promote the real image to src (shows without
// JS) and inject a tiny self-contained menu toggle.
export function unlazyImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const cur = (tag.match(/\bsrc=["']([^"']+)["']/i) ?? [])[1] ?? "";
    if (cur && !/^data:/i.test(cur)) return tag; // already has a real src
    let real = "";
    for (const n of ["data-src", "data-lazy-src", "data-original", "data-lazy"]) {
      const v = (tag.match(new RegExp('\\b' + n + '=["\']([^"\']+)["\']', "i")) ?? [])[1];
      if (v && !/^data:/i.test(v)) { real = v; break; }
    }
    if (!real) {
      const ss = (tag.match(/\bsrcset=["']([^"']+)["']/i) ?? [])[1] ?? (tag.match(/\bdata-srcset=["']([^"']+)["']/i) ?? [])[1] ?? "";
      const f = ss.split(",")[0].trim().split(/\s+/)[0];
      if (f && !/^data:/i.test(f)) real = f;
    }
    if (!real) return tag;
    return cur ? tag.replace(/\bsrc=["'][^"']*["']/i, `src="${real}"`) : tag.replace(/<img\b/i, `<img src="${real}"`);
  });
}

// Imported sites hide entrance-animated elements with `.elementor-invisible{visibility:hidden}` and rely
// on the theme JS (which 404s here) to reveal them on scroll — so without it those elements/images
// "flash then disappear". Force them visible (no animation, but shown).
export const RENDER_FIX_STYLE = `<style data-nebula-render-fix>.elementor-invisible{visibility:visible !important;opacity:1 !important}</style>`;

// Site-wide restyle ("maak de site mooier"): one managed CSS file the AI writes, injected on EVERY
// imported page (after the imported CSS so its !important refinements win) — a whole-site transformation
// instead of only index.html/the hero.
export const NEBULA_RESTYLE_PATH = ".nebula-restyle.css";

// Self-contained mobile-menu toggle: makes the hamburger open the menu even though the theme's own JS
// (on the original domain) never loads. Captures clicks on a *-menu-toggle and shows the nearest menu.
const MOBILE_MENU_SCRIPT = `<script>(function(){document.addEventListener("click",function(e){var el=e.target;var t=el&&el.closest?el.closest('.elementor-menu-toggle,[class*="menu-toggle"]'):null;if(!t)return;e.preventDefault();var open=!t.classList.contains("elementor-active");t.classList.toggle("elementor-active",open);t.setAttribute("aria-expanded",open?"true":"false");var scope=t.closest("nav,.elementor-widget-nav-menu,.elementor-nav-menu--main,header")||document;var dd=scope.querySelector(".elementor-nav-menu--dropdown")||scope.querySelector(".elementor-nav-menu__container")||scope.querySelector("ul.elementor-nav-menu")||scope.querySelector(".sub-menu");if(dd){dd.style.display=open?"block":"";}},true);})();</script>`;

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
  // Imported binary asset (image/font/media)? Served ONE at a time from its own table (never bundled
  // into the site blob) so a faithful import can't reintroduce the load-everything OOM.
  if (!file) {
    const [asset] = await db.select().from(importAssets).where(and(eq(importAssets.projectId, projectId), eq(importAssets.path, p)));
    if (asset) {
      res.setHeader("Content-Type", asset.contentType || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(Buffer.from(asset.data, "base64"));
      return;
    }
  }
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
    // Belt-and-suspenders: neutralise any <base href="https://ORIGINAL/…"> tag. Left in place it makes
    // every relative link/asset resolve to the OLD site, so visiting the published domain bounces the
    // visitor to the original site. Rewrite to root "/" (assets are absolute or /assets/… → unaffected).
    content = content.replace(/(<base\b[^>]*\bhref=)(["'])https?:\/\/[^"']*\2/gi, "$1$2/$2");
    const tag = `<script>window.__BA_PID__=${projectId};</script>`;
    if (/<head[^>]*>/i.test(content)) content = content.replace(/<head[^>]*>/i, (m) => m + tag);
    else if (/<body[^>]*>/i.test(content)) content = content.replace(/<body[^>]*>/i, (m) => m + tag);
    else content = tag + content;
    // The GENERATED booking-app page is self-contained: injecting the imported site's fonts/CSS
    // would override its own nav/hero styling (nav-colour mismatch), so skip both for it.
    const isBookingApp = file.path === "booking-app.html";
    // Self-contained fonts (survive edits): inject the stored @font-face blob (data: URIs) at serve
    // time, so imported icon-fonts render instead of "tofu" boxes.
    const fontBlob = isBookingApp ? undefined : rows.find((r) => r.path === ".nebula-fonts.css")?.content;
    if (fontBlob) {
      const st = `<style data-nebula-fonts>${fontBlob}</style>`;
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, st + "</head>") : content.replace(/<head[^>]*>/i, (m) => m + st);
    }
    // Self-contained imported CSS (survives the domain move): inject after fonts so it wins over the
    // original cross-origin <link> stylesheets (which 404 once the domain points at Nebula).
    const cssBlob = isBookingApp ? undefined : rows.find((r) => r.path === ".nebula-imported.css")?.content;
    if (cssBlob) {
      const st = `<style data-nebula-imported-css>${cssBlob}</style>`;
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, st + "</head>") : content.replace(/<head[^>]*>/i, (m) => m + st);
    }
    // Site-wide restyle (after the imported CSS so it wins) — applies the "make it prettier" refinements
    // to EVERY page, not just index.html.
    const restyleBlob = isBookingApp ? undefined : rows.find((r) => r.path === NEBULA_RESTYLE_PATH)?.content;
    if (restyleBlob) {
      const st = `<style data-nebula-restyle>${restyleBlob}</style>`;
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, st + "</head>") : content.replace(/<head[^>]*>/i, (m) => m + st);
    }
    // Mobile fixes for imported pages: show lazy-loaded images without the (404'ing) theme JS, and give
    // the hamburger a working toggle. Skip the self-contained booking-app page.
    if (!isBookingApp) {
      content = unlazyImages(content);
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, RENDER_FIX_STYLE + "</head>") : RENDER_FIX_STYLE + content;
      content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, MOBILE_MENU_SCRIPT + "</body>") : content + MOBILE_MENU_SCRIPT;
    }
    // Free (unsubscribed) sites carry a non-removable Nebula badge bottom-right.
    if (!(await ownerSubscribed(projectId))) {
      content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, NEBULA_BADGE + "</body>") : content + NEBULA_BADGE;
    }
  }
  res.send(content);
}
