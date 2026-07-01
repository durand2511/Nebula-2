import { Router, json, type Response } from "express";
import { eq, desc, sql, and } from "drizzle-orm";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as safeFetch } from "undici";
import { load as cheerioLoad } from "cheerio";
import { db, projects, projectMessages, projectFiles, projectSnapshots, learnings, emailReminders, studioClasses, studioUsers, studioBookings, type PlatformUser } from "@workspace/db";
import { getSessionUser, tokenFrom } from "../lib/platform-auth.js";
import { isSubscribed, isBookingRequest, chargeTrackedUsage } from "../lib/billing.js";
import { runWithUsage } from "../lib/ai-usage.js";
import {
  CreateProjectBody,
  GetProjectParams,
  DeleteProjectParams,
  ImportProjectFromUrlBody,
} from "@workspace/api-zod";
import { anthropic } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";
import { deleteProjectMedia } from "../lib/media-storage.js";
import { checkWritePlanViolation, BOOKING_BLOCK_KEYWORDS, isNewPageOnImportedSite, detectExplicitNewPage, fitHistoryToContext, importedSiteHasEdits } from "../lib/write-plan.js";
import { applyAction, rebuildBookingApp, ACTION_CATALOGUE, type BuilderAction } from "../lib/actions.js";
import { seedStaffAccounts } from "../lib/studio-auth.js";
import { sendBookingEmail, sendWithConfig, sendBroadcast, sendPaymentEmail, type EmailKind } from "../lib/email.js";
import { getInvoiceSettings, saveInvoiceSettings, createInvoice, renderInvoiceHtml, renderInvoiceDocument, renderInvoicePdf, listInvoices, listInvoicesSince, renderInvoicesXls, renderVatReportXls, renderTeacherPayoutXls, getInvoice } from "../lib/invoice.js";
import { ensureCalendar, saveLessons, getStatus as getCalendarStatus, buildIcs, getLessons, type Lesson } from "../lib/calendar.js";
import { reqBaseUrl } from "../lib/req-url.js";
import { pushLessons } from "../lib/gcal.js";
import { emailBrandSeed } from "../lib/actions.js";
import { resolveSmtpConfig, explainSmtpError } from "../lib/email-config.js";
import { generateEmailBrand, loadEmailBrand } from "../lib/email-brand.js";
import type { WritePlan, FileRole, IntentForEnforcement } from "../lib/write-plan.js";
export type { WritePlan, FileRole, IntentForEnforcement } from "../lib/write-plan.js";
export { checkWritePlanViolation } from "../lib/write-plan.js";

const router = Router();

// Tolerant parser: LANGUAGE line is optional, and the language may instead sit
// on the opening fence (e.g. ```html). Handles CRLF and extra fence metadata.
const FILE_BLOCK_REGEX =
  /FILE:\s*(.+?)\s*\r?\n(?:LANGUAGE:\s*(.+?)\s*\r?\n)?```([\w+-]*)[^\n]*\r?\n([\s\S]*?)```/g;

// Patch format: PATCH: path\nOP: <op>\n[ANCHOR: <anchor>]\n```lang\n<patch>\n```
const PATCH_BLOCK_REGEX =
  /^PATCH:\s*(.+?)\s*\r?\n(?:OP:\s*(.+?)\s*\r?\n)?(?:ANCHOR:\s*(.+?)\s*\r?\n)?```[\w+-]*[^\n]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

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
    // Present as a real browser — many sites (and bot-checks) reject non-browser requests.
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
      "Upgrade-Insecure-Requests": "1",
      Referer: safe.origin + "/",
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    };
    // Retry once on a transient network failure (a flaky connection / temporary block).
    let res: Awaited<ReturnType<typeof safeFetch>> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 700));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMPORT_FETCH_TIMEOUT_MS);
      try {
        res = await safeFetch(safe.toString(), { redirect: "manual", dispatcher: importDispatcher, signal: controller.signal, headers });
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && err.name === "AbortError") break; // timeout → don't retry
      } finally {
        clearTimeout(timer);
      }
    }
    if (!res) {
      if (lastErr instanceof Error && lastErr.name === "AbortError") throw lastErr;
      const code = (lastErr as { cause?: { code?: string } } | undefined)?.cause?.code || (lastErr as Error | undefined)?.message || "onbekend";
      throw new Error(`Kon de website niet bereiken (${code}). De site weigert mogelijk automatische verzoeken vanaf onze server, of is tijdelijk onbereikbaar. Probeer het later opnieuw of importeer een andere pagina.`);
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

  // Remove elements that load/execute embedded documents from unknown origins.
  $("base, frame, frameset, object, portal, applet").remove();

  // Inject a <base href> so that any remaining relative URLs inside scripts or
  // CSS that we couldn't statically rewrite still resolve against the original
  // site. Must be the first element in <head>.
  $("head").prepend(`<base href="${baseUrl}">`);


  // Scripts: strip inline scripts and pure analytics/tracking/ad scripts.
  // All other external scripts are KEPT — this preserves jQuery, Bootstrap,
  // Elementor frontend, Slick, Swiper, AOS, lightboxes, mega-menus, etc. so
  // that buttons, accordions, sliders, modals and other UI interactions work
  // in the preview. These scripts load from the original server (absolutized URL)
  // or from CDNs, and are sandboxed in the preview iframe (allow-scripts, no
  // allow-same-origin), so they cannot access our server's cookies or storage.
  // DEBUG: count scripts kept/removed — remove after debugging
  let _dbgInline = 0, _dbgTracking = 0, _dbgKept = 0;

  $("script").each((_, el) => {
    const $el = $(el);
    const src = ($el.attr("src") ?? "").trim();

    // Inline scripts: strip those that make HTTP calls, use document.write, or force
    // navigation — they fail or cause side-effects in the sandboxed preview.
    // Keep configuration scripts (wc_params, __NEXT_DATA__, theme vars) so external
    // theme JS that depends on those globals still initialises correctly.
    if (!src) {
      const code = ($el.html() ?? "").trim();
      const unsafe =
        /\bfetch\s*\(|\bnew\s+XMLHttpRequest\b|\$\s*\.ajax\b|\$\s*\.post\b|\$\s*\.get\s*\(|\baxios\s*[.(]|\bnew\s+Request\s*\(/i.test(code) ||
        /\bdocument\.write\s*\(/i.test(code) ||
        /\blocation\s*(?:\.href\s*=|\.replace\s*\(|\.assign\s*\()/i.test(code);
      if (unsafe) { $el.remove(); _dbgInline++; }
      return;
    }

    const lsrc = src.toLowerCase();

    // Strip analytics, tracking, advertising, and error-monitoring scripts —
    // these serve no purpose in a preview and may slow down or break the iframe.
    if (/google-analytics\.com|googletagmanager\.com|doubleclick\.net|hotjar\.com|clarity\.ms|facebook\.com\/tr|omnisend|klaviyo|intercom\.io|segment\.io|segment\.com|mixpanel\.com|amplitude\.com|heap\.io|fullstory\.com|mouseflow\.com|crazyegg\.com|newrelic\.com|datadog\.com|sentry\.io|bugsnag\.com|rollbar\.com|logrocket\.com|inspectlet\.com|lucky\s*orange|pingdom\.com|speedcurve\.com|nr-data\.net|js\.hs-scripts\.com|hs-analytics\.net|hubspot\.com\/hs|cookiebot|onetrust|quantcast|yandex\.ru\/metrica|bat\.bing\.com|snap\.licdn\.com/i.test(lsrc)) {
      $el.remove(); _dbgTracking++; return;
    }

    // Keep everything else — theme JS, jQuery, Bootstrap, Elementor, sliders,
    // lightboxes, carousels, animation libs, social embeds, maps, etc.
    // The src URL is absolutized below in the generic attribute-rewrite loop.
    _dbgKept++;
  });

  console.log(
    `[preview] prepareImportedHtml | ${baseUrl} | ` +
    `inline stripped: ${_dbgInline} | tracking stripped: ${_dbgTracking} | external kept: ${_dbgKept}`
  );

  // Iframes: keep legitimate cross-origin embeds (YouTube, Vimeo, Google Maps,
  // booking widgets, etc.) — they run in their own browsing context and cannot
  // touch our preview's origin. Only strip tracking/invisible/dangerous iframes.
  $("iframe").each((_, el) => {
    const $el = $(el);
    const src  = ($el.attr("src")    ?? "").trim();
    const srcdoc = $el.attr("srcdoc");

    // srcdoc embeds a whole document in the same (opaque) origin — strip.
    if (srcdoc !== undefined)          { $el.remove(); return; }
    // javascript: URLs execute in the parent context — strip.
    if (/^javascript:/i.test(src))     { $el.remove(); return; }
    // Tracking/analytics pixels — unnecessary noise.
    if (/googletagmanager\.com|google-analytics\.com|doubleclick\.net|facebook\.com\/tr|hotjar\.com|clarity\.ms/i.test(src)) {
      $el.remove(); return;
    }
    // Invisible iframes (tracking fallbacks, zero-size pixels).
    const style  = ($el.attr("style")  ?? "").toLowerCase();
    const width  = ($el.attr("width")  ?? "");
    const height = ($el.attr("height") ?? "");
    if (/visibility\s*:\s*hidden|display\s*:\s*none/.test(style) ||
        /^["']?0["']?$/.test(width) || /^["']?0["']?$/.test(height)) {
      $el.remove(); return;
    }
    // Safe: keep the iframe as-is (YouTube, Vimeo, Maps, booking services, etc.)
    // Remove srcdoc defensively in case it snuck through a weird attribute encoding.
    $el.removeAttr("srcdoc");
  });
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
      // Drop srcdoc (embeds a whole document in the same opaque origin).
      if (lname === "srcdoc") { $el.removeAttr(name); continue; }
      // Drop form/navigation event handlers that could submit to the original backend,
      // but KEEP other event handlers (onclick on buttons/divs) so UI scripts work.
      if (lname === "onsubmit" || lname === "onformdata") { $el.removeAttr(name); continue; }
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
      } else if (lname === "style") {
        // Rewrite url() inside inline style attributes so background-image GIFs,
        // background videos, and other CSS asset references resolve correctly.
        $el.attr(name, attribs[name].replace(
          /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
          (_m, q, rawUrl) => `url(${q}${absolutizeUrl(rawUrl.trim(), baseUrl)}${q})`,
        ));
      }
    }
  });

  // Rewrite url() inside <style> blocks so CSS background-image, @font-face,
  // cursor references etc. use absolute URLs and load inside the sandboxed iframe.
  $("style").each((_, el) => {
    const $el = $(el);
    const css = $el.html() ?? "";
    const rewritten = css.replace(
      /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
      (_m, q, rawUrl) => `url(${q}${absolutizeUrl(rawUrl.trim(), baseUrl)}${q})`,
    );
    if (rewritten !== css) $el.html(rewritten);
  });

  return $.html();
}

// Detect bot-protection challenge pages, JS-only SPAs, and generic redirect
// pages — these look like valid 200 responses but deliver no real content.
// Returns a string reason when blocked, null when the page looks real.
function detectBlockedPage(rawHtml: string): string | null {
  const lower = rawHtml.toLowerCase();

  // Cloudflare challenge / IUAM (Interstitial Under Attack Mode)
  if (
    lower.includes("cf-browser-verification") ||
    lower.includes("cdn-cgi/challenge-platform") ||
    lower.includes("cdn-cgi/challenge") ||
    (lower.includes("just a moment") && lower.includes("cloudflare")) ||
    lower.includes("_cf_chl_opt") ||
    lower.includes("cf_clearance")
  ) return "cloudflare";

  // Akamai / Imperva / Datadome / PerimeterX bot challenges
  if (
    lower.includes("ak_bmsc") ||
    lower.includes("incap_ses") ||
    lower.includes("datadome") ||
    lower.includes("px-captcha") ||
    lower.includes("perimeterx")
  ) return "bot_protection";

  // Generic "Redirecting…" or "Please wait…" interstitials with almost no body text
  const bodyText = rawHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (
    bodyText.length < 600 &&
    /redirecting|please wait|just a moment|checking your browser|enable javascript|enable cookies/i.test(bodyText)
  ) return "redirect_interstitial";

  // React / Next.js / Vue SPA shells: almost no visible text, giant JS bundle refs
  if (
    bodyText.length < 400 &&
    (lower.includes("__next") || lower.includes("__nuxt") ||
     lower.includes('id="root"') || lower.includes('id="app"'))
  ) return "js_only_spa";

  return null;
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

  // Fail immediately if the homepage is a bot-protection challenge or a JS-only SPA.
  // Without this check the crawler would spend up to (IMPORT_MAX_PAGES / CONCURRENCY)
  // × IMPORT_FETCH_TIMEOUT_MS chasing challenge pages before the score check fires.
  const blockReason = detectBlockedPage(home.html);
  if (blockReason) {
    const msg =
      blockReason === "cloudflare"
        ? "Deze website is beveiligd door Cloudflare en blokkeert automatische toegang. Probeer een andere website, of beschrijf wat je wilt bouwen."
        : blockReason === "js_only_spa"
        ? "Deze website laadt zijn inhoud via JavaScript (React/Next.js) en kan niet geïmporteerd worden — er is geen zichtbare inhoud in de broncode. Beschrijf wat je wilt bouwen."
        : "Deze website blokkeerde de import (bot-beveiliging of redirect-pagina). Probeer een andere website, of beschrijf wat je wilt bouwen.";
    throw new Error(msg);
  }

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

// ── Preview page endpoint ─────────────────────────────────────────────────────
// Serves stored (possibly AI-modified) HTML for an imported site, with the
// <base href> rewritten to route all relative requests through the site-proxy.
// The iframe uses allow-same-origin so requests are same-origin (no CORS).
//
// GET /api/projects/:id/preview-page?page=index.html&sid=<session-id>
router.get("/projects/:id/preview-page", async (req, res) => {
  const projectId = Number(req.params.id);
  const page = (req.query.page as string) || "index.html";
  const sid = (req.query.sid as string) || "";

  const fileRows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const file = fileRows.find((f) => f.path === page) ?? fileRows.find((f) => f.path === "index.html");
  if (!file) { res.status(404).send("Page not found"); return; }

  let html: string = file.content;

  // Extract domain: prefer <base href>, fall back to most-common <a href> host
  const baseHrefMatch = html.match(/<base\s[^>]*href=["']([^"']+)["']/i);
  let domain = "";
  let hasBaseHref = false;
  if (baseHrefMatch) {
    try { domain = new URL(baseHrefMatch[1]).hostname.replace(/^www\./, "").toLowerCase(); hasBaseHref = true; } catch {}
  }
  if (!domain) {
    const counts = new Map<string, number>();
    const aRe = /<a\b[^>]*\bhref=["']https?:\/\/([^/"'?#]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = aRe.exec(html)) !== null) {
      const h = m[1].replace(/^www\./, "").toLowerCase();
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    if (counts.size > 0) {
      domain = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  // Fallback: a NEWLY created page (e.g. pages/bookings.html) has only relative links,
  // so no domain is detectable from it — but it references the imported site's CSS via
  // relative paths (../wp-content/...). Inherit the domain from the project's index.html
  // so a <base href> is injected and those stylesheets resolve through the proxy.
  // Without this the new page renders UNSTYLED ("layout heel anders en niet mooi").
  if (!domain && page !== "index.html") {
    const indexFile = fileRows.find((f) => f.path === "index.html");
    if (indexFile) {
      const ibase = indexFile.content.match(/<base\s[^>]*href=["']([^"']+)["']/i);
      if (ibase) { try { domain = new URL(ibase[1]).hostname.replace(/^www\./, "").toLowerCase(); } catch {} }
      if (!domain) {
        const counts = new Map<string, number>();
        const aRe = /<a\b[^>]*\bhref=["']https?:\/\/([^/"'?#]+)/gi;
        let m: RegExpExecArray | null;
        while ((m = aRe.exec(indexFile.content)) !== null) {
          const h = m[1].replace(/^www\./, "").toLowerCase();
          counts.set(h, (counts.get(h) ?? 0) + 1);
        }
        if (counts.size > 0) domain = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
    }
  }

  if (!domain) {
    // Cannot determine origin — not an imported site, return raw
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html); return;
  }

  // Rewrite or inject <base href> so ALL relative requests route through site-proxy
  if (hasBaseHref) {
    html = html.replace(
      /<base\s[^>]*href=["'][^"']*["'][^>]*>/i,
      `<base href="/api/site-proxy/${domain}/">`,
    );
  } else {
    // Old import — no base href present; inject one at the start of <head>
    html = html.replace(/<head[^>]*>/i, (m) => m + `<base href="/api/site-proxy/${domain}/">`);
  }

  // Strip Next.js/Nuxt/SvelteKit runtime scripts when detected.
  // These SPA frameworks read window.location.pathname during hydration. Since our
  // preview URL (/api/projects/…) doesn't match any real route on the origin site,
  // the framework renders a 404 component that wipes out the SSR-rendered HTML.
  // Removing the runtime keeps the server-rendered snapshot visible and intact.
  // Non-framework scripts (jQuery, Shopify theme.js, etc.) are NOT affected.
  const isNextJs = /<script\b[^>]*\bid=["']__NEXT_DATA__["']/i.test(html);
  const isNuxt   = /<script\b[^>]*\bid=["']__NUXT[^"']*["']/i.test(html) || /window\.__NUXT__/i.test(html);
  if (isNextJs) {
    html = html
      // Remove Next.js JS chunks — they blank the page by detecting the wrong URL
      .replace(/<script\b[^>]*\bsrc=["'][^"']*_next\/[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, "")
      // Remove the SSR data blob that triggers React hydration
      .replace(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>[\s\S]*?<\/script>/gi, "");
    // Keep <link rel="stylesheet" href=".../_next/static/css/..."> — those are CSS, not JS
  }
  if (isNuxt) {
    html = html
      .replace(/<script\b[^>]*\bsrc=["'][^"']*_nuxt\/[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<script\b[^>]*\bid=["']__NUXT[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, "");
  }

  // Build list of stored page keys so the navigation router can route within
  // the imported pages instead of following live links
  const storedKeys = fileRows.filter((f) => f.path.endsWith(".html")).map((f) => f.path);

  // Scripts injected into <head> (run before any site code)
  const sidJson = JSON.stringify(sid);
  const hostJson = JSON.stringify(domain);
  const keysJson = JSON.stringify(storedKeys);

  const injectScript = `
<style>[hidden]{display:none !important}img.lazyload,img.lazyloading,.lazyload,.lazyloading{opacity:1 !important}</style>
<script>
(function(){
"use strict";
// ── 1. Session header patcher ──────────────────────────────────────────────
// Rewrites absolute same-site URLs to go through /api/site-proxy/{domain}/
// and adds X-Preview-Session on every XHR/fetch so our proxy can forward
// the right cookies to the origin server.
var SID=${sidJson};
var HOST=${hostJson};
function nm(h){return(h||"").replace(/^www\./,"").toLowerCase();}
// Rewrite any URL (absolute same-site or relative) to go through site-proxy.
// Returns the rewritten proxy path, or null if the URL should not be proxied.
function rewriteUrl(url){
  var s=String(url);
  // Our own builder API (project actions, Stripe, the proxy itself) must NOT be proxied —
  // e.g. the booking app calls /api/projects/:id/stripe/... and that has to reach our server.
  if(/^\\/api\\//.test(s))return null;
  // Absolute URL
  var u;try{u=new URL(s);}catch(e){u=null;}
  if(u&&/^\\/api\\//.test(u.pathname)&&nm(u.hostname)===nm(location.hostname))return null;
  if(u){
    if((u.protocol!=="http:"&&u.protocol!=="https:")||nm(u.hostname)!==nm(HOST))return null;
    return"/api/site-proxy/"+u.hostname+u.pathname+u.search+u.hash;
  }
  // Protocol-relative
  if(s.startsWith("//"))return"/api/site-proxy/"+s.slice(2);
  // Root-relative (absolute path on same host)
  if(s.startsWith("/"))return"/api/site-proxy/"+HOST+s;
  // Page-relative — skip data: and blob: but proxy everything else
  if(/^(data:|blob:|javascript:|mailto:|tel:)/i.test(s))return null;
  try{var u2=new URL(s,"https://"+HOST+"/");return"/api/site-proxy/"+HOST+u2.pathname+u2.search+u2.hash;}catch(e2){}
  return null;
}
function addSid(h){
  if(!h)h={};
  if(typeof Headers!=="undefined"&&h instanceof Headers){h.set("X-Preview-Session",SID);}
  else{h=Object.assign({},h,{"X-Preview-Session":SID});}
  return h;
}
if(typeof fetch!=="undefined"){
  var _f=window.fetch.bind(window);
  window.fetch=function(inp,ini){
    var url=typeof inp==="string"?inp:(inp&&inp.url!=null?String(inp.url):String(inp));
    ini=ini?Object.assign({},ini):{};
    ini.headers=addSid(ini.headers);
    var px=rewriteUrl(url);
    if(px)return _f(px,ini);
    return _f(inp,ini);
  };
}
if(typeof XMLHttpRequest!=="undefined"){
  var _op=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    var args=Array.prototype.slice.call(arguments);
    var px=rewriteUrl(url);if(px)args[1]=px;
    _op.apply(this,args);
    try{this.setRequestHeader("X-Preview-Session",SID);}catch(e){}
  };
}

// ── 2. Multi-page navigation router ────────────────────────────────────────
// When the user clicks a link that maps to a stored page, postMessage the
// parent React app to switch pages instead of following the link live.
var KEYS=${keysJson};
function norm(h){return h.replace(/^www\./,"")}
function pageKey(pn){
  var p;try{p=decodeURIComponent(pn)}catch(e){p=pn}
  p=p.split("?")[0].split("#")[0].replace(/^\\/+|\\/+$/g,"").replace(/\\.(html?|php|aspx?)$/i,"");
  if(!p)return"index";
  var k=p.replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").toLowerCase();
  return k||"index";
}
document.addEventListener("click",function(e){
  if(window.__bdSelect)return; // select & edit mode owns clicks
  var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
  if(!a)return;
  if(e.defaultPrevented)return;
  var raw=(a.getAttribute("href")||"").trim();
  if(!raw||raw.charAt(0)==="#")return;
  if(/^(mailto:|tel:|sms:|javascript:)/i.test(raw))return;
  if(a.getAttribute("target")==="_blank")return; // links die bewust in een nieuw tabblad openen (bv. Stripe) niet onderscheppen
  var u;try{u=new URL(a.href,document.baseURI);}catch(err){return;}
  // Resolve the actual site path (strip our /api/site-proxy/{domain} prefix if present)
  var sitePath=u.pathname;
  if(u.hostname===location.hostname&&u.pathname.startsWith("/api/site-proxy/")){
    sitePath=u.pathname.replace(/^\\/api\\/site-proxy\\/[^\\/]+/,"");
  }
  // Direct match first: a stored path WITH its subdirectory (e.g. "pages/bookings.html").
  // pageKey() below flattens slashes to dashes, which would miss subdirectory pages.
  var direct=sitePath.replace(/^\\/+/,"").split("?")[0].split("#")[0];
  if(KEYS.indexOf(direct)>-1){
    e.preventDefault();
    try{parent.postMessage({__buildlyNav:direct},"*");}catch(err){}
    return;
  }
  // Is this a link to a stored page? (flat original imported pages)
  var fk=pageKey(sitePath)+".html";
  if(KEYS.indexOf(fk)>-1){
    e.preventDefault();
    try{parent.postMessage({__buildlyNav:fk},"*");}catch(err){}
    return;
  }
  // Same-site link not in stored pages → load live via site-proxy with our script injected.
  // This lets Shopify/WooCommerce product pages, blog posts, etc. load directly from the
  // real server through our proxy rather than being blocked with a toast.
  if(nm(u.hostname)===nm(HOST)){
    e.preventDefault();
    var liveUrl="/api/site-proxy/"+HOST+sitePath+"?__inject=1&__sid="+SID;
    if(u.search)liveUrl+="&"+u.search.slice(1);
    window.location.href=liveUrl;
    return;
  }
  // External (different domain) link → block and show toast.
  e.preventDefault();
  if(raw&&raw.charAt(0)!=="#"){
    var id="__bd_toast";
    var prev=document.getElementById(id);
    if(prev){clearTimeout(prev.__t);prev.parentNode&&prev.parentNode.removeChild(prev);}
    var el=document.createElement("div");el.id=id;
    el.textContent="Externe link geblokkeerd in previewmodus.";
    el.style.cssText="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(20,20,30,.92);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:2147483647;pointer-events:none;";
    document.body.appendChild(el);
    el.__t=setTimeout(function(){el.parentNode&&el.parentNode.removeChild(el);},3000);
  }
},true);

// ── 3. Form submissions ─────────────────────────────────────────────────────
document.addEventListener("submit",function(e){
  if(e.defaultPrevented)return;
  e.preventDefault();
},false);

// ── 4. Prevent SPA navigation from blanking the page ────────────────────────
// Next.js, Nuxt, etc. call history.pushState/replaceState to navigate.
// If the target path matches a stored page, hand off to the parent; otherwise
// swallow the call so the SPA cannot navigate away from the preview content.
(function(){
  var _ps=history.pushState.bind(history);
  var _rs=history.replaceState.bind(history);
  function onNav(orig,state,title,url){
    if(!url){try{orig(state,title,url);}catch(e){}return;}
    var s=String(url);
    var pn="";
    try{pn=new URL(s,document.baseURI).pathname;}catch(e){if(s.startsWith("/"))pn=s;}
    if(pn){
      if(pn.startsWith("/api/site-proxy/")){pn=pn.replace(/^\\/api\\/site-proxy\\/[^\\/]+/,"");}
      var fk=pageKey(pn)+".html";
      if(KEYS.indexOf(fk)>-1){
        try{parent.postMessage({__buildlyNav:fk},"*");}catch(e2){}
        return;
      }
    }
    // Unknown page: swallow the navigation so the SPA cannot blank the preview.
  }
  history.pushState=function(s,t,u){onNav(_ps,s,t,u);};
  history.replaceState=function(s,t,u){onNav(_rs,s,t,u);};
})();

// ── 5. Visual select & edit mode ────────────────────────────────────────────
// Parent toggles this with postMessage({__buildlySelectMode:true/false}). When on,
// hovering outlines elements and a click reports the element to the parent so it can
// run a DETERMINISTIC edit (change_text / replace_image) on the real code — no AI vision.
(function(){
  var ov=null,lbl=null,active=false;
  function ensure(){
    if(ov)return;
    ov=document.createElement("div");
    ov.style.cssText="position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.12);border-radius:3px;display:none;";
    lbl=document.createElement("div");
    lbl.style.cssText="position:fixed;z-index:2147483647;pointer-events:none;background:#2563eb;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:2px 8px;border-radius:4px;display:none;white-space:nowrap;";
    document.documentElement.appendChild(ov);document.documentElement.appendChild(lbl);
  }
  function pickable(t){return t&&t.nodeType===1&&t!==document.body&&t!==document.documentElement;}
  function kindOf(el){return el.tagName==="IMG"?"image":"text";}
  // Build a stable CSS selector for the clicked element so the server can edit THAT element.
  function esc(s){try{return (window.CSS&&CSS.escape)?CSS.escape(s):s.replace(/([^a-zA-Z0-9_-])/g,"\\\\$1");}catch(e){return s;}}
  function cssPath(el){
    if(el.id)return"#"+esc(el.id);
    var parts=[],node=el,depth=0;
    while(node&&node.nodeType===1&&node.tagName!=="BODY"&&node.tagName!=="HTML"&&depth<7){
      if(node.id){parts.unshift("#"+esc(node.id));break;}
      var tag=node.tagName.toLowerCase(),p=node.parentElement;
      if(p){
        var same=[];for(var i=0;i<p.children.length;i++){if(p.children[i].tagName===node.tagName)same.push(p.children[i]);}
        if(same.length>1)tag+=":nth-of-type("+(same.indexOf(node)+1)+")";
      }
      parts.unshift(tag);node=p;depth++;
    }
    return parts.join(">");
  }
  function place(el){
    var r=el.getBoundingClientRect();
    ov.style.display="block";ov.style.left=r.left+"px";ov.style.top=r.top+"px";ov.style.width=r.width+"px";ov.style.height=r.height+"px";
    lbl.textContent=(kindOf(el)==="image"?"Afbeelding":"Tekst")+" · "+el.tagName.toLowerCase();
    lbl.style.display="block";var ly=r.top-22;if(ly<2)ly=r.top+2;lbl.style.left=r.left+"px";lbl.style.top=ly+"px";
  }
  function hide(){if(ov){ov.style.display="none";lbl.style.display="none";}}
  function onMove(e){if(!active)return;var el=e.target;if(!pickable(el)){hide();return;}place(el);}
  function fileName(s){try{var u=new URL(s,document.baseURI);s=u.pathname;}catch(e){}s=s.split("?")[0].split("#")[0];var p=s.split("/");return p[p.length-1]||s;}
  function onClick(e){
    if(!active)return;var el=e.target;if(!pickable(el))return;
    e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();
    var k=kindOf(el),msg={__buildlySelected:true,kind:k,tag:el.tagName.toLowerCase(),selector:cssPath(el),cls:(el.getAttribute("class")||"").slice(0,160)};
    if(k==="image"){var src=el.getAttribute("src")||el.src||"";msg.src=el.src||src;msg.file=fileName(src);msg.alt=el.getAttribute("alt")||"";msg.w=el.naturalWidth||el.width||0;msg.h=el.naturalHeight||el.height||0;}
    else{msg.text=(el.textContent||"").replace(/\\s+/g," ").trim().slice(0,300);}
    try{parent.postMessage(msg,"*");}catch(err){}
  }
  function setActive(on){active=!!on;window.__bdSelect=active;if(active){ensure();document.body.style.cursor="crosshair";}else{document.body.style.cursor="";hide();}}
  window.addEventListener("message",function(e){var d=e&&e.data;if(!d||typeof d!=="object")return;if("__buildlySelectMode" in d)setActive(!!d.__buildlySelectMode);});
  document.addEventListener("mousemove",onMove,true);
  document.addEventListener("click",onClick,true);
  document.addEventListener("mousedown",function(e){if(active&&pickable(e.target)){e.preventDefault();e.stopPropagation();}},true);
  window.addEventListener("scroll",hide,true);
  // Self-activate if the preview URL says so (reliable — no dependency on parent timing).
  try{if(/[?&]edit=1(&|$)/.test(location.search))setActive(true);}catch(e){}
})();

})();
</script>`;

  // Insert inject at the very start of <head>
  html = html.replace(/<head[^>]*>/i, (m) => m + injectScript);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

function buildSystemPrompt(
  projectName: string,
  fileContext: string,
  learningsContext: string,
  importMode: "none" | "rebuild" | "edit" = "none",
  isFirstBuild = false,
  planBlock = "",
  intentCategory?: string,
): string {
  // A new-page request on an imported site must create a new FILE, not a section in
  // index.html. The normal "edit index.html only" incremental block is suppressed so
  // it cannot fight the NEW PAGE contract (planBlock + tool-level hard block).
  const isNewPageOnImport = isNewPageOnImportedSite(importMode, intentCategory);
  // Strict redesign contract for the FIRST rebuild of an imported site: improve
  // the LOOK only, never drop or restructure content, so a "make it prettier"
  // pass keeps every nav item, button, section, link, and the real copy. Only
  // applied in "rebuild" mode — "edit" mode already says "change only what's
  // asked", and pasting "improve the visuals" there would wrongly push a
  // redesign during a tiny follow-up edit.
  const importedBlock =
    importMode === "none"
      ? ""
      : isNewPageOnImport
      ? `NEW PAGE ON AN IMPORTED SITE — create a new FILE, do not edit index.html beyond its nav:
- The user wants a new page/tab. Call write_file("pages/<name>.html") with a complete standalone HTML document (copy the <head> CSS links and the nav/header from index.html so it matches the site, then add the page's own content).
- In index.html, make exactly ONE change with edit_file: add a single <a href="pages/<name>.html"> nav link. Do NOT add a <section>, hidden div, data-view attribute, or JS router case to index.html.
- COST RULE — only TWO tool calls are needed: (1) write_file the new page, (2) edit_file index.html for the nav link. Do NOT edit any other .html file. The other pages are protected originals, not the live site; editing them is wasted work and will be rejected.
- MATCH THE SITE'S STYLE — read index.html first and reuse its design: the SAME button classes, colours, fonts, border-radius and spacing the site already uses. Do NOT introduce a foreign palette (e.g. generic blue buttons) — buttons and form controls on the new page must look like they belong to this exact site. Prefer the site's existing CSS classes over new inline colours.
- The new page must be fully functional with realistic content visible on first load — never "coming soon".`
      : importMode === "edit"
      ? `INCREMENTAL EDIT: Apply ONLY the specific change asked. Use edit_file for targeted changes — keep all existing layout, sections, nav, copy, and styling exactly as-is. Existing image URLs in the files are fine to keep. Only call write_file or edit_file for files you actually change.
SURGICAL TARGETING — edit the file that OWNS the thing being changed: styling → the CSS file, script behaviour → the JS file, copy on a page → that page's file. Do NOT funnel every change into index.html; touch index.html only when the change is genuinely about index.html (its own markup or its nav).`
      : `SURGICAL AUGMENTATION — the imported HTML is the LIVE SITE. Do NOT rebuild or replace it. Use edit_file or write_file to add the requested feature to the existing index.html.

RULES:
- Keep ALL existing content, navigation, sections, images, and copy exactly as-is. Add or change ONLY what the user asked for.
- Insert new HTML (sections, forms, UI components) into the appropriate place using edit_file on index.html.
- Add required CSS as a <style> block inside index.html (via edit_file), or call write_file for a new styles.css if the styling is significant.
- Add required JavaScript as a <script> block at the end of <body> (via edit_file), or call write_file for a new script.js if the logic is significant.
- Only call write_file or edit_file for files you actually change.
- Never stub, "coming soon", or remove any existing section, navigation item, or element.
- The added feature must be fully functional with realistic sample data visible on first load.`;

  return `You are Buildly, an expert AI web app builder. Generate beautiful, fully-functional web apps for a project called "${projectName}", with clean, well-structured, modular code.${learningsContext}

EXECUTE IMMEDIATELY — NEVER DESCRIBE WITHOUT DOING:
When the user asks for any change or addition, implement it immediately using the tools. Never say "I will add X" without actually calling write_file or edit_file in the same turn. If something is ambiguous, make the most reasonable interpretation and build it. One request = one implementation, always.

USE TOOLS TO MAKE ALL CHANGES:
- read_file — read a project file before editing it. Confirm the exact text you want to change.
- write_file — create a NEW file, or fully replace an existing one when the change is large. Never use this for protected imported pages.
- edit_file — surgical replacement: finds old_string (must be exact and unique) and replaces it with new_string. Prefer this over write_file for targeted changes to existing files. If old_string is not found, call read_file first to confirm the exact text.
- delete_file — permanently delete a file. Always write_file to the new path BEFORE calling delete_file on the old path. Use when moving/renaming files.
- finish — call once when ALL requested changes are done, with a 1-2 sentence Dutch summary.

RULES:
- Always call read_file before edit_file when editing an existing file you haven't read yet this session.
- After write_file or edit_file, call read_file if you need to make further edits to the same file.
- Call finish exactly once, at the very end, after all tool calls are complete.
- Never leave a request partially implemented — check every requirement before calling finish.

You build COMPLETE, production-ready web apps — never demos, prototypes, or placeholders.

REFERENCE IMAGES (when the user attaches one or more images):
- Treat the attached image(s) as the PRIMARY visual brief — read them carefully and study the layout structure, color palette, typography, spacing/density, imagery style, button and component shapes, and overall mood.
- Build whatever the user asks, but styled to match the reference as closely as you can: reproduce its look and feel (colors, fonts, proportions, section structure, navigation pattern) so the result clearly belongs to the same brand/design language.
- The reference shows VISUAL direction only. Still build a real, fully-functional app per the runtime constraints below — every button, tab, menu, and link must actually work (do NOT produce a static, non-interactive mockup of the image).
- If the reference's palette/typography conflicts with the NEBULA DESIGN SYSTEM defaults below, the REFERENCE WINS for palette, type, and overall styling (the user is explicitly asking for that look); still keep the execution-quality, layout-discipline, and runtime-robustness rules.
- Recreate the design from scratch in your own clean code; never hotlink the reference image or any external asset URLs from it.

${importedBlock}

RUNTIME CONSTRAINTS (the app runs sandboxed in a browser iframe — respect these exactly):
- Vanilla JavaScript only — plain classic scripts. NO npm, NO build step, NO JSX/TSX, NO frameworks that need compiling.
- Load libraries via CDN only (Tailwind, Chart.js, etc.).
- Persist data with localStorage (no backend/Supabase is available in this sandbox).
- BOOKINGS / RESERVATIONS — two modes, never confuse them:

  ► EXTERNAL URL MODE (applies when the user provides an https:// booking URL):
    - NEVER build a fake booking calendar, fake class schedule, fake time slots, fake booking forms, or any invented booking state.
    - NEVER add a booking section, booking JavaScript, or localStorage booking data to index.html.
    - ONLY create a separate page (pages/bookings.html) that contains a clean call-to-action button linking to the external URL and/or an iframe embed of it.
    - ONLY add ONE nav link to index.html: <a href="pages/bookings.html">BOOKINGS</a> (or the label the user requested).
    - index.html must not change beyond that single nav link addition.
    - pages/bookings.html skeleton:
        <!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Bookings</title><link rel="stylesheet" href="styles/main.css"></head>
        <body><!-- nav --><main style="padding:80px 20px;text-align:center"><h1>Book a session</h1>
        <a href="BOOKING_URL" target="_blank" rel="noopener" style="display:inline-block;margin-top:24px;padding:14px 32px;background:#241f1a;color:#fff;border-radius:8px;text-decoration:none;font-size:1rem">Book now →</a>
        <!-- optionally: <iframe src="BOOKING_URL" width="100%" height="700" frameborder="0"></iframe> -->
        </main></body></html>

  ► BUILT-IN MODE (applies when no external booking URL is provided):
    TWO sub-cases — determine which before doing anything:

    ▸ SUB-CASE A — NEW PAGE ON EXISTING SITE (user has an existing site and asks to "add a bookings tab/page"):
      This is the most common case. The user wants ONE new page added to their site.
      - Create pages/bookings.html: a standalone page with a simple booking form (name + date + time fields, saves to localStorage, shows a list of saved bookings).
      - Add ONE nav link to EVERY existing .html file: <a href="pages/bookings.html">BOOKINGS</a>
      - DO NOT replace existing navbars with a dynamic island nav.
      - DO NOT add sections, JS routers, or data-view attributes to index.html.
      - DO NOT build a full multi-section booking system in index.html.
      This sub-case is triggered when: intent = new_page, project already has HTML files.
      The NEW PAGE RULE above governs this. Skip the FULL SPEC below.

    ▸ SUB-CASE B — STANDALONE BOOKING APP (user wants a booking system as the primary/only purpose):
      The user is building or rebuilding a site specifically to be a booking system.
      Follow the BOOKING/APPOINTMENT APP — FULL SPEC below.
      This sub-case is triggered when: intent = first_build AND user wants booking as the primary purpose.
      This is NOT triggered by: "add a bookings tab", "voeg een boekingspagina toe", or similar additive requests.

    - The form MUST show visible fields on first load — never an empty box.
    - NEVER embed Calendly, OpenTable, ResDiary, Acuity, or any service requiring an external account in built-in mode.

BOOKING / APPOINTMENT APP — FULL SPEC (SUB-CASE B ONLY — standalone booking app as primary purpose; NOT for adding a bookings tab to an existing site. If the user gave you an https:// booking URL, SKIP THIS ENTIRE SECTION and use EXTERNAL URL MODE above. If the user has an existing site and asks to add a bookings tab/page, SKIP THIS SECTION and use SUB-CASE A above):

══════════════════════════════════════════════════════
PAGE STRUCTURE — read this before writing a single line:
══════════════════════════════════════════════════════
The booking system lives on its OWN dedicated page: boeken.html (root level).
This page is COMPLETELY BLANK except for the dynamic island nav + the booking sections.

FORBIDDEN on boeken.html:
  ✗ Do NOT copy any content from index.html or other pages
  ✗ No hero section, no about section, no testimonials, no pricing, no footer content
  ✗ No <h1> page title sitting at the top or bottom of the page
  ✗ No decorative copy, no introductory text blocks
  ✗ Do NOT embed the homepage inside boeken.html in any way

boeken.html body contains ONLY:
  1. The dynamic island <nav> (at the very top, fixed position)
  2. A single <main> wrapper with the booking sections (calendar → time slots → form → confirmation → admin)
  3. <link> to styles + <script> to scripts — nothing else

CORRECT boeken.html skeleton:
  <!DOCTYPE html>
  <html lang="nl">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Boeken</title>
    <link rel="stylesheet" href="styles/main.css">
    <link rel="stylesheet" href="styles/nav.css">
    <link rel="stylesheet" href="styles/booking.css">
  </head>
  <body>
    <!-- ONLY the dynamic island nav + booking sections. Nothing else. -->
    <nav class="dynamic-island-nav" id="mainNav">
      <div class="nav-scroll-track">
        <!-- existing site links first, then booking tabs -->
      </div>
    </nav>
    <main class="booking-app" style="padding-top:80px">
      <section data-section="nieuw-boeken"><!-- calendar + time slots + form + confirmation --></section>
      <section data-section="mijn-boekingen" style="display:none"><!-- client bookings view --></section>
      <section data-section="beheer" style="display:none"><!-- admin panel --></section>
    </main>
    <script src="scripts/nav.js"></script>
    <script src="scripts/booking.js"></script>
  </body>
  </html>

══════════════════════════════════════════════════════
DYNAMIC ISLAND ON EVERY PAGE — the island must NOT disappear when navigating:
══════════════════════════════════════════════════════
After building boeken.html, update EVERY OTHER HTML file in the project:
  - Read each file (index.html, over.html, contact.html, pages/*.html, components/Header.html, etc.)
  - Remove the old <nav>/<header>/navbar from that file
  - Add the SAME dynamic island nav (with the same items including "Boeken"→boeken.html) to that file
  - Link styles/nav.css and scripts/nav.js in that file's <head>/<body>
Result: the floating pill nav appears on every page. Navigating between pages never loses the nav.

If a shared component file (components/Header.html) exists: update that ONE file and it propagates automatically.
If no shared component exists: edit each HTML file individually — do not skip any.

REQUIRED SECTIONS (all must be present and fully functional):
1. CALENDAR — a monthly calendar grid (pure JS, no external lib). Render day numbers in a 7-column grid. Highlight today. Disable past dates (grey, not clickable). Mark days that already have bookings with a small dot or count badge. Clicking an available day opens the time-slot view.
2. TIME SLOTS — after selecting a date, render a responsive grid of time slots (e.g. 09:00–17:30 in 30-minute intervals). Each slot is either: Available (clickable, warm-ink button), Booked (grey, not clickable), or Past (muted). Clicking an available slot opens the booking form.
3. BOOKING FORM — modal or panel that appears after slot selection. Required fields: Full Name, Email, Phone, Service / Type (select dropdown with 3–5 realistic options), Notes (optional textarea). Pre-fill and display the selected Date and Time prominently. Primary CTA: "Boek afspraak" / "Confirm Booking". On submit: validate, save to localStorage, show confirmation.
4. CONFIRMATION — a clear success state (in-page card, not a browser alert): date, time, service, name, a random 6-char confirmation code. Include a "Nieuwe boeking" / "Book another" link.
5. ADMIN PANEL — a separate tab/section (toggle with a nav link or keyboard shortcut). Shows: today's bookings count, this week's count, total upcoming. A sortable table/list of ALL bookings (date, time, client name, service, status). Each row has a "Annuleer" / "Cancel" button. Cancelled bookings show struck-through. Sorting: by date (default), by name.
6. DATA MODEL — store as array in localStorage key "nebula_bookings". Each booking: { id, date, time, service, name, email, phone, notes, status: "confirmed"|"cancelled", createdAt, confirmationCode }.
7. SEED DATA — on first load (localStorage empty), pre-populate with 8 realistic bookings (mix of past and future, 2 of them cancelled) so the app looks used and real, not empty.
8. NAVIGATION — MANDATORY: replace every existing navbar on the page with a DYNAMIC ISLAND. This is non-negotiable. Do it even if the user did not explicitly ask for it.

  ══════════════════════════════════════════════════════
  TOOL SEQUENCE — execute IN THIS ORDER, no shortcuts:
  ══════════════════════════════════════════════════════
  a) read_file every HTML file and component file that contains a <nav>, <header>, or navbar element.
  b) Write down (mentally) every existing nav link: label + href. Example found: Home→index.html, Over→over.html, Contact→contact.html.
  c) write_file / edit_file to ADD the dynamic island (below) BEFORE <body> closes, containing:
       [all extracted existing links] + [Nieuw boeken] + [Mijn boekingen] + [Beheer]
  d) In the SAME file edit: DELETE the entire old <nav>/<header>/navbar block. Every tag, every line. Nothing left.
  e) Repeat steps a-d for EVERY HTML file in the project (including pages/*.html and components/*.html).
     There must be ZERO old navbars in ANY file after you are done.

  ══════════════════════════════════════════════════════
  CONCRETE EXAMPLE — before and after:
  ══════════════════════════════════════════════════════

  BEFORE (old nav that must be completely deleted):
    <header class="site-header">
      <nav class="navbar">
        <ul>
          <li><a href="index.html">Home</a></li>
          <li><a href="over.html">Over ons</a></li>
          <li><a href="diensten.html">Diensten</a></li>
          <li><a href="contact.html">Contact</a></li>
        </ul>
      </nav>
    </header>

  AFTER (dynamic island — the ONLY nav on the page):
    <nav class="dynamic-island-nav" id="mainNav">
      <div class="nav-scroll-track">
        <a href="index.html"    class="nav-item active">Home</a>
        <a href="over.html"     class="nav-item">Over ons</a>
        <a href="diensten.html" class="nav-item">Diensten</a>
        <a href="contact.html"  class="nav-item">Contact</a>
        <a href="#"  class="nav-item" data-view="nieuw-boeken">Nieuw boeken</a>
        <a href="#"  class="nav-item" data-view="mijn-boekingen">Mijn boekingen</a>
        <a href="#"  class="nav-item" data-view="beheer">Beheer</a>
      </div>
    </nav>
    <!-- OLD <header>/<nav> IS GONE — completely removed, not hidden, not commented out -->

  ══════════════════════════════════════════════════════
  CSS — write to styles/nav.css (create if needed, link in <head>):
  ══════════════════════════════════════════════════════
    .dynamic-island-nav {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      width: max-content;
      max-width: calc(100vw - 32px);
      background: rgba(18, 18, 24, 0.85);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid rgba(255,255,255,0.11);
      border-radius: 100px;
      padding: 5px 6px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.40), inset 0 0 0 0.5px rgba(255,255,255,0.07);
      transition: background 0.25s ease, box-shadow 0.25s ease;
    }
    .nav-scroll-track {
      display: flex;
      align-items: center;
      gap: 2px;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
      padding: 0 6px;
      mask-image: linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%);
      -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%);
    }
    .nav-scroll-track::-webkit-scrollbar { display: none; }
    .nav-item {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      flex-shrink: 0;
      padding: 7px 15px;
      border-radius: 100px;
      font-size: 13px;
      font-weight: 500;
      color: rgba(255,255,255,0.52);
      text-decoration: none;
      transition: background 0.16s ease, color 0.16s ease;
      cursor: pointer;
      letter-spacing: 0.01em;
    }
    .nav-item:hover  { color: rgba(255,255,255,0.88); background: rgba(255,255,255,0.08); }
    .nav-item.active { color: #fff; font-weight: 600; background: rgba(255,255,255,0.15); }
    body { padding-top: 68px; }
    /* scroll-shrink */
    .dynamic-island-nav.scrolled {
      background: rgba(10,10,16,0.93);
      box-shadow: 0 4px 18px rgba(0,0,0,0.55), inset 0 0 0 0.5px rgba(255,255,255,0.05);
    }
    /* light-mode override (add class="dynamic-island-nav light" when site background is white/light) */
    .dynamic-island-nav.light {
      background: rgba(246,246,248,0.90);
      border-color: rgba(0,0,0,0.09);
      box-shadow: 0 4px 24px rgba(0,0,0,0.10), inset 0 0 0 0.5px rgba(0,0,0,0.05);
    }
    .dynamic-island-nav.light .nav-item       { color: rgba(0,0,0,0.45); }
    .dynamic-island-nav.light .nav-item:hover  { color: #000; background: rgba(0,0,0,0.06); }
    .dynamic-island-nav.light .nav-item.active { color: #000; background: rgba(0,0,0,0.10); }

  ══════════════════════════════════════════════════════
  JAVASCRIPT — write to scripts/nav.js (link in every HTML file):
  ══════════════════════════════════════════════════════
    (function() {
      var nav = document.getElementById('mainNav');
      if (!nav) return;

      // Scroll-shrink
      window.addEventListener('scroll', function() {
        nav.classList.toggle('scrolled', window.scrollY > 40);
      }, { passive: true });

      // Active state for page links (highlight current page)
      var currentFile = location.pathname.split('/').pop() || 'index.html';
      document.querySelectorAll('.nav-item[href]').forEach(function(a) {
        var href = a.getAttribute('href').split('/').pop();
        if (href && href === currentFile && !a.dataset.view) a.classList.add('active');
      });

      // View-switcher for booking tabs (items with data-view="...")
      var viewItems = document.querySelectorAll('.nav-item[data-view]');
      viewItems.forEach(function(item) {
        item.addEventListener('click', function(e) {
          e.preventDefault();
          var view = this.dataset.view;
          viewItems.forEach(function(i) { i.classList.remove('active'); });
          this.classList.add('active');
          document.querySelectorAll('[data-section]').forEach(function(s) {
            s.style.display = (s.dataset.section === view) ? '' : 'none';
          });
        });
      });

      // Show first booking view on load
      if (viewItems.length) viewItems[0].click();
    })();

  ══════════════════════════════════════════════════════
  HARD RULES — enforced after every file write:
  ══════════════════════════════════════════════════════
  - After writing, scan each file for <header, <nav, class="navbar", id="navbar", class="nav-menu" — if found outside .dynamic-island-nav, DELETE that block immediately.
  - The page may contain exactly ONE nav: .dynamic-island-nav. Zero old navs. Zero duplicates.
  - Link the new styles/nav.css and scripts/nav.js in the <head>/<body> of EVERY HTML file edited.
  - Items with real hrefs navigate normally. Items with data-view switch booking views via JS. Never give a page-link item data-view; never give a view-switcher item a real href.

DESIGN — follow the Nebula Design System. Calendar cells: compact, clean grid. Time slots: pill-shaped buttons in a tight 3–4 column grid. Forms: single-column, wide inputs, generous vertical spacing. Admin table: zebra-stripe rows, compact, readable.
- VIDEOS: use YouTube or Vimeo iframe embeds: <iframe src="https://www.youtube.com/embed/VIDEO_ID" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0"></iframe>. If no real VIDEO_ID is provided, use a placeholder image instead — never a broken or invisible embed.
- MAPS: use a Google Maps embed iframe (<iframe src="https://www.google.com/maps/embed?pb=...">). For interactive maps with markers, use Leaflet.js from CDN. NEVER use the Google Maps JavaScript API (it requires a billing key).
- CONTACT FORMS: self-contained — collect fields, store in localStorage, show a thank-you message. NEVER submit to Formspree, Netlify Forms, Zapier, or any external endpoint.
- SOCIAL MEDIA FEEDS / POSTS: generate realistic static sample posts as styled cards. NEVER embed Twitter/X widgets, Instagram feeds, or Facebook plugins — they require authentication and show nothing in the sandbox.
- REVIEWS / TESTIMONIALS: generate realistic sample testimonials as styled cards. NEVER embed Trustpilot, Google Reviews, or any external review widget.
- PRICING / PAYMENT: show pricing cards. NEVER embed Stripe, PayPal, or payment forms that require a real account.
- EVERYTHING MUST BE VISIBLE on first load — no section may be empty, hidden behind an uninitialized widget, or dependent on an external API call.
- "Pages"/routing — TWO different strategies depending on the project structure:
  • SINGLE-HTML PROJECT (project has only index.html, no other .html pages): for new_feature and visual_tweak requests — single-page app inside index.html with client-side view switching (hash routing or show/hide sections). CRITICAL EXCEPTION for new_page requests (adding a booking page, a contact page, an about page, etc.): ALWAYS create a new standalone .html file (e.g. pages/bookings.html) even when the project currently only has index.html. Add ONLY a nav link to index.html. The project becomes multi-HTML. Never inject a <section>, hidden div, or show/hide block into index.html as a substitute for a real page file.
  • MULTI-HTML PROJECT (project already has 2 or more .html files, e.g. index.html + over.html + contact.html): maintain the multi-page structure. A new page = a new standalone .html file. The navigation link in EVERY existing .html file must also be updated. Never collapse a multi-page site into a single index.html SPA — the other .html files must stay separate and intact.

FILE STRUCTURE — split into MULTIPLE well-organized files by concern, never one giant file:
  - index.html — homepage entry point, always at ROOT level (never in pages/)
  - pages/*.html — inner pages: pages/over-mij.html, pages/contact.html, etc.
  - components/*.html — reusable HTML FRAGMENTS (NOT full documents): components/BookingSection.html, components/Header.html, etc.
  - styles/main.css — shared styling. Feature-specific: styles/booking.css, styles/nav.css, etc.
  - scripts/main.js — shared logic. Feature-specific: scripts/booking.js, scripts/navigation.js, etc.
  - assets/images/, assets/fonts/ — static assets

COMPONENT INCLUDES — how to use HTML components in pages:
  From index.html (root):       <div data-include="components/BookingSection.html"></div>
  From pages/*.html (one level): <div data-include="../components/BookingSection.html"></div>
  The preview system inlines the component content automatically at build time.
  Components must be HTML FRAGMENTS — no DOCTYPE, no <html>, no <head>, no <body> wrapper.
  Keep components pure: no inline <style> or <script> — put CSS in styles/, JS in scripts/.

PATH RULES — relative paths from each location:
  index.html (root):  href="styles/main.css"  src="scripts/main.js"  data-include="components/Foo.html"
  pages/*.html:       href="../styles/main.css" src="../scripts/main.js" data-include="../components/Foo.html" href="../pages/contact.html"

MOVING A FILE (e.g. old-page.html → pages/old-page.html):
  1. read_file("old-page.html") to get the content
  2. write_file("pages/old-page.html", <updated content with corrected relative paths>)
  3. delete_file("old-page.html")
  4. edit_file every other file that links to the old path

  - EDITING EXISTING PROJECT: if the project already uses flat files (styles.css, script.js at root), KEEP that structure — never move or rename existing files. Only new files you create should follow the subdirectory pattern.
- index.html must reference siblings like: <link rel="stylesheet" href="styles/main.css"> and <script src="scripts/main.js"></script> (and <script src="scripts/router.js"></script> etc.)
- CRITICAL — DO NOT use ES module syntax for your OWN local files: no \`type="module"\`, and no \`import\`/\`export\` statements between your own .js files. The preview inlines each local <script src> into the page as a CLASSIC script (in the order listed), so a local \`import './store.js'\` will NOT resolve and silently breaks EVERY button and interaction. Instead: write plain classic scripts, list them in dependency order in the HTML, and share state across files through ONE global namespace (e.g. \`window.App = window.App || {}\`). Wrap each file's internals in an IIFE to avoid leaking locals. (You MAY still import a third-party LIBRARY from a CDN over https.)
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

NEBULA DESIGN SYSTEM — this is the house style. Apply it EXACTLY to EVERY generated app so everything feels like a calm, premium, editorial product crafted by a high-end studio — LIGHT, serene, warm and elegant, never generic AI output. Use these precise values; do not invent a different palette unless the user explicitly asks for one or provides a reference image to match.

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
- NO dead buttons or links — every interactive element must actually work, across the ENTIRE site (every view, tab, and section), and it must STILL all work after any restyle or "make it prettier" / "maak mooier" pass. A button that looks nice but does nothing is a FAILURE.
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
- When regenerating after a fix request, call write_file with the complete corrected content — always a full file replacement, never a partial write.

CONSISTENCY ON EDITS (when current project files already exist below):
- READ FIRST: Before editing any existing file, call read_file on it. Use the actual content you receive — never guess at class names, IDs, or structure.
- SCOPED BUT COMPLETE EDITS: Change what the user asked about — and do it FULLY, whatever it takes. If they ask to MOVE a block up/down, REORDER sections, REPOSITION or OVERLAP an element, place text over an image, WIDEN/RESIZE a section, or otherwise RESTRUCTURE the layout of the part they mention, then actually do it — rewrite that element's/section's markup and CSS (position, order, flex/grid, margins, z-index, absolute positioning) as needed. Do NOT refuse or water down a layout/structure request. The only rule: leave parts of the page the user did NOT mention untouched.
- OUTPUT ONLY CHANGED FILES: Do not emit a file unless you actually modified it. Emitting an unchanged file replaces it verbatim and can corrupt content that is visible in the preview but not fully represented in your context window.
- This is an EDIT to an existing app, not a fresh build. If the existing files already follow the BUILDLY DESIGN SYSTEM above, keep matching it exactly. If they predate it and use a different look, preserve that app's established design language (palette, typography, spacing, component styles) so the result stays visually cohesive — do NOT re-theme or migrate it onto the Buildly system unless the user explicitly asks. Either way, only elevate the parts you actually touch.
- Fully satisfy the request — including layout/structure changes (moving a block up, changing order, repositioning, overlapping text, widening a section). Do not redesign or restructure UNRELATED parts of the app, and do not drop existing features or seeded data.
- Keep all existing files and their working behavior intact; only change what the request requires.
- NEVER remove or empty out buttons, links, CTAs, or sections that were already in the app. Every button/CTA/link that existed before MUST still be present AND fully working after your change — same label and destination unless the user explicitly asked to change it. A "make it prettier" / "maak mooier" pass may RESTYLE these, but must keep every single one of them and keep them all functioning.
- NEVER leave a section as just a heading with nothing under it. Unless the user explicitly asked to remove that section, if a section exists (e.g. "What I offer" / "Dit bied ik aan", Services, Pricing, Contact), it MUST keep its real text AND its buttons/cards/links — a heading followed by empty space, missing copy, or missing buttons is a FAILURE. Restyle a section, never accidentally gut it.
- When you make the site look better, the WHOLE site must still work end-to-end after the redesign: every button, tab, menu item, form, and link across every view actually functions — mentally click through each one before you output.

ACCESSIBILITY & UX (always):
- Every input has an associated <label>; every icon-only button has an aria-label; images have meaningful alt text.
- Fully keyboard operable: logical tab order, visible focus states, Enter/Escape work in dialogs and forms. Use semantic elements (button, nav, main, header) — never click handlers on bare <div>s.
- Ensure readable color contrast (WCAG AA) for text and interactive elements in the chosen palette.
- Provide instant feedback: disable buttons while busy, show inline validation, confirm destructive actions, and use subtle toasts/messages for success/failure.

PRE-FLIGHT BEFORE EDITING ANY EXISTING FILE:
These steps are MANDATORY before every edit_file call on an existing file you have not yet read this session:
1. Call read_file("<path>") and study the actual content.
2. Locate the EXACT text you want to change — copy it character-for-character from the read_file output.
3. Make old_string at least 2–3 full lines long (include surrounding context lines) so it is guaranteed to be unique in the file. A single short line is almost never unique and will match the wrong place.
4. If old_string is not found, call read_file again and pick a different, longer anchor.

NAV STYLE MATCHING — CRITICAL (apply whenever adding any nav link or tab to an existing app):
1. Call read_file on the HTML file first.
2. Find ONE existing nav item in the markup — note its EXACT tag names, class names, href/onclick pattern, aria attributes, and any data-* attributes.
3. Your new nav item must be a VERBATIM COPY of that existing item — same tags, same class names, same attribute names and values — with ONLY the visible text and the link target changed. NEVER invent new class names, a different tag, or a different structure. Example: if existing nav items are '<a href="#about" class="nav-link" data-view="about">Over</a>', your new item is '<a href="#bookings" class="nav-link" data-view="bookings">Boeken</a>'.
   ⚠ EXCEPTION — NEW PAGE (new_page intent, e.g. adding Bookings, Pricing, Contact as a top-level tab):
   The href is NOT copied verbatim. It MUST be a file path: href="pages/bookings.html" (not "#bookings", not "javascript:void(0)", not "#").
   Do NOT copy a hash-based href for a new page file. The page must physically exist as a file.
   Do NOT remove or modify data-view/onclick attributes on the copy — just change href and text.
   Do NOT add a router case, a section toggle, or a show/hide handler for the new page.
4. If the nav uses a JS-driven active-state indicator (a sliding pill, a class toggled on click), extend THAT SAME mechanism for the new item — read script.js to see how it works, then add the new case to that switch/if-else.
   ⚠ EXCEPTION — NEW PAGE: do NOT add a router case or JS view-swap handler for the new page item. The href="pages/bookings.html" link navigates the browser to a real file — no JS router needed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEW PAGE RULE — ABSOLUTE (no exceptions, no override by any other rule below)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If navigation receives a new top-level item — e.g.:
  Home | About | Pricing | Bookings | Contact

→ CREATE A NEW PAGE FILE (e.g. write_file("pages/bookings.html", ...))
→ ADD ONE NAV LINK to each existing HTML file (href="pages/bookings.html")
→ NOTHING ELSE changes in index.html or any other existing file

DO NOT:
  ✗ Create a <section> in index.html for the new tab
  ✗ Create an <a href="#bookings"> anchor link
  ✗ Create a hidden <div> or display:none block in index.html
  ✗ Extend the homepage JS router (no new case, no show/hide handler)
  ✗ Add data-view="bookings" or any JS view-swap logic for the new tab
  ✗ Use localStorage, sessionStorage, or in-memory state for the new tab

This rule takes precedence over NAV STYLE MATCHING, STEP B, STEP C, STEP D,
HOW TO BUILD IT RIGHT, and every other rule in this prompt.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ADDING A NEW PAGE / NAVIGATION TAB (apply this whenever the user asks to "add a page", "add a tab", "maak een nieuwe pagina", "voeg navigatie toe", "add [PageName] to the menu", or any equivalent):

▸ SINGLE-HTML PROJECT (only index.html exists — no other .html pages):
Adding a page converts the project to multi-HTML. Do NOT inject sections into index.html.
All THREE changes are required:
1. NEW PAGE FILE — call read_file("index.html") to copy the <head>, <header>/<nav>, and <footer>. Then call write_file("pages/[pagename].html") with a complete standalone HTML document styled identically to index.html.
2. NAV LINK IN INDEX.HTML — call edit_file on index.html to insert the new nav link (href="pages/[pagename].html") right after the last existing nav item. DO NOT add a <section>, hidden div, or show/hide logic — only the nav link.
3. VERIFY — the new page file pages/[pagename].html must exist on disk. A user clicking the nav link must land on that file, not a section inside index.html.
FORBIDDEN: do NOT add any of the following to index.html: <section id="[pagename]">, display:none divs for the new page, JS router extensions for the new page, localStorage booking state, or any content that belongs in the new page file.

▸ MULTI-HTML PROJECT (project has 2+ .html files — e.g. index.html, over.html, diensten.html, contact.html):
ALL of the following tool calls are required — missing any one produces a broken or incomplete site:
1. NEW PAGE FILE — call read_file("index.html") to copy the <head>, <header>/<nav>, and <footer>. Then call write_file("[pagename].html") with a complete standalone HTML document that looks identical to the rest of the site.
2. NAV UPDATE IN EVERY EXISTING .html FILE — call read_file on each existing .html file, then call edit_file to add the new nav link. Do NOT only update index.html — every page must have the same nav.
3. LINK FORMAT — in a multi-page site, links are plain href="[pagename].html" (relative path), NOT hash links like "#bookings".
CRITICAL: if the project has 5 .html files, you must make 5 edit_file calls (one nav update per file) PLUS 1 write_file call for the new page. Updating only index.html is a failure.
SELF-VERIFY: can a user on over.html click the new nav link and reach [pagename].html? If not, you missed an edit_file call.

REFACTORING AN IMPORTED SITE into proper project structure (when user asks to "reorganize", "structureer", "maak een nette structuur", "component-based maken", etc.):
DO THIS IN ORDER:
1. read_file on ALL .html pages to understand the common structure (header, nav, footer, cookie banner).
2. Identify the LARGEST repeated block — the header/nav is usually biggest. Create it as a fragment: write_file("components/Header.html", <just the header HTML, no DOCTYPE/html/head/body>).
3. For each original .html page: edit_file to REPLACE the repeated header block with <div data-include="components/Header.html"></div> (adjust path prefix for pages in pages/).
4. Extract feature-specific CSS to styles/*.css and JS to scripts/*.js using write_file, then edit_file the pages to reference them.
5. Move pages to pages/*.html: write_file("pages/foo.html", content-with-updated-paths), delete_file("foo.html"). Keep index.html at ROOT.
6. Verify every page: all links between pages work (prefix with ../ or pages/ as needed), all component includes resolve, CSS/JS paths are correct.
PROOF OF CONCEPT FIRST: before restructuring all pages, do ONE page + ONE component so the user can verify the preview works. Get approval, then extend to the rest.

FILE-AWARE SURGICAL EDITING — always classify the request BEFORE touching any file:

STEP 1 — CLASSIFY the request (pick ONE):
  A. STYLING       — colors, fonts, sizes, layout, spacing, hover effects
  B. CONTENT/TEXT  — text or copy change on a specific named page
  C. COMPONENT     — shared element: header, footer, nav, cookie banner, booking form
  D. INTERACTION   — button logic, form behavior, animations, JS features
  E. NEW FEATURE   — a new section, page, or functional capability
  F. HOMEPAGE      — change explicitly about the main/home page (index.html)

STEP 2 — SELECT the minimum set of target files:
  A. STYLING       → Edit styles/*.css (most specific CSS file). NEVER add <style> blocks to HTML.
  B. CONTENT/TEXT  → Edit the ONE .html page named in the request (pages/[page].html). NOT index.html for inner-page content.
  C. COMPONENT     → Edit components/[Name].html ONLY. Change propagates to all pages automatically via data-include.
  D. INTERACTION   → Edit scripts/[feature].js ONLY. NEVER add inline <script> to HTML when a JS file exists.
  E. NEW FEATURE   → Create component + CSS + JS; then edit_file the ONE page that includes this feature.
  F. HOMEPAGE      → index.html is correct.

STEP 3 — READ each target file with read_file before editing.
STEP 4 — MAKE THE SMALLEST CHANGE: prefer edit_file on existing files over write_file.

INDEX.HTML — ONLY the correct target when:
  - The request is explicitly about the homepage / hoofdpagina / de voorpagina / main page.
  - The project has ONLY index.html (no pages/ directory).
  - A shared nav/footer change is needed AND no components/ directory exists.
  When in doubt: consult the PROJECT MAP at the top of the file context, then pick the most specific file — not index.html.

JS-RENDERED CONTENT — CRITICAL: when the app uses JavaScript to render or swap content (innerHTML, template literals, data objects, view objects, router patterns), ANY change to visible content MUST update BOTH the HTML and the JavaScript data source simultaneously.

  HOW TO DETECT: before editing, read every .js file. Look for patterns like:
    const views = { home: "...", about: "...", lesroosters: "..." }
    const pages = { ... }
    function renderPage(name) { container.innerHTML = pages[name]; }
    router patterns: hashchange / pushState handlers that swap content
    template strings / multi-line strings that contain visible text or HTML

  RULE: if visible content is controlled by JavaScript, the HTML file alone is NOT the source of truth.
    - Modifying only the HTML means the JS will overwrite it the moment the user clicks a nav link.
    - You MUST edit the JavaScript data/template that drives the view for that section.
    - Never leave the JS and HTML out of sync. The user will click a nav item and see the old content.

  HOW TO BUILD IT RIGHT: when creating navigation with multiple views/sections:
    ⚠ EXCEPTION — NEW PAGE (new_page intent, e.g. adding Bookings, Pricing, Contact as a top-level nav tab):
    Do NOT use client-side view swapping. Do NOT add JS router cases. Do NOT add show/hide section logic.
    Instead: write_file("pages/bookings.html") → standalone HTML file → browser navigates to it via href.
    The patterns below (renderPage, hashchange, data objects) are for new_feature within an existing SPA only.
    ────────────────────────────────────────────────────────────────────────────────
    - Store all view content as a JavaScript object or array (single source of truth)
    - The initial HTML render calls the same render function as navigation clicks
    - Example: renderPage('home') on load AND on nav click — same function, same data

ANTI-PATTERNS — NEVER:
  - Edit index.html for changes that belong in pages/ or components/.
  - Add inline <style> to HTML when styles/*.css already exists.
  - Add inline <script> to HTML when scripts/*.js already exists.
  - Rewrite an entire file for a small text or style change.
  - Duplicate CSS that already exists in the stylesheet.
  - Edit every page when only a shared component file needs to change.
  - Modify visible HTML content without also updating the JavaScript that controls that view.
  - Create a navigation system where the initial HTML and the JS-rendered HTML are different strings.

PAGE STRUCTURE ANALYSIS — before touching ANY file, read every target file and mentally map it:

STEP A — INVENTORY the page sections. For each HTML file you are about to edit, list:
  - Every top-level <section>, <div id="...">, <div class="...">, <header>, <footer>, <nav>
  - Their ids, class names, and visible purpose (hero, about, booking, contact, cta, testimonials, pricing, footer…)

STEP B — DUPLICATE CHECK. Before adding anything new, ask for each category:
  - Booking / reservations / appointments — does a section, form, or widget already exist?
  - Contact form — does one already exist?
  - CTA / call-to-action — does one already exist?
  - Navigation item for this feature — does one already exist?
  If YES → do NOT create a new one. Instead: improve, replace, or extend the existing one.
  ⚠ EXCEPTION — NEW PAGE (new_page intent): skip this step entirely. A new top-level page tab
  creates a new FILE, not a section. Do not check for existing sections. Do not "improve" a section.
  Go directly to ADDING A NEW PAGE below.

STEP C — EDIT PRIORITY (in order, stop at the first that applies):
  ⚠ EXCEPTION — NEW PAGE (new_page intent, e.g. "add a Bookings tab", "maak een Bookings pagina"):
  Skip STEP C entirely. The answer is NEVER "add a new section to index.html". It is ALWAYS:
  write_file("pages/bookings.html", ...) → then edit_file("index.html") nav link only.
  ────────────────────────────────────────────────────────────────────────────────
  For all other intents (new_feature, edit_existing, visual_tweak, bug_fix):
  1. Improve / fix the existing section for this feature
  2. Extend the existing section (add a field, tab, or step to it)
  3. Replace the existing section's content with the new version
  4. Add a NEW section — only if no suitable section exists at all

STEP D — PLACEMENT RULE for new sections:
  Never inject content randomly between existing elements.
  Pick the single most logical anchor point: after the last related section, before the footer, or at a clearly empty spot.
  Write a clean container first (<section id="feature-name"></section>) then build inside it.
  ⚠ EXCEPTION — NEW PAGE: do not apply STEP D. New page content goes in a new file, not a section.

STEP E — LAYOUT CONSISTENCY. Before writing new markup, note the existing patterns:
  - Flex/grid conventions already in use
  - Spacing classes (padding, margin, gap) used by sibling sections
  - Color and typography conventions
  New elements must mirror these conventions — not introduce a foreign visual style.

NO DUPLICATE RULE — hard constraint:
  A page may have AT MOST ONE of each of: booking section, contact form, CTA banner, each nav item.
  If adding one would create a second, modify the existing one instead — no exceptions.

MAKING A BUTTON OR MENU-ITEM FUNCTIONAL — strict rules, no exceptions:

  WHAT THE USER ASKS: "make the BOOKINGS button work", "fix the nav link", "the menu item doesn't do anything"
  WHAT THIS MEANS: change only the <a> or <button> tag itself. Nothing else.

  RULE 1 — touch only the link tag:
    WRONG: add a new <section id="bookings"> full of content
    RIGHT: change <a href="#">BOOKINGS</a>  →  <a href="#bookings">BOOKINGS</a>
    One tag. One attribute. Done.

  RULE 2 — check before adding anything:
    After fixing the link, check whether id="bookings" already exists in the page.
    grep the full file for id="bookings" (or whatever the target id is).
    - Found → done. The link now scrolls to the existing element.
    - Not found → add a MINIMAL anchor placeholder at the BOTTOM of <body>, above </footer>:
        <section id="bookings"></section>
      This is invisible and takes no space. Do NOT add a heading, form, or any content.
      A visible section with content is only allowed if the user explicitly asked to build one.

  RULE 3 — remove accidental sections:
    If a previous edit already added a large booking/feature section near the top of the page
    (between the nav and the first real content section), REMOVE that block entirely.
    It was added by mistake. The original page layout must be restored.

  RULE 4 — anchor validation before finishing:
    For every internal link on the page (href="#something"):
      Verify that id="something" exists somewhere in the same HTML file.
      If the target id is missing, add the minimal placeholder from RULE 2.
      Never leave a broken anchor that scrolls nowhere.

  RULE 5 — smooth scroll via CSS only:
    If the page does not already have scroll-behavior: smooth, add exactly this to the stylesheet:
      html { scroll-behavior: smooth; }
    Nothing more. No JS scroll library, no scrollIntoView calls.

  RULE 6 — id uniqueness:
    A page may have AT MOST ONE element with any given id.
    If id="bookings" already exists, never add a second one.
    If it appears twice, remove the duplicate (keep the one with real content, or the first).

FINAL SELF-CHECK (verify before calling finish — a broken app is a failure):
- Every sibling file you reference in index.html (<link href>, <script src>) has been written with write_file, and every file you write is referenced. No dangling references, no orphan files.
- All href/src to your own files use relative paths (e.g. "styles/main.css", "scripts/main.js") — never absolute paths or external URLs for local assets. Match the structure of existing files in the project.
- The app runs with ZERO uncaught console errors and every interactive element works.
- The requested feature is fully implemented end-to-end, with realistic seed data visible on first load.
- RE-READ THE USER'S REQUEST: confirm every specific thing asked for is implemented. If anything is missing, make the additional edit_file or write_file calls before calling finish.

OUTPUT FORMAT:
Schrijf in vloeiend, natuurlijk Nederlands — beknopt, direct, zonder herhaling. Spreek de eigenaar aan zoals een vakkundige collega dat doet: zeg wat je doet, doe het, ga door. Geen "Ik ga nu...", geen samenvattingen achteraf, geen wollige inleidingen.

Structuur:
1. Één korte openingszin over wat je aanpakt.
2. Gebruik de tools direct — lees wat nodig is, maak alle wijzigingen, roep finish aan zodra alles klaar is.${planBlock}${fileContext}`
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
// Bounded so the imported context (which is embedded INTO the system prompt) plus the
// base prompt stays well under the model's 200K-token input window, leaving room for
// chat history and the response. Dense HTML tokenizes to ~2.7 chars/token, so 100K
// chars ≈ ~37K tokens of imported context.
const IMPORTED_CONTEXT_MAX_CHARS = 100_000;
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

// Extract the raw <nav> or <header> HTML from a page so the AI can write
// accurate PATCH blocks targeting its exact structure and classes.
function extractNavHtml(html: string): string {
  // Prefer the primary <nav> element; fall back to the whole <header>
  const navRe = /<nav\b[\s\S]*?<\/nav>/gi;
  let best = "";
  let m: RegExpExecArray | null;
  while ((m = navRe.exec(html)) !== null) {
    if (m[0].length > best.length) best = m[0];
  }
  if (best) return best.slice(0, 1500);
  const header = (html.match(/<header\b[\s\S]*?<\/header>/i) || [])[0];
  return (header ?? "").slice(0, 1500);
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

// ── Component extraction helpers ──────────────────────────────────────────────

function extractTagBlock(html: string, tag: string): string | null {
  // Lazy match so we get the first occurrence only (avoids catastrophic backtracking
  // on pages with multiple sections while still handling multiline content).
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? m[0].trim() : null;
}

function extractCookieBannerBlock(html: string): string | null {
  // First try: element whose id/class explicitly names cookie/gdpr/consent.
  const re = /<(?:div|section|aside)\b[^>]*(?:id|class)=["'][^"']*(?:cookie|gdpr|consent|privacy)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section|aside)>/i;
  const m = html.match(re);
  return m ? m[0].trim() : null;
}

function extractAllStyleBlocks(html: string): string {
  const out: string[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const c = m[1].trim();
    if (c) out.push(c);
  }
  return out.join("\n\n");
}

function extractInlineScriptBlocks(html: string): string {
  const out: string[] = [];
  // Only inline scripts — those without a src attribute.
  const re = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const c = m[1].trim();
    if (c) out.push(c);
  }
  return out.join("\n\n");
}

// ── End component extraction helpers ──────────────────────────────────────────

// True once an imported site has been rebuilt into a standalone SPA. A raw
// WordPress import is .html-only, so the presence of any non-HTML editable file
// (styles.css / script.js produced by the first "make it prettier" pass) means
// later requests are INCREMENTAL edits — feed the SPA files raw and change only
// what's asked, never re-distill and rebuild from scratch.
function importedSpaRebuilt(files: { path: string; content: string }[]): boolean {
  const htmlFiles = files.filter((f) => f.path.toLowerCase().endsWith(".html"));
  if (htmlFiles.length === 0) return false;
  // Once ANY of our edits exist (a created page like pages/bookings.html, or extracted
  // styles/scripts), every later build must run in EDIT mode and feed the CURRENT files —
  // never re-distill index.html from the original import, which wipes added nav links and
  // orphans created pages. This is the preview-persistence fix.
  return importedSiteHasEdits(files.map((f) => f.path));
}

// Build the file context for an imported site. First pass = a DISTILLED brief of
// every page (titles, headings, key copy, real image URLs) so the model rebuilds
// a clean single-page app without drowning in raw HTML. After the SPA exists,
// switch to an INCREMENTAL edit that feeds the SPA files raw. Either way every
// original content page (all .html except index.html) is returned as "omitted"
// so it is preserved verbatim for WXR re-export.
function buildImportedContext(
  files: { path: string; content: string }[],
  intentCategory?: string,
): {
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
    // Send current SPA files for direct editing. Bounded by the imported-context
    // budget (not the much larger raw-file budget) so a big CSS/JS file cannot blow
    // past the model's input window — non-HTML files are capped per file too.
    for (const f of editableFiles) {
      const raw = f.path.toLowerCase().endsWith(".html")
        ? extractKeyHtmlSections(f.content)
        : f.content.slice(0, PER_PAGE_MAX_CHARS);
      const block = `--- ${f.path} ---\n${raw}`;
      if (used + block.length + 2 > IMPORTED_CONTEXT_MAX_CHARS) continue;
      blocks.push(block);
      used += block.length + 2;
    }

    // Also include distilled summaries of the original scraped pages so the model
    // can draw on real headings, copy, and image URLs when adding or expanding tabs.
    const scraped = htmlFiles.filter((f) => protectedSet.has(f.path.toLowerCase()));
    const pageSummaries: string[] = [];
    for (const f of scraped) {
      const title = extractPageTitle(f.content, f.path);
      const headings = extractHeadings(f.content);
      const paras = extractParagraphs(f.content).slice(0, 6);
      const imgs = extractPageImages(f.content).slice(0, 4);
      let summary = `=== SOURCE PAGE: ${f.path} ===\nTitle: ${title}\n`;
      if (headings.length) summary += `Headings:\n${headings.slice(0, 10).map((h) => `- ${h}`).join("\n")}\n`;
      if (paras.length) summary += `Copy:\n${paras.map((p) => `- ${p}`).join("\n")}\n`;
      if (imgs.length) summary += `Images:\n${imgs.map((u) => `- ${u}`).join("\n")}\n`;
      summary = summary.slice(0, 4000);
      if (used + summary.length + 2 > IMPORTED_CONTEXT_MAX_CHARS) break;
      pageSummaries.push(summary);
      used += summary.length + 2;
    }

    // For a new-page/new-tab request, the SPA framing must NOT win: a new tab is a
    // NEW standalone file (pages/xxx.html), never a hidden section bolted into index.html.
    const newPageDirective = intentCategory === "new_page"
      ? `\n\n⚠ NEW PAGE / NEW TAB REQUEST — this overrides the single-page-app framing above:\n` +
        `- Create a NEW standalone file (e.g. pages/bookings.html) with write_file. Do NOT add a section, hidden div, or data-view router case to index.html.\n` +
        `- In index.html, change ONLY the navigation: add ONE <a href="pages/xxx.html"> link. Nothing else in index.html may change.\n` +
        `- The new file is a complete HTML document: copy the <head> (CSS links) and the nav/header from index.html so it matches the site, then add the page's own content.\n` +
        `- A clicked nav link must navigate the browser to the new file — never toggle a section inside index.html.`
      : "";

    const context =
      `\n\nThis project was imported from a real website and has ALREADY been rebuilt into the single-page app below. ` +
      `Make the change the user asks for — and do it FULLY. If they ask to move/reorder/reposition/overlap/resize/restructure the part they mention, actually change its layout (markup + CSS: order, position, flex/grid, margins, z-index, absolute positioning). Keep everything the user did NOT mention exactly as it is. ` +
      `Do NOT redesign or re-theme the whole page or touch unrelated parts. Output only the file(s) you actually modify.` +
      `\nSURGICAL TARGETING: edit the file that owns the thing being changed — styling → the CSS file, a script behaviour → the JS file, page copy → the page that contains it. Do NOT funnel every change into index.html; touch index.html only when the change is actually about index.html (its markup or its nav).` +
      newPageDirective +
      `\n\nCurrent project files (modify these as needed):\n${blocks.join("\n\n")}` +
      (pageSummaries.length
        ? `\n\nOriginal scraped pages (reference content for tabs/sections — do NOT output these files):\n${pageSummaries.join("\n\n")}`
        : "");
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
    // All non-index pages are protected — never overwrite the original scraped pages.
    if (f.path.toLowerCase() !== "index.html") omitted.push(f.path);

    let block: string;
    if (f.path.toLowerCase() === "index.html") {
      // Send actual stripped HTML so the model can make surgical edits directly into it.
      const strippedHtml = stripHtml(f.content).slice(0, 20000);
      block = `=== FILE: ${f.path} (MODIFY THIS) ===\n${strippedHtml}`;
    } else {
      // Distilled summary for all other pages — context only, never output them.
      const title = extractPageTitle(f.content, f.path);
      const desc = extractMetaDescription(f.content);
      const headings = extractHeadings(f.content);
      const paras = extractParagraphs(f.content);
      const ctas = extractCtas(f.content);
      const embeds = extractEmbeds(f.content);
      const socials = extractSocialLinks(f.content);
      const imgs = extractPageImages(f.content);

      const navHtml = extractNavHtml(f.content);
      block = `=== PAGE: ${f.path} (protected — use edit_file to update its nav only, never write_file) ===\nTitle: ${title}\n`;
      if (desc) block += `Description: ${desc}\n`;
      if (headings.length) block += `Headings:\n${headings.map((h) => `- ${h}`).join("\n")}\n`;
      if (paras.length) block += `Key copy:\n${paras.map((p) => `- ${p}`).join("\n")}\n`;
      if (ctas.length) block += `Buttons / CTAs:\n${ctas.map((c) => `- ${c}`).join("\n")}\n`;
      if (embeds.length) block += `Embedded media:\n${embeds.map((e) => `- ${e}`).join("\n")}\n`;
      if (socials.length) block += `Social links:\n${socials.map((s) => `- ${s}`).join("\n")}\n`;
      if (imgs.length) block += `Real images (reuse EXACT URLs):\n${imgs.map((u) => `- ${u}`).join("\n")}\n`;
      if (navHtml) block += `Navigation HTML (use this to write an accurate edit_file call that adds the new nav link):\n${navHtml}\n`;
      block = block.slice(0, PER_PAGE_MAX_CHARS);
    }

    if (used + block.length + 2 > IMPORTED_CONTEXT_MAX_CHARS) break;
    blocks.push(block);
    used += block.length + 2;
  }

  const navLine = nav.length ? `Main navigation: ${nav.join(" · ")}\n\n` : "";
  const otherHtmlPaths = ordered.filter(f => f.path.toLowerCase() !== "index.html").map(f => f.path);
  const context =
    `\n\nThis project was imported from a real website with ${ordered.length} HTML page(s): ${ordered.map(f => f.path).join(", ")}.\n` +
    `Rules for this multi-page site:\n` +
    `- index.html: call write_file for a full rewrite, or edit_file for a surgical change.\n` +
    `- Other .html pages (${otherHtmlPaths.join(", ") || "none"}): use edit_file ONLY to update their navigation — do NOT use write_file for these (their full content is protected).\n` +
    `- New pages (e.g. bookings.html): call write_file — they don't exist yet so they are not protected.\n` +
    `- When adding a new page: (1) write_file("[newpage].html"), (2) edit_file index.html to add the nav link, (3) edit_file each other .html page to add the nav link. All three steps are required.\n` +
    `Keep ALL existing content, navigation, sections, images, and copy intact — add or change ONLY what the user asked for.\n\n` +
    navLine +
    blocks.join("\n\n");

  return { context, omitted };
}

function buildProjectManifest(files: { path: string; content: string }[]): string {
  if (files.length === 0) return "";

  const pages = files.filter(f => f.path.endsWith(".html") && !f.path.startsWith("components/"));
  const components = files.filter(f => f.path.startsWith("components/"));
  const styles = files.filter(f => f.path.endsWith(".css"));
  const scripts = files.filter(f => f.path.endsWith(".js"));
  const assets = files.filter(f => f.path.startsWith("assets/"));

  const lines: string[] = ["PROJECT MAP:"];
  if (pages.length)      lines.push(`  Pages:      ${pages.map(f => f.path).join(", ")}`);
  if (components.length) lines.push(`  Components: ${components.map(f => f.path).join(", ")}`);
  if (styles.length)     lines.push(`  Styles:     ${styles.map(f => f.path).join(", ")}`);
  if (scripts.length)    lines.push(`  Scripts:    ${scripts.map(f => f.path).join(", ")}`);
  if (assets.length)     lines.push(`  Assets:     ${assets.map(f => f.path).join(", ")}`);

  // Detect which components are included in which pages
  const includeRe = /data-include=["']([^"']+)["']/g;
  const componentUsers = new Map<string, string[]>();
  for (const f of pages) {
    includeRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = includeRe.exec(f.content)) !== null) {
      const normalized = m[1].replace(/^(\.\.\/)+/, "");
      const users = componentUsers.get(normalized) ?? [];
      users.push(f.path);
      componentUsers.set(normalized, users);
    }
  }

  if (componentUsers.size > 0) {
    lines.push("  Shared components:");
    for (const [comp, users] of componentUsers) {
      lines.push(`    ${comp} → included in: ${users.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function buildFileContext(
  files: { path: string; content: string }[],
  imported = false,
  intentCategory?: string,
): {
  context: string;
  omitted: string[];
} {
  if (files.length === 0) return { context: "", omitted: [] };
  if (imported) return buildImportedContext(files, intentCategory);
  return buildRawFileContext(files);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\bdata-[\w-]+=(?:"[^"]*"|'[^']*'|\S+)/g, "")
    .replace(/\bstyle="[^"]*"/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

function extractKeyHtmlSections(html: string): string {
  const s = stripHtml(html);
  const take = (re: RegExp, limit: number): string => (s.match(re)?.[0] ?? "").slice(0, limit);
  const nav  = take(/<(?:nav|header)\b[^>]*>[\s\S]*?<\/(?:nav|header)>/i, 800);
  const hero = take(/<section\b[^>]*>[\s\S]*?<\/section>/i, 1500);
  const main = take(/<main\b[^>]*>[\s\S]*?<\/main>/i, 2000);
  const parts = [nav, hero, main].filter(Boolean);
  return parts.length ? parts.join("\n") : s.slice(0, 3500);
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
    const content = f.path.toLowerCase().endsWith(".html") ? extractKeyHtmlSections(f.content) : f.content;
    const block = `${header}${content}`;
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
      `The following files were omitted from the context — do NOT call write_file for these filenames (you can't see their full content, so overwriting them would corrupt them). ` +
      `You may call edit_file on them for targeted nav updates if needed:\n` +
      omitted.map((p) => `- ${p}`).join("\n");
  }

  const manifest = buildProjectManifest(files);
  return {
    context: `\n\n${manifest}\n\nCurrent project files (modify these as needed):\n${included.join("\n\n")}${note}`,
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
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      system: [{ type: "text" as const, text:
        "You analyze a user's correction/adjustment request for an AI-generated web app and extract ONE short, GENERALIZABLE design or engineering rule that would help build better apps in the future. " +
        "Write it as a single imperative sentence (max 25 words) that applies to apps in general, NOT to this specific app's content. " +
        "Ignore one-off, app-specific content changes (e.g. 'rename this button to X', 'change this text'). " +
        "If there is no generalizable lesson, reply with exactly NONE.",
        cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user", content: userAdjustment }],
    });
    const lesson = (response.content[0]?.type === "text" ? response.content[0].text : "").trim();
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

type AnthropicImageSource = {
  type: "base64";
  media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
};
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: AnthropicImageSource };
type ChatMsg = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};
// Anthropic only accepts "user" | "assistant" roles in the messages array.
// System messages are extracted and passed as the top-level `system` parameter.
type AnthropicMsg = { role: "user" | "assistant"; content: string | ContentPart[] };

function toAnthropicMsgs(msgs: ChatMsg[]): AnthropicMsg[] {
  return msgs.filter((m) => m.role !== "system") as AnthropicMsg[];
}
type CachedSystemParam = Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }>;
function extractSystem(msgs: ChatMsg[]): CachedSystemParam | undefined {
  const sys = msgs.find((m) => m.role === "system");
  const text = typeof sys?.content === "string" ? sys.content : undefined;
  if (!text) return undefined;
  return [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }];
}

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
        ...images.flatMap((dataUrl): ContentPart[] => {
          const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i);
          if (!match) return [];
          const rawType = match[1].toLowerCase().replace("jpeg", "jpeg") as AnthropicImageSource["media_type"];
          return [{ type: "image", source: { type: "base64", media_type: rawType, data: match[2] } }];
        }),
      ],
    };
    return;
  }
}

const MAX_GENERATION_TOKENS = 16384;
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
        logger.warn({ err, attempt, label }, "API call failed; retrying");
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
    const response = await withRetry(
      () =>
        anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 30,
          system: [{ type: "text" as const, text:
            "Create a short, catchy product name (2-4 words, Title Case) for the app the user describes. Reply with ONLY the name — no quotes, punctuation, or explanation.",
            cache_control: { type: "ephemeral" as const } }],
          messages: [{ role: "user", content: prompt }],
        }),
      "project-name",
    );
    const name = (response.content[0]?.type === "text" ? response.content[0].text : "")
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
// (stop_reason === "max_tokens") so large multi-file apps don't get saved half-written.
async function generateWithContinuation(messages: ChatMsg[]): Promise<string> {
  let full = "";
  const system = extractSystem(messages);
  const apiMsgs = toAnthropicMsgs(messages);
  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    const response = await withRetry(
      () =>
        anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: MAX_GENERATION_TOKENS,
          ...(system ? { system } : {}),
          messages: apiMsgs as Parameters<typeof anthropic.messages.create>[0]["messages"],
        }),
      "sync-completion",
    );
    const part = response.content[0]?.type === "text" ? response.content[0].text : "";
    full += part;
    if (response.stop_reason !== "max_tokens") break;
    if (round === MAX_CONTINUATIONS) {
      logger.warn(
        "Generation still truncated after continuation budget; last file may be incomplete",
      );
      break;
    }
    apiMsgs.push({ role: "assistant", content: part });
    apiMsgs.push({ role: "user", content: CONTINUE_PROMPT });
  }
  return full;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^---+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractNarration(raw: string): string {
  // Take the opening prose before the first FILE: or PATCH: block.
  const marker = raw.match(/^(FILE:|PATCH:)/m);
  const idx = marker?.index ?? -1;
  const head = (idx >= 0 ? raw.slice(0, idx) : raw)
    .replace(/```[\s\S]*$/, "")
    .replace(/LANGUAGE:\s*[^\n]+/g, "");
  return stripMarkdown(head) || "Ja, het is af. Alstublieft.";
}

// Quick post-generation check: did the code actually implement what was asked?
// Uses Haiku (fast/cheap). Returns null when satisfied, or a short description
// of what appears to be missing. Only runs for concrete follow-up requests —
// skips vague style/design requests and first builds.
async function quickVerify(
  request: string,
  generatedCode: string,
  writtenFiles: string[],
): Promise<string | null> {
  // Skip for vague requests, very long requests, or when nothing was written
  if (writtenFiles.length === 0) return null;
  if (request.length > 400) return null;
  if (/mooi(er)?|design|beter|mooier|stijl|layout|kleur|font|kleuren|style|prettier/i.test(request)) return null;

  try {
    const codeSample = generatedCode.slice(0, 1500);
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      messages: [{
        role: "user",
        content: `User requested: "${request.slice(0, 300)}"\n\nFiles written: ${writtenFiles.join(", ")}\n\nCode excerpt:\n${codeSample}\n\nWas the specific request fully implemented? Reply with exactly "YES" if complete, or "NO: [max 12 words on what's missing]" if not.`,
      }],
    });
    const text = (resp.content[0]?.type === "text" ? resp.content[0].text : "YES").trim();
    if (/^YES/i.test(text)) return null;
    return text.replace(/^NO:?\s*/i, "").trim().slice(0, 120) || null;
  } catch {
    return null; // verification is best-effort — never fail the build over it
  }
}

// ─── Multi-agent workflow types ───────────────────────────────────────────────
//
// Architecture:
//   IntentAgent → ArchitectureAgent → FilePlanner → CodeExecutor → Validator → RepairAgent
//
// Inspired by:
//   LangGraph  — state machine with conditional routing between phases
//   CrewAI     — each agent has a single role and structured output
//   OpenHands  — tools are the enforcement boundary; agents cannot bypass them

type IntentCategory =
  | "new_page"      // needs a new HTML file + nav update
  | "new_feature"   // adds functionality to existing pages
  | "edit_existing" // content/text change to existing files
  | "visual_tweak"  // CSS / style only
  | "bug_fix"       // fix broken behavior
  | "first_build";  // no files yet

type IntentResult = {
  category: IntentCategory;
  newPages: Array<{ filename: string; navLabel: string }>;
  targetFiles: string[];
  needsNavUpdate: boolean;
  complexity: "low" | "medium" | "high";
  bookingUrls: string[]; // any booking/iframe URLs found in the request
};

type BuildPlan = {
  filesToCreate: Array<{ path: string; purpose: string }>;
  filesToEdit: Array<{ path: string; reason: string }>;
  navUpdate: { files: string[]; addItem: { label: string; href: string } } | null;
  executionOrder: string[];
  strategy: string;
};

// WritePlan: per-file constraints enforced at the TOOL level.
// Defined in lib/write-plan.ts and re-exported above.
// FileRole and WritePlan types come from that module.

type ValidationSeverity = "hard_fail" | "warning";

type ValidationIssue = {
  type:
    | "content_in_wrong_file"  // page content placed in index.html
    | "missing_new_page"       // required new page was not created
    | "only_index_edited"      // new_page task but only index.html was touched
    | "broken_nav_link"        // href points to non-existent file
    | "missing_anchor"         // href="#id" with no matching id
    | "malformed_html"         // missing </html>
    | "duplicate_nav_item";    // nav label appears more than once
  severity: ValidationSeverity;
  file: string;
  detail: string;
};

type ValidationResult = {
  passed: boolean;     // true only when zero hard_fail issues
  hardFails: ValidationIssue[];
  warnings: ValidationIssue[];
};

// Workflow state machine (LangGraph-style)
type WorkflowPhase = "intent" | "architecture" | "execute" | "validate" | "repair" | "done" | "error";

type WorkflowState = {
  phase: WorkflowPhase;
  intent: IntentResult | null;
  buildPlan: BuildPlan | null;
  writePlan: WritePlan | null;
  repairAttempts: number;
};

// ─── Phase 1: Intent Agent (Haiku — fast classification, ~300ms) ──────────────

async function runIntentAgent(
  content: string,
  existingPaths: string[],
): Promise<IntentResult> {
  const fileList = existingPaths.length > 0 ? existingPaths.join(", ") : "none (first build)";
  // Extract URLs from the user's message for use in WritePlan enforcement
  const urlMatches = content.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `Classify this website builder request. Reply ONLY with valid JSON, no markdown.

User request: "${content.slice(0, 700)}"
Existing files: ${fileList}

JSON schema (reply with exactly this structure):
{
  "category": "new_page",
  "newPages": [{"filename": "pages/bookings.html", "navLabel": "Bookings"}],
  "targetFiles": ["index.html"],
  "needsNavUpdate": true,
  "complexity": "medium",
  "bookingUrls": ["https://example.com/book"]
}

category values:
- "new_page"      → user wants a new page/tab/route (bookings, pricing, about, contact, schedule, reservations, etc.)
- "new_feature"   → add functionality to an EXISTING, already-visible page (e.g. a gallery on the homepage, a form in an existing section)
- "edit_existing" → change text/images/content on existing pages
- "visual_tweak"  → CSS only (colors, fonts, spacing)
- "bug_fix"       → fix broken behavior
- "first_build"   → no existing files

CRITICAL DISAMBIGUATION (this is the most common mistake):
- The words "tab", "tabblad", "pagina", "page", "menu item" almost always mean new_page — NOT new_feature.
- A "tool", "widget", "form", or "systeem" requested ON a new tab/page is STILL new_page. The tool lives INSIDE the new page file. Example: "maak een bookings tab met een boekingstool" → new_page (filename "pages/bookings.html"), the booking tool goes inside that file.
- Only use new_feature when the user adds something to a page that ALREADY EXISTS and is NOT asking for a new tab/page/route.
- When unsure between new_page and new_feature, and the request mentions a tab/pagina/page → choose new_page.

IMPORTANT for new_page: set needsNavUpdate=true, filename as "pages/name.html"
bookingUrls: extract any https:// URLs mentioned in the request`,
      }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "{}";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON");
    const parsed = JSON.parse(match[0]) as IntentResult;
    // Always include URLs found in the raw message
    parsed.bookingUrls = [...new Set([...(parsed.bookingUrls ?? []), ...urlMatches])];
    return applyNewPageOverride(parsed, content, existingPaths);
  } catch {
    const fallback: IntentResult = {
      category: existingPaths.length === 0 ? "first_build" : "edit_existing",
      newPages: [],
      targetFiles: existingPaths.slice(0, 3),
      needsNavUpdate: false,
      complexity: "medium",
      bookingUrls: urlMatches,
    };
    // Even when the classifier fails, a clearly-phrased "new tab/page" request must
    // still create a file — never silently degrade to an index.html edit.
    return applyNewPageOverride(fallback, content, existingPaths);
  }
}

// Deterministic safety net: when the user unambiguously asks for a new page/tab,
// force category=new_page regardless of what the LLM classifier returned. This is
// the fix for "add a bookings TAB with a booking TOOL" being mislabeled new_feature
// (which writes into index.html) instead of new_page (which creates a new file).
function applyNewPageOverride(
  intent: IntentResult,
  content: string,
  existingPaths: string[],
): IntentResult {
  const detected = detectExplicitNewPage(content, existingPaths);
  if (!detected) return intent;
  if (intent.category === "new_page" && intent.newPages.length > 0) return intent;

  logger.info(
    { llmCategory: intent.category, forced: "new_page", detected },
    "[IntentAgent] deterministic new-page override applied",
  );
  return {
    ...intent,
    category: "new_page",
    newPages: intent.newPages.length > 0 ? intent.newPages : [detected],
    needsNavUpdate: true,
  };
}

// ─── Phase 2: Architecture Agent (Sonnet — concrete build plan) ───────────────

async function runArchitectureAgent(
  content: string,
  intent: IntentResult,
  existingPaths: string[],
): Promise<BuildPlan> {
  const fileList = existingPaths.join(", ") || "none";
  const htmlFiles = existingPaths.filter(p => p.endsWith(".html")).join(", ") || "none";
  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 900,
      messages: [{
        role: "user",
        content: `Create a concrete build plan. Reply ONLY with valid JSON.

User request: "${content.slice(0, 800)}"
Intent: ${intent.category}
New pages: ${JSON.stringify(intent.newPages)}
All existing files: ${fileList}
Existing HTML files: ${htmlFiles}

JSON schema:
{
  "filesToCreate": [{"path": "pages/bookings.html", "purpose": "Booking page with iframe embed"}],
  "filesToEdit": [{"path": "index.html", "reason": "Add nav link only — no booking content"}],
  "navUpdate": {
    "files": ["index.html"],
    "addItem": {"label": "Bookings", "href": "pages/bookings.html"}
  },
  "executionOrder": ["pages/bookings.html", "index.html"],
  "strategy": "Create standalone booking page with iframe, then add nav link to index.html"
}

Rules:
- filesToCreate: all new pages go in pages/ directory
- filesToEdit for index.html: ONLY nav link changes — never booking content
- navUpdate.files: ALL existing HTML files (consistency)
- executionOrder: new files first, index.html nav update last`,
      }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "{}";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON");
    const plan = JSON.parse(match[0]) as BuildPlan;
    // Postcondition: for new_page intent, filesToCreate must never be empty.
    // If the AI omitted it, synthesize from intent.newPages before any code runs.
    if (intent.category === "new_page" && (!plan.filesToCreate || plan.filesToCreate.length === 0) && intent.newPages.length > 0) {
      logger.warn({ intent: intent.category, newPages: intent.newPages }, "[ArchitectureAgent] filesToCreate was empty for new_page intent — synthesizing from intent.newPages");
      plan.filesToCreate = intent.newPages.map(p => ({ path: p.filename, purpose: p.navLabel }));
      if (!plan.executionOrder || plan.executionOrder.length === 0) {
        plan.executionOrder = [...intent.newPages.map(p => p.filename), ...existingPaths.filter(p => p.endsWith(".html"))];
      }
    }
    return plan;
  } catch {
    return {
      filesToCreate: intent.newPages.map(p => ({ path: p.filename, purpose: p.navLabel })),
      filesToEdit: existingPaths.filter(p => p.endsWith(".html")).map(p => ({ path: p, reason: "Update navigation" })),
      navUpdate: intent.newPages.length > 0 ? {
        files: existingPaths.filter(p => p.endsWith(".html")),
        addItem: { label: intent.newPages[0]?.navLabel ?? "New Page", href: intent.newPages[0]?.filename ?? "pages/new.html" },
      } : null,
      executionOrder: [...intent.newPages.map(p => p.filename), ...existingPaths.filter(p => p.endsWith(".html"))],
      strategy: "Create new pages then update navigation",
    };
  }
}

// ─── Phase 3: File Planner — produces WritePlan enforced at tool level ─────────

function buildFilePlanner(
  plan: BuildPlan,
  intent: IntentResult,
  existingPaths: string[],
): WritePlan {
  const fileRoles = new Map<string, FileRole>();
  const requiredNewFiles: string[] = [];

  if (intent.category === "new_page") {
    // All existing HTML files: nav link additions only
    for (const p of existingPaths.filter(f => f.endsWith(".html"))) {
      fileRoles.set(p, "nav_update_only");
    }
    // New page files: full write allowed
    for (const f of plan.filesToCreate) {
      fileRoles.set(f.path, "new_page");
      requiredNewFiles.push(f.path);
    }
    // Intent pages also required
    for (const p of intent.newPages) {
      if (!requiredNewFiles.includes(p.filename)) requiredNewFiles.push(p.filename);
    }
  } else if (intent.category === "visual_tweak") {
    // CSS files: unrestricted; HTML files: style_only
    for (const p of existingPaths) {
      fileRoles.set(p, p.endsWith(".css") ? "unrestricted" : "style_only");
    }
  }

  // Blocked patterns: URLs and page-specific keywords that must not appear in nav_update_only files
  const blockedPatterns = [...intent.bookingUrls];

  return { fileRoles, blockedPatterns, requiredNewFiles };
}

// ─── Build plan → system prompt block ─────────────────────────────────────────

function buildNewPageFallbackBlock(intent: IntentResult): string {
  const pages = intent.newPages.length > 0
    ? intent.newPages.map(p => `  - ${p.filename} (nav label: "${p.navLabel}")`).join("\n")
    : "  - pages/new-page.html";
  const existingNavNote = `After creating the page file(s), add ONE <a href="..."> nav link per existing HTML file.`;
  return `

=== NEW PAGE REQUIRED — MANDATORY SEQUENCE ===
Intent: new_page

MANDATORY FIRST ACTION — call write_file for each page below BEFORE any edit_file call:
${pages}

Each new page must be:
- A complete standalone HTML document (DOCTYPE, html, head, body)
- Same visual style as index.html (copy <head> CSS links and nav)
- Nav that links back to index.html and all other existing pages
- Content that directly addresses the user's request (never "coming soon")

SECOND ACTION — ${existingNavNote}

FORBIDDEN (validator will fail the build if detected):
✗ Do NOT add <section>, <div>, or hidden content to index.html for the new page
✗ Do NOT add JS show/hide or hash-routing logic to index.html for the new page
✗ Do NOT add localStorage state to index.html for the new page
✗ index.html may ONLY receive a single new <a href="..."> nav link

The validator checks for the existence of every file listed above.
If a file is missing the RepairAgent will re-run — write_file now, save the round-trip.
=== END REQUIREMENT ===`;
}

function buildExternalBookingOverrideBlock(intent: IntentResult): string {
  const urls = intent.bookingUrls.join(", ");
  const newPages = intent.newPages.map(p => `  - ${p.filename} (label: "${p.navLabel}")`).join("\n") || "  - pages/bookings.html";
  return `

=== EXTERNAL BOOKING URL — HARD OVERRIDE ===
Booking URLs detected: ${urls}

FORBIDDEN — tool will reject if you attempt these:
✗ Do NOT add a booking section, class schedule, fake calendar, or ANY booking content to index.html
✗ Do NOT add booking JavaScript or localStorage booking state to index.html
✗ Do NOT invent fake class data, fake time slots, fake availability, or fake booking forms
✗ Do NOT build any UI that simulates a booking system

REQUIRED — do ONLY this:
1. Create the booking page(s):
${newPages}
   Each file: standalone HTML with site nav + a clean button/link to the booking URL.
   Optionally add an <iframe src="BOOKING_URL"> if the service allows embedding.
2. Add ONE nav link per existing HTML file: e.g. <a href="pages/bookings.html">BOOKINGS</a>
3. Nothing else changes in index.html or other existing pages.

This override supersedes all other booking instructions in this prompt.
=== END OVERRIDE ===`;
}

function buildPlanBlock(plan: BuildPlan, intent: IntentResult, writePlan: WritePlan): string {
  const creates = plan.filesToCreate.map(f => `  - ${f.path}: ${f.purpose}`).join("\n") || "  (none)";
  const edits = plan.filesToEdit.map(f => `  - ${f.path}: ${f.reason}`).join("\n") || "  (none)";
  const navLine = plan.navUpdate
    ? `Add "${plan.navUpdate.addItem.label}" → href="${plan.navUpdate.addItem.href}" in: ${plan.navUpdate.files.join(", ")}`
    : "none";
  const order = plan.executionOrder.map((p, i) => `  ${i + 1}. ${p}`).join("\n");

  const navOnlyFiles = [...writePlan.fileRoles.entries()]
    .filter(([, r]) => r === "nav_update_only").map(([p]) => p).join(", ") || "none";

  const blocked = writePlan.blockedPatterns.length
    ? `The tool will REJECT writes to nav_update_only files that contain: ${writePlan.blockedPatterns.join(", ")}`
    : "";

  const externalUrlOverride = intent.bookingUrls.length > 0
    ? `
⚠ EXTERNAL BOOKING URL DETECTED — HARD OVERRIDE ⚠
URLs: ${intent.bookingUrls.join(", ")}

FORBIDDEN (tool will reject these):
✗ Do NOT add a booking section, booking form, class schedule, or ANY booking content to index.html
✗ Do NOT add booking JavaScript or localStorage booking state to index.html
✗ Do NOT invent a fake calendar, fake class data, fake time slots, or fake booking state

REQUIRED (do exactly this, nothing more):
1. Create pages/bookings.html — a standalone page with a clean link/button to the booking URL.
   Optionally include an <iframe src="BOOKING_URL"> if embedding makes sense.
   Include site nav so the user can navigate back.
2. Add ONLY this nav link to index.html (via edit_file): <a href="pages/bookings.html">BOOKINGS</a>
   (or the label the user requested — keep the href pointing to pages/bookings.html)
3. Do nothing else to index.html. No sections, no scripts, no booking content whatsoever.

This override takes precedence over all other booking instructions in this prompt.`
    : "";

  const filesToCreateList = plan.filesToCreate.length > 0
    ? plan.filesToCreate.map(f => `  write_file("${f.path}", ...)`).join("\n")
    : "  (none listed — check intent.newPages)";

  const categoryRules: Record<IntentCategory, string> = {
    new_page: `STRICT PAGE ISOLATION — MANDATORY SEQUENCE:
STEP 1 — WRITE NEW PAGE FILE(S) FIRST (before any edit_file call):
${filesToCreateList}
  Each must be a complete standalone HTML document (DOCTYPE, html, head, body, nav, content).
  Copy the visual style from index.html. Never leave content out or use placeholder text.

STEP 2 — THEN edit_file on each existing HTML file (nav link ONLY):
  Add exactly ONE <a href="..."> link per file — nothing else.
  The write_file tool will REJECT any write to index.html that adds large content blocks.

FORBIDDEN IN index.html:
  ✗ <section id="..."> for the new page
  ✗ display:none / show-hide divs for the new page
  ✗ JS routing logic or localStorage state for the new page
  ✗ Any content that belongs in the new page file

VALIDATOR WILL HARD-FAIL if any required new page file is missing after CodeExecutor runs.`,
    new_feature: "Add the feature to the existing page. Do not create unnecessary new files.",
    edit_existing: "Surgical edits. Read the file first, change only what was requested.",
    visual_tweak: "CSS changes only. Do not restructure HTML.",
    bug_fix: "Read the broken file first, then apply the minimal targeted fix.",
    first_build: "Build a complete functional app from scratch with realistic seed data.",
  };

  return `

=== TASK BLUEPRINT (ENFORCED AT TOOL LEVEL) ===
Intent: ${intent.category}
Strategy: ${plan.strategy}
${externalUrlOverride}
FILES TO CREATE:
${creates}

FILES TO EDIT (nav link additions only):
${edits}

NAV UPDATE REQUIRED: ${navLine}

EXECUTION ORDER:
${order}

NAV-UPDATE-ONLY FILES (tool blocks large writes): ${navOnlyFiles}
${blocked}

RULES:
${categoryRules[intent.category] ?? "Follow the blueprint."}
${intent.needsNavUpdate ? "- After creating new files, add the nav link to ALL listed HTML files before calling finish()." : ""}
=== END BLUEPRINT ===`;
}

// ─── Phase 4: Deterministic Validator (hard fails + warnings) ─────────────────

function resolveHref(fromFile: string, href: string): string {
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const parts = [...(dir ? dir.split("/") : []), ...href.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

function runDeterministicValidator(
  writtenFiles: string[],
  allFiles: Map<string, string>,
  intent: IntentResult | null,
  writePlan: WritePlan | null,
  userContent: string,
): ValidationResult {
  const hardFails: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // ── Hard fail checks for new_page ─────────────────────────────────────────
  if (intent?.category === "new_page") {
    const required = writePlan?.requiredNewFiles ?? intent.newPages.map(p => p.filename);

    // H1: Required new page file was not created.
    // Tolerant on PATH: the model may legitimately place the page at the root
    // ("bookings.html") to match an imported site's flat structure instead of "pages/".
    // Treat the page as created if a file with the SAME basename exists anywhere.
    const baseName = (p: string) => p.split("/").pop()!.toLowerCase();
    const allHtmlBasenames = new Set([...allFiles.keys()].filter(p => p.endsWith(".html")).map(baseName));
    for (const reqFile of required) {
      if (!allFiles.has(reqFile) && !allHtmlBasenames.has(baseName(reqFile))) {
        hardFails.push({
          type: "missing_new_page", severity: "hard_fail", file: reqFile,
          detail: `Required new page "${reqFile}" was not created. Task cannot be complete without it.`,
        });
      }
    }

    // H2: Only index.html was modified (no new page created)
    const newFilesCreated = writtenFiles.filter(f => !["index.html"].includes(f) && !f.startsWith("styles/") && !f.startsWith("scripts/"));
    if (newFilesCreated.length === 0 && writtenFiles.includes("index.html") && required.length > 0) {
      hardFails.push({
        type: "only_index_edited", severity: "hard_fail", file: "index.html",
        detail: "Only index.html was edited but a new page was required. The page content was injected into the wrong file.",
      });
    }

    // H3: Booking URL / blocked patterns found in index.html
    const indexHtml = allFiles.get("index.html") ?? "";
    for (const pattern of (writePlan?.blockedPatterns ?? intent.bookingUrls)) {
      if (pattern && indexHtml.includes(pattern)) {
        hardFails.push({
          type: "content_in_wrong_file", severity: "hard_fail", file: "index.html",
          detail: `"${pattern.slice(0, 80)}" found in index.html — booking content must be in the new page file only.`,
        });
      }
    }

    // H4: Large new section injected into index.html (heuristic: >8 new block elements)
    if (writtenFiles.includes("index.html")) {
      const blockTags = (indexHtml.match(/<(section|article|div\s+class=|main|aside)\b/gi) ?? []).length;
      if (blockTags > 20 && newFilesCreated.length === 0) {
        hardFails.push({
          type: "content_in_wrong_file", severity: "hard_fail", file: "index.html",
          detail: `index.html has ${blockTags} block elements after edit — a large section was likely injected instead of creating a new page.`,
        });
      }
    }

    // H5: Fake booking system or dynamic island injected into index.html for new_page
    // Covers both external-URL case and no-URL case (built-in mode applied to wrong intent)
    if (intent?.category === "new_page" && writtenFiles.includes("index.html")) {
      const FAKE_BOOKING_PATTERNS = [
        /<section[^>]*(?:id|class)=["'][^"']*book/i,
        /localStorage\s*\.\s*(?:setItem|getItem)\s*\(\s*["'][^"']*book/i,
        /function\s+\w*[Bb]ook/,
        /class\s+schedule|class[- ]data|seed.*booking|fake.*booking/i,
        /<(?:section|div)[^>]*>[\s\S]{0,200}(?:book a class|boek een les|boek nu|book now)/i,
        // Dynamic island replacement — triggered by the Booking FULL SPEC being wrongly applied
        /dynamic-island-nav/i,
        /data-view=["'](?:bookings?|boeken|nieuw-boeken|mijn-boekingen)/i,
        /data-section=["'](?:nieuw-boeken|mijn-boekingen|beheer)/i,
        /nieuw.?boeken|mijn.?boekingen/i,
      ];
      for (const pattern of FAKE_BOOKING_PATTERNS) {
        if (pattern.test(indexHtml)) {
          hardFails.push({
            type: "content_in_wrong_file", severity: "hard_fail", file: "index.html",
            detail: `Fake booking system detected in index.html (pattern: ${pattern.source.slice(0, 60)}). Booking content must go in pages/bookings.html only. index.html may only receive a nav link.`,
          });
          break;
        }
      }
    }
  }

  // ── Structural checks on all written HTML files ────────────────────────────
  for (const filePath of writtenFiles) {
    if (!filePath.endsWith(".html")) continue;
    const html = allFiles.get(filePath) ?? "";
    if (!html) continue;

    // Malformed HTML
    if (html.includes("<html") && !html.includes("</html>")) {
      hardFails.push({ type: "malformed_html", severity: "hard_fail", file: filePath, detail: "Missing </html> closing tag" });
    }

    // Broken nav links
    const hrefRe = /href=["']([^"'#?:]+\.html[^"']*)/g;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(html)) !== null) {
      const href = m[1].split("?")[0].split("#")[0];
      const resolved = resolveHref(filePath, href);
      if (!allFiles.has(resolved) && !allFiles.has(href)) {
        hardFails.push({
          type: "broken_nav_link", severity: "hard_fail", file: filePath,
          detail: `href="${href}" resolves to "${resolved}" which does not exist`,
        });
      }
    }

    // NOTE: duplicate nav-label detection was removed — real sites legitimately repeat
    // labels (desktop + mobile menu, header + footer), so counting <a> text across the
    // whole document produced false-positive warnings on every normal/imported page.

    // Broken anchor links (warning)
    const anchorRe = /href=["']#([^"']+)["']/g;
    const idRe = /\bid=["']([^"']+)["']/g;
    const ids = new Set<string>();
    while ((m = idRe.exec(html)) !== null) ids.add(m[1]);
    while ((m = anchorRe.exec(html)) !== null) {
      if (!ids.has(m[1])) {
        warnings.push({ type: "missing_anchor", severity: "warning", file: filePath, detail: `href="#${m[1]}" has no matching id` });
      }
    }
  }

  return { passed: hardFails.length === 0, hardFails, warnings };
}

// ─── Phase 5: Smart Repair Agent (Sonnet — moves content between files) ───────

async function runSmartRepair(
  session: BuildSession,
  projectId: number,
  validation: ValidationResult,
  currentFiles: Map<string, NebulaFile>,
  intent: IntentResult,
  writtenFiles: string[],
): Promise<string[]> {
  const send = (event: BuildEvent) => emitBuildEvent(session, event);
  const emitAgentEvt = (evt: AgentEvent) => send({ type: "agent", ...evt });
  const repairedFiles: string[] = [];

  if (validation.passed) return repairedFiles;

  send({ type: "status", message: "Reparatie uitvoeren..." });

  const issueList = validation.hardFails.map(i => `[${i.type}] ${i.file}: ${i.detail}`).join("\n");

  // Build context: only the relevant files
  const relevantPaths = new Set<string>([
    "index.html",
    ...intent.newPages.map(p => p.filename),
    ...writtenFiles,
  ]);
  const fileCtx = [...currentFiles.entries()]
    .filter(([p]) => relevantPaths.has(p))
    .map(([p, f]) => `=== FILE: ${p} ===\n${f.content.slice(0, 6000)}`)
    .join("\n\n")
    .slice(0, 24000);

  const newPagePath = intent.newPages[0]?.filename ?? "pages/new-page.html";
  const navLabel = intent.newPages[0]?.navLabel ?? "New Page";
  const bookingUrls = intent.bookingUrls;

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: `A website build has validation errors. Repair the files to fix them.

VALIDATION ERRORS:
${issueList}

WHAT MUST BE TRUE AFTER REPAIR:
1. "${newPagePath}" must exist as a complete standalone HTML page
2. "${newPagePath}" must contain the booking/page content (not index.html)
3. "index.html" must contain ONLY a nav link <a href="${newPagePath}">${navLabel}</a> — no booking content
4. Every nav href must point to an existing file
${bookingUrls.length ? `5. Booking URLs (${bookingUrls.join(", ")}) must appear in "${newPagePath}" only` : ""}

CURRENT FILE CONTENTS:
${fileCtx}

Output the corrected files. For each file, use this format:
FILE: path/to/file.html
\`\`\`html
[full corrected HTML]
\`\`\`

Rules:
- If booking content is in index.html: remove it from index.html, put it in ${newPagePath}
- index.html: only change the nav (add one <a> link) — preserve ALL other content
- ${newPagePath}: must be a complete standalone HTML page with nav + booking content only
- Preserve the visual design system (colors, fonts, styles) from index.html`,
      }],
    });

    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const blockRe = /^FILE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)^```/gm;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(text)) !== null) {
      const filePath = m[1].trim();
      const newContent = m[2];
      if (!newContent.trim()) continue;

      const existing = currentFiles.get(filePath);
      const language = inferLanguage(filePath);
      try {
        if (existing?.id != null) {
          await db.update(projectFiles).set({ content: newContent, language, updatedAt: new Date() }).where(eq(projectFiles.id, existing.id));
          currentFiles.set(filePath, { ...existing, content: newContent });
        } else {
          const [row] = await db.insert(projectFiles).values({ projectId, path: filePath, content: newContent, language }).returning();
          currentFiles.set(filePath, { id: row.id, path: filePath, content: newContent });
        }
        emitAgentEvt({ event: "file_saved", path: filePath, op: existing ? "update" : "create", linesAdded: 0, linesRemoved: 0, symbols: ["repair"], summary: `Reparatie: ${filePath}` });
        repairedFiles.push(filePath);
      } catch (err) {
        logger.error({ err, filePath }, "smart_repair write failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "smart_repair call failed");
  }

  return repairedFiles;
}

// checkWritePlanViolation and WritePlan types are imported from lib/write-plan.ts
// (see imports at the top of this file)

// ─── Agent events ─────────────────────────────────────────────────────────────

export type AgentEvent =
  | { event: "file_read";         path: string; size: number }
  | { event: "target_found";      path: string; location: string }
  | { event: "patch_created";     path: string; linesInPatch: number }
  | { event: "patch_applied";     path: string }
  | { event: "file_saved";        path: string; op: "create" | "update"; linesAdded: number; linesRemoved: number; symbols: string[]; summary: string }
  | { event: "validation_passed"; path: string }
  | { event: "validation_error";  path: string; error: string };

// Keep for backward compat in non-streaming route
export type SavedFileEvent = {
  path: string;
  op: "create" | "update";
  linesAdded: number;
  linesRemoved: number;
  symbols: string[];
  summary: string;
};

// IDs and class names that are structural boilerplate in almost every page —
// not meaningful as change signals.
const GENERIC_IDS = new Set([
  "page", "root", "app", "main", "content", "wrapper", "container",
  "header", "footer", "nav", "body", "layout", "inner", "outer", "top",
]);
const GENERIC_CLASSES = new Set([
  "container", "wrapper", "page", "app", "root", "main", "content",
  "inner", "outer", "layout", "body", "section", "row", "col", "grid",
  "flex", "box", "block", "item", "list", "text", "title", "subtitle",
  "heading", "label", "link", "icon", "image", "btn", "button", "card",
]);

function extractSymbols(
  path: string,
  newContent: string,
  oldContent = "",
): string[] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const out: string[] = [];
  // For updates: only flag symbols present in new but absent from old.
  const isNew = (sym: string, pattern: RegExp) =>
    oldContent === "" || !pattern.test(oldContent.replace(/\s+/g, " "));

  if (ext === "js") {
    const fns = [...newContent.matchAll(/function\s+(\w+)\s*\(/g)].slice(0, 10);
    for (const m of fns) {
      const name = m[1];
      if (!new RegExp(`function\\s+${name}\\s*\\(`).test(oldContent)) out.push(`${name}()`);
    }
    const arrows = [...newContent.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g)].slice(0, 6);
    for (const m of arrows) {
      const name = m[1];
      if (!out.some(s => s.startsWith(name)) && !new RegExp(`\\b${name}\\s*=`).test(oldContent))
        out.push(`${name}()`);
    }
    const evts = [...new Set([...newContent.matchAll(/addEventListener\s*\(\s*['"](\w+)['"]/g)].map(m => m[1]))];
    for (const e of evts) if (!new RegExp(`addEventListener.*['"]${e}['"]`).test(oldContent)) out.push(`on${e}`);
    if (/localStorage/.test(newContent) && !/localStorage/.test(oldContent)) out.push("localStorage");
    if (/fetch\s*\(/.test(newContent) && !/fetch\s*\(/.test(oldContent)) out.push("fetch");
  }

  if (ext === "html" || ext === "htm") {
    for (const m of newContent.matchAll(/<section[^>]*\bid=["']([^"']+)["']/gi)) {
      const id = m[1];
      if (!GENERIC_IDS.has(id) && !oldContent.includes(`id="${id}"`) && !oldContent.includes(`id='${id}'`)) out.push(`#${id}`);
    }
    for (const m of newContent.matchAll(/<(?:div|article|aside|main)[^>]*\bid=["']([^"']+)["']/gi)) {
      const id = m[1];
      if (!GENERIC_IDS.has(id) && !oldContent.includes(`id="${id}"`) && !oldContent.includes(`id='${id}'`)) out.push(`#${id}`);
    }
    const inputTypes = [...new Set([...newContent.matchAll(/<input[^>]*\btype=["']([^"']+)["']/gi)].map(m => m[1]))];
    const oldInputTypes = new Set([...oldContent.matchAll(/<input[^>]*\btype=["']([^"']+)["']/gi)].map(m => m[1]));
    const newInputTypes = inputTypes.filter(t => !oldInputTypes.has(t));
    if (newInputTypes.length) out.push(`input[${newInputTypes.join(", ")}]`);
    const btns = [...newContent.matchAll(/<button[^>]*>([^<]{1,25})<\/button>/gi)]
      .map(m => m[1].trim())
      .filter(t => t && !/</.test(t));
    const oldBtns = new Set([...oldContent.matchAll(/<button[^>]*>([^<]{1,25})<\/button>/gi)].map(m => m[1].trim()));
    for (const b of btns.slice(0, 3)) if (!oldBtns.has(b)) out.push(`"${b}"`);
    if (/<form[\s>]/i.test(newContent) && !/<form[\s>]/i.test(oldContent)) out.push("form");
  }

  if (ext === "css") {
    const oldClasses = new Set([...oldContent.matchAll(/\.([a-z][a-z0-9_-]+)\s*\{/gi)].map(m => m[1]));
    const classes = [...new Set([...newContent.matchAll(/\.([a-z][a-z0-9_-]+)\s*\{/gi)].map(m => m[1]))]
      .filter(c => !GENERIC_CLASSES.has(c) && !oldClasses.has(c))
      .slice(0, 8);
    for (const c of classes) out.push(`.${c}`);
    if (/@keyframes/.test(newContent) && !/@keyframes/.test(oldContent)) out.push("@keyframes");
    if (/@media/.test(newContent) && !/@media/.test(oldContent)) out.push("@media");
  }

  void isNew; // suppress unused warning — kept for future use
  return out;
}

function generateSummary(
  path: string,
  op: "create" | "update",
  linesAdded: number,
  linesRemoved: number,
  symbols: string[],
): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const parts: string[] = [];

  if (ext === "js") {
    const fns = symbols.filter(s => s.endsWith("()"));
    const evts = symbols.filter(s => s.startsWith("on"));
    const hasStorage = symbols.includes("localStorage");
    const hasFetch = symbols.includes("fetch");
    if (fns.length > 0) parts.push(op === "create"
      ? `${fns.length} functie${fns.length > 1 ? "s" : ""}: ${fns.slice(0, 3).join(", ")}`
      : `${fns.length} nieuwe functie${fns.length > 1 ? "s" : ""}: ${fns.slice(0, 3).join(", ")}`);
    if (evts.length > 0) parts.push(`events: ${evts.join(", ")}`);
    if (hasStorage) parts.push("localStorage");
    if (hasFetch) parts.push("fetch API");
  } else if (ext === "html" || ext === "htm") {
    const sections = symbols.filter(s => s.startsWith("#"));
    const inputs = symbols.find(s => s.startsWith("input["));
    const btns = symbols.filter(s => s.startsWith('"'));
    const hasForm = symbols.includes("form");
    if (sections.length > 0) parts.push(`${sections.length === 1 ? "sectie" : `${sections.length} secties`}: ${sections.slice(0, 3).join(", ")}`);
    if (hasForm || inputs) parts.push(`formulier${inputs ? ` met ${inputs}` : ""}`);
    if (btns.length > 0 && !hasForm) parts.push(`knoppen: ${btns.slice(0, 2).join(", ")}`);
  } else if (ext === "css") {
    const classes = symbols.filter(s => s.startsWith("."));
    const hasResponsive = symbols.includes("@media");
    const hasAnimation = symbols.includes("@keyframes");
    if (classes.length > 0) parts.push(`${classes.length} nieuwe klasse${classes.length > 1 ? "s" : ""}: ${classes.slice(0, 4).join(", ")}`);
    if (hasResponsive) parts.push("responsive");
    if (hasAnimation) parts.push("animaties");
  }

  if (parts.length === 0) {
    return op === "create"
      ? `${linesAdded} regels geschreven`
      : `${linesAdded > 0 ? `+${linesAdded}` : ""}${linesRemoved > 0 ? ` −${linesRemoved}` : ""} regels`;
  }
  return parts.join(" · ");
}

function computeLineDiff(
  oldContent: string,
  newContent: string,
): { linesAdded: number; linesRemoved: number } {
  const normalize = (s: string) => s.split("\n").map(l => l.trim()).filter(Boolean);
  const oldLines = normalize(oldContent);
  const newLines = normalize(newContent);
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  return {
    linesAdded: newLines.filter(l => !oldSet.has(l)).length,
    linesRemoved: oldLines.filter(l => !newSet.has(l)).length,
  };
}

// ─── Patch application ────────────────────────────────────────────────────────

function applyPatch(
  content: string,
  op: string,
  anchor: string | null,
  patch: string,
): { result: string; found: boolean; location: string } {
  const normalizedOp = op.trim().toLowerCase().replace(/[-\s]/g, "_");

  if (normalizedOp === "insert_before_body_close" || normalizedOp === "append_to_body" || normalizedOp === "insert_before_close_body") {
    const idx = content.lastIndexOf("</body>");
    if (idx === -1) {
      return { result: content.trimEnd() + "\n" + patch.trimEnd() + "\n", found: true, location: "einde bestand" };
    }
    return {
      result: content.slice(0, idx) + patch.trimEnd() + "\n" + content.slice(idx),
      found: true,
      location: "voor </body>",
    };
  }

  if (normalizedOp === "insert_after_id" && anchor) {
    const idPattern = new RegExp(`id=["']${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i");
    const idMatch = idPattern.exec(content);
    if (!idMatch) return { result: content, found: false, location: anchor };

    // Find the opening tag start
    const tagStart = content.lastIndexOf("<", idMatch.index);
    const tagNameMatch = content.slice(tagStart + 1).match(/^([a-z][a-z0-9]*)/i);
    const tagName = tagNameMatch?.[1]?.toLowerCase() ?? "div";
    const closeTag = `</${tagName}>`;

    let depth = 1;
    let pos = idMatch.index + idMatch[0].length;
    while (depth > 0 && pos < content.length) {
      const nextOpen = content.indexOf(`<${tagName}`, pos);
      const nextClose = content.indexOf(closeTag, pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + tagName.length + 1;
      } else {
        depth--;
        if (depth === 0) {
          const insertAt = nextClose + closeTag.length;
          return {
            result: content.slice(0, insertAt) + "\n" + patch.trimEnd() + "\n" + content.slice(insertAt),
            found: true,
            location: `na #${anchor}`,
          };
        }
        pos = nextClose + closeTag.length;
      }
    }
    return { result: content, found: false, location: anchor };
  }

  // Default: append to end (for CSS, JS, and fallback)
  return {
    result: content.trimEnd() + "\n\n" + patch.trimEnd() + "\n",
    found: true,
    location: "einde bestand",
  };
}

// ─── Patch-based agentic editing ─────────────────────────────────────────────

async function processPatchBlocks(
  projectId: number,
  raw: string,
  existingFiles: { id: number; path: string; content?: string }[],
  onAgentEvent: (event: AgentEvent) => void,
): Promise<string[]> {
  const written: string[] = [];
  // Track current content per path so sequential patches on the same file chain correctly.
  const currentContent = new Map<string, string>();

  let match: RegExpExecArray | null;
  PATCH_BLOCK_REGEX.lastIndex = 0;
  while ((match = PATCH_BLOCK_REGEX.exec(raw)) !== null) {
    const [, filePath, rawOp, rawAnchor, patchContent] = match;
    const trimmedPath = filePath.trim();
    if (!trimmedPath) continue;
    const op = (rawOp ?? "append").trim();
    const anchor = rawAnchor?.trim() ?? null;

    const existing = existingFiles.find(f => f.path === trimmedPath);
    // Use the latest in-memory version if this file was already patched this run.
    const existingContent = currentContent.has(trimmedPath)
      ? currentContent.get(trimmedPath)!
      : (existing?.content ?? "");

    // 1. file_read — only after we access the content
    onAgentEvent({ event: "file_read", path: trimmedPath, size: existingContent.length });

    // 2. Find anchor / apply patch
    const { result, found, location } = applyPatch(existingContent, op, anchor, patchContent);

    if (!found) {
      onAgentEvent({ event: "validation_error", path: trimmedPath, error: `Ankerpunt niet gevonden: ${anchor ?? op}` });
      continue;
    }

    // 3. target_found
    onAgentEvent({ event: "target_found", path: trimmedPath, location });

    // 4. patch_created
    const linesInPatch = patchContent.split("\n").filter(l => l.trim()).length;
    onAgentEvent({ event: "patch_created", path: trimmedPath, linesInPatch });

    // 5. patch_applied
    onAgentEvent({ event: "patch_applied", path: trimmedPath });

    // 6. Save to DB
    const language = inferLanguage(trimmedPath);
    if (existing) {
      await db.update(projectFiles).set({ content: result, language, updatedAt: new Date() }).where(eq(projectFiles.id, existing.id));
    } else {
      await db.insert(projectFiles).values({ projectId, path: trimmedPath, content: result, language });
    }
    // Update in-memory cache so subsequent patches on the same file see the latest content.
    currentContent.set(trimmedPath, result);
    written.push(trimmedPath);

    // 7. file_saved — only after real DB write
    try {
      const { linesAdded, linesRemoved } = computeLineDiff(existingContent, result);
      const symbols = extractSymbols(trimmedPath, result, existingContent);
      const summary = generateSummary(trimmedPath, existing ? "update" : "create", linesAdded, linesRemoved, symbols);
      onAgentEvent({ event: "file_saved", path: trimmedPath, op: existing ? "update" : "create", linesAdded, linesRemoved, symbols, summary });
    } catch (err) {
      logger.error({ err, path: trimmedPath }, "processPatchBlocks: post-save metadata failed");
      onAgentEvent({ event: "file_saved", path: trimmedPath, op: existing ? "update" : "create", linesAdded: 0, linesRemoved: 0, symbols: [], summary: trimmedPath });
    }

    // 8. validation — structural check
    const isHtml = trimmedPath.endsWith(".html") || trimmedPath.endsWith(".htm");
    const valid = result.length > existingContent.length && (!isHtml || /<\/html>/i.test(result) || !/<html/i.test(result));
    if (valid) {
      onAgentEvent({ event: "validation_passed", path: trimmedPath });
    } else {
      onAgentEvent({ event: "validation_error", path: trimmedPath, error: "Resultaat ziet er onvolledig uit" });
    }
  }
  return written;
}

// ─────────────────────────────────────────────────────────────────────────────

async function persistGeneratedFiles(
  projectId: number,
  raw: string,
  existingFiles: { id: number; path: string; content?: string }[],
  protectedPaths: Set<string> = new Set(),
  onAgentEvent?: (event: AgentEvent) => void,
  skipPaths: Set<string> = new Set(),
): Promise<string[]> {
  const written: string[] = [];
  let match;
  FILE_BLOCK_REGEX.lastIndex = 0;
  while ((match = FILE_BLOCK_REGEX.exec(raw)) !== null) {
    const [, filePath, langLine, fenceLang, fileContent] = match;
    const trimmedPath = filePath.trim();
    if (!trimmedPath) continue;
    // Never overwrite a page omitted from the model's context.
    if (protectedPaths.has(trimmedPath)) continue;
    // Skip files already handled by processPatchBlocks.
    if (skipPaths.has(trimmedPath)) continue;
    const language = (langLine || fenceLang || "").trim() || inferLanguage(trimmedPath);
    written.push(trimmedPath);
    const existing = existingFiles.find((f) => f.path === trimmedPath);
    if (existing) {
      await db
        .update(projectFiles)
        .set({ content: fileContent, language, updatedAt: new Date() })
        .where(eq(projectFiles.id, existing.id));
    } else {
      await db.insert(projectFiles).values({ projectId, path: trimmedPath, content: fileContent, language });
    }
    if (onAgentEvent) {
      const op = existing ? "update" : "create";
      const oldContent = existing?.content ?? "";
      const { linesAdded, linesRemoved } = op === "update"
        ? computeLineDiff(oldContent, fileContent)
        : { linesAdded: fileContent.split("\n").filter(Boolean).length, linesRemoved: 0 };
      const symbols = extractSymbols(trimmedPath, fileContent, oldContent);
      const summary = generateSummary(trimmedPath, op, linesAdded, linesRemoved, symbols);
      onAgentEvent({ event: "file_saved", path: trimmedPath, op, linesAdded, linesRemoved, symbols, summary });
    }
  }
  return written;
}

// ── Platform-account ownership (multi-tenant): each account only sees/owns its own projects ──
async function currentUser(req: unknown): Promise<PlatformUser | null> {
  return getSessionUser(tokenFrom(req as { headers: Record<string, unknown>; query?: Record<string, unknown> }));
}

// Defense-in-depth: for ANY /projects/<id>/... builder request that carries a VALID platform token,
// the token's user must own the project — otherwise 403. Requests without a platform token (the
// preview iframe, published sites, and booking-app /studio calls which use a different token) pass
// straight through unchanged, so nothing public breaks.
router.use(async (req, res, next) => {
  const m = req.path.match(/^\/projects\/(\d+)(?:\/|$)/);
  if (!m) return next();
  const token = tokenFrom(req as { headers: Record<string, unknown>; query?: Record<string, unknown> });
  if (!token) return next();
  try {
    const u = await getSessionUser(token);
    if (!u) return next(); // not a platform token (e.g. a studio booking-client token) → leave as-is
    const [p] = await db.select().from(projects).where(eq(projects.id, Number(m[1])));
    if (p && p.ownerId != null && p.ownerId !== u.id) { res.status(403).json({ error: "Geen toegang tot dit project." }); return; }
    return next();
  } catch { return next(); }
});
// Returns the logged-in owner of `projectId`, or sends 401/403/404 and returns null. ownerless
// (legacy) projects are allowed through so older data isn't locked out.
async function requireOwner(req: unknown, res: { status: (n: number) => { json: (o: unknown) => void } }, projectId: number): Promise<PlatformUser | null> {
  const u = await currentUser(req);
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return null; }
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) { res.status(404).json({ error: "Project niet gevonden." }); return null; }
  if (p.ownerId != null && p.ownerId !== u.id) { res.status(403).json({ error: "Geen toegang tot dit project." }); return null; }
  return u;
}

router.get("/projects", async (req, res) => {
  try {
    const u = await currentUser(req);
    if (!u) { res.json([]); return; } // not logged in → no projects
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
      .where(eq(projects.ownerId, u.id))
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
      .where(sql`${projects.ownerId} = ${(await currentUser(req))?.id ?? -1}`)
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
    const u = await currentUser(req);
    if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
    const [project] = await db
      .insert(projects)
      .values({
        ownerId: u.id,
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
  const owner = await currentUser(req);
  if (!owner) { res.status(401).json({ error: "Niet ingelogd." }); return; }

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
        ownerId: owner.id,
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
    if (!(await requireOwner(req, res, parsed.data.projectId))) return;
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
    if (!(await requireOwner(req, res, parsed.data.projectId))) return;
    await db.delete(projects).where(eq(projects.id, parsed.data.projectId));
    // DB rows cascade (files/assets/etc.); the imported binary media on the persistent disk does
    // NOT, so remove that folder too — otherwise a re-import under a new id leaves orphaned bytes.
    await deleteProjectMedia(parsed.data.projectId).catch((err) => req.log.warn({ err }, "media cleanup failed"));
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

// ---- Detached build sessions -------------------------------------------------
// A build can take several minutes. The browser/iframe may refresh, the user may
// navigate, or the edge proxy may drop a long-lived SSE connection mid-build —
// any of which kills the request socket. To stop that from wasting an entire
// build (or leaving a project half-written), generation runs DETACHED from the
// HTTP request: it streams progress into an in-memory session that clients attach
// to. A dropped connection just removes a listener; the build keeps running and
// still persists its files. Clients reconnect to the same session and replay the
// progress they missed.

type BuildEvent = Record<string, unknown>;

type BuildSession = {
  projectId: number;
  events: BuildEvent[]; // full ordered buffer, replayed on every (re)connect
  status: "running" | "done" | "error";
  listeners: Set<(e: BuildEvent) => void>;
  startedAt: number;
  cancelled: boolean;
  abort: () => void; // tears down the upstream model call on an explicit Stop
};

const activeBuilds = new Map<number, BuildSession>();
// Keep a finished session around briefly so a client reconnecting right after
// completion still receives the terminal event before we free the buffer.
const FINISHED_SESSION_TTL_MS = 2 * 60_000;

function createBuildSession(projectId: number): BuildSession {
  const session: BuildSession = {
    projectId,
    events: [],
    status: "running",
    listeners: new Set(),
    startedAt: Date.now(),
    cancelled: false,
    abort: () => {},
  };
  activeBuilds.set(projectId, session);
  return session;
}

function emitBuildEvent(session: BuildSession, event: BuildEvent): void {
  session.events.push(event);
  for (const listener of session.listeners) {
    try {
      listener(event);
    } catch {
      /* a dead listener must never break the build */
    }
  }
}

function finishBuildSession(session: BuildSession, status: "done" | "error"): void {
  session.status = status;
  const timer = setTimeout(() => {
    if (activeBuilds.get(session.projectId) === session) {
      activeBuilds.delete(session.projectId);
    }
  }, FINISHED_SESSION_TTL_MS);
  timer.unref?.();
}

// Stream an in-flight (or just-finished) build session to one HTTP client as SSE.
// Replays the full buffer first so a reconnecting client is caught up, then
// forwards live events. A dropped socket only detaches this listener.
function attachToBuild(session: BuildSession, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  function safeWrite(chunk: string): void {
    if (closed || res.writableEnded) return;
    try {
      res.write(chunk);
    } catch {
      /* socket gone */
    }
  }
  function cleanup(): void {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    session.listeners.delete(listener);
  }
  function listener(event: BuildEvent): void {
    safeWrite(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "done" || event.type === "error") {
      cleanup();
      res.end();
    }
  }

  safeWrite(": open\n\n");
  for (const event of session.events) {
    safeWrite(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (session.status !== "running") {
    // Build already finished — the replay above included its terminal event.
    res.end();
    return;
  }

  session.listeners.add(listener);
  heartbeat = setInterval(() => safeWrite(": ping\n\n"), 3000);
  // Passive disconnect (refresh, navigation, proxy cap): keep the build running.
  res.on("close", cleanup);
}

// Run a full generation, detached from any HTTP request, streaming progress into
// the session and persisting the result regardless of whether a client is still
// connected. Only an explicit cancel (session.cancelled) stops it early.
// Cheap Haiku-based error fixer: reads only the SPA JS/CSS/HTML files, produces a
// targeted patch using a minimal system prompt. Costs ~15× less than a full build.
async function runFixBuild(
  session: BuildSession,
  projectId: number,
  errorText: string,
): Promise<void> {
  const send = (event: BuildEvent) => emitBuildEvent(session, event);
  try {
    const projectRows = await db.select().from(projects).where(eq(projects.id, projectId));
    if (projectRows.length === 0) {
      send({ type: "error", message: "Project not found" });
      finishBuildSession(session, "error");
      return;
    }

    const allFiles = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    // Only send the generated SPA files — not the full imported-site HTML pages.
    const spaFiles = allFiles.filter(
      (f) =>
        f.path === "index.html" ||
        f.path.endsWith(".css") ||
        f.path.endsWith(".js"),
    );
    const fileContext = spaFiles
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join("\n\n");

    const fixSystem = `Fix the JavaScript runtime error below. Change ONLY what is needed to eliminate the error — do not redesign, rename, or touch anything else.

CRITICAL FILE FORMAT — use this exactly:
FILE: script.js
\`\`\`js
...full corrected file content...
\`\`\`
The FILE: line must be directly before the opening fence. Output ONLY the file(s) you changed.`;

    send({ type: "status", message: "Analysing error…" });

    let full = "";
    const seenFiles = new Set<string>();
    const controller = new AbortController();
    session.abort = () => {
      session.cancelled = true;
      try { controller.abort(); } catch { /* already settled */ }
    };

    const stream = await withRetry(
      () =>
        anthropic.messages.create(
          {
            model: "claude-haiku-4-5",
            max_tokens: 8192,
            system: [{ type: "text" as const, text: fixSystem, cache_control: { type: "ephemeral" as const } }],
            messages: [
              {
                role: "user",
                content: `Runtime error: ${errorText}\n\nProject files:\n${fileContext}`,
              },
            ],
            stream: true,
          },
          { signal: controller.signal },
        ),
      "fix-stream",
    );

    if (session.cancelled) { session.abort(); }

    try {
      for await (const event of stream) {
        if (session.cancelled) break;
        if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
        const delta = event.delta.text;
        if (!delta) continue;
        full += delta;
        send({ type: "delta", text: delta });
        const re = /FILE:\s*([^\n]+)\n/g;
        let m;
        while ((m = re.exec(full)) !== null) {
          const path = m[1].trim();
          if (!seenFiles.has(path)) {
            seenFiles.add(path);
            send({ type: "writing", path });
          }
        }
      }
    } catch (streamErr) {
      if (!session.cancelled) throw streamErr;
    }

    if (session.cancelled) {
      send({ type: "done", files: [], cancelled: true });
      finishBuildSession(session, "done");
      return;
    }

    const written = await persistGeneratedFiles(
      projectId,
      full,
      allFiles,
      new Set(),
      (evt) => send({ type: "file", ...evt }),
    );
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    const explanation = extractNarration(full) || "Fixed the runtime error.";
    const [assistantMsg] = await db
      .insert(projectMessages)
      .values({ projectId, role: "assistant", content: explanation })
      .returning();

    send({ type: "message", id: assistantMsg.id, content: explanation });
    send({ type: "done", files: written });
    finishBuildSession(session, "done");
  } catch (err) {
    logger.error({ err, projectId }, "Failed to run fix build");
    send({ type: "error", message: "Could not fix the error automatically." });
    finishBuildSession(session, "error");
  }
}

// ─── Agentic tool loop (Claude-Code-style) ────────────────────────────────────

const NEBULA_TOOLS = [
  {
    name: "read_file",
    description: "Read the current content of a project file. Call this before edit_file to confirm the exact text you want to change.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path — e.g. 'index.html', 'styles.css', 'script.js'" },
      },
      required: ["path"] as const,
    },
  },
  {
    name: "write_file",
    description: "Create a new file or fully replace an existing file's content. Use for NEW files or when the change is too large for surgical edits. Never use this for protected imported pages — use edit_file instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        content: { type: "string", description: "Complete file content" },
      },
      required: ["path", "content"] as const,
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact occurrence of old_string with new_string inside a file. Read the file first to confirm the exact text. old_string must be unique in the file. Prefer this over write_file for targeted changes to existing files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        old_string: { type: "string", description: "Exact text to find and replace — must be unique in the file" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string", "new_string"] as const,
    },
  },
  {
    name: "delete_file",
    description: "Permanently delete a file from the project. Use when moving a file to a new path: write_file to the new path first, then delete_file the old path. Cannot be undone.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path to delete, e.g. 'old-page.html'" },
      },
      required: ["path"] as const,
    },
  },
  {
    name: "finish",
    description: "Signal that ALL requested changes are complete and the task is done.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "1-2 sentences in Dutch summarising what was changed" },
      },
      required: ["summary"] as const,
    },
  },
];

type NebulaFile = { id: number | null; path: string; content: string };

async function executeNebulaToolCall(
  name: string,
  input: Record<string, unknown>,
  projectId: number,
  currentFiles: Map<string, NebulaFile>,
  written: string[],
  onAgentEvent: (evt: AgentEvent) => void,
  protectedPaths: Set<string>,
  writePlan?: WritePlan | null,
  intent?: IntentForEnforcement | null,
): Promise<string> {
  const path = String(input.path ?? "").trim();

  if (name === "read_file") {
    const file = currentFiles.get(path);
    if (!file) {
      return `File not found: "${path}". Available files: ${[...currentFiles.keys()].join(", ") || "none"}`;
    }
    onAgentEvent({ event: "file_read", path, size: file.content.length });
    return file.content;
  }

  // ── Unconditional index.html booking-content guard ─────────────────────────
  // This fires BEFORE WritePlan, BEFORE system-prompt guidance.
  // index.html must NEVER receive booking section content regardless of plan state.
  // Applies to both write_file and edit_file when a booking context is active.
  if ((path === "index.html" || path === "index.htm") && (name === "write_file" || name === "edit_file")) {
    const textToCheck = name === "write_file"
      ? String(input.content ?? "")
      : String(input.new_string ?? "");
    const hasBookingContext =
      (writePlan?.blockedPatterns.length ?? 0) > 0 ||
      (intent?.bookingUrls.length ?? 0) > 0 ||
      intent?.category === "new_page";
    if (hasBookingContext) {
      const FORBIDDEN: Array<{ re: RegExp; label: string }> = [
        { re: /id=["']bookings["']/i, label: 'id="bookings"' },
        { re: /<section[^>]*(?:id|class)=["'][^"']*book/i, label: "booking <section>" },
        { re: /class=["'][^"']*booking/i, label: 'class="...booking..."' },
        { re: /nebula_bookings/i, label: "nebula_bookings localStorage key" },
        { re: /function\s+\w*[Bb]ook\w*\s*\(/i, label: "booking JS function" },
        { re: /booking.?(calendar|form|widget|system)/i, label: "booking calendar/form/widget" },
        { re: /time.?slot/i, label: "time-slot" },
        { re: /book a class|boek een les/i, label: '"Book a Class"' },
        // Dynamic island / section-router patterns — the BOOKING FULL SPEC injects these
        // into index.html, which is forbidden when adding a bookings PAGE to an existing site.
        { re: /data-view=["'](?:bookings?|boeken|reserv)/i, label: 'data-view="bookings" (section router attribute)' },
        { re: /data-section=["'](?:nieuw-boeken|mijn-boekingen|beheer)/i, label: 'data-section="..." (booking section tab)' },
        { re: /dynamic-island-nav/i, label: "dynamic-island-nav (full booking app nav replacement)" },
        { re: /<section[^>]*data-section=/i, label: "<section data-section=...> (booking section tab)" },
        { re: /scripts\/booking\.js/i, label: "scripts/booking.js (booking app script)" },
        { re: /styles\/booking\.css/i, label: "styles/booking.css (booking app stylesheet)" },
        { re: /href=["']#[^"']*book/i, label: 'href="#...book..." (hash anchor for booking section)' },
        { re: /nieuw.?boeken|mijn.?boekingen/i, label: '"nieuw boeken"/"mijn boekingen" section label' },
      ];
      for (const { re, label } of FORBIDDEN) {
        if (re.test(textToCheck)) {
          logger.warn({ path, label, intent: intent?.category }, "[HardBlock] booking content blocked from index.html");
          return [
            `BLOCKED [index.html protected]: Cannot write "${label}" to index.html.`,
            `index.html may ONLY receive a nav link for the booking page.`,
            ``,
            `You are applying the BOOKING FULL SPEC to an existing site. That spec is for standalone booking apps only.`,
            `For adding a bookings TAB to an existing site, use SUB-CASE A:`,
            `1. write_file("pages/bookings.html", <standalone booking page with a form OR external link>)`,
            `2. edit_file("index.html", old_string="</nav>", new_string=\`\\n  <a href="pages/bookings.html">BOOKINGS</a>\\n</nav>\`)`,
            `Do NOT replace the existing nav with a dynamic island. Do NOT add data-view or data-section attributes.`,
          ].join("\n");
        }
      }
    }
  }

  if (name === "write_file") {
    const content = String(input.content ?? "");
    if (!path) return "Error: path is required";
    if (!content.trim()) return "Error: content cannot be empty";
    if (protectedPaths.has(path)) {
      return `"${path}" is a protected imported page — use edit_file to make targeted changes instead of rewriting the whole file.`;
    }

    // ── WritePlan enforcement (pure fn — logged and always runs when plan is set) ──
    {
      const existingContent = currentFiles.get(path)?.content ?? "";
      const existingLines = existingContent.split("\n").length;
      const newLines = content.split("\n").length;
      const role = writePlan?.fileRoles.get(path) ?? "none";
      const blockedPatternsFound = (writePlan?.blockedPatterns ?? []).filter(p => p && content.includes(p));
      logger.info({
        tool: "write_file", path, role,
        existingLines, newLines, lineIncrease: newLines - existingLines,
        blockedPatternsFound,
        writePlanActive: !!writePlan,
      }, "[WritePlan] write_file enforcement check");

      const violation = checkWritePlanViolation(path, content, existingContent, writePlan, "write_file", content, intent);
      if (violation) {
        logger.warn({ path, role, violation }, "[WritePlan] write_file BLOCKED");
        return violation;
      }
    }
    const language = inferLanguage(path);
    const existing = currentFiles.get(path);
    try {
      if (existing?.id != null) {
        await db.update(projectFiles)
          .set({ content, language, updatedAt: new Date() })
          .where(eq(projectFiles.id, existing.id));
        currentFiles.set(path, { ...existing, content });
      } else {
        const [row] = await db.insert(projectFiles)
          .values({ projectId, path, content, language })
          .returning();
        currentFiles.set(path, { id: row.id, path, content });
      }
      const { linesAdded, linesRemoved } = computeLineDiff(existing?.content ?? "", content);
      const symbols = extractSymbols(path, content, existing?.content ?? "");
      const summary = generateSummary(path, existing ? "update" : "create", linesAdded, linesRemoved, symbols);
      onAgentEvent({ event: "file_saved", path, op: existing ? "update" : "create", linesAdded, linesRemoved, symbols, summary });
      onAgentEvent({ event: "validation_passed", path });
      if (!written.includes(path)) written.push(path);
      return "OK";
    } catch (err) {
      logger.error({ err, path }, "write_file tool failed");
      return `Error writing "${path}": ${String(err)}`;
    }
  }

  if (name === "edit_file") {
    const old_string = String(input.old_string ?? "");
    const new_string = String(input.new_string ?? "");
    if (!path || !old_string) return "Error: path and old_string are required";
    const file = currentFiles.get(path);
    if (!file) return `File not found: "${path}". Call read_file first to confirm the path.`;

    // Cost guard for new pages on imported sites: the protected original pages are NOT
    // the live site (that's index.html), so updating their nav is pointless and expensive.
    // Only index.html needs the new nav link — skip edits to the protected originals.
    if (
      intent?.category === "new_page" &&
      protectedPaths.has(path) &&
      path !== "index.html" && path !== "index.htm"
    ) {
      logger.info({ path }, "[CostGuard] skipped edit to protected page for new_page — only index.html needs the nav link");
      return `SKIP "${path}": it is a protected original page, not the live site. For a new page, only add the nav link to index.html — do NOT edit the other pages. The new page file + the index.html nav link are all that is needed.`;
    }

    // ── WritePlan enforcement for edit_file ───────────────────────────────────
    {
      const existingContent = file.content;
      const hypotheticalNewContent =
        file.content.slice(0, file.content.indexOf(old_string)) +
        new_string +
        file.content.slice(file.content.indexOf(old_string) + old_string.length);
      const existingLines = existingContent.split("\n").length;
      const newLines = hypotheticalNewContent.split("\n").length;
      const role = writePlan?.fileRoles.get(path) ?? "none";
      const blockedPatternsFound = (writePlan?.blockedPatterns ?? []).filter(p => p && new_string.includes(p));
      logger.info({
        tool: "edit_file", path, role,
        existingLines, newLines, lineIncrease: newLines - existingLines,
        blockedPatternsFound,
        writePlanActive: !!writePlan,
      }, "[WritePlan] edit_file enforcement check");

      const violation = checkWritePlanViolation(path, hypotheticalNewContent, existingContent, writePlan, "edit_file", new_string, intent);
      if (violation) {
        logger.warn({ path, role, violation }, "[WritePlan] edit_file BLOCKED");
        return violation;
      }
    }

    onAgentEvent({ event: "file_read", path, size: file.content.length });
    const idx = file.content.indexOf(old_string);
    if (idx === -1) {
      return `old_string not found in "${path}". Call read_file("${path}") to see the current content and confirm the exact text.`;
    }

    onAgentEvent({ event: "target_found", path, location: old_string.slice(0, 80).replace(/\n/g, "↵") });
    const newContent =
      file.content.slice(0, idx) + new_string + file.content.slice(idx + old_string.length);
    const language = inferLanguage(path);
    try {
      if (file.id != null) {
        await db.update(projectFiles)
          .set({ content: newContent, language, updatedAt: new Date() })
          .where(eq(projectFiles.id, file.id));
      } else {
        await db.insert(projectFiles)
          .values({ projectId, path, content: newContent, language });
      }
      currentFiles.set(path, { ...file, content: newContent });
      const { linesAdded, linesRemoved } = computeLineDiff(file.content, newContent);
      const symbols = extractSymbols(path, newContent, file.content);
      const summary = generateSummary(path, "update", linesAdded, linesRemoved, symbols);
      onAgentEvent({ event: "patch_created", path, linesInPatch: new_string.split("\n").length });
      onAgentEvent({ event: "patch_applied", path });
      onAgentEvent({ event: "file_saved", path, op: "update", linesAdded, linesRemoved, symbols, summary });
      onAgentEvent({ event: "validation_passed", path });
      if (!written.includes(path)) written.push(path);
      return "OK";
    } catch (err) {
      logger.error({ err, path }, "edit_file tool failed");
      return `Error editing "${path}": ${String(err)}`;
    }
  }

  if (name === "delete_file") {
    if (!path) return "Error: path is required";
    const file = currentFiles.get(path);
    if (!file) {
      return `File not found: "${path}". Available files: ${[...currentFiles.keys()].join(", ") || "none"}`;
    }
    try {
      if (file.id != null) {
        await db.delete(projectFiles).where(eq(projectFiles.id, file.id));
      }
      currentFiles.delete(path);
      return "OK";
    } catch (err) {
      logger.error({ err, path }, "delete_file tool failed");
      return `Error deleting "${path}": ${String(err)}`;
    }
  }

  return `Unknown tool: ${name}`;
}

// Rough char count of an Anthropic message list (text + tool inputs + tool results).
function estimateMessageChars(messages: Array<{ content: unknown }>): number {
  let n = 0;
  for (const m of messages) {
    const c = m.content as unknown;
    if (typeof c === "string") { n += c.length; continue; }
    if (!Array.isArray(c)) continue;
    for (const b of c as Array<Record<string, unknown>>) {
      if (b.type === "text") n += String(b.text ?? "").length;
      else if (b.type === "tool_use") n += JSON.stringify(b.input ?? {}).length;
      else if (b.type === "tool_result") {
        n += typeof b.content === "string" ? b.content.length : JSON.stringify(b.content ?? "").length;
      }
    }
  }
  return n;
}

// Shorten large file contents inside OLD turns so the growing tool-loop history never
// exceeds the model's input window. The most recent `keepRecent` messages are left
// untouched (the model is actively reading/editing them); older write_file inputs and
// read_file results are capped (the file lives in the DB — it can be re-read if needed).
function truncateOldToolHistory(
  messages: Array<{ role: string; content: unknown }>,
  keepRecent: number,
  cap: number,
): void {
  const cutoff = Math.max(1, messages.length - keepRecent); // always keep messages[0] (original request)
  for (let i = 1; i < cutoff; i++) {
    const c = messages[i].content as unknown;
    if (!Array.isArray(c)) continue;
    for (const b of c as Array<Record<string, unknown>>) {
      if (b.type === "tool_result" && typeof b.content === "string" && b.content.length > cap) {
        b.content = b.content.slice(0, cap) + `\n…[ingekort: ${b.content.length - cap} tekens — lees het bestand opnieuw indien nodig]`;
      } else if (b.type === "tool_use" && b.input && typeof b.input === "object") {
        const input = b.input as Record<string, unknown>;
        for (const k of ["content", "new_string", "old_string"]) {
          if (typeof input[k] === "string" && (input[k] as string).length > cap) {
            input[k] = (input[k] as string).slice(0, cap) + "…[ingekort]";
          }
        }
      } else if (b.type === "text" && typeof b.text === "string" && (b.text as string).length > cap) {
        b.text = (b.text as string).slice(0, cap) + "…";
      }
    }
  }
}

async function runBuild(
  session: BuildSession,
  projectId: number,
  content: string,
  images: string[],
  buildPlan?: BuildPlan | null,
  intent?: IntentResult | null,
  writePlan?: WritePlan | null,
): Promise<void> {
  const send = (event: BuildEvent) => emitBuildEvent(session, event);
  try {
    const projectRows = await db.select().from(projects).where(eq(projects.id, projectId));
    if (projectRows.length === 0) {
      send({ type: "error", message: "Project not found" });
      finishBuildSession(session, "error");
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
    const fileCtx = buildFileContext(existingFiles, isImported, intent?.category);
    const protectedPaths = new Set(fileCtx.omitted);
    // Build the write plan. If the pipeline already produced one, use it.
    // If not (e.g. ArchitectureAgent failed), derive a minimal safety plan from
    // intent alone — this ensures enforcement ALWAYS runs for new_page tasks
    // even when planning agents throw.
    let effectiveWritePlan: WritePlan | null = writePlan ?? null;
    if (!effectiveWritePlan && intent) {
      if (buildPlan) {
        effectiveWritePlan = buildFilePlanner(buildPlan, intent, existingFiles.map(f => f.path));
      } else if (intent.category === "new_page") {
        // Minimal fallback: mark all existing HTML files as nav_update_only
        const fallbackRoles = new Map<string, FileRole>();
        for (const f of existingFiles) {
          if (f.path.endsWith(".html")) fallbackRoles.set(f.path, "nav_update_only");
        }
        const fallbackNewFiles = intent.newPages.map(p => p.filename);
        for (const p of fallbackNewFiles) fallbackRoles.set(p, "new_page");
        effectiveWritePlan = {
          fileRoles: fallbackRoles,
          blockedPatterns: [...intent.bookingUrls],
          requiredNewFiles: fallbackNewFiles,
        };
        logger.info({ fallbackRoles: [...fallbackRoles.entries()], blockedPatterns: intent.bookingUrls }, "[WritePlan] using fallback plan (ArchitectureAgent unavailable)");
      }
    }
    // Imported site + new_page: the protected original pages are not the live site.
    // Drop them from the editable (nav_update_only) set so only index.html is touched —
    // this is the cost fix (no more editing all 13 pages) and keeps the blueprint focused.
    if (isImported && intent?.category === "new_page" && effectiveWritePlan) {
      let removed = 0;
      for (const p of [...effectiveWritePlan.fileRoles.keys()]) {
        if (protectedPaths.has(p) && p !== "index.html" && p !== "index.htm" &&
            effectiveWritePlan.fileRoles.get(p) === "nav_update_only") {
          effectiveWritePlan.fileRoles.delete(p);
          removed++;
        }
      }
      if (removed > 0) logger.info({ removed }, "[WritePlan] imported new_page — restricted nav update to index.html only");

      // Also scrub the build plan so the TASK BLUEPRINT only tells the model to touch
      // index.html. Otherwise its "update nav in: index.html, docenten.html, …" list
      // makes the model attempt edits to every protected page (wasted calls, confusion).
      if (buildPlan) {
        const isEditable = (p: string) => !protectedPaths.has(p) || p === "index.html" || p === "index.htm";
        if (buildPlan.navUpdate) {
          buildPlan.navUpdate.files = buildPlan.navUpdate.files.filter(isEditable);
          if (buildPlan.navUpdate.files.length === 0) buildPlan.navUpdate.files = ["index.html"];
        }
        buildPlan.filesToEdit = buildPlan.filesToEdit.filter(f => isEditable(f.path));
      }
    }
    logger.info({
      hasWritePlan: !!effectiveWritePlan,
      intentCategory: intent?.category ?? "none",
      writePlanRoles: effectiveWritePlan ? [...effectiveWritePlan.fileRoles.entries()] : [],
      blockedPatterns: effectiveWritePlan?.blockedPatterns ?? [],
      requiredNewFiles: effectiveWritePlan?.requiredNewFiles ?? [],
    }, "[WritePlan] resolved for this build");
    const planBlock = buildPlan && intent && effectiveWritePlan
      ? buildPlanBlock(buildPlan, intent, effectiveWritePlan)
      : intent?.category === "new_page"
        ? ((intent.bookingUrls.length ?? 0) > 0
            ? buildExternalBookingOverrideBlock(intent)
            : buildNewPageFallbackBlock(intent))
        : (intent?.bookingUrls.length ?? 0) > 0
          ? buildExternalBookingOverrideBlock(intent!)
          : "";
    const systemPrompt = buildSystemPrompt(
      projectRows[0].name,
      fileCtx.context,
      learningsContext,
      importMode,
      isFirstBuild,
      planBlock,
      intent?.category,
    );

    send({
      type: "status",
      message: isFirstBuild ? "Planning your app" : "Reviewing your request",
    });

    const emitAgent = (evt: AgentEvent) => send({ type: "agent", ...evt });

    // In-memory file cache — updated live by tool calls so subsequent reads see latest content.
    const currentFiles = new Map<string, NebulaFile>(
      existingFiles.map(f => [f.path, { id: f.id, path: f.path, content: f.content ?? "" }]),
    );
    const written: string[] = [];
    let taskSummary = "";
    let narrationText = "";

    // Guard the model's input context window: system prompt + imported context +
    // the full chat history can exceed 200K tokens on long/imported projects, which
    // returns a 400 "prompt is too long" (surfaced to the user as "something went
    // wrong"). Trim the oldest history messages to stay under a safe budget.
    const fitted = fitHistoryToContext(systemPrompt.length, chatMessages);
    if (fitted.dropped > 0) {
      logger.warn(
        { projectId, droppedMessages: fitted.dropped, keptMessages: fitted.kept.length, systemPromptChars: systemPrompt.length },
        "[Context] trimmed old chat history to fit the model's input budget",
      );
    }
    const streamMsgs: ChatMsg[] = [
      { role: "system", content: systemPrompt },
      ...fitted.kept,
    ];
    attachImagesToLastUser(streamMsgs, images);

    const streamSystem = extractSystem(streamMsgs);
    const apiStreamMsgs = toAnthropicMsgs(streamMsgs);
    type ApiMsgsType = Parameters<typeof anthropic.messages.create>[0]["messages"];
    const loopMessages: ApiMsgsType = apiStreamMsgs as ApiMsgsType;

    const MAX_TOOL_ITERATIONS = 30;

    const sysChars = streamSystem ? streamSystem.length : 0;
    const MAX_INPUT_TOKENS = 170_000; // hard model limit is 200K — leave margin for tools + estimation error
    const CHARS_PER_TOKEN = 2.5; // conservative: dense HTML/code is ~2.7 chars/token, so 2.5 over-estimates tokens

    outer: for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      if (session.cancelled) break;

      // Bound the growing tool-loop history so we never exceed the model's input window.
      // Truncate old turns first; if still over budget, progressively shorten more turns
      // (down to keepRecent=0 as a last resort, which caps even the newest turn).
      for (let keepRecent = 6; keepRecent >= 0; keepRecent--) {
        const estTokens = (sysChars + estimateMessageChars(loopMessages)) / CHARS_PER_TOKEN;
        if (estTokens <= MAX_INPUT_TOKENS) break;
        const cap = keepRecent >= 4 ? 1500 : keepRecent >= 1 ? 800 : 400;
        truncateOldToolHistory(loopMessages, keepRecent, cap);
        if (keepRecent === 0) {
          logger.warn({ projectId, estTokens: Math.round(estTokens) }, "[Context] aggressively truncated tool-loop history to fit input budget");
        }
      }

      const controller = new AbortController();
      const createStream = () =>
        anthropic.messages.create(
          {
            model: "claude-sonnet-4-5",
            max_tokens: MAX_GENERATION_TOKENS,
            stream: true,
            tools: NEBULA_TOOLS as Parameters<typeof anthropic.messages.create>[0]["tools"],
            ...(streamSystem ? { system: streamSystem } : {}),
            messages: loopMessages,
          },
          { signal: controller.signal },
        );
      let stream;
      try {
        stream = await withRetry(createStream, "agentic-stream");
      } catch (err) {
        // Safety net: if the prompt is still too long despite the budget guard
        // (estimation error), aggressively shrink the history and retry once rather
        // than failing the whole build with "something went wrong".
        if (String((err as Error)?.message ?? err).includes("prompt is too long")) {
          logger.warn({ projectId }, "[Context] prompt too long — emergency truncation + retry");
          truncateOldToolHistory(loopMessages, 1, 400);
          stream = await withRetry(createStream, "agentic-stream-retry");
        } else {
          throw err;
        }
      }

      session.abort = () => {
        session.cancelled = true;
        try { controller.abort(); } catch {}
      };
      if (session.cancelled) { session.abort(); break; }

      // Accumulate response blocks for conversation history
      type TextBlock   = { type: "text";     text: string };
      type ToolUseBlk = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
      const responseBlocks: Array<TextBlock | ToolUseBlk> = [];
      const toolUses: ToolUseBlk[] = [];
      let currentTU: { id: string; name: string; inputJson: string } | null = null;
      let stopReason: string | null = null;
      let firstToken = true;

      try {
        for await (const event of stream) {
          if (session.cancelled) break;

          if (event.type === "content_block_start") {
            const cb = event.content_block;
            if (cb.type === "text") {
              responseBlocks.push({ type: "text", text: "" });
            } else if (cb.type === "tool_use") {
              currentTU = { id: cb.id, name: cb.name, inputJson: "" };
              const labels: Record<string, string> = {
                read_file:  "Bestand lezen…",
                write_file: "Bestand schrijven…",
                edit_file:  "Bestand aanpassen…",
                finish:     "Afronden…",
              };
              send({ type: "status", message: labels[cb.name] ?? `${cb.name}…` });
              // Begin live code streaming so the user can watch the file being written.
              if (cb.name === "write_file" || cb.name === "edit_file") {
                send({ type: "code_start", name: cb.name });
              }
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              const text = event.delta.text;
              narrationText += text;
              const last = responseBlocks[responseBlocks.length - 1];
              if (last?.type === "text") last.text += text;
              send({ type: "delta", text });
              if (firstToken) {
                firstToken = false;
                send({ type: "status", message: isFirstBuild ? "Generating code…" : "Aan het werk…" });
              }
            } else if (event.delta.type === "input_json_delta" && currentTU) {
              currentTU.inputJson += event.delta.partial_json;
              // Forward the file content as it streams so the live code panel can render it.
              if (currentTU.name === "write_file" || currentTU.name === "edit_file") {
                send({ type: "code_delta", text: event.delta.partial_json });
              }
            }
          } else if (event.type === "content_block_stop") {
            if (currentTU) {
              if (currentTU.name === "write_file" || currentTU.name === "edit_file") {
                send({ type: "code_end" });
              }
              try {
                const parsedInput = JSON.parse(currentTU.inputJson || "{}") as Record<string, unknown>;
                const tu: ToolUseBlk = { type: "tool_use", id: currentTU.id, name: currentTU.name, input: parsedInput };
                toolUses.push(tu);
                responseBlocks.push(tu);
              } catch { /* malformed JSON — skip this tool call */ }
              currentTU = null;
            }
          } else if (event.type === "message_delta") {
            stopReason = event.delta.stop_reason ?? stopReason;
          }
        }
      } catch (streamErr) {
        if (!session.cancelled) throw streamErr;
      }

      if (session.cancelled) break outer;

      // Append assistant turn to conversation history
      loopMessages.push({
        role: "assistant",
        content: responseBlocks as unknown as ApiMsgsType[number]["content"],
      });

      if (!toolUses.length || stopReason === "end_turn") break;

      // Execute tool calls and collect results
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      let shouldFinish = false;

      for (const tu of toolUses) {
        if (tu.name === "finish") {
          taskSummary = String(tu.input.summary ?? "");
          shouldFinish = true;
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "done" });
          continue;
        }
        const result = await executeNebulaToolCall(
          tu.name, tu.input, projectId, currentFiles, written, emitAgent, protectedPaths, effectiveWritePlan, intent ?? null,
        );
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
      }

      loopMessages.push({
        role: "user",
        content: toolResults as unknown as ApiMsgsType[number]["content"],
      });

      if (shouldFinish) break;
    }

    if (session.cancelled) {
      await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      send({ type: "done", files: [], cancelled: true });
      finishBuildSession(session, "done");
      return;
    }

    if (written.length === 0 && existingFiles.length === 0) {
      send({
        type: "error",
        message: "I couldn't generate valid files. Please try rephrasing your request.",
      });
      finishBuildSession(session, "error");
      return;
    }

    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    // ── Phase 4: Deterministic validation ────────────────────────────────────
    if (written.length > 0) {
      const allFileContents = new Map<string, string>(
        [...currentFiles.entries()].map(([p, f]) => [p, f.content]),
      );
      const validation = runDeterministicValidator(
        written, allFileContents, intent ?? null, effectiveWritePlan, content,
      );

      // Warnings are non-blocking and informational; they confused users by showing up
      // as red "errors" in the chat. Keep them in the server log only — never surface
      // them in the chat. Only true hard-fails are shown to the user (below).
      if (validation.warnings.length > 0) {
        logger.info({ warnings: validation.warnings.map(w => `${w.file}: ${w.detail}`) }, "[Validator] non-blocking warnings (not shown to user)");
      }

      // ── Phase 5: Smart repair on hard fails ─────────────────────────────────
      if (!validation.passed && validation.hardFails.length > 0) {
        for (const hf of validation.hardFails) {
          emitAgent({ event: "validation_error", path: hf.file, error: hf.detail });
        }
        const repairedPaths = await runSmartRepair(
          session, projectId, validation, currentFiles, intent ?? { category: "edit_existing", newPages: [], targetFiles: [], needsNavUpdate: false, complexity: "medium", bookingUrls: [] }, written,
        );
        for (const p of repairedPaths) {
          if (!written.includes(p)) written.push(p);
        }

        // Re-validate after repair
        const allFileContents2 = new Map<string, string>(
          [...currentFiles.entries()].map(([p, f]) => [p, f.content]),
        );
        const revalidation = runDeterministicValidator(written, allFileContents2, intent ?? null, effectiveWritePlan, content);
        if (!revalidation.passed) {
          for (const hf of revalidation.hardFails) {
            emitAgent({ event: "validation_error", path: hf.file, error: `[post-repair] ${hf.detail}` });
          }
        }
      }
    }

    // NOTE: the deterministic post-build nav propagation / shell-sync / stylesheet-sync was
    // removed — on real WordPress/Astra markup it broke the nav (duplicate <li>, items
    // dropping below the bar). The model handles its own navigation (copying the site's nav
    // per the system prompt), which is what worked reliably before. Page CSS resolves via the
    // preview-page <base href> inheritance for created pages.

    const explanation = taskSummary || extractNarration(narrationText) || (isFirstBuild ? "App gebouwd!" : "Aanpassing doorgevoerd.");
    const [assistantMsg] = await db
      .insert(projectMessages)
      .values({ projectId, role: "assistant", content: explanation })
      .returning();

    send({ type: "message", id: assistantMsg.id, content: explanation });
    send({ type: "done", files: written });
    finishBuildSession(session, "done");

    if (isFirstBuild) {
      void generateProjectName(projectId, content);
    } else {
      void recordLearning(projectId, content);
    }
  } catch (err) {
    logger.error({ err, projectId }, "Failed to run build");
    send({ type: "error", message: "Something went wrong while building your app." });
    finishBuildSession(session, "error");
  }
}

// ─── Build pipeline: Intent → Architecture → CodeGenerator → Validator ────────
//
// Inspired by LangGraph's conditional routing (route by intent category)
// and CrewAI's specialized agents (each agent has one clear responsibility).
// OpenHands' observation/action loop drives the CodeGenerator phase.

// ─── Full workflow state machine ───────────────────────────────────────────────
//
//   IntentAgent → ArchitectureAgent → FilePlanner → CodeExecutor → Validator → RepairAgent
//
// Phase routing is conditional (LangGraph-style): only run ArchitectureAgent
// and FilePlanner when the intent actually warrants it.

async function runBuildPipeline(
  session: BuildSession,
  projectId: number,
  content: string,
  images: string[],
): Promise<void> {
  const send = (event: BuildEvent) => emitBuildEvent(session, event);

  const state: WorkflowState = {
    phase: "intent",
    intent: null,
    buildPlan: null,
    writePlan: null,
    repairAttempts: 0,
  };

  try {
    // Fetch paths only (lightweight — full files are loaded in runBuild)
    const pathRows = await db
      .select({ path: projectFiles.path })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    const existingPaths = pathRows.map(r => r.path);

    // Snapshot the pre-build file state so the user can "draai dit terug" after a build.
    if (existingPaths.length > 0) await snapshotProject(projectId, content.slice(0, 120));

    // ── Phase 1: Intent Agent ──────────────────────────────────────────────────
    if (existingPaths.length > 0 && images.length === 0) {
      send({ type: "status", message: "Verzoek analyseren..." });
      try {
        state.intent = await runIntentAgent(content, existingPaths);
        state.phase = "architecture";
        logger.info({ intent: state.intent }, "[Pipeline] IntentAgent result");
      } catch (err) {
        logger.warn({ err }, "[Pipeline] IntentAgent failed — running without intent");
      }
    }

    // ── Phase 2: Architecture Agent (new_page or complex new_feature only) ─────
    if (state.intent && (
      state.intent.category === "new_page" ||
      (state.intent.category === "new_feature" && state.intent.complexity === "high")
    )) {
      send({ type: "status", message: "Bouwplan opstellen..." });
      try {
        state.buildPlan = await runArchitectureAgent(content, state.intent, existingPaths);
        // Pipeline guard: for new_page intent, filesToCreate must never be empty after ArchitectureAgent.
        // A second synthesis pass here catches the case where the AI JSON parsed but dropped the array.
        if (
          state.intent.category === "new_page" &&
          (!state.buildPlan.filesToCreate || state.buildPlan.filesToCreate.length === 0) &&
          state.intent.newPages.length > 0
        ) {
          logger.warn({ newPages: state.intent.newPages }, "[Pipeline] ArchitectureAgent returned empty filesToCreate for new_page — deriving from intent.newPages");
          state.buildPlan.filesToCreate = state.intent.newPages.map(p => ({ path: p.filename, purpose: p.navLabel }));
          state.buildPlan.executionOrder = [
            ...state.intent.newPages.map(p => p.filename),
            ...existingPaths.filter(p => p.endsWith(".html")),
          ];
        }
        state.phase = "execute";
        logger.info({ buildPlan: state.buildPlan }, "[Pipeline] ArchitectureAgent result");
      } catch (err) {
        logger.warn({ err }, "[Pipeline] ArchitectureAgent failed — fallback WritePlan will be used");
      }
    }

    // ── Phase 3: File Planner (produces WritePlan for tool enforcement) ─────────
    if (state.intent && state.buildPlan) {
      state.writePlan = buildFilePlanner(state.buildPlan, state.intent, existingPaths);
      logger.info({
        writePlanRoles: [...state.writePlan.fileRoles.entries()],
        blockedPatterns: state.writePlan.blockedPatterns,
        requiredNewFiles: state.writePlan.requiredNewFiles,
      }, "[Pipeline] FilePlanner result");
    }

    // ── Phases 4–5: CodeExecutor + Validator + RepairAgent (inside runBuild) ───
    await runBuild(session, projectId, content, images, state.buildPlan, state.intent, state.writePlan);
  } catch (err) {
    logger.error({ err, projectId }, "runBuildPipeline failed");
    send({ type: "error", message: "Er is iets misgegaan tijdens het bouwen." });
    finishBuildSession(session, "error");
  }
}

// Short acknowledgments / greetings — detected so we can skip a full build.
const CONVERSATIONAL_RE =
  /^((dankjewel|bedankt|dank\s+je(\s+wel)?|thanks?|thank\s+you|oke?y?|super|perfect|top|goed(\s+zo)?|mooi|geweldig|ja|nee|yes|no|prima|fijn|cool|nice|great|awesome|fantastisch|uitstekend|precies|correct|juist|haha+|wow|lol)[\s!?.,:]*)+$/i;

async function checkConversational(content: string, projectId: number): Promise<boolean> {
  if (!CONVERSATIONAL_RE.test(content.trim())) return false;
  const rows = await db.select({ id: projectFiles.id })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .limit(1);
  return rows.length > 0; // never skip the very first build
}

async function handleConversational(session: BuildSession, projectId: number, content: string): Promise<void> {
  const send = (event: BuildEvent) => emitBuildEvent(session, event);
  try {
    await db.insert(projectMessages).values({ projectId, role: "user", content });
    const opts = [
      "Graag gedaan! Laat maar weten als je iets wilt aanpassen.",
      "Geen probleem! Zeg maar als je nog iets nodig hebt.",
      "Top! Laat me weten als je nog wensen hebt.",
      "Fijn! Heb je nog andere aanpassingen nodig?",
    ];
    const reply = opts[Math.floor(Math.random() * opts.length)];
    await db.insert(projectMessages).values({ projectId, role: "assistant", content: reply });
    send({ type: "text", text: reply });
    send({ type: "done", files: [] });
    finishBuildSession(session, "done");
  } catch (err) {
    logger.error({ err, projectId }, "handleConversational failed");
    send({ type: "error", message: "Something went wrong." });
    finishBuildSession(session, "error");
  }
}

// ─── Command architecture: AI classifies intent → JSON; hardcoded functions execute ──────
//
// The ONLY AI call here maps free text to one fixed action (no HTML/CSS generation). The
// action is then carried out by the deterministic functions in lib/actions.ts.
async function classifyCommand(text: string): Promise<BuilderAction> {
  // Deterministic shortcut: a "booking app" request needs NO AI at all — the app is hard-coded.
  if (/\b(booking[\s-]?app|boekings?[\s-]?app|boekings?systeem|reserverings?(?:systeem|app)|reservatie[\s-]?systeem)\b/i.test(text)) {
    return { action: "add_booking_app" };
  }
  const catalogue = ACTION_CATALOGUE
    .map((a) => `- "${a.action}" (params: ${a.params.join(", ") || "—"}) → ${a.when}`)
    .join("\n");
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Map the user's request to EXACTLY ONE action. Reply with ONLY a JSON object, no prose.

Actions:
${catalogue}

Rules:
- Output shape: {"action": "<one of the action names>", ...params}
- For add_nav_item: include "label" (visible text) and "href" (e.g. "<slug>.html" for an internal page, or "#<id>" / a URL).
- For create_page: include "name" (slug/title) and "navLabel" (the tab text).
- For change_color: include "target" (one of: primary, background, text, buttons, links, nav, headings) and "color" as a CSS HEX value. Translate colour words to hex (e.g. donkerblauw → #1e3a8a, rood → #dc2626). "nav"/"menu"/"balk" → target "nav"; "knoppen" → "buttons"; "achtergrond" → "background"; "titels"/"koppen" → "headings"; a general "maak de site X" → "primary".
- For change_font: include "family" (e.g. "Poppins", "Roboto", "Montserrat").
- For change_text: include "from" (the exact current text) and "to" (the new text). ONLY use this when the user clearly gives BOTH the old and the new text.
- For replace_image: include "match" ("logo", "hero", "all", or a word from the image's filename/alt) and "src" (the new image URL).
- For set_booking_logins: when the user gives login details for the booking app, extract EVERY account into "accounts": an array of {role, name, email, password}. role is "admin" for the studio owner/manager/admin login, otherwise "teacher". Example: 'admin login is Eva eva@x.nl Geheim1, docent Lisa lisa@x.nl Yoga2' → {"action":"set_booking_logins","accounts":[{"role":"admin","name":"Eva","email":"eva@x.nl","password":"Geheim1"},{"role":"teacher","name":"Lisa","email":"lisa@x.nl","password":"Yoga2"}]}. If a name is missing, derive it from the e-mail. Keep passwords EXACTLY as written.
- For undo: when the user wants to revert/reverse/take back the previous change ("draai dit terug", "maak het ongedaan", "toch niet doen", "haal die wijziging weg", "undo", "ga terug naar hoe het was") → {"action":"undo","reason":"..."}.
- A request that needs NEW layout, NEW sections, restructuring, or content you'd have to write yourself → {"action":"none","reason":"needs build"}.
- If unclear, return {"action":"none","reason":"<short reason>"}.

User request: "${text.slice(0, 400)}"`,
      }],
    });
    const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "{}";
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { action: "none", reason: "no JSON" };
    return validateAction(parsed);
  } catch (err) {
    logger.warn({ err }, "[command] classify failed");
    return { action: "none", reason: "classification failed" };
  }
}

// Parse a list of booking-app login accounts from the classified JSON.
function parseBookingAccounts(p: Record<string, unknown>): { role: "admin" | "teacher"; name: string; email: string; password: string }[] {
  const raw = Array.isArray(p.accounts) ? (p.accounts as Record<string, unknown>[]) : [];
  return raw
    .map((x) => ({
      role: x.role === "admin" ? ("admin" as const) : ("teacher" as const),
      name: typeof x.name === "string" ? x.name.trim() : "",
      email: typeof x.email === "string" ? x.email.trim().toLowerCase() : "",
      password: typeof x.password === "string" ? x.password : "",
    }))
    .filter((x) => x.name && /.+@.+\..+/.test(x.email) && x.password);
}

// Validate/normalise the AI JSON so a malformed reply can never reach the executors.
function validateAction(p: Record<string, unknown>): BuilderAction {
  const a = String(p.action ?? "");
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : "");
  switch (a) {
    case "add_nav_item":
      return s("label") && s("href") ? { action: "add_nav_item", label: s("label"), href: s("href") } : { action: "none", reason: "missing label/href" };
    case "remove_nav_item":
      return s("label") ? { action: "remove_nav_item", label: s("label") } : { action: "none", reason: "missing label" };
    case "rename_nav_item":
      return s("from") && s("to") ? { action: "rename_nav_item", from: s("from"), to: s("to") } : { action: "none", reason: "missing from/to" };
    case "create_page":
      return s("name") && s("navLabel") ? { action: "create_page", name: s("name"), navLabel: s("navLabel") } : { action: "none", reason: "missing name/navLabel" };
    case "change_color": {
      const allowed = ["primary", "background", "text", "buttons", "links", "nav", "headings"] as const;
      const t = s("target").toLowerCase();
      const target = (allowed as readonly string[]).includes(t) ? (t as (typeof allowed)[number]) : "primary";
      return s("color") ? { action: "change_color", target, color: s("color") } : { action: "none", reason: "missing color" };
    }
    case "change_font":
      return s("family") ? { action: "change_font", family: s("family") } : { action: "none", reason: "missing family" };
    case "change_text":
      return s("from") && s("to") ? { action: "change_text", from: s("from"), to: s("to") } : { action: "none", reason: "missing from/to" };
    case "replace_image":
      return s("match") && s("src") ? { action: "replace_image", match: s("match"), src: s("src") } : { action: "none", reason: "missing match/src" };
    case "edit_element": {
      const ops = ["text", "image", "color", "background"] as const;
      const op = s("op") as (typeof ops)[number];
      return s("page") && s("selector") && (ops as readonly string[]).includes(op)
        ? { action: "edit_element", page: s("page"), selector: s("selector"), op, value: typeof p.value === "string" ? (p.value as string) : "" }
        : { action: "none", reason: "missing edit_element params" };
    }
    case "add_section": {
      const kinds = ["heading", "text", "image-text", "gallery", "cta"] as const;
      const kind = s("kind") as (typeof kinds)[number];
      return s("page") && (kinds as readonly string[]).includes(kind)
        ? { action: "add_section", page: s("page"), kind }
        : { action: "none", reason: "missing add_section params" };
    }
    case "add_booking_app":
      return parseBookingAccounts(p).length ? { action: "add_booking_app", accounts: parseBookingAccounts(p) } : { action: "add_booking_app" };
    case "set_booking_logins": {
      const accounts = parseBookingAccounts(p);
      return accounts.length ? { action: "set_booking_logins", accounts } : { action: "none", reason: "no valid login credentials found" };
    }
    case "undo":
      return { action: "undo", reason: s("reason") || "undo last change" };
    default:
      return { action: "none", reason: s("reason") || "unrecognised action" };
  }
}

// ─── Undo history ────────────────────────────────────────────────────────────
// Snapshot the FULL current file state BEFORE any mutating action (a /command edit
// or an AI build). "draai terug"/"maak ongedaan" restores the most recent snapshot.
const MAX_SNAPSHOTS = 25;

async function snapshotProject(projectId: number, label: string): Promise<void> {
  try {
    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    if (files.length === 0) return; // nothing to restore to
    const payload = JSON.stringify(files.map((f) => ({ path: f.path, content: f.content, language: f.language })));
    await db.insert(projectSnapshots).values({ projectId, label: label.slice(0, 200), files: payload });
    // Prune to the last MAX_SNAPSHOTS so history can't grow without bound.
    const rows = await db
      .select({ id: projectSnapshots.id })
      .from(projectSnapshots)
      .where(eq(projectSnapshots.projectId, projectId))
      .orderBy(desc(projectSnapshots.id));
    const stale = rows.slice(MAX_SNAPSHOTS).map((r) => r.id);
    for (const id of stale) await db.delete(projectSnapshots).where(eq(projectSnapshots.id, id));
  } catch (err) {
    logger.warn({ err, projectId }, "[snapshot] failed (continuing without undo point)");
  }
}

// Restore the project to the most recent snapshot, then drop that snapshot so a second
// "undo" walks further back. Returns a human summary, or null if there's nothing to undo.
async function undoProject(projectId: number): Promise<{ summary: string; affected: string[] } | null> {
  const [snap] = await db
    .select()
    .from(projectSnapshots)
    .where(eq(projectSnapshots.projectId, projectId))
    .orderBy(desc(projectSnapshots.id))
    .limit(1);
  if (!snap) return null;

  const prev = JSON.parse(snap.files) as { path: string; content: string; language: string }[];
  const prevByPath = new Map(prev.map((f) => [f.path, f]));
  const current = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const curByPath = new Map(current.map((f) => [f.path, f]));
  const affected: string[] = [];

  // Restore/insert every file from the snapshot.
  for (const f of prev) {
    const cur = curByPath.get(f.path);
    if (cur) {
      if (cur.content !== f.content) {
        await db.update(projectFiles).set({ content: f.content, language: f.language, updatedAt: new Date() }).where(eq(projectFiles.id, cur.id));
        affected.push(f.path);
      }
    } else {
      await db.insert(projectFiles).values({ projectId, path: f.path, content: f.content, language: f.language });
      affected.push(f.path);
    }
  }
  // Delete files that exist now but did NOT exist in the snapshot (i.e. were created since).
  for (const f of current) {
    if (!prevByPath.has(f.path)) {
      await db.delete(projectFiles).where(eq(projectFiles.id, f.id));
      affected.push(f.path);
    }
  }

  await db.delete(projectSnapshots).where(eq(projectSnapshots.id, snap.id));
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
  const what = snap.label ? ` ("${snap.label}")` : "";
  return { summary: `Laatste wijziging${what} teruggedraaid op ${affected.length} bestand(en).`, affected };
}

// Per-element edit (from the visual select-and-edit mode). Targets ONE element on ONE page
// via a CSS selector and edits it with cheerio (byte-faithful round-trip). Snapshots first.
async function editElement(
  projectId: number,
  a: { page: string; selector: string; op: "text" | "image" | "color" | "background"; value: string },
): Promise<{ summary: string; affected: string[] }> {
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const file = files.find((f) => f.path === a.page) ?? files.find((f) => f.path === "index.html");
  if (!file) return { summary: "Pagina niet gevonden.", affected: [] };

  const $ = cheerioLoad(file.content);
  let el;
  try { el = $(a.selector).first(); } catch { return { summary: "Ongeldige selector.", affected: [] }; }
  if (!el || el.length === 0) return { summary: "Element niet gevonden.", affected: [] };

  const mergeStyle = (prop: string, value: string) => {
    const cur = (el!.attr("style") || "").replace(new RegExp(prop + "\\s*:[^;]*;?", "i"), "").trim();
    el!.attr("style", (cur ? cur.replace(/;?\s*$/, "; ") : "") + prop + ":" + value + ";");
  };

  if (a.op === "text") el.text(a.value);
  else if (a.op === "image") { el.removeAttr("srcset"); el.removeAttr("data-src"); el.removeAttr("data-srcset"); el.attr("src", a.value); }
  else if (a.op === "color") mergeStyle("color", a.value);
  else if (a.op === "background") mergeStyle("background-color", a.value);

  const out = $.html();
  if (out === file.content) return { summary: "Geen wijziging.", affected: [] };

  await snapshotProject(projectId, `bewerk ${a.op}`);
  await db.update(projectFiles).set({ content: out, updatedAt: new Date() }).where(eq(projectFiles.id, file.id));
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
  const label = { text: "Tekst", image: "Afbeelding", color: "Tekstkleur", background: "Achtergrond" }[a.op];
  return { summary: `${label} van element aangepast op ${file.path}.`, affected: [file.path] };
}

router.post("/projects/:projectId/command", json({ limit: "1mb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  if (!message.trim()) { res.status(400).json({ error: "message is required" }); return; }

  try {
    // 1) AI: intent → JSON (the only AI step).
    const action = await classifyCommand(message);
    logger.info({ projectId, action }, "[command] classified");

    // Not a simple deterministic command → tell the caller to fall back to the AI build.
    // Don't persist anything here so the build path can own the message.
    if (action.action === "none") {
      res.json({ handled: false, action });
      return;
    }

    // Undo: restore the most recent snapshot (no AI, no new snapshot).
    if (action.action === "undo") {
      const undone = await undoProject(projectId);
      const summary = undone?.summary ?? "Er is niets om terug te draaien.";
      await db.insert(projectMessages).values({ projectId, role: "user", content: message });
      await db.insert(projectMessages).values({ projectId, role: "assistant", content: summary });
      res.json({ handled: true, action, summary, changedFiles: undone?.affected ?? [], createdFiles: [], undone: !!undone });
      return;
    }

    // 2) Hardcoded execution on the project's files.
    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const result = applyAction(action, files.map((f) => ({ path: f.path, content: f.content })));

    // Snapshot the pre-change state so this edit can be undone with "draai terug".
    if (result.changed.length > 0 || result.created.length > 0) {
      await snapshotProject(projectId, message.slice(0, 120));
    }

    // 3) Persist deterministically.
    const byPath = new Map(files.map((f) => [f.path, f]));
    for (const c of result.changed) {
      const existing = byPath.get(c.path);
      if (existing) {
        await db.update(projectFiles).set({ content: c.content, updatedAt: new Date() }).where(eq(projectFiles.id, existing.id));
      }
    }
    for (const n of result.created) {
      await db.insert(projectFiles).values({ projectId, path: n.path, content: n.content, language: "html" });
    }

    // 4) Record the exchange in the chat history so the UI shows it like any other turn.
    await db.insert(projectMessages).values({ projectId, role: "user", content: message });
    await db.insert(projectMessages).values({ projectId, role: "assistant", content: result.summary });
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    // SECURITY: seed the studio's logins server-side (authoritative), so passwords never need to live
    // in the served page. Trusted call → may update an existing password when the owner changes it.
    if ((action.action === "add_booking_app" || action.action === "set_booking_logins") && "accounts" in action && Array.isArray(action.accounts) && action.accounts.length) {
      try { await seedStaffAccounts(projectId, action.accounts, true); } catch (err) { logger.warn({ err, projectId }, "[command] staff seed failed"); }
    }

    // First-time booking app → generate the e-mail branding once (logo + name + AI copy).
    if (action.action === "add_booking_app" && result.created.some((c) => c.path === "booking-app.html")) {
      const all = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
      await generateEmailBrand(projectId, all.map((f) => ({ path: f.path, content: f.content })));
    }

    res.json({
      handled: true,
      action,
      summary: result.summary,
      changedFiles: result.changed.map((c) => c.path),
      createdFiles: result.created.map((c) => c.path),
    });
  } catch (err) {
    logger.error({ err, projectId }, "[command] failed");
    res.status(500).json({ error: "Command failed" });
  }
});

// Direct action execution — NO AI. The visual "select & edit" mode in the preview
// already knows exactly which action to run (e.g. change_text / replace_image on the
// clicked element), so it posts the action straight here: deterministic, free, undoable.
router.post("/projects/:projectId/action", json({ limit: "1mb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const raw = req.body?.action;
  if (!raw || typeof raw !== "object") { res.status(400).json({ error: "action is required" }); return; }

  try {
    const action = validateAction(raw as Record<string, unknown>);
    if (action.action === "none") { res.json({ handled: false, action }); return; }

    if (action.action === "undo") {
      const undone = await undoProject(projectId);
      res.json({ handled: true, action, summary: undone?.summary ?? "Er is niets om terug te draaien.", changedFiles: undone?.affected ?? [], createdFiles: [], undone: !!undone });
      return;
    }

    if (action.action === "edit_element") {
      const r = await editElement(projectId, action);
      res.json({ handled: true, action, summary: r.summary, changedFiles: r.affected, createdFiles: [] });
      return;
    }

    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const result = applyAction(action, files.map((f) => ({ path: f.path, content: f.content })));
    if (result.changed.length === 0 && result.created.length === 0) {
      res.json({ handled: true, action, summary: "Geen wijziging nodig.", changedFiles: [], createdFiles: [] });
      return;
    }

    await snapshotProject(projectId, result.summary);

    const byPath = new Map(files.map((f) => [f.path, f]));
    for (const c of result.changed) {
      const existing = byPath.get(c.path);
      if (existing) await db.update(projectFiles).set({ content: c.content, updatedAt: new Date() }).where(eq(projectFiles.id, existing.id));
    }
    for (const n of result.created) {
      await db.insert(projectFiles).values({ projectId, path: n.path, content: n.content, language: "html" });
    }
    await db.insert(projectMessages).values({ projectId, role: "assistant", content: result.summary });
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    // SECURITY: seed logins server-side (authoritative) so passwords never live in the served page.
    if ((action.action === "add_booking_app" || action.action === "set_booking_logins") && "accounts" in action && Array.isArray(action.accounts) && action.accounts.length) {
      try { await seedStaffAccounts(projectId, action.accounts, true); } catch (err) { logger.warn({ err, projectId }, "[action] staff seed failed"); }
    }

    // When the booking app is first created, generate the e-mail branding ONCE (logo + name +
    // AI-written copy). Reused by every later e-mail; skipped if it already exists.
    if (action.action === "add_booking_app" && result.created.some((c) => c.path === "booking-app.html")) {
      const all = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
      await generateEmailBrand(projectId, all.map((f) => ({ path: f.path, content: f.content })));
    }

    res.json({ handled: true, action, summary: result.summary, changedFiles: result.changed.map((c) => c.path), createdFiles: result.created.map((c) => c.path) });
  } catch (err) {
    logger.error({ err, projectId }, "[action] failed");
    res.status(500).json({ error: "Action failed" });
  }
});

// Set (or reset) the booking-app homepage background from an uploaded image. Stores the image
// as assets/booking-bg.txt and regenerates booking-app.html. Larger body limit for the data URL.
router.post("/projects/:projectId/booking-bg", json({ limit: "12mb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const image = typeof req.body?.image === "string" ? req.body.image : "";
  const reset = req.body?.reset === true || image === "";
  if (!reset && !/^data:image\/(png|jpe?g|webp);base64,/.test(image)) {
    res.status(400).json({ error: "Geef een geldige afbeelding mee." }); return;
  }
  try {
    const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    if (!rows.some((f) => f.path === "booking-app.html")) {
      res.json({ handled: false, error: "Er is nog geen booking-app. Vraag eerst 'maak een booking app'." }); return;
    }
    await snapshotProject(projectId, reset ? "achtergrond herstellen" : "achtergrond uploaden");
    const assetPath = "assets/booking-bg.txt";
    const asset = rows.find((f) => f.path === assetPath);
    if (reset) {
      if (asset) await db.delete(projectFiles).where(eq(projectFiles.id, asset.id));
    } else if (asset) {
      await db.update(projectFiles).set({ content: image, updatedAt: new Date() }).where(eq(projectFiles.id, asset.id));
    } else {
      await db.insert(projectFiles).values({ projectId, path: assetPath, content: image, language: "plaintext" });
    }
    // Rebuild the booking app with the new background.
    const fresh = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const rebuilt = rebuildBookingApp(fresh.map((f) => ({ path: f.path, content: f.content })));
    if (rebuilt) {
      const page = fresh.find((f) => f.path === "booking-app.html")!;
      await db.update(projectFiles).set({ content: rebuilt.content, updatedAt: new Date() }).where(eq(projectFiles.id, page.id));
    }
    const summary = reset ? "Achtergrond hersteld (automatische hero/gradient)." : "Homepagina-achtergrond van de booking-app aangepast.";
    await db.insert(projectMessages).values({ projectId, role: "assistant", content: summary });
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    res.json({ handled: true, summary });
  } catch (err) {
    logger.error({ err, projectId }, "[booking-bg] failed");
    res.status(500).json({ error: "Achtergrond instellen mislukt." });
  }
});

// Transactional e-mail trigger from the booking app (fire-and-forget). Sends the matching
// e-mail now (booking/cancel/welcome) and, for a booking, schedules the 24h reminder; a cancel
// deletes any pending reminder for that booking. SMTP must be configured (env) or this no-ops.
router.post("/projects/:projectId/notify", json({ limit: "256kb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const b = req.body ?? {};
  const type = String(b.type ?? "");
  const to = String(b.to ?? "").trim();
  const allowed: EmailKind[] = ["booking", "cancel", "welcome", "reset", "promoted"];
  if (!allowed.includes(type as EmailKind)) { res.status(400).json({ error: "Onbekend type." }); return; }
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { res.status(400).json({ error: "Ongeldig e-mailadres." }); return; }
  const data = {
    studio: String(b.studio ?? ""),
    name: String(b.name ?? ""),
    classTitle: String(b.classTitle ?? ""),
    date: String(b.date ?? ""),
    time: String(b.time ?? ""),
    password: String(b.password ?? ""),
    mode: String(b.mode ?? ""),
    onlineLink: String(b.onlineLink ?? ""),
    onlineInfo: String(b.onlineInfo ?? ""),
  };
  const bookingId = String(b.bookingId ?? "");
  try {
    // Schedule / unschedule the 24h reminder (a promoted waitlister is now booked → also gets one).
    if ((type === "booking" || type === "promoted") && data.date) {
      const lessonAt = new Date(data.date + "T" + (data.time || "00:00") + ":00");
      if (!isNaN(lessonAt.getTime())) {
        const sendAt = new Date(lessonAt.getTime() - 24 * 60 * 60 * 1000);
        if (lessonAt.getTime() > Date.now()) {
          await db.insert(emailReminders).values({
            projectId, bookingId, email: to, name: data.name,
            classTitle: data.classTitle, studio: data.studio, lessonAt, sendAt,
          });
        }
      }
    } else if (type === "cancel" && bookingId) {
      await db.delete(emailReminders).where(and(eq(emailReminders.projectId, projectId), eq(emailReminders.bookingId, bookingId)));
    }
    // Send the immediate confirmation e-mail (best-effort; no-op if SMTP unconfigured).
    let sent = false;
    try { sent = await sendBookingEmail(projectId, to, type as EmailKind, data); }
    catch (err) { logger.warn({ err, projectId, type }, "[notify] send failed"); }
    res.json({ handled: true, sent });
  } catch (err) {
    logger.error({ err, projectId }, "[notify] failed");
    res.status(500).json({ error: "Notificatie mislukt." });
  }
});

// E-mail status: all mail is sent from ONE central account (configured in the server's .env).
// Returns whether it's configured + the from address. Never returns the password.
router.get("/projects/:projectId/email", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const cfg = await resolveSmtpConfig(projectId);
    res.json(cfg ? { configured: true, from: cfg.from } : { configured: false });
  } catch (err) { logger.error({ err, projectId }, "[email] status failed"); res.status(500).json({ error: "Kon status niet ophalen." }); }
});

// Send a real test e-mail using the central config. Defaults to sending to the from address.
router.post("/projects/:projectId/email/test", json({ limit: "32kb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const bodyTo = String(req.body?.to ?? "").trim();
  try {
    const cfg = await resolveSmtpConfig(projectId);
    if (!cfg) { res.status(400).json({ ok: false, error: "E-mail is nog niet ingesteld op de server." }); return; }
    const to = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(bodyTo) ? bodyTo : cfg.from;
    const brand = (await loadEmailBrand(projectId)) || undefined;
    await sendWithConfig(cfg, to, "test", {}, brand);
    res.json({ ok: true, to });
  } catch (err) {
    logger.warn({ err, projectId }, "[email] test failed");
    res.status(502).json({ ok: false, error: explainSmtpError((err as Error)?.message || "onbekend") });
  }
});

// "Bericht naar leden": send a real, admin-written e-mail (subject + body) to a list of recipients.
// The booking app supplies the recipient e-mails (they live client-side in localStorage).
router.post("/projects/:projectId/email/broadcast", json({ limit: "512kb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const subject = String(req.body?.subject ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  const recipients = Array.isArray(req.body?.recipients)
    ? Array.from(new Set(req.body.recipients.map((e: unknown) => String(e).trim().toLowerCase()))).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    : [];
  if (!subject || !body) { res.status(400).json({ error: "Onderwerp en bericht zijn verplicht." }); return; }
  if (!recipients.length) { res.status(400).json({ error: "Geen geldige ontvangers." }); return; }
  if (recipients.length > 500) { res.status(400).json({ error: "Maximaal 500 ontvangers per bericht." }); return; }
  try {
    const r = await sendBroadcast(projectId, recipients, subject, body);
    if (!r.configured) { res.status(400).json({ ok: false, error: "E-mail is nog niet ingesteld op de server." }); return; }
    res.json({ ok: true, sent: r.sent, total: r.total });
  } catch (err) {
    logger.error({ err, projectId }, "[email] broadcast failed");
    res.status(502).json({ ok: false, error: explainSmtpError((err as Error)?.message || "onbekend") });
  }
});

// Invoice settings (studio's legal details for invoices) — shown/edited in the Facturatie tab.
router.get("/projects/:projectId/invoice-settings", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try { res.json(await getInvoiceSettings(projectId)); }
  catch (err) { logger.error({ err, projectId }, "[invoice] settings get failed"); res.status(500).json({ error: "Kon instellingen niet ophalen." }); }
});
router.post("/projects/:projectId/invoice-settings", json({ limit: "32kb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try { await saveInvoiceSettings(projectId, req.body ?? {}); res.json({ ok: true, ...(await getInvoiceSettings(projectId)) }); }
  catch (err) { logger.error({ err, projectId }, "[invoice] settings save failed"); res.status(500).json({ error: "Opslaan mislukt." }); }
});

// Generate an invoice for a payment + e-mail the payment confirmation (called on every Stripe payment).
router.post("/projects/:projectId/invoice", json({ limit: "64kb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const b = req.body ?? {};
  const to = String(b.email ?? "").trim();
  const total = Number(b.amount);
  if (!total || total <= 0) { res.status(400).json({ error: "Ongeldig bedrag." }); return; }
  try {
    const inv = await createInvoice(projectId, {
      customerName: String(b.name ?? ""), customerEmail: to,
      description: String(b.description ?? "Aankoop"), total, method: String(b.method ?? "Stripe"),
    });
    const settings = await getInvoiceSettings(projectId);
    const html = renderInvoiceHtml(settings, inv);
    const pdfBase64 = renderInvoicePdf(settings, inv).toString("base64");
    let sent = false;
    if (to && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      try { sent = await sendPaymentEmail(projectId, to, html, inv.number, pdfBase64); }
      catch (err) { logger.warn({ err, projectId }, "[invoice] payment email failed"); }
    }
    res.json({ ok: true, number: inv.number, id: inv.id, sent });
  } catch (err) {
    logger.error({ err, projectId }, "[invoice] create failed");
    res.status(500).json({ error: "Factuur aanmaken mislukt." });
  }
});

// Calendar feed: the booking app syncs its lessons; the studio subscribes to the .ics URL.
router.post("/projects/:projectId/calendar/sync", json({ limit: "512kb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const lessons = Array.isArray(req.body?.lessons) ? (req.body.lessons as Lesson[]) : [];
  try {
    const r = await saveLessons(projectId, lessons, reqBaseUrl(req));
    void pushLessons(projectId, lessons); // instant push to a connected Google Calendar (no-op if not connected)
    res.json({ ok: true, ...r });
  }
  catch (err) { logger.error({ err, projectId }, "[calendar] sync failed"); res.status(500).json({ error: "Sync mislukt." }); }
});
router.get("/projects/:projectId/calendar", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try { await ensureCalendar(projectId, reqBaseUrl(req)); res.json(await getCalendarStatus(projectId, reqBaseUrl(req))); }
  catch (err) { logger.error({ err, projectId }, "[calendar] status failed"); res.status(500).json({ error: "Status mislukt." }); }
});
// Public, token-protected iCal feed that calendars subscribe to.
router.get("/projects/:projectId/calendar/:token", async (req, res) => {
  const projectId = Number(req.params.projectId);
  const token = String(req.params.token || "").replace(/\.ics$/i, "");
  if (isNaN(projectId) || !token) { res.status(400).send("Invalid"); return; }
  try {
    const lessons = await getLessons(projectId, token);
    if (lessons === null) { res.status(404).send("Niet gevonden."); return; }
    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const studio = emailBrandSeed(files.map((f) => ({ path: f.path, content: f.content }))).studio;
    const idx = files.find((f) => /index\.html$/i.test(f.path))?.content ?? "";
    const domain = (idx.match(/<a\b[^>]*\bhref=["']https?:\/\/([^/"']+)/i) ?? [])[1] ?? "";
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="lessen.ics"`);
    res.send(buildIcs(studio, domain, lessons));
  } catch (err) { logger.error({ err, projectId }, "[calendar] ics failed"); res.status(500).send("Fout."); }
});

// Admin invoice overview (list).
router.get("/projects/:projectId/invoices", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const rows = await listInvoices(projectId);
    res.json(rows.map((i) => ({ id: i.id, number: i.number, date: i.date, customerName: i.customerName, customerEmail: i.customerEmail, description: i.description, total: i.total, status: i.status, currency: i.currency, createdAt: i.createdAt })));
  } catch (err) { logger.error({ err, projectId }, "[invoice] list failed"); res.status(500).json({ error: "Kon facturen niet ophalen." }); }
});

// Download all invoices from the last N months (1–12) as a real Excel file (.xls SpreadsheetML).
router.get("/projects/:projectId/invoices/export", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).send("Invalid project ID"); return; }
  const months = Math.min(12, Math.max(1, parseInt(String(req.query.months || "12"), 10) || 12));
  try {
    const rows = await listInvoicesSince(projectId, months);
    const settings = await getInvoiceSettings(projectId);
    const xls = renderInvoicesXls(settings, rows);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="facturen-${months}mnd-${stamp}.xls"`);
    res.send(xls);
  } catch (err) { logger.error({ err, projectId }, "[invoice] export failed"); res.status(500).send("Export mislukt."); }
});

// BTW/VAT report (grouped per rate) for the last N months — real Excel (.xls).
router.get("/projects/:projectId/invoices/vat-report", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).send("Invalid project ID"); return; }
  const months = Math.min(12, Math.max(1, parseInt(String(req.query.months || "12"), 10) || 12));
  try {
    const rows = await listInvoicesSince(projectId, months);
    const settings = await getInvoiceSettings(projectId);
    const label = months + (months === 1 ? " maand" : " maanden");
    const xls = renderVatReportXls(settings, rows, label);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="btw-overzicht-${months}mnd-${stamp}.xls"`);
    res.send(xls);
  } catch (err) { logger.error({ err, projectId }, "[invoice] vat-report failed"); res.status(500).send("Export mislukt."); }
});

// Teacher payout overview for the last N months — classes given + attendance per teacher (+ optional
// payout if a per-class rate is given). Real Excel (.xls).
router.get("/projects/:projectId/teacher-payout", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).send("Invalid project ID"); return; }
  const months = Math.min(12, Math.max(1, parseInt(String(req.query.months || "12"), 10) || 12));
  const rate = Math.max(0, Number(req.query.rate) || 0);
  try {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months); cutoff.setHours(0, 0, 0, 0);
    const cut = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    const classes = (await db.select().from(studioClasses).where(eq(studioClasses.projectId, projectId))).filter((c) => c.date >= cut);
    const users = await db.select().from(studioUsers).where(eq(studioUsers.projectId, projectId));
    const bookings = await db.select().from(studioBookings).where(eq(studioBookings.projectId, projectId));
    const nameByEmail: Record<string, string> = {}; users.forEach((u) => { nameByEmail[u.email] = u.name; });
    // booked + present counts per classId|date
    const cnt: Record<string, { booked: number; present: number }> = {};
    for (const b of bookings) { if (b.status !== "booked") continue; const k = b.classId + "|" + b.date; (cnt[k] ||= { booked: 0, present: 0 }); cnt[k].booked++; if (b.present === "true") cnt[k].present++; }
    const byTeacher: Record<string, { teacher: string; email: string; classes: number; bookings: number; present: number }> = {};
    for (const c of classes) {
      const email = c.teacherEmail || "(geen docent)";
      const g = (byTeacher[email] ||= { teacher: nameByEmail[email] || c.teacher || "", email: c.teacherEmail || "", classes: 0, bookings: 0, present: 0 });
      g.classes++; const k = c.id + "|" + c.date; g.bookings += cnt[k]?.booked || 0; g.present += cnt[k]?.present || 0;
    }
    const rows = Object.values(byTeacher).sort((a, b) => b.classes - a.classes);
    const xls = renderTeacherPayoutXls(rows, months + (months === 1 ? " maand" : " maanden"), rate);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="docenten-uitbetaling-${months}mnd-${stamp}.xls"`);
    res.send(xls);
  } catch (err) { logger.error({ err, projectId }, "[payout] failed"); res.status(500).send("Export mislukt."); }
});

// Printable invoice page (fallback / preview).
router.get("/projects/:projectId/invoice/:invId/view", async (req, res) => {
  const projectId = Number(req.params.projectId), invId = Number(req.params.invId);
  if (isNaN(projectId) || isNaN(invId)) { res.status(400).send("Invalid"); return; }
  try {
    const inv = await getInvoice(projectId, invId);
    if (!inv) { res.status(404).send("Factuur niet gevonden."); return; }
    const settings = await getInvoiceSettings(projectId);
    res.type("html").send(renderInvoiceDocument(settings, inv, req.query.print === "1"));
  } catch (err) { logger.error({ err, projectId }, "[invoice] view failed"); res.status(500).send("Fout bij ophalen factuur."); }
});

// The real downloadable PDF file.
router.get("/projects/:projectId/invoice/:invId/pdf", async (req, res) => {
  const projectId = Number(req.params.projectId), invId = Number(req.params.invId);
  if (isNaN(projectId) || isNaN(invId)) { res.status(400).send("Invalid"); return; }
  try {
    const inv = await getInvoice(projectId, invId);
    if (!inv) { res.status(404).send("Factuur niet gevonden."); return; }
    const settings = await getInvoiceSettings(projectId);
    const pdf = renderInvoicePdf(settings, inv);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="factuur-${inv.number}.pdf"`);
    res.send(pdf);
  } catch (err) { logger.error({ err, projectId }, "[invoice] pdf failed"); res.status(500).send("Fout bij genereren PDF."); }
});

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

  // Account + ownership (multi-tenant) + billing gate.
  const owner = await requireOwner(req, res, projectId);
  if (!owner) return;

  // If a build is already running for this project, attach this client to it
  // instead of starting a second one (the client guards against this, but a
  // stale tab could still POST). Otherwise start a fresh detached build.
  const running = activeBuilds.get(projectId);
  if (running && running.status === "running") {
    attachToBuild(running, res);
    return;
  }

  // Short acknowledgments ("dankjewel", "ok", etc.) get a chat reply, no build — allowed for all,
  // still metered (cheap).
  if (images.length === 0 && content.length < 200 && await checkConversational(content, projectId)) {
    const session = createBuildSession(projectId);
    void runWithUsage(() => handleConversational(session, projectId, content)).then(({ totals }) => chargeTrackedUsage(owner.id, projectId, content, totals)).catch(() => {});
    attachToBuild(session, res);
    return;
  }

  // Billing gate for real AI changes.
  const subscribed = isSubscribed(owner);
  if (subscribed && (owner.aiCredit ?? 0) <= 0) {
    res.status(402).json({ error: "Je AI-tegoed is op. Koop bij in je profiel → Abonnement." });
    return;
  }
  if (!subscribed && !isBookingRequest(content)) {
    res.status(402).json({ error: "Met een gratis account kan de AI alleen een boekingssysteem toevoegen of de admin-login instellen. Abonneer je (€69,99/maand) voor volledige AI-bewerkingen." });
    return;
  }

  const session = createBuildSession(projectId);
  void runWithUsage(() => runBuildPipeline(session, projectId, content, images)).then(({ totals }) => chargeTrackedUsage(owner.id, projectId, content, totals)).catch(() => {});
  attachToBuild(session, res);
});

// Report whether a detached build is currently running for this project, so a
// freshly loaded (or reloaded) client can decide to reattach to live progress.
router.get("/projects/:projectId/build/status", (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  const session = activeBuilds.get(projectId);
  res.json({
    running: !!session && session.status === "running",
    startedAt: session?.startedAt ?? null,
  });
});

// Reconnect to an in-flight build's SSE stream (replays missed progress). Unlike
// the POST route this never creates a new message or build — it only attaches.
router.get("/projects/:projectId/build/stream", (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  const session = activeBuilds.get(projectId);
  if (!session) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: "idle" })}\n\n`);
    res.end();
    return;
  }
  attachToBuild(session, res);
});

// Explicitly cancel a running build (the user pressed Stop). A passive
// disconnect must NOT cancel — only this does.
router.post("/projects/:projectId/build/cancel", (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  const session = activeBuilds.get(projectId);
  if (session && session.status === "running") {
    session.cancelled = true;
    session.abort();
  }
  res.json({ ok: true });
});

// Cheap Haiku-powered error fix. Uses the same detached-session + SSE pattern as
// the main build so the client can reuse identical reconnect/replay logic.
router.post("/projects/:projectId/messages/fix-error", json({ limit: "1mb" }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  const error = typeof req.body?.error === "string" ? req.body.error.trim() : "";
  if (!error) {
    res.status(400).json({ error: "error is required" });
    return;
  }

  const running = activeBuilds.get(projectId);
  if (running && running.status === "running") {
    attachToBuild(running, res);
    return;
  }

  const session = createBuildSession(projectId);
  void runFixBuild(session, projectId, error);
  attachToBuild(session, res);
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

// ── Extract shared components from existing HTML pages ────────────────────────
// Reads the canonical HTML (index.html or first HTML file), extracts structural
// blocks (header, nav, footer, cookie banner) and inline CSS/JS as reference
// files. Does NOT modify any existing page — the extracted files are additive.
router.post("/projects/:projectId/extract-components", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  try {
    const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const htmlFiles = rows.filter(f => f.path.toLowerCase().endsWith(".html"));
    if (htmlFiles.length === 0) { res.json({ created: [], canonical: null }); return; }

    const canonical = htmlFiles.find(f => f.path.toLowerCase() === "index.html") ?? htmlFiles[0];
    const existing = new Set(rows.map(f => f.path));

    type NewFile = { path: string; content: string; language: string; source: string };
    const toCreate: NewFile[] = [];

    // --- HTML component fragments ---
    const headerBlock = extractTagBlock(canonical.content, "header");
    if (headerBlock && !existing.has("components/Header.html"))
      toCreate.push({ path: "components/Header.html", content: headerBlock, language: "html", source: canonical.path });

    const navBlock = extractTagBlock(canonical.content, "nav");
    if (navBlock && !existing.has("components/Navigation.html"))
      toCreate.push({ path: "components/Navigation.html", content: navBlock, language: "html", source: canonical.path });

    const footerBlock = extractTagBlock(canonical.content, "footer");
    if (footerBlock && !existing.has("components/Footer.html"))
      toCreate.push({ path: "components/Footer.html", content: footerBlock, language: "html", source: canonical.path });

    const cookieBlock = extractCookieBannerBlock(canonical.content);
    if (cookieBlock && !existing.has("components/CookieBanner.html"))
      toCreate.push({ path: "components/CookieBanner.html", content: cookieBlock, language: "html", source: canonical.path });

    // --- CSS files (extracted inline styles as reference) ---
    const extractedCss = extractAllStyleBlocks(canonical.content);
    if (!existing.has("styles/main.css"))
      toCreate.push({
        path: "styles/main.css",
        content: extractedCss || "/* Gedeelde stijlen — hier komen kleur, typografie en herbruikbare patronen. */\n",
        language: "css",
        source: extractedCss ? canonical.path : "",
      });
    if (!existing.has("styles/layout.css"))
      toCreate.push({ path: "styles/layout.css", content: "/* Layout — grid, flex en structuur. */\n", language: "css", source: "" });
    if (!existing.has("styles/responsive.css"))
      toCreate.push({ path: "styles/responsive.css", content: "/* Responsive — media queries voor mobiel en tablet. */\n", language: "css", source: "" });

    // --- JS files (extracted inline scripts as reference) ---
    const extractedJs = extractInlineScriptBlocks(canonical.content);
    if (!existing.has("scripts/main.js"))
      toCreate.push({
        path: "scripts/main.js",
        content: extractedJs || "/* Gedeeld JavaScript — initialisatie en hulpfuncties. */\n",
        language: "javascript",
        source: extractedJs ? canonical.path : "",
      });
    if (!existing.has("scripts/navigation.js"))
      toCreate.push({ path: "scripts/navigation.js", content: "/* Navigatie — mobiel menu, actieve links, smooth scroll. */\n", language: "javascript", source: "" });
    if (!existing.has("scripts/cookies.js"))
      toCreate.push({ path: "scripts/cookies.js", content: "/* Cookie consent — tonen, accepteren en opslaan van toestemming. */\n", language: "javascript", source: "" });

    const created: { path: string; source: string }[] = [];
    for (const f of toCreate) {
      await db.insert(projectFiles).values({ projectId, path: f.path, content: f.content, language: f.language });
      created.push({ path: f.path, source: f.source });
    }
    if (created.length > 0) {
      await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    }

    res.json({ created, canonical: canonical.path });
  } catch (err) {
    logger.error({ err }, "extract-components failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/projects/:projectId/files/:filePath", async (req, res) => {
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
    const existing = rows.find((f) => f.path === filePath);
    if (!existing) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    await db.delete(projectFiles).where(eq(projectFiles.id, existing.id));
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete file");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
