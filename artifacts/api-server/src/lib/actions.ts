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

export type ColorTarget = "primary" | "background" | "text" | "buttons" | "links" | "nav" | "headings";
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
  | { action: "add_booking_app"; accounts?: BookingAccount[] }
  | { action: "set_booking_logins"; accounts: BookingAccount[] }
  | { action: "undo"; reason: string }
  | { action: "none"; reason: string };

/** The fixed catalogue the classifier must choose from (shown to the AI, used to validate). */
export const ACTION_CATALOGUE = [
  { action: "add_nav_item", params: ["label", "href"], when: "add/append a link or tab to the navigation menu" },
  { action: "remove_nav_item", params: ["label"], when: "remove/delete a tab or link from the navigation" },
  { action: "rename_nav_item", params: ["from", "to"], when: "rename/change the text of an existing nav tab" },
  { action: "create_page", params: ["name", "navLabel"], when: "create a new page/tab (a new file) and add it to the nav" },
  { action: "change_color", params: ["target", "color"], when: "change a colour of the site (background, text, buttons, links, nav/header bar, headings, or the primary/brand colour)" },
  { action: "change_text", params: ["from", "to"], when: "replace a specific piece of visible text with new text (the user gives both the old and the new text)" },
  { action: "replace_image", params: ["match", "src"], when: "replace/swap an image (logo, hero, or all images) with a new image URL" },
  { action: "change_font", params: ["family"], when: "change the font / typeface of the whole site" },
  { action: "add_booking_app", params: [], when: "the user wants a booking/reservation app or system added (e.g. 'maak een booking app', 'voeg een boekingssysteem toe', 'reserveringssysteem', 'agenda waar klanten lessen kunnen boeken')" },
  { action: "set_booking_logins", params: ["accounts"], when: "the user provides login credentials (e-mail + password, optionally names) for the booking app — the admin login and/or teacher logins — so they can log in (e.g. 'de admin login is ...', 'docent Lisa: lisa@x.nl wachtwoord ...')" },
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
      const inner = `header .container,nav .container,header [class*="container"],nav [class*="container"],[class*="navbar"] .container,.navbar-collapse,[class*="navbar"] .navbar-collapse,header .dropdown-menu,nav .dropdown-menu,[class*="navbar"] .dropdown-menu`;
      let css = `${bar}{background-color:${c} !important;background-image:none !important;}`;
      css += `${inner}{background-color:${c} !important;}`;
      if (fg) {
        // Links, menu text and dropdown items stay readable against the new bar.
        css += `header a,nav a,[class*="site-header"] a,[class*="navbar"] a,[role="banner"] a,header .dropdown-item,nav .dropdown-item,header .nav-link,nav .nav-link{color:${fg} !important;}`;
        // Buttons inside the bar flip to a visible inverted style (skip the hamburger toggler).
        css += `header button:not(.navbar-toggler),nav button:not(.navbar-toggler),header .btn,nav .btn,header [class*="button"],nav [class*="button"],header input[type="submit"],nav input[type="submit"]{background-color:${fg} !important;color:${c} !important;border-color:${fg} !important;}`;
      }
      return css;
    }
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

/** Best-guess site logo as an ABSOLUTE url: an <img> that looks like a logo, else first image. */
function extractLogo(html: string, domain: string): string {
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const srcOf = (t: string) => (t.match(/\bsrc=["']([^"']+)["']/i) ?? [])[1] ?? "";
  let pick = "";
  for (const t of imgs) {
    const meta = `${srcOf(t)} ${(t.match(/\bclass=["']([^"']*)["']/i) ?? [])[1] ?? ""} ${(t.match(/\balt=["']([^"']*)["']/i) ?? [])[1] ?? ""}`;
    if (/logo/i.test(meta)) { pick = srcOf(t); break; }
  }
  if (!pick && imgs.length) pick = srcOf(imgs[0]);
  if (!pick) return "";
  if (/^https?:\/\//i.test(pick)) return pick;
  if (pick.startsWith("//")) return "https:" + pick;
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
    const s = (t[0].match(/\bsrc=["']([^"']+)["']/i) ?? [])[1];
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
  links: "links", nav: "navigatiebalk", headings: "koppen",
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

    case "change_color":
      mapHtml((h) => changeColor(h, action.target, action.color));
      return { changed, created, summary: `Kleur van ${COLOR_LABEL[action.target] ?? action.target} aangepast naar ${normalizeColor(action.color)} op ${changed.length} pagina's.` };

    case "change_font":
      mapHtml((h) => changeFont(h, action.family));
      return { changed, created, summary: `Lettertype aangepast naar "${action.family}" op ${changed.length} pagina's.` };

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
