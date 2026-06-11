import { Router, json } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as safeFetch } from "undici";
import { load as cheerioLoad } from "cheerio";
import { db, projects, projectMessages, projectFiles, learnings } from "@workspace/db";
import {
  CreateProjectBody,
  GetProjectParams,
  DeleteProjectParams,
  ImportProjectFromUrlBody,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";

const router = Router();

// Tolerant parser: LANGUAGE line is optional, and the language may instead sit
// on the opening fence (e.g. ```html). Handles CRLF and extra fence metadata.
const FILE_BLOCK_REGEX =
  /FILE:\s*(.+?)\s*\r?\n(?:LANGUAGE:\s*(.+?)\s*\r?\n)?```([\w+-]*)[^\n]*\r?\n([\s\S]*?)```/g;

function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "html",
    htm: "html",
    css: "css",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    svg: "svg",
    ts: "typescript",
    md: "markdown",
  };
  return map[ext] ?? "plaintext";
}

// --- Website import (AI Editor) ---------------------------------------------

const IMPORT_FETCH_TIMEOUT_MS = 12000;
const IMPORT_MAX_BYTES = 1_500_000; // cap so a huge page can't blow the model's context
const IMPORT_MAX_REDIRECTS = 4;

// Block requests that resolve to loopback / private / link-local ranges so a
// user-supplied URL can't be used to reach internal services (SSRF).

// Expand an IPv6 string (handling "::" compression and a dotted-quad tail) into
// its 8 16-bit hextets, or null if it isn't parseable.
function expandIpv6(ip: string): number[] | null {
  let s = ip.split("%")[0];
  const dm = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dm && dm.index !== undefined) {
    const p = dm[1].split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    const h1 = ((p[0] << 8) | p[1]).toString(16);
    const h2 = ((p[2] << 8) | p[3]).toString(16);
    s = s.slice(0, dm.index) + h1 + ":" + h2;
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  let all: string[];
  if (parts.length === 1) {
    all = head;
  } else {
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    all = [...head, ...new Array(missing).fill("0"), ...tail];
  }
  if (all.length !== 8) return null;
  const nums = all.map((h) => (h === "" ? 0 : parseInt(h, 16)));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

// If an IPv6 address embeds an IPv4 (mapped `::ffff:x` or compatible `::x`),
// return that IPv4 in dotted form so it can be range-checked. This closes SSRF
// bypasses where an internal IPv4 (e.g. 127.0.0.1) is encoded as IPv6.
function embeddedIpv4(ip6: string): string | null {
  const h = expandIpv6(ip6);
  if (!h) return null;
  const isMapped = h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff;
  const isCompat =
    h.slice(0, 6).every((x) => x === 0) && !(h[6] === 0 && h[7] <= 1);
  if (!isMapped && !isCompat) return null;
  return `${(h[6] >> 8) & 0xff}.${h[6] & 0xff}.${(h[7] >> 8) & 0xff}.${h[7] & 0xff}`;
}

function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local incl. cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    const h = expandIpv6(lower);
    if (!h) return true; // valid-but-unparseable → treat as unsafe
    if (h.every((x) => x === 0)) return true; // :: unspecified
    if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1 loopback
    if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((h[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
    if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    const v4 = embeddedIpv4(lower); // IPv4-mapped/compatible → check the IPv4
    if (v4) return isPrivateIp(v4);
    return false;
  }
  return true; // unknown format → treat as unsafe
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") {
    throw new Error("That host isn't allowed.");
  }
  // If the host is a literal IP, validate it directly; otherwise resolve DNS.
  const literal = isIP(host);
  const ips = literal
    ? [host]
    : (await dnsLookup(host, { all: true })).map((r) => r.address);
  if (ips.length === 0 || ips.some((ip) => isPrivateIp(ip))) {
    throw new Error("That host isn't allowed.");
  }
  return url;
}

// Hardened dispatcher: re-resolves and re-validates the host at actual connect
// time. assertSafeUrl alone is vulnerable to DNS rebinding (a host can resolve
// to a public IP during validation and a private IP at connect time); this
// closes that gap because the connection only ever uses an IP we just checked.
const importDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { all: true })
        .then((records) => {
          if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) {
            callback(new Error("That host isn't allowed."), null as never, 0);
            return;
          }
          if (options && (options as { all?: boolean }).all) {
            callback(null, records as never, 0);
          } else {
            callback(null, records[0].address, records[0].family);
          }
        })
        .catch((err: Error) => callback(err, null as never, 0));
    },
  },
});

// Fetch HTML while following redirects manually, re-validating every hop so a
// redirect can't bounce us to an internal address.
async function fetchWebsiteHtml(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= IMPORT_MAX_REDIRECTS; hop++) {
    const safe = await assertSafeUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMPORT_FETCH_TIMEOUT_MS);
    let res: Awaited<ReturnType<typeof safeFetch>>;
    try {
      res = await safeFetch(safe.toString(), {
        redirect: "manual",
        dispatcher: importDispatcher,
        signal: controller.signal,
        headers: {
          // Present as a real browser — many sites return 403 to non-browser
          // User-Agents / missing browser headers (e.g. Cloudflare bot checks).
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,nl;q=0.8",
          "Upgrade-Insecure-Requests": "1",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("The website returned an invalid redirect.");
      current = new URL(location, safe).toString();
      continue;
    }
    if (!res.ok) {
      throw new Error(`The website responded with status ${res.status}.`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("html")) {
      throw new Error("That URL doesn't point to a web page.");
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("Couldn't read the website's content.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > IMPORT_MAX_BYTES) {
          await reader.cancel();
          throw new Error("That page is too large to import.");
        }
        chunks.push(value);
      }
    }
    const html = Buffer.concat(chunks).toString("utf-8");
    return { html, finalUrl: safe.toString() };
  }
  throw new Error("The website redirected too many times.");
}

// URL-bearing attributes we rewrite to absolute and scrub for script schemes.
const URL_ATTRS = [
  "href",
  "src",
  "poster",
  "background",
  "action",
  "formaction",
  "data",
  "xlink:href",
];

// Attributes that carry a comma-separated list of candidate URLs.
const SRCSET_ATTRS = ["srcset", "imagesrcset"];

// Decode HTML entities then normalize whitespace/control chars so an obfuscated
// scheme (e.g. `java\tscript:` or `javascript&#58;`) can't slip past the check.
function normalizeUrlValue(value: string): string {
  return value.replace(/[\u0000-\u0020\u00a0]+/g, "").toLowerCase();
}

function isDangerousScheme(value: string): boolean {
  const v = normalizeUrlValue(value);
  return (
    v.startsWith("javascript:") ||
    v.startsWith("vbscript:") ||
    v.startsWith("data:text/html")
  );
}

function absolutizeUrl(rawValue: string, baseUrl: string): string {
  const value = rawValue.trim();
  if (isDangerousScheme(value)) return "#";
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("data:") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  ) {
    return value;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

// Turn a fetched live page into a self-contained, preview-safe single HTML file.
// Parsing into a real DOM (cheerio) — rather than regex — is deliberate: it
// handles quoted/unquoted/entity-encoded attributes uniformly so script vectors
// can't survive via an edge case the preview iframe (allow-scripts) would run.
// We strip all scripts and JS event handlers, neutralize script-scheme URLs, and
// rewrite asset URLs to absolute so the sandboxed iframe can still load CSS/images.
function prepareImportedHtml(html: string, baseUrl: string): string {
  const $ = cheerioLoad(html);

  // Remove scripts and any element that can load/execute an embedded document
  // (these would run JS inside the allow-scripts preview sandbox).
  $("script, base, iframe, frame, frameset, object, embed, portal, applet").remove();
  // Drop meta-refresh redirects — they can navigate the sandboxed preview to a
  // script-bearing document (e.g. content="0;url=javascript:..." / data:text/html).
  $("meta").each((_, el) => {
    if (($(el).attr("http-equiv") ?? "").trim().toLowerCase() === "refresh") {
      $(el).remove();
    }
  });
  // Drop <noscript> entirely. Its body is the JS-DISABLED fallback, which a browser
  // never renders while scripting is on — and our preview runs with allow-scripts.
  // cheerio/parse5 parse a <noscript> body as a single raw TEXT node (scripting-on
  // semantics), so unwrapping it injects the markup as ESCAPED text that prints as
  // visible tags (e.g. GTM's hidden tracking <iframe>, lazy-image fallbacks).
  // Removing it matches real browser behavior and avoids the escaped-text artifact.
  $("noscript").remove();

  $("*").each((_, node) => {
    const el = node as { attribs?: Record<string, string> };
    const attribs = el.attribs;
    if (!attribs) return;
    const $el = $(node);
    for (const name of Object.keys(attribs)) {
      const lname = name.toLowerCase();
      // Drop inline event handlers (onclick, onload, onerror, ...) and srcdoc,
      // which embeds a whole document that would run scripts in the iframe.
      if (lname.startsWith("on") || lname === "srcdoc") {
        $el.removeAttr(name);
        continue;
      }
      if (URL_ATTRS.includes(lname)) {
        $el.attr(name, absolutizeUrl(attribs[name], baseUrl));
      } else if (SRCSET_ATTRS.includes(lname)) {
        const rewritten = attribs[name]
          .split(",")
          .map((part) => {
            const seg = part.trim();
            if (!seg) return seg;
            const [u, ...rest] = seg.split(/\s+/);
            return [absolutizeUrl(u, baseUrl), ...rest].join(" ");
          })
          .join(", ");
        $el.attr(name, rewritten);
      }
    }
  });

  return $.html();
}

// Measure how much real, renderable content a prepared HTML page has. Bot-protection
// challenges, JS-only SPAs, and blocked responses return a shell with an empty (or
// near-empty) <body>, which would import as a project that previews as a blank page.
// We count visible text length plus media/structural elements so we can refuse such
// imports with a clear message instead of silently creating an empty project.
function meaningfulContentScore(html: string): number {
  const $ = cheerioLoad(html);
  const text = ($("body").text() ?? "").replace(/\s+/g, " ").trim();
  const media = $("body img, body picture, body svg, body video, body canvas").length;
  const structural = $(
    "body p, body h1, body h2, body h3, body li, body section, body article, body table, body form",
  ).length;
  return text.length + media * 50 + structural * 25;
}

// Below this score a page is treated as effectively empty (blocked / JS-only).
const MIN_IMPORT_CONTENT_SCORE = 80;

// Max number of pages we crawl+store for an imported site. Keeps import time and
// project size bounded while still capturing a typical brochure site in full
// (most have well under this many pages); huge blogs get the first N pages.
const IMPORT_MAX_PAGES = 30;
const IMPORT_CRAWL_CONCURRENCY = 5;

// File-extensions / paths that are never standalone HTML pages worth crawling.
const SKIP_LINK_EXT =
  /\.(jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|rss|txt|pdf|zip|gz|tar|rar|7z|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|doc|docx|xls|xlsx|ppt|pptx|csv)$/i;
const SKIP_LINK_PATH =
  /\/wp-(admin|login|json|content|includes)\b|\/feed\/?$|\/cart\/?$|\/checkout\/?$|\/my-account\b|\/wp-login\.php/i;

// Map a URL pathname to a stable local file key so internal links can be resolved
// to imported pages by the preview. MIRRORED by the inline key() in the app-builder
// preview router (project-workspace.tsx, buildPreviewHtml) — keep the two in sync.
function pageKeyFromPath(pathname: string): string {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    p = pathname;
  }
  p = p
    .split("?")[0]
    .split("#")[0]
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.(html?|php|aspx?)$/i, "");
  if (!p) return "index";
  const key = p
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return key || "index";
}

// Collect same-host, crawlable page links from a page's HTML (absolute, deduped).
function discoverInternalLinks(html: string, pageUrl: string, host: string): string[] {
  const $ = cheerioLoad(html);
  const out: string[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const raw = ($(el).attr("href") ?? "").trim();
    if (!raw || raw.startsWith("#")) return;
    let u: URL;
    try {
      u = new URL(raw, pageUrl);
    } catch {
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (u.hostname.replace(/^www\./, "").toLowerCase() !== host) return;
    if (SKIP_LINK_EXT.test(u.pathname)) return;
    if (SKIP_LINK_PATH.test(u.pathname)) return;
    u.hash = "";
    const norm = u.origin + u.pathname + (u.search || "");
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push(norm);
  });
  return out;
}

// Crawl an imported site starting at the homepage: fetch the homepage, then
// breadth-first fetch its same-host internal pages (capped by IMPORT_MAX_PAGES).
// The homepage always becomes "index.html"; other pages get a stable key.
async function crawlSite(
  startUrl: string,
): Promise<{ pages: { key: string; url: string; html: string }[]; finalUrl: string }> {
  const home = await fetchWebsiteHtml(startUrl);
  const baseUrl = new URL(home.finalUrl);
  const host = baseUrl.hostname.replace(/^www\./, "").toLowerCase();

  const pages: { key: string; url: string; html: string }[] = [
    { key: "index.html", url: home.finalUrl, html: home.html },
  ];
  const claimed = new Set<string>(["index"]);
  const queuedKeys = new Set<string>(["index"]);
  const queue: string[] = discoverInternalLinks(home.html, home.finalUrl, host);

  while (queue.length > 0 && pages.length < IMPORT_MAX_PAGES) {
    const batch: string[] = [];
    while (
      queue.length > 0 &&
      batch.length < IMPORT_CRAWL_CONCURRENCY &&
      pages.length + batch.length < IMPORT_MAX_PAGES
    ) {
      const link = queue.shift()!;
      let key: string;
      try {
        key = pageKeyFromPath(new URL(link).pathname);
      } catch {
        continue;
      }
      if (queuedKeys.has(key)) continue;
      queuedKeys.add(key);
      batch.push(link);
    }
    if (batch.length === 0) break;

    const results = await Promise.allSettled(batch.map((l) => fetchWebsiteHtml(l)));
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      let key: string;
      try {
        key = pageKeyFromPath(new URL(r.value.finalUrl).pathname);
      } catch {
        continue;
      }
      if (claimed.has(key)) continue;
      claimed.add(key);
      pages.push({ key: `${key}.html`, url: r.value.finalUrl, html: r.value.html });
      if (pages.length < IMPORT_MAX_PAGES) {
        for (const nl of discoverInternalLinks(r.value.html, r.value.finalUrl, host)) {
          let nk: string;
          try {
            nk = pageKeyFromPath(new URL(nl).pathname);
          } catch {
            continue;
          }
          if (queuedKeys.has(nk)) continue;
          queue.push(nl);
        }
      }
    }
  }

  return { pages, finalUrl: home.finalUrl };
}

function buildSystemPrompt(
  projectName: string,
  fileContext: string,
  learningsContext: string,
  importMode: "none" | "rebuild" | "edit" = "none",
): string {
  // Strict redesign contract for the FIRST rebuild of an imported site: improve
  // the LOOK only, never drop or restructure content, so a "make it prettier"
  // pass keeps every nav item, button, section, link, and the real copy. Only
  // applied in "rebuild" mode — "edit" mode already says "change only what's
  // asked", and pasting "improve the visuals" there would wrongly push a
  // redesign during a tiny follow-up edit.
  const preservationRules = `
REDESIGN PRESERVATION CONTRACT — when rebuilding this site you may change ONLY the visual design, never the content, structure, or media:
PRESERVE EXACTLY (never change, remove, rename, reorder, or shorten):
- Every navigation item and the menu structure, exactly as-is.
- Every button and CTA — same label, same destination, same functionality.
- Every section and content block — keep all of them, in the same order; nothing may be removed or reordered.
- Every link and its destination (cross-page links become working in-app nav tabs/views — but none may disappear).
- All forms and input fields — keep every field, label, and the form's purpose.
- All footer content — links, address, contact details, and social icons.
- The real content provided for each page below — use the REAL wording, headings and CTA labels exactly as given; never replace them with lorem ipsum or invented marketing copy, and never leave a section empty, stubbed, or "coming soon".
RENDER ALL MEDIA FULLY — recreate it as the real, working thing, never a placeholder, a grey box, or a bare text link (use the exact embed/media URLs listed per page below; these real URLs are allowed exactly like the real image URLs):
- YouTube / Vimeo → an embedded <iframe> player using the real embed URL (convert watch links to the /embed/<id> form); add allowfullscreen and allow="autoplay; encrypted-media; picture-in-picture; fullscreen".
- Google Maps → an embedded <iframe> map using the real embed URL.
- Video / audio files → native <video controls> / <audio controls> players pointing at the real source URL.
- Images → loaded and displayed from their real absolute URLs.
- Social links → keep the real URLs and show them as recognizable inline-SVG brand icons.
- Any other iframe embed → render it inline with its real src.
IMPROVE (this is ALL you may change): typography (cleaner, modern); spacing and layout consistency (uniform spacing, alignment, visual hierarchy on a real grid); color palette (refine and modernize but keep the brand recognizable); component styling for buttons, cards and inputs (same function, better design); mobile responsiveness.
HARD RULES:
- If a section, button, menu item, link, form, or piece of media exists in the original, it MUST exist in the redesign, rendered fully.
- Never simplify by removing, and never replace media with a placeholder — only simplify by cleaning up the visuals.
- When in doubt: keep it, render it for real, and make it look better.
- "Change ONLY the visual design" refers to not altering the CONTENT or STRUCTURE — it does NOT mean output only CSS. You are still writing the full index.html markup and script.js from scratch in this same response; a response that omits index.html or script.js (e.g. only a styles.css) is a hard FAILURE.`;
  const importedBlock =
    importMode === "none"
      ? ""
      : (importMode === "edit"
      ? `IMPORTED WEBSITE — INCREMENTAL EDIT (this site was imported and has ALREADY been rebuilt into the single-page app shown in the current project files below):
- Apply ONLY the specific change the user asks for. Preserve the existing layout, structure, sections, navigation, copy, and styling EXACTLY as they are — do NOT redesign, re-theme, restructure, or regenerate the page, and do not touch anything the user did not mention. A full rebuild here is a FAILURE.
- The current files already reuse the site's REAL image URLs (absolute https URLs); keep them as-is — the "no external image URLs" rule does NOT apply to image URLs already present in these files. If the change needs a new image, prefer one already in the files; otherwise use inline SVG/emoji per the runtime rules.
- Output ONLY the file(s) you actually modify; leave every other file untouched.`
      : `REBUILD OUTPUT CONTRACT — READ FIRST: This imported site has NOT been rebuilt yet. There is NO index.html single-page app, NO styles.css and NO script.js in the project yet — you are CREATING all three from scratch RIGHT NOW, in this single response. You MUST output all THREE complete files: index.html (the full SPA markup containing every section, the navigation, and all real content/media), styles.css (the full stylesheet), and script.js (view switching + interactivity). Use the exact "FILE: <path>" format for each. Outputting only a stylesheet — or any response that omits index.html or script.js — is a hard FAILURE: a styles.css alone has no markup to style and renders a blank page. Even if the user only says "make it prettier" / "maak mooier", a rebuild ALWAYS means generating the whole SPA, never only CSS.

IMPORTED WEBSITE ASSETS (applies ONLY when the current project files below are HTML imported/crawled from a real website):
- That imported HTML contains the site's REAL images as ABSOLUTE URLs (e.g. <img src="https://…">, <source srcset="https://…">, and CSS background-image: url(https://…)). These are genuine, working assets from the source site — NOT random, placeholder, or hallucinated URLs — so the "no external image URLs" runtime rule does NOT apply to them. REUSE them.
- Pull the most relevant real images out of the imported HTML and place them tastefully into your new design so the result feels like ONE cohesive whole with the original site: a hero/banner image at the top, supporting photos inside cards/sections, a gallery where it fits, and the site's real logo image in the header (this is the one case where an actual logo image is expected instead of a text wordmark).
- Copy each image URL EXACTLY as it appears in the imported HTML (keep the full absolute URL). Never invent, guess, shorten, or alter an image URL, and never swap in a stock/CDN URL. If you need an image that is not present in the imported HTML, fall back to inline SVG/emoji per the runtime rules rather than guessing a URL.
- Make every reused image responsive and on-grid: max-width:100%, height:auto, object-fit:cover where cropping helps, sensible aspect ratios, and meaningful alt text. Style the surrounding layout with the design system so the photos feel intentionally composed, not pasted in. Place images like a real designer: a strong hero image, balanced photo/text sections, an occasional gallery or image grid — never one lonely picture and never a wall of images.
- REBUILD THE WHOLE SITE, NOT JUST THE HOMEPAGE. Recreate the imported site as ONE cohesive multi-view single-page app inside index.html. Read the site's MAIN navigation menu from the imported HTML and create a working nav tab/view for EVERY primary section (e.g. Home, each class/service page, About, Pricing/Rates, Blog, Contact). Switch views client-side (hash routing or show/hide sections) — every nav tab must actually work. Building only a home page is a FAILURE.
- FULLY DESIGN EACH TAB, not only the home view. Every tab gets real headings, real copy taken from that section's imported page, and the relevant real images from that page, laid out on the grid with the design system. Never leave a tab empty, stubbed, "coming soon", or visibly thinner than the others — each view must look finished on its own. The home/landing view is just one of several complete views.
- If a primary nav section's page is NOT present in the files below (omitted for size), STILL create its tab and fill it with tasteful, on-brand content and a relevant reused image consistent with the rest of the site — do not drop the tab or leave it blank.`) +
    (importMode === "rebuild" ? "\n" + preservationRules : "");
  return `You are Buildly, an expert AI web app builder. Generate beautiful, fully-functional web apps for a project called "${projectName}", with clean, well-structured, modular code.${learningsContext}

You build COMPLETE, production-ready web apps — never demos, prototypes, or placeholders.

REFERENCE IMAGES (when the user attaches one or more images):
- Treat the attached image(s) as the PRIMARY visual brief — read them carefully and study the layout structure, color palette, typography, spacing/density, imagery style, button and component shapes, and overall mood.
- Build whatever the user asks, but styled to match the reference as closely as you can: reproduce its look and feel (colors, fonts, proportions, section structure, navigation pattern) so the result clearly belongs to the same brand/design language.
- The reference shows VISUAL direction only. Still build a real, fully-functional app per the runtime constraints below — every button, tab, menu, and link must actually work (do NOT produce a static, non-interactive mockup of the image).
- If the reference's palette/typography conflicts with the BUILDLY DESIGN SYSTEM defaults below, the REFERENCE WINS for palette, type, and overall styling (the user is explicitly asking for that look); still keep the execution-quality, layout-discipline, and runtime-robustness rules.
- Recreate the design from scratch in your own clean code; never hotlink the reference image or any external asset URLs from it.

${importedBlock}

RUNTIME CONSTRAINTS (the app runs sandboxed in a browser iframe — respect these exactly):
- Vanilla JavaScript only — plain classic scripts. NO npm, NO build step, NO JSX/TSX, NO frameworks that need compiling.
- Load libraries via CDN only (Tailwind, Chart.js, etc.).
- Persist data with localStorage (no backend/Supabase is available in this sandbox).
- "Pages"/routing = a single-page app with client-side view switching (hash routing or show/hide sections) inside index.html — do NOT rely on separate .html files for navigation.

FILE STRUCTURE — split into MULTIPLE well-organized files, never one giant file:
  - index.html — semantic markup, plus an inline <style> block with your design-token :root variables and a small body reset; all other styling lives in styles.css. Link sibling files with relative paths
  - styles.css — custom styling beyond Tailwind utilities
  - script.js — app logic; for larger apps split by concern into several JS files (e.g. router.js, store.js, ui.js), each referenced from index.html
- index.html must reference siblings exactly like: <link rel="stylesheet" href="styles.css"> and <script src="script.js"></script> (and <script src="store.js"></script> etc.)
- CRITICAL — DO NOT use ES module syntax for your OWN local files: no \`type="module"\`, and no \`import\`/\`export\` statements between your own .js files. The preview inlines each local <script src> into the page as a CLASSIC script (in the order listed), so a local \`import './store.js'\` will NOT resolve and silently breaks EVERY button and interaction. Instead: write plain classic scripts, list them in dependency order in index.html, and share state across files through ONE global namespace (e.g. \`window.App = window.App || {}\`; assign \`window.App.store = ...\` in store.js and read it in script.js). Wrap each file's internals in an IIFE to avoid leaking locals. (You MAY still import a third-party LIBRARY from a CDN over https.)
- Add brief comments explaining each module's responsibility. Keep UI, logic, and data access separated.

DESIGN — THINK LIKE A WORLD-CLASS PRODUCT DESIGNER. Every app you build must look and feel like a premium, $10,000 product: clean, elegant, meticulously polished, and visually cohesive. Never ship something generic, cluttered, flat, or "templated". Design is not decoration added at the end — design every screen with intent from the very start.

DESIGN PROCESS — ALWAYS plan the structure BEFORE writing a single line of code. Reason through these steps first, then build strictly to that plan:
1. Understand the app's goal and who uses it.
2. Map the primary user flow — the main task the user performs and repeats.
3. Define the information architecture: the main views/sections and how they relate.
4. Choose ONE consistent layout on a real grid system. Use a proper app shell: a top bar/header (app name + primary nav), an optional sidebar for section navigation on larger/data-dense apps, and a main content region on a consistent column grid. Decide breakpoints.
5. Decide the reusable components you need — header, navigation, cards, forms, tables/lists, empty states — and use them consistently throughout.
6. Verify spacing, alignment, and visual hierarchy against a single consistent spacing scale BEFORE finalizing.
7. Only then write the HTML, CSS, and JavaScript, faithfully to that plan.

The result MUST feel like a deliberate, cohesive, professionally-designed product appropriate to what the app is (an editorial landing page, a calm wellness site, or a data-dense dashboard) — NOT loose blocks dropped onto a page.

STRUCTURE & LAYOUT REQUIREMENTS (apply to EVERY app):
- A real app shell: clear header/top bar, an optional sidebar for navigation on larger apps, and a main content area on a consistent grid.
- Group content into clearly delineated sections with consistent vertical rhythm — never a random pile of elements.
- Align everything to the grid on one consistent spacing scale; no arbitrary margins, no off-grid or random placement.
- Stats/metrics live in COMPACT stat cards arranged in a row or grid (small label + value) — not giant numbers scattered around.
- Forms are well-structured: grouped fields, aligned labels, logical order, one clear primary action.
- Lists and tables are clean and scannable: aligned columns, clear headers, tidy rows.
- Restrained typography — follow the type scale below; no unnecessarily huge text.
- Fully responsive: the grid reflows sensibly from desktop to mobile (sidebar collapses, cards stack, tables stay usable).

BUILDLY DESIGN SYSTEM — this is the house style. Apply it EXACTLY to EVERY generated app so everything feels like a calm, premium, editorial product crafted by a high-end studio — LIGHT, serene, warm and elegant, never generic AI output. Use these precise values; do not invent a different palette unless the user explicitly asks for one or provides a reference image to match.

OVERALL PAGE:
- Background: #f7f4ee (warm gebroken wit) — LIGHT by default. NEVER use a black, near-black, or dark page background unless the user EXPLICITLY asks for dark mode. The page is the calmest, lightest surface; cards sit on top of it as crisp white surfaces that clearly stand out.
- All text defaults to #241f1a (warm near-black ink), with muted rgba(36,31,26,0.78) and soft rgba(36,31,26,0.56) variants.
- Max content width: ~1180px centered (margin: 0 auto) for rich/marketing layouts; ~800px for simple single-column or form/content apps; for dashboards and data-dense tools use a wider centered shell with a sidebar so tables and stat-card grids have room. Keep generous gutters and royale whitespace either way.
- Section padding: 56px–96px. Page padding: 48px 24px.
- Font: Inter, imported from Google Fonts (with a system-sans fallback).

TYPOGRAPHY HIERARCHY:
- H1: 48px–60px, font-weight 300, letter-spacing -0.02em — large but elegant and airy.
- H2: 30px–36px, font-weight 300, letter-spacing -0.01em.
- H3: 20px–22px, font-weight 400.
- Body: 15px–17px, font-weight 400, line-height 1.7, color rgba(36,31,26,0.78).
- Eyebrow/caption: 11px–12px, uppercase, letter-spacing 0.08em–0.12em, color rgba(36,31,26,0.56).

INPUTS & FORM FIELDS:
- Background: #ffffff (or transparent on white surfaces); border: 1px solid rgba(70,58,45,0.12), or a single subtle bottom-border for minimal forms; border-radius: 4px (subtle, never heavy rounding).
- Color: #241f1a; font-size: 16px; font-weight: 400; padding: 14px 16px; width: 100%.
- Placeholder color: rgba(36,31,26,0.45).
- On focus: border color -> rgba(70,58,45,0.45); NO glow, NO heavy box-shadow.
- Transition: border-color 0.2s ease.

LABELS:
- Font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase.
- Color: rgba(36,31,26,0.56); display: block; margin-bottom: 8px.

FORM GROUPS:
- Margin-bottom: 28px–32px; position: relative.

PRIMARY BUTTONS:
- Background: #241f1a (dark ink); color: #ffffff; border: none; border-radius: 4px.
- Padding: 14px 28px; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer.
- On hover: opacity 0.9 (or background #3a322a); transition: 0.15s.
- NO box-shadow, NO gradient.

SECONDARY BUTTONS:
- Background: transparent; color: #241f1a; border: 1px solid rgba(70,58,45,0.22).
- Same padding and typography as primary.
- On hover: border-color rgba(70,58,45,0.45); subtle background #faf7f2.

CARDS & CONTAINERS — cards read as crisp WHITE surfaces sitting on the warm off-white page, with quiet, tasteful hierarchy (think high-end editorial / wellness branding):
- Background: #ffffff — clearly distinct from the #f7f4ee page; soft alternate surfaces may use #f3ede4. NEVER use a dark card fill on a light page.
- Border: 1px solid rgba(70,58,45,0.12) — subtle but clearly visible.
- Border-radius: 12px; padding: 24px–32px; backdrop-filter: none.
- Shadow: ONE very subtle shadow for depth only — box-shadow: 0 1px 2px rgba(70,58,45,0.06), 0 8px 24px rgba(70,58,45,0.05). Keep it light; never heavy, large, or colored shadows, no gradients, no glass/blur effects (the floating dynamic-island nav is the ONE exception that may use blur — see NAVIGATION).
- Interactive/hoverable cards: lift slightly on hover — background #faf7f2 (and/or border rgba(70,58,45,0.22)); transition: background 0.15s ease, border-color 0.15s ease.

METRIC / STAT DISPLAYS:
- Present stats as COMPACT white stat cards (use the SAME white card surface from the CARDS section above, with its border and subtle shadow) arranged in a responsive row/grid with tight internal padding. They must be instantly recognizable as separate cards, not faint panels that melt into the page.
- Label: 12px, uppercase, letter-spacing 0.08em, color rgba(36,31,26,0.56), placed above the value.
- Value: ~28px, font-weight 300, letter-spacing -0.02em, color #241f1a — high contrast against the white card, prominent but restrained; never oversized.
- Keep cards compact and aligned to the grid; never use giant hero numbers scattered around the page.

STRICT RULES — never break these:
- LIGHT by default: warm off-white page, white cards, dark ink text. NEVER a black/dark page or dark cards unless the user EXPLICITLY asks for dark mode.
- Zero gradients.
- No heavy, large, or colored shadows and no glows — the ONLY shadow allowed is the single subtle card shadow defined in CARDS & CONTAINERS, used purely for depth.
- Subtle, lightly-rounded inputs (radius 4px or bottom-border only); never heavy rounding.
- Restrained, earthy accents only — no loud or saturated colors, no busy patterns, no harsh contrasts beyond what readability needs.
- Generous whitespace and clear hierarchy; every app must feel like a calm, premium editorial studio made it, not an AI.
- Inspired by minimal editorial design and high-end wellness/lifestyle branding.

EXECUTION QUALITY (still required within this system):
- Consistent spacing and pixel-perfect alignment; no awkward gaps, clipped text, or misaligned elements.
- Smooth, subtle transitions only (the ones specified above); motion is effortless, never flashy.
- Design every state: empty states, loading states, hover/active/focus states, and inline error states.

IMPLEMENTATION:
- Put these design tokens in an inline <style> block at the top of index.html (a :root variable set for the colors above — e.g. --bg:#f7f4ee; --surface:#ffffff; --surface-soft:#f3ede4; --surface-hover:#faf7f2; --text:#241f1a; --text-muted:rgba(36,31,26,0.78); --text-soft:rgba(36,31,26,0.56); --border:rgba(70,58,45,0.12); --border-strong:rgba(70,58,45,0.22) — plus a body reset: margin 0, background #f7f4ee, color #241f1a, font-family Inter) so the app paints correctly immediately; put all other styling in styles.css.
- Import Inter with a Google Fonts <link>.

NON-NEGOTIABLES (quality floor — never break):
- NO Lorem Ipsum or placeholder copy — write real, realistic content and seed real sample data so the app is fully demonstrable on first load.
- NO dead buttons or links — every interactive element must actually work.
- Fully mobile responsive with media queries.
- Every form has validation with clear inline error messages.
- Always include empty states and loading states.

BRANDING / LOGO (apply to EVERY app):
- For the logo in the header, use the app's NAME as a clean text wordmark (just the styled name, optionally with a tasteful accent on one word). Do NOT invent or insert a generic placeholder logo icon, emoji, symbol, monogram glyph, or abstract "logo" mark next to or above the name — these read as unfinished AI output and must never appear.
- Only render an actual logo image/icon when the user explicitly provides one or clearly asks for a specific logo. If a reference image shows a real logo, recreate that brand's wordmark/logo faithfully instead of a generic placeholder glyph.

NAVIGATION — THE DYNAMIC ISLAND (apply to every NEW build and every full imported REBUILD; this is the signature element that makes the whole product feel premium). On an EDIT to an existing app, do NOT apply this — keep the app's existing navigation exactly as-is unless the user explicitly asks to redesign the navigation:
- The PRIMARY navigation must be a floating "dynamic island": a single pill-shaped bar (border-radius: 9999px) that floats a little below the top of the viewport, horizontally CENTERED, with clear margin on all sides — it sits OVER the content, never edge-to-edge and never a full-width flat bar. Use position: fixed; top: ~16px; z-index above content; with a max-width so it stays a compact island, not a stretched bar.
- Surface: a translucent, frosted warm-white pill. THIS FLOATING NAV IS THE ONE AND ONLY PLACE where backdrop-filter blur is permitted (a deliberate, scoped exception to the no-blur rule) — e.g. background: rgba(255,255,255,0.72); backdrop-filter: blur(16px) saturate(140%); 1px solid var(--border); and the single subtle card shadow from CARDS & CONTAINERS. Nothing else in the app may use blur or glass.
- Contents, all INSIDE the pill: the app-name text wordmark on the left, the nav items as inline rounded link buttons in the middle, and (optionally) one primary CTA on the right. Comfortable padding (≈8px 14px), tight gaps, vertically centered, ink-on-light text.
- "Dynamic" = it moves with intent. (a) Active state: a smoothly SLIDING highlight pill sits behind the active nav item and glides to the newly-selected item with a spring-like ease (transition ≈ transform 0.35s cubic-bezier(0.22,1,0.36,1)) — a magic-move indicator, not a static underline. (b) On scroll: the island subtly compacts (a touch less padding, slightly more opaque, marginally smaller) as the page scrolls down and relaxes back at the top — smooth transitions only. Keep all motion effortless and restrained, in the spirit of the house style.
- Mobile / overflow: on small screens the island becomes a compact pill showing the wordmark + a menu toggle; tapping morphs/expands it DOWNWARD into a rounded floating panel listing the items with a smooth height+opacity animation, then collapses back — it always stays a floating, rounded island, never a full-width bar. If there are too many nav items to fit on desktop, let the island scroll horizontally or use a tasteful "More" overflow inside it — NEVER drop nav items (this is critical for imported rebuilds, where EVERY primary nav item from the preservation contract must remain reachable in the island).
- It must be fully real: every item switches views client-side and actually works; keyboard operable with visible focus; mark the active item with aria-current="page". Ensure main content has enough top padding so the floating island never overlaps the first heading.
- If the user explicitly asked for dark mode (or a reference image is dark), make the island a translucent dark/ink frosted pill instead, keeping the same floating shape and behavior.

ALWAYS GENERATE:
1. The primary navigation — for new builds and full imported rebuilds, as the floating DYNAMIC ISLAND described above (on an edit to an existing app, keep its existing nav unless the user asks to redesign it) — by default with the app name as a text wordmark; only use a real logo if the user explicitly provides/requests one or a reference image clearly includes it (never a generic placeholder glyph).
2. A main content area in a centered, comfortable container.
3. At least 3 working, genuinely useful interactive features.
4. Error handling and graceful fallbacks.
5. A complete, shippable, beautiful app — not a demo.

CORE FEATURES (include unless the user says otherwise):
- A real main app view with genuine functionality — not a stub.
- Data persistence via localStorage so data survives refreshes.
- Form validation with clear, inline error messages.
- Navigation/routing between views when the app has more than one section.

AUTHENTICATION — ONLY WHEN THE USER ASKS:
- Do NOT add login, sign-up, sign-in, user accounts, or any authentication UI or logic unless the user explicitly requests it. By default an app must open straight into its working main view — no login wall.
- Only when the user's request clearly mentions accounts / login / users / sign-in, build a clean auth flow (localStorage-backed login/register, persisted session, logged-in state, logout).

CODE QUALITY:
- NO placeholder text like "TODO", "coming soon", or dead buttons — every button and link must actually do something.
- Seed real, realistic sample data so the app is demonstrable on first load.
- Clear variable/function names and clean, readable code.

RUNTIME ROBUSTNESS (critical — the app MUST run with ZERO uncaught console errors):
- Run code only after the DOM exists: place <script> tags at the END of <body>, or wrap all DOM access in a "DOMContentLoaded" listener. Never read elements before they are rendered.
- Guard every element lookup: check the result of getElementById/querySelector before using it. Never call methods on a possibly-null element.
- Wrap parsing and storage in try/catch: JSON.parse, localStorage.getItem/setItem can throw — handle failures gracefully and fall back to seed data.
- Do NOT reference external image, font, or file URLs that may 404 (no random photo/CDN asset URLs). For graphics use inline SVG, emoji, or data URIs (NO gradients — see the design system); these are fine as decorative graphics but NEVER as a substitute header logo glyph (see BRANDING / LOGO). Google Fonts <link> tags are allowed. EXCEPTION: real absolute image URLs taken verbatim from an imported website's HTML are allowed and encouraged — see IMPORTED WEBSITE ASSETS — because they are genuine working assets from that site, not guessed URLs.
- Hidden-by-default overlays (modals, dialogs, drawers, dropdown menus, toasts) MUST be genuinely hidden until opened. If you toggle one via the HTML \`hidden\` attribute (e.g. \`el.hidden = true\`), do NOT also set \`display\` on its base class — a rule like \`.modal{display:grid}\` overrides \`[hidden]\` so the overlay never actually hides. Either add an explicit \`.modal[hidden]{display:none}\` rule or toggle a visibility class instead. CRITICAL: a full-screen \`position:fixed; inset:0\` overlay that is meant to be closed but still renders sits on top of the page and swallows EVERY click, making the entire app unresponsive — always ensure a closed overlay computes to \`display:none\`.
- Attach event listeners only to elements that exist; verify selectors match the markup you generated.
- When regenerating after a fix request, output the COMPLETE corrected files (every file), not a partial patch — files fully replace the previous versions.

CONSISTENCY ON EDITS (when current project files already exist below):
- This is an EDIT to an existing app, not a fresh build. If the existing files already follow the BUILDLY DESIGN SYSTEM above, keep matching it exactly. If they predate it and use a different look, preserve that app's established design language (palette, typography, spacing, component styles) so the result stays visually cohesive — do NOT re-theme or migrate it onto the Buildly system unless the user explicitly asks. Either way, only elevate the parts you actually touch.
- Make the SMALLEST change that satisfies the request. Do not redesign, rename, or restructure unrelated parts of the app, and do not drop existing features or seeded data.
- Keep all existing files and their working behavior intact; only change what the request requires.

ACCESSIBILITY & UX (always):
- Every input has an associated <label>; every icon-only button has an aria-label; images have meaningful alt text.
- Fully keyboard operable: logical tab order, visible focus states, Enter/Escape work in dialogs and forms. Use semantic elements (button, nav, main, header) — never click handlers on bare <div>s.
- Ensure readable color contrast (WCAG AA) for text and interactive elements in the chosen palette.
- Provide instant feedback: disable buttons while busy, show inline validation, confirm destructive actions, and use subtle toasts/messages for success/failure.

FINAL SELF-CHECK (verify before you output — a broken app is a failure):
- Every sibling file you reference in index.html (<link href>, <script src>) is actually generated below, and every file you generate is referenced. No dangling references, no orphan files.
- All href/src to your own files use relative paths (e.g. "styles.css", "script.js") — never absolute paths or external URLs for local assets.
- The app runs with ZERO uncaught console errors and every interactive element works.
- The requested feature is fully implemented end-to-end, with realistic seed data visible on first load.

OUTPUT FORMAT:
Start with 1-2 warm, conversational sentences (NO code, NO file names) spoken directly to the user, explaining what you're about to build. For a change to an existing app, say specifically what you will change and why. THEN output each file as its own block, html first:
FILE: index.html
LANGUAGE: html
\`\`\`
...full file...
\`\`\`
FILE: styles.css
LANGUAGE: css
\`\`\`
...full file...
\`\`\`
FILE: script.js
LANGUAGE: javascript
\`\`\`
...full file...
\`\`\`

Output nothing after the final code block — your opening sentences to the user are the only prose you write.${fileContext}`;
}

// The model has a hard input-token limit. A large multi-page imported site can
// be several MB of HTML (well past that limit), so we include files under a
// character budget instead of dumping everything. Roughly ~3.4 chars/token for
// dense HTML, so ~2M chars stays comfortably under the limit while leaving room
// for the system prompt, conversation history, and the response.
const MAX_FILE_CONTEXT_CHARS = 2_000_000;

// Imported WordPress/Elementor sites are enormous walls of minified markup
// (30 pages × ~200KB = several MB). Feeding even ~2M chars of that raw HTML to a
// reasoning model makes it burn its entire output-token budget "reading" the
// bloat and emit NOTHING (observed: an edit request streamed for ~2.5 min and
// produced zero tokens). So for imports we send a compact, DISTILLED brief of
// each page instead of the raw HTML: titles, headings, key copy and the real
// image URLs — everything the model needs to rebuild a clean single-page app.
const IMPORTED_CONTEXT_MAX_CHARS = 260_000;
const PER_PAGE_MAX_CHARS = 11_000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function collectTagText(re: RegExp, html: string, limit: number): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(html)) !== null && out.length < limit) {
    const t = htmlToText(m[1]);
    if (t) out.push(t);
  }
  return out;
}

function extractHeadings(html: string): string[] {
  return collectTagText(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi, html, 24);
}

function extractParagraphs(html: string): string[] {
  return collectTagText(/<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>/gi, html, 140)
    .filter((t) => t.length >= 30)
    .slice(0, 18)
    .map((t) => (t.length > 600 ? t.slice(0, 600) + "…" : t));
}

// Pull the labels of buttons and button-styled links so a redesign keeps every
// CTA verbatim (the PRESERVATION CONTRACT requires same labels + same actions).
function extractCtas(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = htmlToText(raw);
    const key = t.toLowerCase();
    if (t && t.length >= 2 && t.length <= 48 && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  };
  let m: RegExpExecArray | null;
  const btnRe = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  while ((m = btnRe.exec(html)) !== null && out.length < 16) push(m[1]);
  const linkBtnRe =
    /<a\b[^>]*\b(?:class|role)=["'][^"']*(?:btn|button|cta)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = linkBtnRe.exec(html)) !== null && out.length < 16) push(m[1]);
  return out.slice(0, 16);
}

function extractPageImages(html: string): string[] {
  const urls = new Set<string>();
  const add = (raw?: string) => {
    if (!raw) return;
    const first = raw.trim().split(/[\s,]+/)[0]; // srcset → first candidate URL
    if (/^https?:\/\//i.test(first)) urls.add(first);
  };
  let m: RegExpExecArray | null;
  const imgRe = /<img\b[^>]*?\bsrc=["']([^"']+)["']/gi;
  while ((m = imgRe.exec(html)) !== null && urls.size < 12) add(m[1]);
  const srcsetRe = /\bsrcset=["']([^"']+)["']/gi;
  while ((m = srcsetRe.exec(html)) !== null && urls.size < 12) add(m[1]);
  return [...urls].slice(0, 12);
}

// Capture rich media embeds (YouTube/Vimeo/Maps/Spotify iframes, <video>/<audio>
// sources, and bare YouTube watch links) so a rebuild can recreate them as REAL
// working players instead of dropping them or leaving a placeholder. Hidden
// tracker iframes (GTM/analytics/zero-size) are skipped — they are not content.
function extractEmbeds(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const isTracker = (s: string) =>
    /googletagmanager|google-analytics|doubleclick|facebook\.com\/tr|hotjar|gtm\.js|connect\.facebook/i.test(
      s,
    ) ||
    /visibility\s*:\s*hidden|display\s*:\s*none|(?:width|height)=["']?0\b/i.test(s);
  const push = (kind: string, raw?: string) => {
    if (!raw || out.length >= 12) return;
    const url = raw.startsWith("//") ? "https:" + raw : raw;
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push(`${kind}: ${url}`);
  };
  let m: RegExpExecArray | null;
  const iframeRe = /<iframe\b([^>]*)>/gi;
  while ((m = iframeRe.exec(html)) !== null && out.length < 12) {
    const attrs = m[1];
    if (isTracker(attrs)) continue;
    const src = (attrs.match(/\bsrc=["']([^"']+)["']/i) || [])[1];
    if (!src) continue;
    let kind = "iframe embed";
    if (/youtube(?:-nocookie)?\.com|youtu\.be/i.test(src)) kind = "YouTube video embed";
    else if (/vimeo\.com/i.test(src)) kind = "Vimeo video embed";
    else if (/\/maps\/embed|google\.[^/]+\/maps|maps\.google/i.test(src)) kind = "Google Maps embed";
    else if (/spotify\.com/i.test(src)) kind = "Spotify embed";
    else if (/soundcloud\.com/i.test(src)) kind = "SoundCloud audio embed";
    push(kind, src);
  }
  const videoRe = /<video\b[^>]*\bsrc=["']([^"']+)["']/gi;
  while ((m = videoRe.exec(html)) !== null) push("video file", m[1]);
  const sourceRe = /<source\b[^>]*\bsrc=["']([^"']+\.(?:mp4|webm|ogg|mov)[^"']*)["']/gi;
  while ((m = sourceRe.exec(html)) !== null) push("video file", m[1]);
  const audioRe = /<audio\b[^>]*\bsrc=["']([^"']+)["']/gi;
  while ((m = audioRe.exec(html)) !== null) push("audio file", m[1]);
  const ytLinkRe =
    /<a\b[^>]*\bhref=["'](https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?[^"']+|youtu\.be\/[^"']+))["']/gi;
  while ((m = ytLinkRe.exec(html)) !== null) push("YouTube video (embed as a player)", m[1]);
  return out.slice(0, 12);
}

// Social profile links, one per platform, so the redesign keeps them and renders
// recognizable brand icons instead of dropping the footer's social row.
function extractSocialLinks(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const social =
    /(facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|youtu\.be|tiktok\.com|pinterest\.|wa\.me|whatsapp\.com|t\.me|telegram|threads\.net)/i;
  const re = /<a\b[^>]*\bhref=["'](https?:\/\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < 10) {
    const url = m[1];
    if (!social.test(url)) continue;
    const platform = (url.match(social) || [])[1].toLowerCase().replace(/\.$/, "");
    if (seen.has(platform)) continue;
    seen.add(platform);
    out.push(url);
  }
  return out;
}

function extractMetaDescription(html: string): string {
  const tag = html.match(/<meta\b[^>]*\bname=["']description["'][^>]*>/i);
  if (!tag) return "";
  const c = tag[0].match(/content=["']([\s\S]*?)["']/i);
  return c ? htmlToText(c[1]) : "";
}

function extractPageTitle(html: string, fallback: string): string {
  const og = html.match(/<meta\b[^>]*\bproperty=["']og:title["'][^>]*>/i);
  if (og) {
    const c = og[0].match(/content=["']([\s\S]*?)["']/i);
    if (c) return htmlToText(c[1]);
  }
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return htmlToText(t[1]);
  return fallback;
}

function extractNavItems(indexHtml: string): string[] {
  // Gather candidate menu containers (every <nav>, any <ul class/id="…menu…">,
  // and the <header>), then pick whichever yields the most distinct, short link
  // labels — i.e. the real primary menu, not a lone "skip to content" link.
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  const navRe = /<nav\b[\s\S]*?<\/nav>/gi;
  while ((m = navRe.exec(indexHtml)) !== null) candidates.push(m[0]);
  const menuRe = /<ul\b[^>]*\b(?:class|id)=["'][^"']*menu[^"']*["'][\s\S]*?<\/ul>/gi;
  while ((m = menuRe.exec(indexHtml)) !== null) candidates.push(m[0]);
  const header = (indexHtml.match(/<header\b[\s\S]*?<\/header>/i) || [])[0];
  if (header) candidates.push(header);

  let best: string[] = [];
  for (const block of candidates) {
    const items: string[] = [];
    const re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
    let a: RegExpExecArray | null;
    while ((a = re.exec(block)) !== null && items.length < 24) {
      const t = htmlToText(a[1]);
      if (t && t.length >= 2 && t.length <= 40 && !items.includes(t)) items.push(t);
    }
    if (items.length > best.length) best = items;
  }
  return best.slice(0, 20);
}

// True once an imported site has been rebuilt into a standalone SPA. A raw
// WordPress import is .html-only, so the presence of any non-HTML editable file
// (styles.css / script.js produced by the first "make it prettier" pass) means
// later requests are INCREMENTAL edits — feed the SPA files raw and change only
// what's asked, never re-distill and rebuild from scratch.
function importedSpaRebuilt(files: { path: string; content: string }[]): boolean {
  const htmlFiles = files.filter((f) => f.path.toLowerCase().endsWith(".html"));
  if (htmlFiles.length === 0) return false;
  const protectedSet = new Set(
    htmlFiles
      .filter((f) => f.path.toLowerCase() !== "index.html")
      .map((f) => f.path.toLowerCase()),
  );
  return files.some(
    (f) => !protectedSet.has(f.path.toLowerCase()) && !f.path.toLowerCase().endsWith(".html"),
  );
}

// Build the file context for an imported site. First pass = a DISTILLED brief of
// every page (titles, headings, key copy, real image URLs) so the model rebuilds
// a clean single-page app without drowning in raw HTML. After the SPA exists,
// switch to an INCREMENTAL edit that feeds the SPA files raw. Either way every
// original content page (all .html except index.html) is returned as "omitted"
// so it is preserved verbatim for WXR re-export.
function buildImportedContext(files: { path: string; content: string }[]): {
  context: string;
  omitted: string[];
} {
  const htmlFiles = files.filter((f) => f.path.toLowerCase().endsWith(".html"));
  if (htmlFiles.length === 0) return buildRawFileContext(files);

  // The original imported content pages (every .html except index.html) are
  // always protected so they are preserved verbatim for WXR re-export.
  const protectedPaths = htmlFiles
    .filter((f) => f.path.toLowerCase() !== "index.html")
    .map((f) => f.path);
  const protectedSet = new Set(protectedPaths.map((p) => p.toLowerCase()));
  const editableFiles = files.filter((f) => !protectedSet.has(f.path.toLowerCase()));

  // On every edit AFTER the first rebuild we feed the existing SPA files raw and
  // tell the model to change ONLY what the user asked for (see importedSpaRebuilt).
  if (importedSpaRebuilt(files)) {
    let used = 0;
    const blocks: string[] = [];
    for (const f of editableFiles) {
      const block = `--- ${f.path} ---\n${f.content}`;
      if (used + block.length + 2 > MAX_FILE_CONTEXT_CHARS) continue;
      blocks.push(block);
      used += block.length + 2;
    }
    const context =
      `\n\nThis project was imported from a real website and has ALREADY been rebuilt into the single-page app below. ` +
      `Make ONLY the specific change the user asks for. Keep the existing layout, structure, sections, copy and styling exactly as they are — edit just the part that needs to change. ` +
      `Do NOT redesign, re-theme, or regenerate the whole page, and do NOT change anything the user did not ask about. Output only the file(s) you actually modify.\n\n` +
      `Current project files (modify these as needed):\n${blocks.join("\n\n")}`;
    return { context, omitted: protectedPaths };
  }

  const index = htmlFiles.find((f) => f.path.toLowerCase() === "index.html");
  const nav = index ? extractNavItems(index.content) : [];

  const ordered = [...htmlFiles].sort((a, b) => {
    if (a.path.toLowerCase() === "index.html") return -1;
    if (b.path.toLowerCase() === "index.html") return 1;
    return a.path.localeCompare(b.path);
  });

  const blocks: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const f of ordered) {
    // Protect every original page except index.html: the model rebuilds the SPA
    // into index.html and must never overwrite the verbatim source pages.
    if (f.path.toLowerCase() !== "index.html") omitted.push(f.path);

    const title = extractPageTitle(f.content, f.path);
    const desc = extractMetaDescription(f.content);
    const headings = extractHeadings(f.content);
    const paras = extractParagraphs(f.content);
    const ctas = extractCtas(f.content);
    const embeds = extractEmbeds(f.content);
    const socials = extractSocialLinks(f.content);
    const imgs = extractPageImages(f.content);

    let block = `=== PAGE: ${f.path} ===\nTitle: ${title}\n`;
    if (desc) block += `Description: ${desc}\n`;
    if (headings.length) block += `Headings (keep all of these):\n${headings.map((h) => `- ${h}`).join("\n")}\n`;
    if (paras.length) block += `Key copy (keep this real wording):\n${paras.map((p) => `- ${p}`).join("\n")}\n`;
    if (ctas.length) block += `Buttons / CTAs (recreate each one with this EXACT label and its action):\n${ctas.map((c) => `- ${c}`).join("\n")}\n`;
    if (embeds.length) block += `Embedded media (recreate each as a REAL working embed/player — NEVER a link or placeholder; convert YouTube watch links to /embed/<id>):\n${embeds.map((e) => `- ${e}`).join("\n")}\n`;
    if (socials.length) block += `Social links (keep these URLs, render as recognizable inline-SVG brand icons):\n${socials.map((s) => `- ${s}`).join("\n")}\n`;
    if (imgs.length) block += `Real images (reuse these EXACT URLs):\n${imgs.map((u) => `- ${u}`).join("\n")}\n`;
    block = block.slice(0, PER_PAGE_MAX_CHARS);

    if (used + block.length + 2 > IMPORTED_CONTEXT_MAX_CHARS) break;
    blocks.push(block);
    used += block.length + 2;
  }

  const navLine = nav.length ? `Main navigation: ${nav.join(" · ")}\n\n` : "";
  const context =
    `\n\nThis project was IMPORTED from a real website. What follows is a DISTILLED summary of every page (titles, headings, key copy, buttons/CTAs, embedded media, social links, and the real image URLs) — NOT the raw HTML, which is far too large to include. ` +
    `Use it to rebuild the site as ONE cohesive, beautiful single-page app, reusing the real image URLs EXACTLY as given. ` +
    `Follow the REDESIGN PRESERVATION CONTRACT strictly: recreate EVERY page as a working nav view, and keep every heading, every line of copy, every button/CTA (same label), and every link — improve only the visual design, never drop or shorten content. ` +
    `Output ONLY index.html, styles.css and script.js. Do NOT emit code blocks for any of the original per-page .html files — they are kept as-is.\n\n` +
    navLine +
    blocks.join("\n\n");

  return { context, omitted };
}

function buildFileContext(
  files: { path: string; content: string }[],
  imported = false,
): {
  context: string;
  omitted: string[];
} {
  if (files.length === 0) return { context: "", omitted: [] };
  if (imported) return buildImportedContext(files);
  return buildRawFileContext(files);
}

function buildRawFileContext(files: { path: string; content: string }[]): {
  context: string;
  omitted: string[];
} {
  if (files.length === 0) return { context: "", omitted: [] };

  // Priority: the entry page first, then stylesheets/scripts, then remaining
  // pages smallest-first so we fit as many whole pages as possible.
  const rank = (p: string): number => {
    const lower = p.toLowerCase();
    if (lower === "index.html") return 0;
    if (lower.endsWith(".css")) return 1;
    if (lower.endsWith(".js")) return 2;
    return 3;
  };
  const ordered = [...files].sort((a, b) => {
    const r = rank(a.path) - rank(b.path);
    if (r !== 0) return r;
    return a.content.length - b.content.length;
  });

  const included: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const f of ordered) {
    const header = `--- ${f.path} ---\n`;
    const block = `${header}${f.content}`;
    if (used + block.length + 2 <= MAX_FILE_CONTEXT_CHARS) {
      included.push(block);
      used += block.length + 2; // account for the "\n\n" join
    } else if (included.length === 0) {
      // A single file already exceeds the budget: include a truncated head so
      // the model still has something to work with. Reserve space for the
      // (longer) header and join so the total never exceeds the budget.
      const truncHeader = `--- ${f.path} (truncated to fit context) ---\n`;
      const room = Math.max(0, MAX_FILE_CONTEXT_CHARS - truncHeader.length - 2);
      const head = f.content.slice(0, room);
      included.push(`${truncHeader}${head}`);
      used += truncHeader.length + head.length + 2;
      omitted.push(f.path);
    } else {
      omitted.push(f.path);
    }
  }

  let note = "";
  if (omitted.length > 0) {
    note =
      `\n\nNOTE: This project is too large to include every source file in full. ` +
      `The following original page FILES were omitted to stay within limits — do NOT emit a code block for any of these exact filenames (you can't see their content, so any output would corrupt them) and do not link to them. ` +
      `You MAY still build an in-app nav tab/view for the corresponding section (see IMPORTED WEBSITE ASSETS) using on-brand content; just keep all of that inside index.html, never in these files:\n` +
      omitted.map((p) => `- ${p}`).join("\n");
  }

  return {
    context: `\n\nCurrent project files (modify these as needed):\n${included.join("\n\n")}${note}`,
    omitted,
  };
}

// Pulls the accumulated lessons learned from past user feedback so every new
// generation benefits from corrections made on earlier apps.
async function buildLearningsContext(): Promise<string> {
  try {
    const rows = await db
      .select({ content: learnings.content })
      .from(learnings)
      .orderBy(desc(learnings.createdAt))
      .limit(40);
    if (rows.length === 0) return "";
    const list = rows
      .reverse()
      .map((r) => `- ${r.content}`)
      .join("\n");
    return `\n\nLESSONS LEARNED FROM PAST USER FEEDBACK (apply these proactively to every app you build so you don't repeat past mistakes):\n${list}`;
  } catch {
    return "";
  }
}

// After a user adjusts a generated app, distill a single generalizable, reusable
// lesson from their request and store it so future generations improve.
async function recordLearning(
  projectId: number,
  userAdjustment: string,
): Promise<void> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "You analyze a user's correction/adjustment request for an AI-generated web app and extract ONE short, GENERALIZABLE design or engineering rule that would help build better apps in the future. " +
            "Write it as a single imperative sentence (max 25 words) that applies to apps in general, NOT to this specific app's content. " +
            "Ignore one-off, app-specific content changes (e.g. 'rename this button to X', 'change this text'). " +
            "If there is no generalizable lesson, reply with exactly NONE.",
        },
        { role: "user", content: userAdjustment },
      ],
    });
    const lesson = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!lesson || lesson.toUpperCase() === "NONE" || lesson.length < 8 || lesson.length > 300) {
      return;
    }

    // Safety gate: reject distilled "lessons" that look like prompt-injection /
    // meta-instructions, since they get injected into every future system prompt.
    const lower = lesson.toLowerCase();
    const injectionMarkers = [
      "ignore previous",
      "ignore the previous",
      "ignore all",
      "disregard",
      "system prompt",
      "you are now",
      "forget everything",
      "override",
      "jailbreak",
    ];
    if (injectionMarkers.some((m) => lower.includes(m))) {
      logger.warn({ projectId }, "Rejected potential prompt-injection learning");
      return;
    }

    // Dedupe: skip if we already stored an identical lesson.
    const existing = await db
      .select({ id: learnings.id })
      .from(learnings)
      .where(eq(learnings.content, lesson))
      .limit(1);
    if (existing.length > 0) return;

    await db.insert(learnings).values({ content: lesson, sourceProjectId: projectId });
    logger.info({ projectId }, "Recorded new learning from user adjustment");
  } catch (err) {
    // Learning is best-effort; never let it affect the user's generation.
    logger.error({ err, projectId }, "Failed to record learning");
  }
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
type ChatMsg = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

// The OpenAI SDK's message param type, derived from the client so we don't need
// a direct `openai` dependency just for types. Our ChatMsg is structurally a
// subset; cast at the call sites where we hand messages to the SDK.
type SdkMessages = Parameters<typeof openai.chat.completions.create>[0]["messages"];

// Accepts the optional `images` field from a chat request and returns a safe,
// bounded list of data: image URLs to forward to the model as a visual brief.
const MAX_IMAGES = 4;
const MAX_IMAGE_DATA_URL_LEN = 8_000_000; // ~6MB decoded; vision input cap.
function sanitizeImageDataUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(item)) continue;
    if (item.length > MAX_IMAGE_DATA_URL_LEN) continue;
    out.push(item);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

// Attach reference images to the most recent user turn so the model treats them
// as the visual brief for THIS request. History images aren't re-sent (the built
// code already reflects them), which keeps token usage bounded.
function attachImagesToLastUser(messages: ChatMsg[], images: string[]): void {
  if (images.length === 0) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const existing = messages[i].content;
    const text = typeof existing === "string" ? existing : "";
    messages[i] = {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ],
    };
    return;
  }
}

const MAX_GENERATION_TOKENS = 32768;
const MAX_CONTINUATIONS = 2;
const CONTINUE_PROMPT =
  "Your previous message was cut off. Continue from exactly where you stopped, without repeating anything you already wrote. Resume mid-line if needed.";

// Retry a transient OpenAI failure a couple of times with backoff so a single
// network blip doesn't turn into a failed generation for the user.
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        logger.warn({ err, attempt, label }, "OpenAI call failed; retrying");
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// Derive a concise, human project title from the user's first prompt. Runs
// fire-and-forget after the first build so it never blocks or breaks generation.
async function generateProjectName(projectId: number, prompt: string): Promise<void> {
  try {
    const completion = await withRetry(
      () =>
        openai.chat.completions.create({
          model: "gpt-5.4",
          max_completion_tokens: 30,
          messages: [
            {
              role: "system",
              content:
                "Create a short, catchy product name (2-4 words, Title Case) for the app the user describes. Reply with ONLY the name — no quotes, punctuation, or explanation.",
            },
            { role: "user", content: prompt },
          ],
        }),
      "project-name",
    );
    const name = (completion.choices[0]?.message?.content ?? "")
      .replace(/["'`*]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (name && name.length >= 2 && name.length <= 60) {
      await db.update(projects).set({ name }).where(eq(projects.id, projectId));
      logger.info({ projectId, name }, "Auto-named project");
    }
  } catch (err) {
    logger.error({ err, projectId }, "Failed to auto-name project");
  }
}

// Generate a full response, transparently continuing when the model truncates
// (finish_reason === "length") so large multi-file apps don't get saved half-written.
async function generateWithContinuation(messages: ChatMsg[]): Promise<string> {
  let full = "";
  const msgs = [...messages];
  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    const completion = await withRetry(
      () =>
        openai.chat.completions.create({
          model: "gpt-5.4",
          max_completion_tokens: MAX_GENERATION_TOKENS,
          messages: msgs as SdkMessages,
        }),
      "sync-completion",
    );
    const choice = completion.choices[0];
    const part = choice?.message?.content ?? "";
    full += part;
    if (choice?.finish_reason !== "length") break;
    if (round === MAX_CONTINUATIONS) {
      logger.warn(
        "Generation still truncated after continuation budget; last file may be incomplete",
      );
      break;
    }
    msgs.push({ role: "assistant", content: part });
    msgs.push({ role: "user", content: CONTINUE_PROMPT });
  }
  return full;
}

function extractNarration(raw: string): string {
  // The model now speaks first, before the first FILE block. Keep that opening
  // prose as the assistant's chat message and drop everything from FILE: onward.
  // Match FILE: only at the start of a line, so prose like "update FILE: x" in
  // the narration itself doesn't prematurely truncate it.
  const marker = raw.match(/^FILE:/m);
  const idx = marker?.index ?? -1;
  const head = (idx >= 0 ? raw.slice(0, idx) : raw)
    .replace(/```[\s\S]*$/, "")
    .replace(/LANGUAGE:\s*[^\n]+/g, "")
    .trim();
  return head || "Done! Your app has been updated.";
}

async function persistGeneratedFiles(
  projectId: number,
  raw: string,
  existingFiles: { id: number; path: string }[],
  protectedPaths: Set<string> = new Set(),
): Promise<string[]> {
  const written: string[] = [];
  let match;
  FILE_BLOCK_REGEX.lastIndex = 0;
  while ((match = FILE_BLOCK_REGEX.exec(raw)) !== null) {
    const [, filePath, langLine, fenceLang, fileContent] = match;
    const trimmedPath = filePath.trim();
    if (!trimmedPath) continue;
    // Never overwrite a page that was omitted from the model's context: it
    // couldn't have seen the real content, so any output for it would be a
    // guess that corrupts the existing file.
    if (protectedPaths.has(trimmedPath)) continue;
    const language = (langLine || fenceLang || "").trim() || inferLanguage(trimmedPath);
    written.push(trimmedPath);
    const existing = existingFiles.find((f) => f.path === trimmedPath);
    if (existing) {
      await db
        .update(projectFiles)
        .set({ content: fileContent, language, updatedAt: new Date() })
        .where(eq(projectFiles.id, existing.id));
    } else {
      await db.insert(projectFiles).values({
        projectId,
        path: trimmedPath,
        content: fileContent,
        language,
      });
    }
  }
  return written;
}

router.get("/projects", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        source: projects.source,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        messageCount: sql<number>`(select count(*) from project_messages where project_id = ${projects.id})::int`,
        fileCount: sql<number>`(select count(*) from project_files where project_id = ${projects.id})::int`,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/recent", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        source: projects.source,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        messageCount: sql<number>`(select count(*) from project_messages where project_id = ${projects.id})::int`,
        fileCount: sql<number>`(select count(*) from project_files where project_id = ${projects.id})::int`,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt))
      .limit(6);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to get recent projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects", async (req, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const [project] = await db
      .insert(projects)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        source: "jordy",
      })
      .returning();
    res.status(201).json({
      ...project,
      messageCount: 0,
      fileCount: 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Import a live website by URL and seed a new project with it so the user can
// edit it with AI. Registered before "/projects/:projectId" — though that route
// is GET/DELETE only, this keeps the more specific path unambiguous.
router.post("/projects/import-url", async (req, res) => {
  const parsed = ImportProjectFromUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A url is required." });
    return;
  }

  // Allow users to paste a bare domain (e.g. "stripe.com").
  let rawUrl = parsed.data.url.trim();
  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = `https://${rawUrl}`;
  }

  let crawled: { pages: { key: string; url: string; html: string }[]; finalUrl: string };
  try {
    crawled = await crawlSite(rawUrl);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "The website took too long to respond."
        : err instanceof Error
          ? err.message
          : "Couldn't fetch that website.";
    req.log.warn({ err, rawUrl }, "Website import failed");
    res.status(400).json({ error: message });
    return;
  }

  // Refuse imports that returned no real content. Bot-protection challenges and
  // JS-only sites hand back an empty <body>, which would otherwise become a project
  // that previews as a blank page with no explanation.
  const homepage = crawled.pages.find((p) => p.key === "index.html") ?? crawled.pages[0];
  const bestScore = crawled.pages.reduce(
    (max, p) => Math.max(max, meaningfulContentScore(prepareImportedHtml(p.html, p.url))),
    0,
  );
  if (!homepage || bestScore < MIN_IMPORT_CONTENT_SCORE) {
    req.log.warn(
      { rawUrl, finalUrl: crawled.finalUrl, pageCount: crawled.pages.length, bestScore },
      "Website import returned no usable content",
    );
    res.status(422).json({
      error:
        "Deze website kon niet geïmporteerd worden — hij gaf een lege pagina terug. " +
        "Sites die geautomatiseerde toegang blokkeren of hun inhoud met JavaScript laden, " +
        "kunnen niet geïmporteerd worden. Dit is vaak tijdelijk: probeer het later opnieuw, " +
        "kies een andere website, of beschrijf wat je wilt bouwen.",
    });
    return;
  }

  try {
    let hostname = "Imported Site";
    try {
      hostname = new URL(crawled.finalUrl).hostname.replace(/^www\./, "");
    } catch {
      /* keep fallback */
    }

    const [project] = await db
      .insert(projects)
      .values({
        name: hostname,
        description: `Imported from ${crawled.finalUrl}`,
        source: "yogilates",
      })
      .returning();

    await db.insert(projectFiles).values(
      crawled.pages.map((p) => ({
        projectId: project.id,
        path: p.key,
        content: prepareImportedHtml(p.html, p.url),
        language: "html" as const,
      })),
    );

    req.log.info(
      { projectId: project.id, pageCount: crawled.pages.length, finalUrl: crawled.finalUrl },
      "Imported website",
    );

    res.status(201).json({
      ...project,
      messageCount: 0,
      fileCount: crawled.pages.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create imported project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:projectId", async (req, res) => {
  const parsed = GetProjectParams.safeParse({ projectId: Number(req.params.projectId) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        source: projects.source,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        messageCount: sql<number>`(select count(*) from project_messages where project_id = ${projects.id})::int`,
        fileCount: sql<number>`(select count(*) from project_files where project_id = ${projects.id})::int`,
      })
      .from(projects)
      .where(eq(projects.id, parsed.data.projectId));
    if (rows.length === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/projects/:projectId", async (req, res) => {
  const parsed = DeleteProjectParams.safeParse({ projectId: Number(req.params.projectId) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    await db.delete(projects).where(eq(projects.id, parsed.data.projectId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:projectId/messages", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const msgs = await db
      .select()
      .from(projectMessages)
      .where(eq(projectMessages.projectId, projectId))
      .orderBy(projectMessages.createdAt);
    res.json(msgs);
  } catch (err) {
    req.log.error({ err }, "Failed to list messages");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects/:projectId/messages", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const content = req.body?.content;
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  try {
    const projectRows = await db.select().from(projects).where(eq(projects.id, projectId));
    if (projectRows.length === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    await db.insert(projectMessages).values({ projectId, role: "user", content });

    const history = await db
      .select()
      .from(projectMessages)
      .where(eq(projectMessages.projectId, projectId))
      .orderBy(projectMessages.createdAt);

    const chatMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const existingFiles = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    const isAdjustment = existingFiles.length > 0;
    const isImported = (projectRows[0].description ?? "").startsWith("Imported from");
    const importMode = !isImported
      ? "none"
      : importedSpaRebuilt(existingFiles)
        ? "edit"
        : "rebuild";
    const learningsContext = await buildLearningsContext();
    const fileCtx = buildFileContext(existingFiles, isImported);
    const systemPrompt = buildSystemPrompt(
      projectRows[0].name,
      fileCtx.context,
      learningsContext,
      importMode,
    );

    const aiContent =
      (await generateWithContinuation([
        { role: "system", content: systemPrompt },
        ...chatMessages,
      ])) || "I'm sorry, I couldn't generate a response.";

    const written = await persistGeneratedFiles(
      projectId,
      aiContent,
      existingFiles,
      new Set(fileCtx.omitted),
    );
    if (written.length === 0 && existingFiles.length === 0) {
      res.status(422).json({
        error: "I couldn't generate valid files. Please try rephrasing your request.",
      });
      return;
    }
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    const [assistantMsg] = await db
      .insert(projectMessages)
      .values({ projectId, role: "assistant", content: extractNarration(aiContent) })
      .returning();

    if (isAdjustment) {
      // Learn from this adjustment (follow-up on an existing app) without blocking the response.
      void recordLearning(projectId, content);
    } else {
      // Give the project a real name derived from the first prompt.
      void generateProjectName(projectId, content);
    }

    res.status(201).json(assistantMsg);
  } catch (err) {
    req.log.error({ err }, "Failed to send message");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Default prompt used when the user sends only reference image(s) with no text,
// so the model always receives a concrete textual instruction.
const REFERENCE_ONLY_PROMPT =
  "Build an app that matches the attached reference image(s) as closely as possible.";

// This route opts in to a larger body limit (skipped by the global parser) so it
// can accept base64-encoded reference images.
router.post("/projects/:projectId/messages/stream", json({ limit: "25mb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const images = sanitizeImageDataUrls(req.body?.images);
  const rawContent = typeof req.body?.content === "string" ? req.body.content : "";
  // Allow image-only requests: fall back to a default instruction when the user
  // attached reference image(s) without any text.
  const content = rawContent.trim()
    ? rawContent
    : images.length > 0
      ? REFERENCE_ONLY_PROMPT
      : "";
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  // Emit a first body byte IMMEDIATELY, before any DB/context work. On a large
  // imported project the pre-stream work (reading every file, building the prompt)
  // can take several seconds; without an early byte the edge proxy sees an idle
  // connection and drops it (observed ~3.8s aborts) before the model ever replies.
  try {
    res.write(": open\n\n");
  } catch {
    /* socket already gone before we started */
  }

  let clientGone = false;
  const send = (event: Record<string, unknown>) => {
    if (clientGone || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Detect a real client disconnect (e.g. the user pressed "Stop"). We listen on
  // the RESPONSE, not the request: req "close" fires as soon as the POST body is
  // read, which would falsely look like an abort before we've sent anything.
  res.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });

  // Keep the proxied SSE connection from idling out while the model "thinks":
  // on complex apps there can be a 30s+ gap before the first token, which the
  // edge proxy would otherwise treat as a dead connection and drop. A comment
  // line resets idle timers and is ignored by the client's `data:` parser.
  const heartbeat = setInterval(() => {
    if (clientGone || res.writableEnded || res.destroyed) return;
    try {
      res.write(": ping\n\n");
    } catch {
      /* socket already torn down */
    }
  }, 3000);

  try {
    const projectRows = await db.select().from(projects).where(eq(projects.id, projectId));
    if (projectRows.length === 0) {
      send({ type: "error", message: "Project not found" });
      res.end();
      return;
    }

    await db.insert(projectMessages).values({ projectId, role: "user", content });

    const history = await db
      .select()
      .from(projectMessages)
      .where(eq(projectMessages.projectId, projectId))
      .orderBy(projectMessages.createdAt);

    const chatMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const existingFiles = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    const isFirstBuild = existingFiles.length === 0;
    const isImported = (projectRows[0].description ?? "").startsWith("Imported from");
    const importMode = !isImported
      ? "none"
      : importedSpaRebuilt(existingFiles)
        ? "edit"
        : "rebuild";
    const learningsContext = await buildLearningsContext();
    const fileCtx = buildFileContext(existingFiles, isImported);
    const omittedPaths = new Set(fileCtx.omitted);
    const systemPrompt = buildSystemPrompt(
      projectRows[0].name,
      fileCtx.context,
      learningsContext,
      importMode,
    );

    send({
      type: "status",
      message: isFirstBuild ? "Planning your app" : "Reviewing your request",
    });

    let full = "";
    const seenFiles = new Set<string>();
    const streamMsgs: ChatMsg[] = [
      { role: "system", content: systemPrompt },
      ...chatMessages,
    ];
    attachImagesToLastUser(streamMsgs, images);

    outer: for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
      // Don't kick off (or pay for) another round if the user already bailed.
      if (clientGone) break;

      const stream = await withRetry(
        () =>
          openai.chat.completions.create({
            model: "gpt-5.4",
            max_completion_tokens: MAX_GENERATION_TOKENS,
            stream: true,
            messages: streamMsgs as SdkMessages,
          }),
        "stream-completion",
      );

      // Tear down the upstream OpenAI request the moment the client hangs up.
      const onClose = () => {
        if (res.writableEnded) return;
        clientGone = true;
        try {
          stream.controller.abort();
        } catch {
          /* already settled */
        }
      };
      res.on("close", onClose);

      // The client may have disconnected while the request was in flight.
      if (clientGone) {
        onClose();
        res.off("close", onClose);
        break;
      }

      let part = "";
      let finishReason: string | null = null;
      try {
        for await (const chunk of stream) {
          if (clientGone) break;
          finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (!delta) continue;
          part += delta;
          full += delta;
          // Stream raw tokens so the UI can show the code being written live.
          send({ type: "delta", text: delta });
          const re = /FILE:\s*([^\n]+)\n/g;
          let m;
          while ((m = re.exec(full)) !== null) {
            const path = m[1].trim();
            if (!seenFiles.has(path)) {
              seenFiles.add(path);
              send({ type: "file", path });
            }
          }
        }
      } catch (streamErr) {
        if (!clientGone) throw streamErr;
      } finally {
        res.off("close", onClose);
      }

      if (clientGone) break outer;
      // Stop unless the model ran out of room mid-output.
      if (finishReason !== "length") break;
      if (round === MAX_CONTINUATIONS) {
        logger.warn(
          { projectId },
          "Streamed generation still truncated after continuation budget; last file may be incomplete",
        );
        break;
      }
      send({ type: "status", message: "Finishing a large app" });
      streamMsgs.push({ role: "assistant", content: part });
      streamMsgs.push({ role: "user", content: CONTINUE_PROMPT });
    }

    if (clientGone) {
      // User pressed Stop — keep any fully-formed files already generated so the
      // work isn't lost, but skip the SSE replies (the connection is gone).
      await persistGeneratedFiles(projectId, full, existingFiles, omittedPaths);
      await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      return;
    }

    send({ type: "status", message: "Saving files" });

    const written = await persistGeneratedFiles(projectId, full, existingFiles, omittedPaths);

    if (written.length === 0 && existingFiles.length === 0) {
      send({
        type: "error",
        message: "I couldn't generate valid files. Please try rephrasing your request.",
      });
      res.end();
      return;
    }

    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    const explanation = extractNarration(full);
    const [assistantMsg] = await db
      .insert(projectMessages)
      .values({ projectId, role: "assistant", content: explanation })
      .returning();

    send({ type: "message", id: assistantMsg.id, content: explanation });
    send({ type: "done", files: written });
    res.end();

    if (isFirstBuild) {
      // Give the project a real name derived from the first prompt.
      void generateProjectName(projectId, content);
    } else {
      // Learn from this adjustment (follow-up on an existing app) so future apps improve.
      void recordLearning(projectId, content);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to stream message");
    send({ type: "error", message: "Something went wrong while building your app." });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

router.get("/projects/:projectId/files", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const files = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId))
      .orderBy(projectFiles.path);
    res.json(files);
  } catch (err) {
    req.log.error({ err }, "Failed to list files");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:projectId/files/:filePath", async (req, res) => {
  const projectId = Number(req.params.projectId);
  const filePath = req.params.filePath;
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    const file = rows.find((f) => f.path === filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.json(file);
  } catch (err) {
    req.log.error({ err }, "Failed to get file");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/projects/:projectId/files/:filePath", async (req, res) => {
  const projectId = Number(req.params.projectId);
  const filePath = req.params.filePath;
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  const { content, language } = req.body ?? {};
  if (content === undefined || typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    const existing = rows.find((f) => f.path === filePath);
    let file;
    if (existing) {
      const [updated] = await db
        .update(projectFiles)
        .set({
          content,
          language: language ?? existing.language,
          updatedAt: new Date(),
        })
        .where(eq(projectFiles.id, existing.id))
        .returning();
      file = updated;
    } else {
      const [created] = await db
        .insert(projectFiles)
        .values({
          projectId,
          path: filePath,
          content,
          language: language ?? "plaintext",
        })
        .returning();
      file = created;
    }
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    res.json(file);
  } catch (err) {
    req.log.error({ err }, "Failed to update file");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
