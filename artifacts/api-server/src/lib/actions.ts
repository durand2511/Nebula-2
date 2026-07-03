/**
 * COMMAND ARCHITECTURE — AI classifies intent → JSON; HARDCODED functions execute.
 *
 * The AI is used ONLY to map a free-text request to one of a fixed set of actions (below).
 * It never generates HTML/CSS. Every action is carried out by a deterministic, tested
 * function in this file — reliable and free of AI variance. Every visual action applies
 * to EVERY HTML page in the project, so a single command (e.g. "maak de nav donkerblauw")
 * changes the whole site consistently — including the nav on every page.
 *
 * Add a new capability = add an action type + a pure executor here + one line in the
 * classifier's action list. The execution path stays 100% hardcoded.
 */
import { insertNavLink } from "./write-plan.js";
import { buildBookingAppPage, type BookingAccount } from "./booking-app.js";

export type ColorTarget = "primary" | "background" | "text" | "buttons" | "links" | "nav" | "nav-text" | "headings";
export type ImageMatch = "all" | "logo" | "hero" | string;

export type BuilderAction =
  | { action: "add_nav_item"; label: string; href: string }
  | { action: "remove_nav_item"; label: string }
  | { action: "rename_nav_item"; from: string; to: string }
  | { action: "create_page"; name: string; navLabel: string }
  | { action: "change_color"; target: ColorTarget; color: string }
  | { action: "change_text"; from: string; to: string }
  | { action: "replace_image"; match: ImageMatch; src: string }
  | { action: "change_font"; family: string }
  | { action: "edit_element"; page: string; selector: string; op: "text" | "image" | "color" | "background"; value: string }
  | { action: "add_section"; page: string; kind: SectionKind }
  | { action: "add_booking_app"; accounts?: BookingAccount[] }
  | { action: "set_booking_logins"; accounts: BookingAccount[] }
  | { action: "remove_external_bookings" }
  | { action: "undo"; reason: string }
  | { action: "none"; reason: string };

/** The fixed catalogue the classifier must choose from (shown to the AI, used to validate). */
export const ACTION_CATALOGUE = [
  { action: "add_nav_item", params: ["label", "href"], when: "add/append a link or tab to the navigation menu" },
  { action: "remove_nav_item", params: ["label"], when: "remove/delete a tab or link from the navigation" },
  { action: "rename_nav_item", params: ["from", "to"], when: "rename/change the text of an existing nav tab" },
  { action: "create_page", params: ["name", "navLabel"], when: "create a new page/tab (a new file) and add it to the nav" },
  { action: "add_section", params: ["page", "kind"], when: "add a new content section (heading/text/image-text/gallery/cta) to a page" },
  { action: "change_color", params: ["target", "color"], when: "change a colour of the site (background, text, buttons, links, nav/header bar, headings, or the primary/brand colour)" },
  { action: "change_text", params: ["from", "to"], when: "replace a specific piece of visible text with new text (the user gives both the old and the new text)" },
  { action: "replace_image", params: ["match", "src"], when: "replace/swap an image (logo, hero, or all images) with a new image URL" },
  { action: "change_font", params: ["family"], when: "change the font / typeface of the whole site" },
  { action: "add_booking_app", params: [], when: "the user wants a booking/reservation app or system added (e.g. 'maak een booking app', 'voeg een boekingssysteem toe', 'reserveringssysteem', 'agenda waar klanten lessen kunnen boeken')" },
  { action: "set_booking_logins", params: ["accounts"], when: "the user provides login credentials (e-mail + password, optionally names) for the booking app — the admin login and/or teacher logins — so they can log in (e.g. 'de admin login is ...', 'docent Lisa: lisa@x.nl wachtwoord ...')" },
  { action: "remove_external_bookings", params: [], when: "remove all links/buttons/widgets that point to OTHER (external) booking/scheduling platforms (bsport, Momoyoga, Eversports, Mindbody, etc.) from the site — e.g. 'verwijder alle links naar andere boekingsplatformen', 'haal de rooster/reserveer-knoppen naar bsport weg', 'weg met de externe booking widgets'" },
  { action: "undo", params: ["reason"], when: "undo/revert/reverse the previous change, take it back, remove the last edit (e.g. 'draai dit terug', 'maak ongedaan', 'toch niet', 'haal die wijziging weg', 'undo')" },
  { action: "none", params: ["reason"], when: "the request is none of the above / unclear / needs custom layout or content" },
] as const;

const norm = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// ── Colour helpers ────────────────────────────────────────────────────────────

// Dutch + English colour names → hex, so the executor still works if the classifier
// passes a bare colour name through instead of a hex value.
const COLOR_NAMES: Record<string, string> = {
  zwart: "#111111", black: "#111111",
  wit: "#ffffff", white: "#ffffff",
  rood: "#dc2626", red: "#dc2626", donkerrood: "#991b1b",
  blauw: "#2563eb", blue: "#2563eb", donkerblauw: "#1e3a8a", navy: "#1e3a8a", lichtblauw: "#60a5fa",
  groen: "#16a34a", green: "#16a34a", donkergroen: "#15803d", lichtgroen: "#4ade80",
  geel: "#eab308", yellow: "#eab308",
  oranje: "#ea580c", orange: "#ea580c",
  paars: "#7c3aed", purple: "#7c3aed", violet: "#7c3aed",
  roze: "#ec4899", pink: "#ec4899", roos: "#ec4899",
  grijs: "#6b7280", gray: "#6b7280", grey: "#6b7280", donkergrijs: "#374151", lichtgrijs: "#d1d5db",
  bruin: "#92400e", brown: "#92400e",
  turquoise: "#14b8a6", turkoois: "#14b8a6", teal: "#14b8a6",
  beige: "#d6c7a1", goud: "#d4af37", gold: "#d4af37", zilver: "#c0c0c0", silver: "#c0c0c0",
};

/** Normalise a colour value to a CSS colour. Trusts hex/rgb/hsl; maps known names. */
export function normalizeColor(value: string): string {
  const v = value.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(v)) return v;
  if (COLOR_NAMES[v]) return COLOR_NAMES[v];
  // strip a leading article/qualifier ("een donkerblauwe" → "donkerblauw")
  const word = v.replace(/^(een|de|het|the)\s+/, "").replace(/e$/, "");
  if (COLOR_NAMES[word]) return COLOR_NAMES[word];
  return v; // last resort: hand the raw value to CSS (named CSS colours still work)
}

/** Pick a readable text colour (#fff/#111) for a given background hex; "" if not a hex. */
function contrastText(color: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return "";
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  // relative luminance (sRGB approximation)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.55 ? "#ffffff" : "#111111";
}

/**
 * Build the CSS body for one colour target. Appended LAST in <head> and using !important
 * so it wins over the imported theme, while staying scoped to surfaces that won't break
 * layout. Each target lives in its own managed <style> block so changing one colour
 * never wipes another.
 */
function colorCss(target: ColorTarget, color: string, specifics: string[] = []): string {
  const c = normalizeColor(color);
  const fg = contrastText(c);
  switch (target) {
    case "background":
      return `html,body{background-color:${c} !important;}`;
    case "text":
      return `body,p,li,span,td,th,dd,dt{color:${c} !important;}`;
    case "headings":
      return `h1,h2,h3,h4,h5,h6{color:${c} !important;}`;
    case "links":
      return `a{color:${c} !important;}`;
    case "buttons":
      return `button,.btn,.button,[class*="button"],input[type="submit"],input[type="button"],a.wp-block-button__link,.wp-block-button__link,.elementor-button{background-color:${c} !important;border-color:${c} !important;${fg ? `color:${fg} !important;` : ""}}`;
    case "nav": {
      // Paint the WHOLE bar: the header/nav AND every inner wrapper/dropdown that could
      // carry its own background, so no patch keeps the old colour. background-image:none
      // clears theme gradients/images that would otherwise hide the colour.
      const generic = `header,nav,.site-header,.main-header,[class*="site-header"],[class*="main-header"],[class*="main-navigation"],[class*="navbar"],[class*="nav-bar"],[class*="menu-bar"],[class*="topbar"],[role="banner"]`;
      // High-specificity selectors built from the real nav's id+classes (e.g. #header.navbar.fixed-top)
      // guarantee we out-specify Bootstrap utilities like `.bg-light{...!important}` on every page.
      const bar = specifics.length ? `${generic},${specifics.join(",")}` : generic;
      // Inner wrappers AND dropdown/submenu panels get the bar colour too — incl. Elementor's
      // `.sub-menu` / `.elementor-sub-item` (otherwise the dropdown stays white while its text flips
      // to the light contrast colour → invisible white-on-white items).
      const inner = `header .container,nav .container,header [class*="container"],nav [class*="container"],[class*="navbar"] .container,.navbar-collapse,[class*="navbar"] .navbar-collapse,header .dropdown-menu,nav .dropdown-menu,[class*="navbar"] .dropdown-menu,header .sub-menu,nav .sub-menu,.elementor-nav-menu .sub-menu,ul.sub-menu,[class*="sub-menu"],[class*="elementor-sub-item"]`;
      let css = `${bar}{background-color:${c} !important;background-image:none !important;}`;
      css += `${inner}{background-color:${c} !important;}`;
      if (fg) {
        // Links, menu text and dropdown items stay readable against the new bar (incl. Elementor items).
        css += `header a,nav a,[class*="site-header"] a,[class*="navbar"] a,[role="banner"] a,header .dropdown-item,nav .dropdown-item,header .nav-link,nav .nav-link,.elementor-item,.elementor-sub-item,.sub-menu a{color:${fg} !important;}`;
        // Buttons inside the bar flip to a visible inverted style (skip the hamburger toggler).
        css += `header button:not(.navbar-toggler),nav button:not(.navbar-toggler),header .btn,nav .btn,header [class*="button"],nav [class*="button"],header input[type="submit"],nav input[type="submit"]{background-color:${fg} !important;color:${c} !important;border-color:${fg} !important;}`;
      }
      return css;
    }
    case "nav-text":
      // Colour ONLY the nav/menu text (links + Elementor items) across the whole bar, on every page —
      // the background is left untouched. Used when the user picks the "text colour" swatch on the nav.
      return `header a,nav a,[class*="site-header"] a,[class*="main-header"] a,[class*="navbar"] a,[class*="nav-bar"] a,[class*="menu-bar"] a,[class*="topbar"] a,[role="banner"] a,header .nav-link,nav .nav-link,.elementor-item,.elementor-sub-item,.elementor-nav-menu a,.sub-menu a{color:${c} !important;}`;
    case "primary":
    default:
      // Brand colour: links, buttons, and common theme CSS variables.
      return `:root{--buildly-primary:${c};--wp--preset--color--primary:${c};--e-global-color-primary:${c};}` +
        `a{color:${c} !important;}` +
        `button,.btn,.button,[class*="button"],input[type="submit"],a.wp-block-button__link,.wp-block-button__link,.elementor-button{background-color:${c} !important;border-color:${c} !important;${fg ? `color:${fg} !important;` : ""}}`;
  }
}

/** Insert or replace a managed <style data-buildly="<key>"> block in <head>. */
function upsertStyleBlock(html: string, key: string, css: string): string {
  const block = `<style data-buildly="${key}">${css}</style>`;
  const re = new RegExp(`<style data-buildly="${key}">[\\s\\S]*?<\\/style>`, "i");
  if (re.test(html)) return html.replace(re, block);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}</head>`);
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/(<head\b[^>]*>)/i, `$1${block}`);
  // No <head> at all (fragment / blank page) — prepend so it still applies.
  return block + html;
}

// ── Pure HTML transforms (deterministic, no AI) ───────────────────────────────

/** Add a nav item to every primary menu on the page (delegates to the tested insertNavLink). */
export function addNavItem(html: string, label: string, href: string): string {
  return insertNavLink(html, href, label) ?? html;
}

/** Remove the nav item whose visible text matches `label`, from <nav> blocks. */
export function removeNavItem(html: string, label: string): string {
  const target = norm(label);
  return html.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, (block) => {
    // Prefer removing a whole <li> (keeps the list valid); else remove the bare <a>.
    let out = block.replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, (li) => {
      const text = norm(li.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
      return text === target ? "" : li;
    });
    if (out === block) {
      out = block.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (a, inner) => (norm(inner) === target ? "" : a));
    }
    return out;
  });
}

/** Rename the nav item whose visible text matches `from` to `to`. */
export function renameNavItem(html: string, from: string, to: string): string {
  const target = norm(from);
  return html.replace(/(<a\b[^>]*>)([\s\S]*?)(<\/a>)/gi, (m, open: string, inner: string, close: string) =>
    norm(inner) === target ? `${open}${to}${close}` : m,
  );
}

// Distinctive brand tokens of external booking/scheduling platforms. Used to catch their embedded
// WIDGETS too — WordPress plugin blocks/scripts reference them via class/id or a RELATIVE plugin path
// (e.g. class="wp-block-momoyoga…", /wp-content/plugins/momoyoga-integration/…), not just an external URL.
const BOOKING_PLATFORM_TOKENS = [
  "momoyoga", "bsport", "eversport", "mindbody", "arketa", "gymly", "virtuagym", "glofox", "wellnessliving",
  "fitmanager", "bookwhen", "acuityscheduling", "fitogram", "punchpass", "wodify", "perfectgym", "sportbit",
  "clubplanner", "hello-again", "teamup", "trainin", "mywellness", "simplybook", "setmore", "ovatu", "bookeo",
];
const TOKEN_RE = new RegExp("(" + BOOKING_PLATFORM_TOKENS.join("|") + ")", "i");
const hasBookingToken = (s: string): boolean => !!s && TOKEN_RE.test(s);

// Remove every element whose START TAG matches tokenRe (e.g. class/id contains a platform name),
// INCLUDING its full (possibly nested) content — used to strip embedded schedule/booking widget blocks.
function removeElementsWithAttrToken(html: string, tokenRe: RegExp): string {
  const openTag = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  const voids = /^(img|br|hr|input|meta|link|source|track|area|base|col|embed|param|wbr)$/i;
  let m: RegExpExecArray | null;
  while ((m = openTag.exec(html)) !== null) {
    const tag = m[1];
    if (voids.test(tag) || m[0].endsWith("/>") || !tokenRe.test(m[2])) continue;
    const start = m.index;
    const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    scan.lastIndex = openTag.lastIndex;
    let depth = 1, end = -1, w: RegExpExecArray | null;
    while ((w = scan.exec(html)) !== null) {
      if (w[0].endsWith("/>")) continue;
      depth += w[1] ? -1 : 1;
      if (depth === 0) { end = scan.lastIndex; break; }
    }
    if (end === -1) continue; // unbalanced → leave it alone (safety)
    html = html.slice(0, start) + html.slice(end);
    openTag.lastIndex = start; // keep scanning from the cut point
  }
  return html;
}

const isExternalBookingUrl = (url: string): boolean =>
  (/^https?:\/\//i.test(url) || url.startsWith("//")) && hasBookingToken(url);

/**
 * Remove everything that points to / embeds an EXTERNAL booking platform (bsport, Momoyoga, Eversports,
 * …): widget blocks (class/id), platform scripts/styles/iframes (incl. relative WP-plugin paths), and
 * links/buttons. Nav items that are ONLY such a link get dropped whole; mixed items keep their other
 * links. Internal links (the site's own pages, the Nebula "Boeken" page) are never touched.
 */
export function removeExternalBookings(html: string): string {
  let out = html;
  // 1. Widget CONTAINERS: elements whose class/id carries a platform token (e.g. the Momoyoga block).
  out = removeElementsWithAttrToken(out, new RegExp('\\b(?:class|id)=["\'][^"\']*(?:' + BOOKING_PLATFORM_TOKENS.join("|") + ')', "i"));
  // 2. Platform assets: <script src>/<link href>/<style id>/<iframe src> referencing a platform token
  //    (matches absolute URLs AND relative WP-plugin paths). Inline scripts are matched by src only.
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => hasBookingToken(m.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? "") ? "" : m);
  out = out.replace(/<link\b[^>]*>/gi, (m) => hasBookingToken(m.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "") ? "" : m);
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (m) => hasBookingToken(m.match(/\bid=["']([^"']+)["']/i)?.[1] ?? "") ? "" : m);
  out = out.replace(/<iframe\b[^>]*>(?:[\s\S]*?<\/iframe>)?/gi, (m) => hasBookingToken(m.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? "") ? "" : m);
  // 3. Nav items: a <li> whose only link(s) are external → drop it; mixed → strip just those <a>.
  out = out.replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, (li) => {
    const hrefs = [...li.matchAll(/\bhref=["']([^"']+)["']/gi)].map((mm) => mm[1]);
    const ext = hrefs.filter(isExternalBookingUrl).length;
    if (ext === 0) return li;
    const anchors = (li.match(/<a\b[^>]*>/gi) || []).length;
    if (anchors <= ext) return ""; // the whole item is just external booking link(s)
    return li.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi, (a, href) => isExternalBookingUrl(href) ? "" : a);
  });
  // 4. Any remaining bare <a href=ext …>…</a> (CTA buttons outside a nav list).
  out = out.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi, (m, href) => isExternalBookingUrl(href) ? "" : m);
  return out;
}

/** Remove background declarations from an inline style="" value; "" if nothing useful is left. */
function stripBgDecls(decl: string): string {
  return decl
    .replace(/(?:^|;)\s*background(?:-color|-image)?\s*:[^;]*/gi, ";")
    .replace(/;\s*;+/g, ";")
    .replace(/^\s*;+|\s*;+\s*$/g, "")
    .trim();
}

/**
 * Clear EVERY prior source of a nav/header background colour so a fresh recolour can win:
 *   1. inline style="background-color:…" on elements inside <header>/<nav> blocks, and
 *   2. background declarations inside <style> rules whose selector targets the nav/header
 *      (e.g. a previously injected `#header.navbar{background-color:#4a7c9e !important}`).
 * The #2 case is the real culprit: an ID selector + !important out-specifies our element-level
 * override, so the bar "only partly" changes until that rule's background is removed.
 * Other inline styles (box-shadow, padding) and non-background rules are preserved.
 */
function clearPriorNavBackground(html: string): string {
  const scrubTag = (tag: string): string =>
    tag.replace(/(\sstyle=)(["'])([^"']*)\2/i, (m, pre: string, q: string, decl: string) => {
      const cleaned = stripBgDecls(decl);
      return cleaned ? `${pre}${q}${cleaned}${q}` : "";
    });
  const scrubBlock = (block: string) => block.replace(/<[a-z][a-z0-9]*\b[^>]*>/gi, scrubTag);
  let out = html
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, scrubBlock)
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, scrubBlock);

  // Neutralise nav/header-targeted background rules inside <style> blocks (but never our own).
  const navSel = /(?:^|[\s,>+~])(?:header|nav|\.navbar|[.#][\w-]*(?:nav|menu|header)[\w-]*)/i;
  out = out.replace(/(<style\b(?![^>]*data-buildly)[^>]*>)([\s\S]*?)(<\/style>)/gi, (full, open, css, close) => {
    const next = css.replace(/([^{}]+)\{([^{}]*)\}/g, (rule: string, sel: string, body: string) =>
      navSel.test(sel) ? `${sel}{${body.replace(/background(?:-color|-image)?\s*:[^;}]*;?/gi, "")}}` : rule,
    );
    return `${open}${next}${close}`;
  });
  return out;
}

// Bootstrap (and similar) background UTILITY classes set the background with !important and
// would fight a nav recolour on the pages that use them (e.g. `bg-light` on inner pages but
// not the homepage — the exact "only the hero changes" bug). Strip them from nav/header tags.
const BG_UTILITY = /\bbg-(?:light|dark|white|black|body|body-tertiary|body-secondary|transparent|primary|secondary|success|info|warning|danger|muted|gradient)\b/gi;
function stripNavBgUtilityClasses(html: string): string {
  const scrub = (tag: string) =>
    tag.replace(/(\sclass=)(["'])([^"']*)\2/i, (m, pre: string, q: string, cls: string) => {
      const next = cls.replace(BG_UTILITY, "").replace(/\s+/g, " ").trim();
      return `${pre}${q}${next}${q}`;
    });
  return html
    .replace(/<nav\b[^>]*>/gi, scrub)
    .replace(/<header\b[^>]*>/gi, scrub);
}

const cssEscClass = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");
/** Build high-specificity selectors (tag#id.class.class) from the page's nav/header elements. */
function navBarSelectors(html: string): string[] {
  const out: string[] = [];
  const re = /<(nav|header)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(html)) !== null && count < 4) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const id = (attrs.match(/\bid=["']([^"']+)["']/i) ?? [])[1];
    const cls = (attrs.match(/\bclass=["']([^"']+)["']/i) ?? [])[1] ?? "";
    const classes = cls.split(/\s+/).map(cssEscClass).filter(Boolean).slice(0, 6);
    if (!id && classes.length === 0) continue; // bare tag adds no specificity over generic
    let sel = tag;
    if (id) sel += "#" + cssEscClass(id);
    if (classes.length) sel += "." + classes.join(".");
    if (!out.includes(sel)) { out.push(sel); count++; }
  }
  return out;
}

/** Change a colour of the site — applies to every page via a managed style block. */
export function changeColor(html: string, target: ColorTarget, color: string): string {
  if (target !== "nav") return upsertStyleBlock(html, `color-${target}`, colorCss(target, color));
  // Nav: clear prior backgrounds (inline + <style> rules), strip Bootstrap bg-* utilities,
  // then out-specify any remaining external rule with id+class selectors.
  let base = clearPriorNavBackground(html);
  base = stripNavBgUtilityClasses(base);
  const specifics = navBarSelectors(base);
  return upsertStyleBlock(base, "color-nav", colorCss("nav", color, specifics));
}

/** Change the site font — managed style block, applies to every page. */
export function changeFont(html: string, family: string): string {
  const fam = family.trim().replace(/["']/g, "");
  // Quote multi-word families; add a sensible generic fallback.
  const stack = `${/\s/.test(fam) ? `'${fam}'` : fam}, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  // Load the family from Google Fonts (best-effort; harmless if it 404s).
  const imp = `@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap');`;
  const css = `${imp}body,h1,h2,h3,h4,h5,h6,p,a,button,input,textarea,select,li,span{font-family:${stack} !important;}`;
  return upsertStyleBlock(html, "font", css);
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace a specific piece of visible text with new text — never touches tags/attributes. */
export function changeText(html: string, from: string, to: string): string {
  const needle = from.trim();
  if (!needle) return html;
  const re = new RegExp(escRe(needle), "gi");
  // Only operate on text nodes (the bit between ">" and "<"), so we never corrupt
  // attributes, URLs, class names, or script/style contents that merely contain the word.
  return html.replace(/>([^<]+)</g, (m, text: string) => `>${text.replace(re, to)}<`);
}

/**
 * Replace image sources. `match` selects which images:
 *   "all"/"alle" → every <img>; "logo" → images that look like a logo;
 *   "hero" → the first content image; otherwise images whose src/alt contains `match`.
 * Strips srcset / data-src so the new src actually wins.
 */
export function replaceImage(html: string, match: ImageMatch, src: string): string {
  const m = match.trim().toLowerCase();
  let heroDone = false;
  let n = 0;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcAttr = (tag.match(/\bsrc=["']([^"']*)["']/i)?.[1] ?? "").toLowerCase();
    const altAttr = (tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "").toLowerCase();
    const cls = (tag.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "").toLowerCase();

    let hit = false;
    if (m === "all" || m === "alle" || m === "alles") hit = true;
    else if (m === "logo") hit = /logo/.test(srcAttr) || /logo/.test(altAttr) || /logo/.test(cls);
    else if (m === "hero") { hit = !heroDone; heroDone = true; }
    else hit = srcAttr.includes(m) || altAttr.includes(m);

    if (!hit) return tag;
    n++;
    let out = tag
      .replace(/\bsrcset=["'][^"']*["']/gi, "")
      .replace(/\bdata-src=["'][^"']*["']/gi, "")
      .replace(/\bdata-srcset=["'][^"']*["']/gi, "");
    out = /\bsrc=["'][^"']*["']/i.test(out)
      ? out.replace(/\bsrc=["'][^"']*["']/i, `src="${src}"`)
      : out.replace(/<img\b/i, `<img src="${src}"`);
    return out;
  });
}

/** A minimal, clean standalone page (used by create_page). Self-contained, no framework deps. */
// ── Manual section blocks (visual editor, no AI) ──────────────────────────────
// Self-contained, inline-styled sections so they look clean on ANY imported site. Text + images
// are editable afterwards via "Selecteer & bewerk". Light, editorial house style.
export type SectionKind = "heading" | "text" | "image-text" | "gallery" | "cta";

const IMG = (seed: string) => `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=900&q=70`;
const SECTION_TEMPLATES: Record<SectionKind, string> = {
  heading: `<section style="padding:72px 24px;background:#faf9f6;text-align:center">
  <div style="max-width:760px;margin:0 auto">
    <h2 style="font-size:34px;font-weight:700;color:#1f2937;margin:0 0 14px">Nieuwe titel</h2>
    <p style="font-size:18px;line-height:1.7;color:#4b5563;margin:0">Beschrijvende tekst die je hier aanpast. Klik op de tekst met "Selecteer &amp; bewerk".</p>
  </div>
</section>`,
  text: `<section style="padding:56px 24px;background:#fff">
  <div style="max-width:720px;margin:0 auto">
    <p style="font-size:18px;line-height:1.8;color:#374151;margin:0">Schrijf hier je tekst. Dit is een eenvoudig tekstblok dat je kunt aanpassen via "Selecteer &amp; bewerk".</p>
  </div>
</section>`,
  "image-text": `<section style="padding:64px 24px;background:#fff">
  <div style="max-width:1080px;margin:0 auto;display:flex;flex-wrap:wrap;gap:40px;align-items:center">
    <img src="${IMG("1545205597-3d9d02c29597")}" alt="" style="flex:1 1 320px;width:100%;max-width:520px;border-radius:16px;object-fit:cover;aspect-ratio:4/3">
    <div style="flex:1 1 320px">
      <h2 style="font-size:28px;font-weight:700;color:#1f2937;margin:0 0 12px">Titel naast afbeelding</h2>
      <p style="font-size:17px;line-height:1.7;color:#4b5563;margin:0">Vertel hier iets over je studio of dienst. Vervang de afbeelding en pas de tekst aan.</p>
    </div>
  </div>
</section>`,
  gallery: `<section style="padding:64px 24px;background:#faf9f6">
  <div style="max-width:1080px;margin:0 auto">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px">
      <img src="${IMG("1518611012118-696072aa579a")}" alt="" style="width:100%;border-radius:14px;object-fit:cover;aspect-ratio:1/1">
      <img src="${IMG("1599901860904-17e6ed7083a0")}" alt="" style="width:100%;border-radius:14px;object-fit:cover;aspect-ratio:1/1">
      <img src="${IMG("1506126613408-eca07ce68773")}" alt="" style="width:100%;border-radius:14px;object-fit:cover;aspect-ratio:1/1">
    </div>
  </div>
</section>`,
  cta: `<section style="padding:72px 24px;background:#1f2937;text-align:center">
  <div style="max-width:680px;margin:0 auto">
    <h2 style="font-size:30px;font-weight:700;color:#fff;margin:0 0 14px">Klaar om te beginnen?</h2>
    <p style="font-size:17px;line-height:1.7;color:#d1d5db;margin:0 0 26px">Een korte, wervende zin die bezoekers aanzet tot actie.</p>
    <a href="#" style="display:inline-block;background:#fff;color:#1f2937;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:999px">Neem contact op</a>
  </div>
</section>`,
};

/** Insert a section block into a page: before <footer>, else before </main>/</body>, else append. */
export function addSection(html: string, kind: SectionKind): string {
  const block = "\n" + (SECTION_TEMPLATES[kind] || SECTION_TEMPLATES.text) + "\n";
  const lower = html.toLowerCase();
  const footer = lower.indexOf("<footer");
  if (footer !== -1) return html.slice(0, footer) + block + html.slice(footer);
  const mainClose = lower.lastIndexOf("</main>");
  if (mainClose !== -1) return html.slice(0, mainClose) + block + html.slice(mainClose);
  const bodyClose = lower.lastIndexOf("</body>");
  if (bodyClose !== -1) return html.slice(0, bodyClose) + block + html.slice(bodyClose);
  return html + block;
}

export function buildBlankPage(title: string, navLabel: string): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body>
  <main style="max-width:800px;margin:0 auto;padding:48px 24px;font:inherit;">
    <h1>${navLabel}</h1>
    <p>Deze pagina is klaar om in te vullen.</p>
  </main>
</body>
</html>`;
}

/** Site title from <title> (strip a trailing " - Brand" / " | Brand" suffix). */
function extractTitle(html: string): string {
  const t = (html.match(/<title[^>]*>([^<]*)<\/title>/i) ?? [])[1] ?? "";
  return t.split(/\s[|–\-]\s/)[0].replace(/\s+/g, " ").trim().slice(0, 40) || "Studio";
}

/** Top-level menu links (label + href) from the first nav/header, for the app's slim header. */
function extractNavLinks(html: string, skipHref: string): { label: string; href: string }[] {
  const block = (html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i) ?? [])[0]
    ?? (html.match(/<header\b[^>]*>[\s\S]*?<\/header>/i) ?? [])[0] ?? "";
  const out: { label: string; href: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null && out.length < 8) {
    const href = m[1].trim();
    const label = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!label || label.length > 22) continue;
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    if (href === skipHref) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, href });
  }
  return out;
}

/** The site's domain, from the first absolute link (used to absolutise a relative logo URL). */
function extractDomain(html: string): string {
  return (html.match(/<a\b[^>]*\bhref=["']https?:\/\/([^/"']+)/i) ?? [])[1] ?? "";
}

// The REAL image URL of an <img> tag. Lazy-loading themes put a 1×1 data: placeholder in src and the
// actual image in data-src/data-lazy-src/srcset — so reading only src would miss every content photo.
function realImgSrc(tag: string): string {
  const attr = (n: string) => (tag.match(new RegExp('\\b' + n + '=["\']([^"\']+)["\']', "i")) ?? [])[1] ?? "";
  const src = attr("src");
  if (src && !/^data:/i.test(src)) return src;
  for (const n of ["data-src", "data-lazy-src", "data-original", "data-lazy"]) {
    const v = attr(n);
    if (v && !/^data:/i.test(v)) return v;
  }
  const srcset = attr("srcset") || attr("data-srcset");
  if (srcset) { const first = srcset.split(",")[0].trim().split(/\s+/)[0]; if (first && !/^data:/i.test(first)) return first; }
  return src; // may be a data: placeholder → the caller's data:/logo filters drop it
}

/** Best-guess site logo as an ABSOLUTE url: an <img> that looks like a logo, else first image. */
function extractLogo(html: string, domain: string): string {
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const srcOf = (t: string) => realImgSrc(t);
  let pick = "";
  for (const t of imgs) {
    const meta = `${srcOf(t)} ${(t.match(/\bclass=["']([^"']*)["']/i) ?? [])[1] ?? ""} ${(t.match(/\balt=["']([^"']*)["']/i) ?? [])[1] ?? ""}`;
    if (/logo/i.test(meta)) { pick = srcOf(t); break; }
  }
  if (!pick && imgs.length) pick = srcOf(imgs[0]);
  if (!pick) return "";
  if (/^https?:\/\//i.test(pick)) return pick;
  if (pick.startsWith("//")) return "https:" + pick;
  // A LOCALISED asset (import stored it at /assets/<hash>) is served by the Nebula host itself — keep it
  // root-relative. Prepending the original domain gives a 404 (that path only exists on Nebula).
  if (pick.startsWith("/assets/")) return pick;
  if (!domain) return "";
  if (pick.startsWith("/")) return "https://" + domain + pick;
  return "https://" + domain + "/" + pick.replace(/^\.?\//, "");
}

/** Best-guess HERO/background image from the site (absolute url), to use as the app background.
 * Skips logos/icons/svgs; prefers images that look like a hero/banner/cover and real photos. */
function extractHeroImage(html: string, domain: string, logo: string): string {
  const cands: string[] = [];
  const bgRe = /background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi;
  let m: RegExpExecArray | null;
  while ((m = bgRe.exec(html)) !== null) cands.push(m[2]);
  const imgRe = /<img\b[^>]*>/gi;
  let t: RegExpExecArray | null;
  while ((t = imgRe.exec(html)) !== null) {
    const s = realImgSrc(t[0]);
    if (s) cands.push(s);
  }
  let best = "", bestScore = 0;
  cands.forEach((url, i) => {
    const low = url.toLowerCase();
    if (!url || /^data:/.test(low) || /\.svg(\?|$)/.test(low)) return;
    if (/logo|icon|favicon|sprite|avatar|placeholder|spinner|loader|emoji/.test(low)) return;
    if (logo && url === logo) return;
    let score = 1;
    if (/hero|banner|header|slider|cover|background|achtergrond|bg[-_]/.test(low)) score += 6;
    if (/wp-content\/uploads|\/media\/|\/images?\//.test(low)) score += 2;
    if (/\.(jpe?g|webp)(\?|$)/.test(low)) score += 1;
    score += Math.max(0, 3 - Math.floor(i / 4)); // mild preference for earlier-in-document
    if (score > bestScore) { bestScore = score; best = url; }
  });
  if (!best) return "";
  if (/^https?:\/\//i.test(best)) return best;
  if (best.startsWith("//")) return "https:" + best;
  // Localised asset → keep root-relative (served by the Nebula host; original domain would 404).
  if (best.startsWith("/assets/")) return best;
  if (!domain) return "";
  if (best.startsWith("/")) return "https://" + domain + best;
  return "https://" + domain + "/" + best.replace(/^\.?\//, "");
}

/** Best-guess accent colour: a managed primary block, else the first non-neutral hex used. */
function extractAccentColor(html: string): string | undefined {
  const v = html.match(/--buildly-primary\s*:\s*(#[0-9a-fA-F]{3,8})/);
  if (v) return v[1];
  const hexes = html.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  for (const h of hexes) {
    const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min > 40 && max < 240 && max > 40) return h.toLowerCase(); // skip near-white/black/grey
  }
  return undefined;
}

/** Read the baked accounts out of an already-generated booking-app.html. */
function readBakedAccounts(html: string): BookingAccount[] {
  const m = html.match(/var BAKED=(\{[\s\S]*?\});/);
  if (!m) return [];
  try { return (JSON.parse(m[1]).accounts as BookingAccount[]) || []; } catch { return []; }
}

/** Merge new logins into existing: a new admin REPLACES the admin; teachers replace/add by e-mail. */
function mergeAccounts(existing: BookingAccount[], incoming: BookingAccount[]): BookingAccount[] {
  let out = existing.slice();
  for (const inc of incoming) {
    if (inc.role === "admin") {
      out = out.filter((a) => a.role !== "admin");
      out.unshift(inc);
    } else {
      out = out.filter((a) => a.email !== inc.email);
      out.push(inc);
    }
  }
  return out;
}

export type ProjectFile = { path: string; content: string };
export type ActionResult = { changed: ProjectFile[]; created: ProjectFile[]; summary: string };

// A nice studio name: use the page title, but when it's generic ("Home", "Welkom", …) derive a
// readable name from the domain instead (praktijkdelotus.nl → "Praktijkdelotus").
function prettyStudio(title: string, domain: string): string {
  const t = (title || "").trim();
  const generic = !t || /^(home|homepage|welkom|welcome|untitled|index|menu|start|studio|pagina|website)$/i.test(t);
  if (!generic) return t;
  const host = (domain || "").replace(/^https?:\/\//, "").replace(/^www\./i, "");
  const label = (host.split(".")[0] || "").replace(/[-_]+/g, " ").trim();
  if (!label) return t || "onze studio";
  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Studio name + logo + accent for branding the transactional e-mails (extracted from the site). */
export function emailBrandSeed(files: ProjectFile[]): { studio: string; logo: string; accent: string } {
  const ref = files.find((f) => /index\.html$/i.test(f.path) && !/booking/i.test(f.path))
    ?? files.find((f) => f.path.endsWith(".html") && /<nav\b|<header\b/i.test(f.content) && !/booking/i.test(f.path))
    ?? files.find((f) => f.path.endsWith(".html") && !/booking/i.test(f.path));
  const dom = ref ? extractDomain(ref.content) : "";
  return {
    studio: ref ? prettyStudio(extractTitle(ref.content), dom) : "onze studio",
    logo: (ref ? extractLogo(ref.content, dom) : "") || "",
    accent: (ref ? extractAccentColor(ref.content) : undefined) || "#7a00df",
  };
}

/** Rebuild booking-app.html from the project's files: keeps the current accounts, uses the
 * manual background (assets/booking-bg.txt) if present else an auto hero, and the site's
 * title/nav/accent/logo. Returns null if there's no booking app to rebuild. */
export function rebuildBookingApp(files: ProjectFile[]): ProjectFile | null {
  const path = "booking-app.html";
  const existing = files.find((f) => f.path === path);
  if (!existing) return null;
  const ref = files.find((f) => /index\.html$/i.test(f.path) && !/booking/i.test(f.path))
    ?? files.find((f) => f.path.endsWith(".html") && /<nav\b|<header\b/i.test(f.content) && !/booking/i.test(f.path))
    ?? files.find((f) => f.path.endsWith(".html") && f.path !== path);
  const dom = ref ? extractDomain(ref.content) : "";
  const content = buildBookingAppPage({
    title: ref ? extractTitle(ref.content) : "Studio",
    navLinks: ref ? extractNavLinks(ref.content, path) : [],
    accent: ref ? extractAccentColor(ref.content) : undefined,
    logo: ref ? extractLogo(ref.content, dom) : undefined,
    homeBg: files.find((f) => f.path === "assets/booking-bg.txt")?.content
      ?? (ref ? extractHeroImage(ref.content, dom, extractLogo(ref.content, dom)) : undefined),
    accounts: existing ? readBakedAccounts(existing.content) : [],
  });
  return { path, content };
}

const COLOR_LABEL: Record<ColorTarget, string> = {
  primary: "hoofdkleur", background: "achtergrond", text: "tekst", buttons: "knoppen",
  links: "links", nav: "navigatiebalk", "nav-text": "navigatie-tekst", headings: "koppen",
};

/**
 * Apply an action to the project's files — PURE: returns which files changed/were created,
 * the caller persists them. No AI, no surprises. Visual actions touch every HTML page.
 */
export function applyAction(action: BuilderAction, files: ProjectFile[]): ActionResult {
  const htmlFiles = files.filter((f) => f.path.toLowerCase().endsWith(".html"));
  const changed: ProjectFile[] = [];
  const created: ProjectFile[] = [];

  const mapHtml = (fn: (html: string) => string) => {
    for (const f of htmlFiles) {
      const next = fn(f.content);
      if (next !== f.content) changed.push({ path: f.path, content: next });
    }
  };

  switch (action.action) {
    case "add_nav_item":
      mapHtml((h) => addNavItem(h, action.label, action.href));
      return { changed, created, summary: `Navigatie-item "${action.label}" toegevoegd op ${changed.length} pagina's.` };

    case "remove_nav_item":
      mapHtml((h) => removeNavItem(h, action.label));
      return { changed, created, summary: `Navigatie-item "${action.label}" verwijderd van ${changed.length} pagina's.` };

    case "rename_nav_item":
      mapHtml((h) => renameNavItem(h, action.from, action.to));
      return { changed, created, summary: `Navigatie-item "${action.from}" hernoemd naar "${action.to}" op ${changed.length} pagina's.` };

    case "create_page": {
      const slug = action.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nieuwe-pagina";
      const path = `${slug}.html`;
      if (!files.some((f) => f.path === path)) {
        created.push({ path, content: buildBlankPage(action.navLabel, action.navLabel) });
      }
      mapHtml((h) => addNavItem(h, action.navLabel, path));
      return { changed, created, summary: `Pagina "${path}" aangemaakt en als "${action.navLabel}" in de navigatie gezet.` };
    }

    case "add_section": {
      const target = files.find((f) => f.path === action.page) || files.find((f) => f.path.toLowerCase().endsWith("index.html"));
      if (!target) return { changed, created, summary: "Pagina niet gevonden." };
      const updated = addSection(target.content, action.kind);
      if (updated !== target.content) changed.push({ path: target.path, content: updated });
      return { changed, created, summary: `Sectie toegevoegd aan ${target.path}.` };
    }

    case "change_color":
      mapHtml((h) => changeColor(h, action.target, action.color));
      return { changed, created, summary: `Kleur van ${COLOR_LABEL[action.target] ?? action.target} aangepast naar ${normalizeColor(action.color)} op ${changed.length} pagina's.` };

    case "change_font":
      mapHtml((h) => changeFont(h, action.family));
      return { changed, created, summary: `Lettertype aangepast naar "${action.family}" op ${changed.length} pagina's.` };

    case "remove_external_bookings":
      mapHtml((h) => removeExternalBookings(h));
      return { changed, created, summary: changed.length
        ? `Links, knoppen en widgets naar externe boekingsplatformen verwijderd op ${changed.length} pagina's.`
        : "Geen links naar externe boekingsplatformen gevonden." };

    case "change_text":
      mapHtml((h) => changeText(h, action.from, action.to));
      return { changed, created, summary: `Tekst "${action.from}" vervangen door "${action.to}" op ${changed.length} pagina's.` };

    case "replace_image":
      mapHtml((h) => replaceImage(h, action.match, action.src));
      return { changed, created, summary: `Afbeelding(en) (${action.match}) vervangen op ${changed.length} pagina's.` };

    case "add_booking_app": {
      const path = "booking-app.html";
      // Reuse the site's menu links + accent so the (clean, self-contained) app still fits in.
      const ref = htmlFiles.find((f) => /index\.html$/i.test(f.path) && !/booking/i.test(f.path))
        ?? htmlFiles.find((f) => /<nav\b|<header\b/i.test(f.content) && !/booking/i.test(f.path))
        ?? htmlFiles.find((f) => !/booking/i.test(f.path));
      if (!files.some((f) => f.path === path)) {
        created.push({
          path,
          content: buildBookingAppPage({
            title: ref ? extractTitle(ref.content) : "Studio",
            navLinks: ref ? extractNavLinks(ref.content, path) : [],
            accent: ref ? extractAccentColor(ref.content) : undefined,
            logo: ref ? extractLogo(ref.content, extractDomain(ref.content)) : undefined,
            // Manual override (assets/booking-bg.txt) wins; otherwise auto-pick a hero image from the site.
            homeBg: files.find((f) => f.path === "assets/booking-bg.txt")?.content
              ?? (ref ? extractHeroImage(ref.content, extractDomain(ref.content), extractLogo(ref.content, extractDomain(ref.content))) : undefined),
            accounts: action.accounts,
          }),
        });
      }
      mapHtml((h) => addNavItem(h, "Boeken", path));
      return { changed, created, summary: `Booking-app "${path}" toegevoegd (werkend, in de stijl van de site) en als "Boeken" in de navigatie gezet op ${changed.length} pagina's. Tip: je kunt de homepagina-achtergrond later veranderen door een afbeelding in de chat te uploaden en te zeggen "gebruik dit als achtergrond".` };
    }

    case "set_booking_logins": {
      const path = "booking-app.html";
      const existing = files.find((f) => f.path === path);
      if (!existing) {
        return { changed, created, summary: `Er is nog geen booking-app. Vraag eerst "maak een booking app", dan kan ik de logins instellen.` };
      }
      const merged = mergeAccounts(readBakedAccounts(existing.content), action.accounts);
      const ref = htmlFiles.find((f) => /index\.html$/i.test(f.path) && !/booking/i.test(f.path))
        ?? htmlFiles.find((f) => /<nav\b|<header\b/i.test(f.content) && !/booking/i.test(f.path))
        ?? htmlFiles.find((f) => f.path !== path);
      const content = buildBookingAppPage({
        title: ref ? extractTitle(ref.content) : "Studio",
        navLinks: ref ? extractNavLinks(ref.content, path) : [],
        accent: ref ? extractAccentColor(ref.content) : undefined,
        logo: ref ? extractLogo(ref.content, extractDomain(ref.content)) : undefined,
        homeBg: files.find((f) => f.path === "assets/booking-bg.txt")?.content
          ?? (ref ? extractHeroImage(ref.content, extractDomain(ref.content), extractLogo(ref.content, extractDomain(ref.content))) : undefined),
        accounts: merged,
      });
      changed.push({ path, content });
      const who = action.accounts.map((a) => `${a.name} (${a.role === "admin" ? "beheerder" : "docent"}: ${a.email})`).join(", ");
      return { changed, created, summary: `Inloggegevens ingesteld voor ${who}. Je kunt nu op de booking-app inloggen met die gegevens.` };
    }

    case "edit_element":
    case "undo":
      // These need the DB / a cheerio pass on one page — handled in the route, never here.
      return { changed, created, summary: "" };

    case "none":
    default:
      return { changed, created, summary: `Geen actie: ${("reason" in action && action.reason) || "verzoek niet herkend"}.` };
  }
}
