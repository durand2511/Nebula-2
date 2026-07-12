/**
 * Serve a project's website on a connected custom domain: map the request path to a file in
 * project_files (/ → index.html, /booking-app.html → that file, /blog/x.html → that file) and
 * return it. Simple MVP renderer — serves the stored files as-is.
 */
import { db, projectFiles, projects, platformUsers, importAssets, projectGsc, seoArticles } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { Request, Response } from "express";
import { getPublishedFiles } from "./site-publish.js";
import { INDEXNOW_KEY } from "./indexnow.js";

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
export const RENDER_FIX_STYLE = `<style data-nebula-render-fix>.elementor-invisible{visibility:visible !important;opacity:1 !important}
/* Keep accessibility skip-links visually hidden (they became visible "Skip to main content" text on
   every page once the theme's own screen-reader CSS was out-competed). Still shown on keyboard focus. */
.screen-reader-text:not(:focus):not(:focus-within),.skip-link:not(:focus),.ea11y-skip-to-content-link:not(:focus),a[href="#content"]:not(:focus):not([class*="button"]):not([class*="btn"]),[class*="skip-to-content"]:not(:focus){position:absolute !important;width:1px !important;height:1px !important;padding:0 !important;margin:-1px !important;overflow:hidden !important;clip:rect(0,0,0,0) !important;white-space:nowrap !important;border:0 !important}
/* Imported Elementor video widgets ship WITHOUT an <iframe> (their frontend JS builds it on the
   original domain, which never loads here). We inject the iframe (see VIDEO_EMBED_SCRIPT) and make the
   embed fluid so it fills the column and renders correctly on mobile. */
.elementor-widget-video .elementor-wrapper{position:relative;width:100%;aspect-ratio:16/9;height:auto;overflow:hidden}
.elementor-widget-video .elementor-video{position:absolute;inset:0;width:100%;height:100%}
.elementor-widget-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
/* Stop the nav-menu widget (and its container) from clipping its own opened mobile dropdown — that was
   cutting the hamburger menu off so you couldn't see all items. */
.elementor-widget-nav-menu,.elementor-widget-nav-menu>.elementor-widget-container{overflow:visible !important}
/* Mobile menu submenus: render INLINE within the list (full width, indented) instead of floating off to
   the side as a clipped "island". Scoped to the mobile dropdown <nav>, so desktop flyout menus are
   untouched. The whole nav is hidden when the menu is closed, so this only shows while it's open. */
nav.elementor-nav-menu--dropdown .sub-menu{position:static !important;left:auto !important;right:auto !important;top:auto !important;width:100% !important;min-width:0 !important;max-width:100% !important;max-height:none !important;display:block !important;visibility:visible !important;opacity:1 !important;box-shadow:none !important;transform:none !important;padding-left:1.2em}
</style>`;

// Floating "Boek nu" pill shown on every page of a site that has a booking system — an always-present
// booking CTA in addition to the nav link. Links to the booking app; hidden on the booking page itself.
export const BOOK_FLOAT_BUTTON = `<a href="/booking-app.html" data-nebula-book aria-label="Boek nu" style="position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99998;display:inline-flex;align-items:center;gap:8px;background:#111827;color:#fff;font:600 15px/1.1 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;padding:14px 24px;border-radius:999px;text-decoration:none;box-shadow:0 10px 28px rgba(17,24,39,.28)">📅 Boek nu</a>`;

// Whether the floating booking button shows on this page, per the .nebula-book-scope setting.
// Default is OFF — the pill only appears when explicitly enabled (scope "all" or a page list),
// so adding a booking system no longer auto-injects an unwanted floating "Boek nu" button.
// "all" → every page; empty/"off"/"none" → nowhere; otherwise a comma/space list of page paths.
export function showBookButtonOn(pagePath: string, scopeRaw?: string): boolean {
  const scope = (scopeRaw || "off").trim().toLowerCase();
  if (scope === "all") return true;
  if (scope === "" || scope === "off" || scope === "none" || scope === "geen") return false;
  const page = pagePath.toLowerCase().replace(/\.html$/, "");
  return scope.split(/[\s,]+/).filter(Boolean).some((s) => s.replace(/\.html$/, "") === page);
}

// Site-wide restyle ("maak de site mooier"): one managed CSS file the AI writes, injected on EVERY
// imported page (after the imported CSS so its !important refinements win) — a whole-site transformation
// instead of only index.html/the hero.
export const NEBULA_RESTYLE_PATH = ".nebula-restyle.css";

// Self-contained mobile-menu toggle: makes the hamburger open the menu even though the theme's own JS
// (on the original domain) never loads. Captures clicks on a *-menu-toggle and shows the nearest menu.
const MOBILE_MENU_SCRIPT = `<script>(function(){
function findDd(t){var scope=t.closest(".elementor-widget-nav-menu,nav,header")||document;return scope.querySelector("nav.elementor-nav-menu--dropdown")||scope.querySelector(".elementor-nav-menu__container:not(.elementor-nav-menu--main)")||scope.querySelector("ul.elementor-nav-menu")||scope.querySelector(".sub-menu");}
function show(t,dd){var r=t.getBoundingClientRect();var topY=Math.max(0,Math.round(r.bottom));dd.style.setProperty("display","block","important");dd.style.setProperty("position","fixed","important");dd.style.setProperty("top",topY+"px","important");dd.style.setProperty("left","0","important");dd.style.setProperty("right","0","important");dd.style.setProperty("width","100%","important");dd.style.setProperty("max-width","100%","important");dd.style.setProperty("max-height",(window.innerHeight-topY-8)+"px","important");dd.style.setProperty("overflow-y","auto","important");dd.style.setProperty("z-index","99999","important");dd.style.setProperty("transition","none","important");dd.style.padding="8px 0";var bg="";try{bg=getComputedStyle(dd).backgroundColor;}catch(x){}if(!bg||bg==="rgba(0, 0, 0, 0)"||bg==="transparent")dd.style.background="#fff";}
function hide(dd){dd.style.setProperty("display","none","important");["position","top","left","right","width","max-width","max-height","overflow-y","z-index","background","padding","transition"].forEach(function(p){dd.style.removeProperty(p);});}
document.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest('.elementor-menu-toggle,[class*="menu-toggle"]'):null;if(!t)return;t=t.closest(".elementor-menu-toggle")||t.closest('[class~="menu-toggle"]')||t;e.preventDefault();e.stopPropagation();var dd=findDd(t);if(!dd)return;var open=dd.getAttribute("data-nebmenu")!=="1";dd.setAttribute("data-nebmenu",open?"1":"0");t.classList.toggle("elementor-active",open);t.setAttribute("aria-expanded",open?"true":"false");dd.setAttribute("aria-hidden",open?"false":"true");if(open)show(t,dd);else hide(dd);},true);
})();</script>`;

// Imported Elementor video widgets carry the YouTube/Vimeo URL in data-settings but no <iframe> (the
// theme's frontend JS that builds it lives on the original domain and never loads). Build the iframe
// ourselves from data-settings so the videos actually play — on desktop AND mobile.
const VIDEO_EMBED_SCRIPT = `<script>(function(){function embed(u){if(!u)return"";u=String(u);var m;if(m=u.match(/(?:youtu\\.be\\/|youtube(?:-nocookie)?\\.com\\/(?:watch\\?v=|embed\\/|v\\/|shorts\\/))([\\w-]{6,})/i))return"https://www.youtube.com/embed/"+m[1];if(m=u.match(/vimeo\\.com\\/(?:video\\/)?(\\d+)/i))return"https://player.vimeo.com/video/"+m[1];return"";}var ws=document.querySelectorAll(".elementor-widget-video");for(var i=0;i<ws.length;i++){var w=ws[i];if(w.querySelector("iframe"))continue;var s={};try{s=JSON.parse(w.getAttribute("data-settings")||"{}");}catch(e){}var src=embed(s.youtube_url||s.vimeo_url||s.link||s.url||"");if(!src)continue;var slot=w.querySelector(".elementor-video")||w.querySelector(".elementor-wrapper")||w;var f=document.createElement("iframe");f.src=src;f.setAttribute("frameborder","0");f.setAttribute("allowfullscreen","");f.setAttribute("allow","accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture");f.setAttribute("loading","lazy");f.title="Video";slot.innerHTML="";slot.appendChild(f);}})();</script>`;

// Imported "ticker"/marquee bars scroll via the site's OWN JS (which doesn't load here), so they sat
// still. Drive the moving track ourselves: scroll it left every frame and, because the items are
// identical repeats, reset by exactly one item-width when it passes — a seamless loop (no jump/"bug").
export const TICKER_SCRIPT = `<script>(function(){function run(tr){if(!tr||tr.__nebTick)return;tr.__nebTick=1;var x=0;var cs=getComputedStyle(tr);var gap=parseFloat(cs.columnGap||cs.gap||"0")||0;function step(){x-=0.7;var f=tr.firstElementChild;if(f){var iw=f.getBoundingClientRect().width+gap;if(iw>0){while(x<=-iw)x+=iw;}}tr.style.transform="translateX("+x.toFixed(2)+"px)";requestAnimationFrame(step);}requestAnimationFrame(step);}function init(){var sel="[data-hero-ticker]>a,[data-hero-ticker]>div,[data-ticker]>*,.marquee__inner,.marquee-content,.ticker__track";document.querySelectorAll(sel).forEach(run);}if(document.readyState!=="loading")init();else document.addEventListener("DOMContentLoaded",init);})();</script>`;

// Short stable hash (djb2) for cache-busting externalized CSS — changes only when the content changes.
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
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
  // IndexNow verification file — the same key on every domain we serve, proving host control so we can
  // submit this site's URLs to Bing/Yandex. Answered before the normal file lookup.
  if (p === `${INDEXNOW_KEY}.txt`) { res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.send(INDEXNOW_KEY); return; }
  // Externalized imported CSS / fonts — served as ONE cacheable file instead of being inlined into every
  // page (that inlined blob was ~5 MB per page). The browser now downloads it once and reuses it across
  // pages → big page-speed / Core Web Vitals win. Cache-busted via the ?v=<hash> the <link> carries.
  if (p === "_nebula/imported.css" || p === "_nebula/fonts.css") {
    const src = p === "_nebula/fonts.css" ? ".nebula-fonts.css" : ".nebula-imported.css";
    const blob = rows.find((r) => r.path === src)?.content;
    if (blob) { res.setHeader("Content-Type", "text/css; charset=utf-8"); res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); res.send(blob); return; }
    res.status(404).send("/* not found */"); return;
  }
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
    // Google Search Console verification: if this project connected GSC, keep its meta tag in the <head>
    // on every page (Google re-checks it, so it must stay present, not just during initial verification).
    try {
      const [gsc] = await db.select().from(projectGsc).where(eq(projectGsc.projectId, projectId));
      const vtag = gsc?.verifyTag || "";
      if (vtag && !content.includes("google-site-verification")) {
        content = /<head[^>]*>/i.test(content) ? content.replace(/<head[^>]*>/i, (m) => m + vtag) : vtag + content;
      }
    } catch { /* best-effort */ }
    // The GENERATED booking-app page is self-contained: injecting the imported site's fonts/CSS
    // would override its own nav/hero styling (nav-colour mismatch), so skip both for it.
    const isBookingApp = file.path === "booking-app.html";
    // Self-contained fonts (survive edits): inject the stored @font-face blob (data: URIs) at serve
    // time, so imported icon-fonts render instead of "tofu" boxes.
    // Reference the fonts/CSS as EXTERNAL cacheable files (served above at /_nebula/*.css) instead of
    // inlining the (up to ~5 MB) blob into every page. One download, reused across pages → far lighter
    // pages and much better Core Web Vitals. ?v=<hash> busts the cache whenever the blob changes.
    const fontBlob = isBookingApp ? undefined : rows.find((r) => r.path === ".nebula-fonts.css")?.content;
    if (fontBlob) {
      const st = `<link rel="stylesheet" data-nebula-fonts href="/_nebula/fonts.css?v=${shortHash(fontBlob)}">`;
      content = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, st + "</head>") : content.replace(/<head[^>]*>/i, (m) => m + st);
    }
    // Imported CSS: injected after fonts so it wins over the original cross-origin <link> stylesheets
    // (which 404 once the domain points at Nebula).
    const cssBlob = isBookingApp ? undefined : rows.find((r) => r.path === ".nebula-imported.css")?.content;
    if (cssBlob) {
      const st = `<link rel="stylesheet" data-nebula-imported-css href="/_nebula/imported.css?v=${shortHash(cssBlob)}">`;
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
      const tail = MOBILE_MENU_SCRIPT + VIDEO_EMBED_SCRIPT + TICKER_SCRIPT;
      content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, tail + "</body>") : content + tail;
      // Strip a leftover duplicate "blog.html" nav link (the old SEO engine added one next to the site's
      // own Blog link) — server-side, so it disappears regardless of any re-publish state.
      content = content
        .replace(/<li\b(?:(?!<\/li>)[\s\S])*?\bhref=["']blog\.html["'](?:(?!<\/li>)[\s\S])*?<\/li>/gi, "")
        .replace(/<a\b[^>]*\bhref=["']blog\.html["'][\s\S]*?<\/a>/gi, "");
      // On the studio's OWN blog page, list the published SEO articles — built server-side from the DB,
      // so it's always current and never depends on the re-publish/snapshot mechanism. Identify the blog
      // page by its filename ("blog…"), excluding the article pages (blog/…) and the redirect stub.
      if (/(^|\/)blog[\w-]*(\.html$|\/index\.html$)/i.test(file.path) && file.path !== "blog.html" && !/^blog\//i.test(file.path)) {
        try {
          const arts = await db.select().from(seoArticles).where(and(eq(seoArticles.projectId, projectId), eq(seoArticles.status, "published")));
          if (arts.length) {
            const e = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
            const cards = arts.map((a) => `<a href="/blog/${e(a.slug)}.html" style="display:block;background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:16px 18px;margin:0 0 12px;text-decoration:none;color:#1f2937"><span style="display:block;font-size:18px;font-weight:600;color:#7a00df">${e(a.title)}</span></a>`).join("");
            const section = `<section data-nebula-blog-list style="max-width:760px;margin:40px auto;padding:0 20px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"><h2 style="font-size:26px;margin:0 0 16px;color:#1f2937">Blog</h2>${cards}</section>`;
            content = /data-nebula-blog-list/i.test(content)
              ? content.replace(/<section\b[^>]*data-nebula-blog-list[\s\S]*?<\/section>/i, section)
              : (/<footer\b/i.test(content) ? content.replace(/<footer\b/i, section + "\n<footer") : content.replace(/<\/body>/i, section + "</body>"));
          }
        } catch { /* best-effort */ }
      }
    }
    // Floating "Boek nu" CTA on a site that has a booking system (except the booking page). Scope is
    // controlled by an optional .nebula-book-scope file the AI writes: "all" (default) | "off" | a
    // page path (or comma list) to limit it to specific page(s).
    if (!isBookingApp && rows.some((r) => r.path === "booking-app.html") && showBookButtonOn(file.path, rows.find((r) => r.path === ".nebula-book-scope")?.content)) {
      content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, BOOK_FLOAT_BUTTON + "</body>") : content + BOOK_FLOAT_BUTTON;
    }
    // Free (unsubscribed) sites carry a non-removable Nebula badge bottom-right.
    if (!(await ownerSubscribed(projectId))) {
      content = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, NEBULA_BADGE + "</body>") : content + NEBULA_BADGE;
    }
  }
  res.send(content);
}
