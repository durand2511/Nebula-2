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
  // Keep noscript content visible but drop the wrapper.
  $("noscript").each((_, el) => {
    $(el).replaceWith($(el).contents());
  });

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

function buildSystemPrompt(projectName: string, fileContext: string, learningsContext: string): string {
  return `You are Buildly, an expert AI web app builder. Generate beautiful, fully-functional web apps for a project called "${projectName}", with clean, well-structured, modular code.${learningsContext}

You build COMPLETE, production-ready web apps — never demos, prototypes, or placeholders.

REFERENCE IMAGES (when the user attaches one or more images):
- Treat the attached image(s) as the PRIMARY visual brief — read them carefully and study the layout structure, color palette, typography, spacing/density, imagery style, button and component shapes, and overall mood.
- Build whatever the user asks, but styled to match the reference as closely as you can: reproduce its look and feel (colors, fonts, proportions, section structure, navigation pattern) so the result clearly belongs to the same brand/design language.
- The reference shows VISUAL direction only. Still build a real, fully-functional app per the runtime constraints below — every button, tab, menu, and link must actually work (do NOT produce a static, non-interactive mockup of the image).
- If the reference's palette/typography conflicts with the BUILDLY DESIGN SYSTEM defaults below, the REFERENCE WINS for palette, type, and overall styling (the user is explicitly asking for that look); still keep the execution-quality, layout-discipline, and runtime-robustness rules.
- Recreate the design from scratch in your own clean code; never hotlink the reference image or any external asset URLs from it.

RUNTIME CONSTRAINTS (the app runs sandboxed in a browser iframe — respect these exactly):
- Vanilla JavaScript only (ES modules / plain JS). NO npm, NO build step, NO JSX/TSX, NO frameworks that need compiling.
- Load libraries via CDN only (Tailwind, Chart.js, etc.).
- Persist data with localStorage (no backend/Supabase is available in this sandbox).
- "Pages"/routing = a single-page app with client-side view switching (hash routing or show/hide sections) inside index.html — do NOT rely on separate .html files for navigation.

FILE STRUCTURE — split into MULTIPLE well-organized files, never one giant file:
  - index.html — semantic markup, plus an inline <style> block with your design-token :root variables and a small body reset; all other styling lives in styles.css. Link sibling files with relative paths
  - styles.css — custom styling beyond Tailwind utilities
  - script.js — app logic; for larger apps split by concern into several JS files (e.g. router.js, store.js, ui.js), each referenced from index.html
- index.html must reference siblings exactly like: <link rel="stylesheet" href="styles.css"> and <script src="script.js"></script> (and <script src="store.js"></script> etc.)
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

The result MUST feel like a professional SaaS dashboard — a deliberate, cohesive product — NOT loose blocks dropped onto a page.

STRUCTURE & LAYOUT REQUIREMENTS (apply to EVERY app):
- A real app shell: clear header/top bar, an optional sidebar for navigation on larger apps, and a main content area on a consistent grid.
- Group content into clearly delineated sections with consistent vertical rhythm — never a random pile of elements.
- Align everything to the grid on one consistent spacing scale; no arbitrary margins, no off-grid or random placement.
- Stats/metrics live in COMPACT stat cards arranged in a row or grid (small label + value) — not giant numbers scattered around.
- Forms are well-structured: grouped fields, aligned labels, logical order, one clear primary action.
- Lists and tables are clean and scannable: aligned columns, clear headers, tidy rows.
- Restrained typography — follow the type scale below; no unnecessarily huge text.
- Fully responsive: the grid reflows sensibly from desktop to mobile (sidebar collapses, cards stack, tables stay usable).

BUILDLY DESIGN SYSTEM — this is the house style. Apply it EXACTLY to EVERY generated app so everything feels like it was crafted by a Berlin design studio (think Linear, Vercel, Resend, Raycast), never like AI output. Use these precise values; do not invent a different palette unless the user explicitly asks for one.

OVERALL PAGE:
- Background: #0a0a0a — this is the darkest surface in the app and must stay clearly darker than any card so cards visibly stand out as separate components (never let cards blend into the page).
- All text defaults to #ffffff
- Max content width: ~800px centered (margin: 0 auto) for simple single-column or form/content apps; for dashboards and data-dense tools use a wider centered shell (up to ~1200px) with a sidebar so tables and stat-card grids have room. Keep generous gutters either way.
- Page padding: 48px 24px
- Font: Inter, imported from Google Fonts (with a system-sans fallback)

TYPOGRAPHY HIERARCHY:
- H1: 32px, font-weight 300, letter-spacing -0.02em
- H2: 20px, font-weight 400, letter-spacing -0.01em
- Body: 15px, font-weight 400, line-height 1.7, color rgba(255,255,255,0.7)
- Caption: 12px, uppercase, letter-spacing 0.08em, color rgba(255,255,255,0.4)

INPUTS & FORM FIELDS:
- Background: transparent; border: none; border-bottom: 2px solid rgba(255,255,255,0.15); border-radius: 0 (flat, never rounded)
- Color: #ffffff; font-size: 16px; font-weight: 400; padding: 16px 0; width: 100%
- Placeholder color: rgba(255,255,255,0.3)
- On focus: border-bottom color -> #ffffff; NO outline, NO glow, NO box-shadow
- Transition: border-color 0.2s ease

LABELS:
- Font-size: 11px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase
- Color: rgba(255,255,255,0.4); display: block; margin-bottom: 8px

FORM GROUPS:
- Margin-bottom: 32px; position: relative

PRIMARY BUTTONS:
- Background: #ffffff; color: #000000; border: none; border-radius: 4px
- Padding: 16px 32px; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer
- On hover: opacity 0.85; transition: opacity 0.15s
- NO box-shadow, NO gradient

SECONDARY BUTTONS:
- Background: transparent; color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.2)
- Same padding and typography as primary
- On hover: border-color rgba(255,255,255,0.6)

CARDS & CONTAINERS — cards must read as clearly distinct surfaces sitting ON TOP of the page, with strong-but-tasteful visual hierarchy (think Stripe Dashboard, Linear, Notion):
- Background: #161616 — a solid surface that is noticeably lighter than the #0a0a0a page. NEVER use a near-page fill like rgba(255,255,255,0.04); the card must be obviously separate from the background.
- Border: 1px solid rgba(255,255,255,0.10) — subtle but clearly visible against both the card and the page.
- Border-radius: 12px; padding: 24px–32px; backdrop-filter: none.
- Shadow: ONE subtle shadow for depth only — box-shadow: 0 1px 2px rgba(0,0,0,0.4). Keep it light; never use heavy, large, or colored shadows, and never use gradients or glass/blur effects.
- Interactive/hoverable cards: lift slightly on hover — background #1c1c1c (and/or border rgba(255,255,255,0.16)); transition: background 0.15s ease, border-color 0.15s ease.

METRIC / STAT DISPLAYS:
- Present stats as COMPACT stat cards arranged in a responsive row/grid (use the SAME distinct card surface from the CARDS section above — #161616 with its border and subtle shadow — with tight internal padding). They must be instantly recognizable as separate cards, not faint panels that melt into the page.
- Label: 12px, uppercase, letter-spacing 0.08em, color rgba(255,255,255,0.45), placed above the value.
- Value: ~28px, font-weight 300, letter-spacing -0.02em, color #ffffff — high contrast against the card, prominent but restrained; never oversized.
- Keep cards compact and aligned to the grid; never use giant hero numbers scattered around the page.

STRICT RULES — never break these:
- Zero gradients.
- No heavy, large, or colored shadows and no glows — the ONLY shadow allowed is the single subtle card shadow defined in CARDS & CONTAINERS, used purely for depth.
- Zero rounded inputs (inputs are flat, bottom-border only).
- Zero colored buttons — buttons are only solid white (primary) or transparent/outline (secondary).
- Generous whitespace and clear hierarchy; every app must feel like a Berlin design studio made it, not an AI.
- Inspired by Linear, Vercel, Resend, Raycast.

EXECUTION QUALITY (still required within this system):
- Consistent spacing and pixel-perfect alignment; no awkward gaps, clipped text, or misaligned elements.
- Smooth, subtle transitions only (the ones specified above); motion is effortless, never flashy.
- Design every state: empty states, loading states, hover/active/focus states, and inline error states.

IMPLEMENTATION:
- Put these design tokens in an inline <style> block at the top of index.html (a :root variable set for the colors above + a body reset: margin 0, background #0a0a0a, color #ffffff, font-family Inter) so the app paints correctly immediately; put all other styling in styles.css.
- Import Inter with a Google Fonts <link>.

NON-NEGOTIABLES (quality floor — never break):
- NO Lorem Ipsum or placeholder copy — write real, realistic content and seed real sample data so the app is fully demonstrable on first load.
- NO dead buttons or links — every interactive element must actually work.
- Fully mobile responsive with media queries.
- Every form has validation with clear inline error messages.
- Always include empty states and loading states.

ALWAYS GENERATE:
1. A clean, well-designed header or navigation.
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
- Do NOT reference external image, font, or file URLs that may 404 (no random photo/CDN asset URLs). For graphics use inline SVG, emoji, or data URIs (NO gradients — see the design system). Google Fonts <link> tags are allowed.
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

function buildFileContext(files: { path: string; content: string }[]): string {
  if (files.length === 0) return "";
  return `\n\nCurrent project files (modify these as needed):\n${files
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n")}`;
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
): Promise<string[]> {
  const written: string[] = [];
  let match;
  FILE_BLOCK_REGEX.lastIndex = 0;
  while ((match = FILE_BLOCK_REGEX.exec(raw)) !== null) {
    const [, filePath, langLine, fenceLang, fileContent] = match;
    const trimmedPath = filePath.trim();
    if (!trimmedPath) continue;
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

  let imported: { html: string; finalUrl: string };
  try {
    imported = await fetchWebsiteHtml(rawUrl);
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

  try {
    const preparedHtml = prepareImportedHtml(imported.html, imported.finalUrl);
    let hostname = "Imported Site";
    try {
      hostname = new URL(imported.finalUrl).hostname.replace(/^www\./, "");
    } catch {
      /* keep fallback */
    }

    const [project] = await db
      .insert(projects)
      .values({
        name: hostname,
        description: `Imported from ${imported.finalUrl}`,
      })
      .returning();

    await db.insert(projectFiles).values({
      projectId: project.id,
      path: "index.html",
      content: preparedHtml,
      language: "html",
    });

    res.status(201).json({
      ...project,
      messageCount: 0,
      fileCount: 1,
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
    const learningsContext = await buildLearningsContext();
    const systemPrompt = buildSystemPrompt(
      projectRows[0].name,
      buildFileContext(existingFiles),
      learningsContext,
    );

    const aiContent =
      (await generateWithContinuation([
        { role: "system", content: systemPrompt },
        ...chatMessages,
      ])) || "I'm sorry, I couldn't generate a response.";

    const written = await persistGeneratedFiles(projectId, aiContent, existingFiles);
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
  }, 10000);

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
    const learningsContext = await buildLearningsContext();
    const systemPrompt = buildSystemPrompt(
      projectRows[0].name,
      buildFileContext(existingFiles),
      learningsContext,
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
      await persistGeneratedFiles(projectId, full, existingFiles);
      await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      return;
    }

    send({ type: "status", message: "Saving files" });

    const written = await persistGeneratedFiles(projectId, full, existingFiles);

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
