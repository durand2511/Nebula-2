/**
 * WritePlan enforcement — pure functions, no DB, fully testable.
 *
 * This module is the single source of truth for write restrictions.
 * executeNebulaToolCall imports from here; the test imports from here directly.
 */

export type FileRole =
  | "nav_update_only"  // only a nav <a> tag may be added — full rewrites blocked
  | "new_page"         // must be created as a new standalone HTML file
  | "style_only"       // CSS changes only
  | "unrestricted";    // no extra constraints

export type WritePlan = {
  fileRoles: Map<string, FileRole>;
  blockedPatterns: string[]; // strings that must NOT appear in nav_update_only files
  requiredNewFiles: string[]; // files that MUST be created by the end of the build
};

/** Minimal intent shape needed for fail-closed enforcement when writePlan is null. */
export type IntentForEnforcement = {
  category: string;
  bookingUrls: string[];
};

/**
 * True when a new-page/new-tab request lands on an imported site.
 *
 * Imported sites are rebuilt into a single-page app in index.html, and the normal
 * imported-edit guidance tells the model "edit index.html only". For a NEW page that
 * guidance is wrong — a new tab must become a new standalone FILE (pages/xxx.html),
 * never a section bolted into index.html. When this returns true the caller must
 * suppress the "edit index.html only" framing and emit the new-page-creates-a-file
 * directive instead.
 */
export function isNewPageOnImportedSite(
  importMode: "none" | "rebuild" | "edit" | string,
  intentCategory: string | undefined | null,
): boolean {
  return importMode !== "none" && intentCategory === "new_page";
}

/**
 * Trim chat history so the total prompt fits the model's input context window.
 *
 * The model has a hard input limit (200K tokens for Sonnet). System prompt + imported
 * context + the full chat history can exceed it on long-running/imported projects,
 * producing a "prompt is too long" 400 that surfaces as "something went wrong".
 *
 * Strategy: always keep the newest message (the current request), then add older
 * messages newest-first while they fit the budget. Token count is estimated from
 * characters with a conservative divisor (dense HTML/code tokenizes to ~3.3 chars/token;
 * a lower divisor over-estimates tokens, so we err toward trimming rather than 400ing).
 *
 * @returns the kept messages (chronological order) and how many were dropped.
 */
export function fitHistoryToContext<T extends { content: string }>(
  systemPromptChars: number,
  history: T[],
  maxInputTokens = 170_000,
  charsPerToken = 2.5, // conservative: dense HTML/code tokenizes to ~2.7 chars/token, so 2.5 errs toward trimming
): { kept: T[]; dropped: number } {
  const budgetChars = maxInputTokens * charsPerToken;
  let used = systemPromptChars;
  const kept: T[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msgChars = (history[i].content?.length ?? 0) + 16; // +16 for role/formatting overhead
    // Always keep the most recent message even if it alone is large.
    if (kept.length > 0 && used + msgChars > budgetChars) break;
    used += msgChars;
    kept.unshift(history[i]);
  }
  return { kept, dropped: history.length - kept.length };
}

/**
 * True when an imported project shows signs of OUR edits (so later builds must EDIT the
 * current files, never re-distill/rebuild index.html from the original scraped content —
 * which would wipe added nav links and orphan created pages like pages/bookings.html).
 *
 * Signals of an edit:
 *  - any file in a subdirectory (pages/, styles/, scripts/, components/) — original
 *    imported pages are always FLAT at the root, so a nested file was created by us;
 *  - any non-HTML asset at the root (styles.css / script.js from a "prettier" pass).
 *
 * index.html alone never counts (every imported site has it).
 */
export function importedSiteHasEdits(paths: string[]): boolean {
  return paths.some((p) => {
    const lp = p.toLowerCase();
    if (lp === "index.html") return false;
    if (lp.includes("/")) return true;      // nested file → created by us
    if (!lp.endsWith(".html")) return true;  // root-level asset → SPA already rebuilt/edited
    return false;
  });
}

export type NavItem = { href: string; label: string };

/**
 * Extract the PRIMARY menu items (label + href) from an imported page. Looks at the first
 * non-footer / non-mobile <nav> that has anchors, de-duplicates by href, and skips dead
 * links (#, javascript:). This is the single source of truth for the clean nav.
 */
export function extractPrimaryNavItems(html: string): NavItem[] {
  const navs = [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)];
  let chosen = "";
  for (const m of navs) {
    const before = html.slice(Math.max(0, (m.index ?? 0) - 300), m.index ?? 0).toLowerCase();
    const ctx = before + " " + m[0].slice(0, 200).toLowerCase();
    if (/\b(footer|policy|policies|social|breadcrumb|legal)\b/.test(ctx)) continue;
    if (/(mobile-menu|off-?canvas|offcanvas|menu-drawer|nav-drawer|slide-?menu|popup-menu|hamburger-menu)/.test(ctx)) continue;
    if (!/<a\b/i.test(m[0])) continue;
    chosen = m[0];
    break;
  }
  if (!chosen) return [];

  const items: NavItem[] = [];
  const seen = new Set<string>();
  for (const a of chosen.matchAll(/<a\b[^>]*\bhref=("|')([^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = a[2].trim();
    const label = a[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!href || !label) continue;
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const key = href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ href, label });
  }
  return items;
}

/**
 * Build ONE clean, self-contained nav bar from menu items. It carries its own inline layout
 * (a flex row) and inherits the page's font/colour, so it renders identically on every page
 * regardless of the imported site's messy CSS. No framework classes, no duplicate variants.
 */
export function buildCleanNavBar(items: NavItem[]): string {
  const links = items
    .map(
      (it) =>
        `      <li><a href="${it.href}" style="color:inherit;text-decoration:none;padding:8px 14px;display:inline-block;font-weight:500;border-radius:6px;">${it.label}</a></li>`,
    )
    .join("\n");
  return `<header data-clean-nav style="border-bottom:1px solid rgba(0,0,0,.08);font:inherit;">
  <nav style="max-width:1100px;margin:0 auto;padding:12px 20px;">
    <ul style="list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;align-items:center;">
${links}
    </ul>
  </nav>
</header>`;
}

/**
 * Replace a page's messy top navigation with ONE clean nav bar (identical on every page),
 * preserving the <footer>. This is what makes the tab stay visible while navigating — every
 * page gets the exact same clean menu instead of its own inconsistent copy.
 */
export function normalizeImportedNav(pageHtml: string, cleanNav: string): string {
  const fIdx = pageHtml.search(/<footer\b/i);
  let head = fIdx >= 0 ? pageHtml.slice(0, fIdx) : pageHtml;
  const foot = fIdx >= 0 ? pageHtml.slice(fIdx) : "";
  head = head
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, "");
  if (/<body[^>]*>/i.test(head)) head = head.replace(/<body[^>]*>/i, (m) => m + "\n" + cleanNav);
  else head = cleanNav + head;
  return head + foot;
}

/**
 * Light, SAFE cleanup of imported HTML so the code panel is readable: strip HTML comments,
 * analytics/tracking scripts, and collapse runs of blank lines. Does NOT remove structural
 * classes/wrappers the site's CSS depends on (that would break the look).
 */
export function cleanupImportedHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    // tracking / analytics / consent scripts (layout-irrelevant noise)
    .replace(/<script\b[^>]*>(?:[\s\S]*?(?:gtag|googletagmanager|google-analytics|fbq|facebook\.net|hotjar|clarity\.ms|cookieconsent|_gaq)[\s\S]*?)<\/script>/gi, "")
    .replace(/<script\b[^>]*\bsrc=["'][^"']*(?:gtm|googletagmanager|google-analytics|analytics|hotjar|clarity|fbevents|connect\.facebook)[^"']*["'][^>]*>\s*<\/script>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Insert a nav link into an HTML page by CLONING an existing nav anchor's exact markup
 * (so classes/structure match the site), changing only the href and visible label.
 *
 * Used to propagate a new page's nav link across the site DETERMINISTICALLY (no LLM cost),
 * so a tab like BOOKINGS stays visible on every page instead of only on index.html.
 *
 * Returns the modified HTML, or null when it can't safely insert (no nav anchor found,
 * or the link is already present — both mean "leave the file untouched").
 */
export function insertNavLink(html: string, href: string, label: string): string | null {
  const dropActive = (s: string) =>
    s.replace(/\s+aria-current=("|')[^"']*\1/gi, "")
      .replace(/\s+(?:active|current|current[-_][\w-]+)(?=["'\s])/gi, "");
  // The clone must not reuse the template's element id — duplicate ids are invalid HTML.
  const dropId = (s: string) => s.replace(/\s+id=("|')[^"']*\1/i, "");
  // For an INTERNAL link, drop target="_blank"/rel copied from the template (e.g. an external
  // CTA): an internal page must open in the same window, or the preview can't navigate to it.
  const isInternal = !/^(https?:)?\/\//i.test(href);
  const dropTarget = (s: string) =>
    isInternal
      ? s.replace(/\s+target=("|')[^"']*\1/i, "").replace(/\s+rel=("|')[^"']*\1/i, "")
      : s;

  // Find the index of the tag that BALANCES the open-tag starting at `fromOpen` (so nested
  // <ul>/<li> don't fool us). Returns the index of the matching close tag, or -1.
  function balancedClose(s: string, tag: string, fromOpen: number): number {
    const re = new RegExp(`<\\/?${tag}\\b`, "gi");
    re.lastIndex = fromOpen;
    let depth = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      if (m[0][1] === "/") { depth--; if (depth === 0) return m.index; }
      else depth++;
    }
    return -1;
  }

  // Build the new item from an existing one: clone its markup, swap href + label, drop id/active.
  function cloneItem(tmpl: string): string {
    return dropTarget(dropId(dropActive(
      tmpl
        .replace(/\bhref=("|')[^"']*\1/i, `href="${href}"`)
        .replace(/(<a\b[^>]*>)[\s\S]*?(<\/a>)/i, `$1${label}$2`),
    )));
  }

  // Insert the new item as the LAST TOP-LEVEL item of the menu inside `block`. Uses balanced
  // matching so submenus never break the structure and the position is always the same
  // (final top-level <li>, just before the main list's closing </ul>).
  function insertIntoBlock(block: string): string | null {
    // Skip if THIS block already links the page (per-block dedup, not whole-document).
    if (block.includes(`href="${href}"`) || block.includes(`href='${href}'`)) return null;

    const ulOpen = block.search(/<ul\b/i);
    if (ulOpen >= 0) {
      const ulClose = balancedClose(block, "ul", ulOpen);
      if (ulClose > ulOpen) {
        // Find a clean TOP-LEVEL <li> as the structural template: walk top-level items by
        // balanced <li> matching, pick one whose own markup has an <a> (ignore wrappers).
        let i = block.slice(ulOpen).search(/<li\b/i);
        let template = "";
        let cursor = ulOpen + (i >= 0 ? i : 0);
        while (i >= 0 && cursor < ulClose) {
          const liClose = balancedClose(block, "li", cursor);
          if (liClose < 0 || liClose > ulClose) break;
          const li = block.slice(cursor, liClose + 5); // include "</li>"
          if (/<a\b/i.test(li)) template = li;
          const next = block.slice(liClose).search(/<li\b/i);
          if (next < 0) break;
          cursor = liClose + next;
          i = 0;
        }
        if (template) {
          const newItem = cloneItem(template);
          return block.slice(0, ulClose) + "      " + newItem + "\n    " + block.slice(ulClose);
        }
      }
    }

    // No usable list: clone the last anchor as a sibling (flex/inline navs).
    const anchors = block.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi);
    if (!anchors || anchors.length === 0) return null;
    const tmpl = anchors[anchors.length - 1];
    const newA = dropTarget(dropId(dropActive(
      tmpl.replace(/\bhref=("|')[^"']*\1/i, `href="${href}"`).replace(/>([\s\S]*?)<\/a>/i, `>${label}</a>`),
    )));
    return block.replace(tmpl, tmpl + "\n      " + newA);
  }

  // Real WP/Astra headers ship the PRIMARY menu in several <nav> blocks (desktop, mobile/
  // off-canvas, sticky) plus footer. Insert into EVERY primary-menu nav (so the visible one
  // has it), skipping footer/secondary/mobile variants. Per-block dedup (above) means a
  // hidden variant that already has the link never blocks the visible menu from getting it.
  if (/<nav\b/i.test(html)) {
    const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);
    // The ACTUAL enclosing elements of the nav (its ancestor chain), found by parsing forward
    // and keeping an open-tag stack. This is reliable — unlike a fixed char-window it ignores
    // already-closed PRECEDING siblings (e.g. a mobile menu that sits just before the desktop
    // nav but is already closed), which previously got the desktop nav wrongly excluded.
    const ancestorTags = (offset: number): string => {
      const stack: string[] = [];
      const re = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null && m.index < offset) {
        const name = m[2].toLowerCase();
        if (m[1]) { for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].toLowerCase().startsWith(name)) { stack.length = i; break; } } }
        // Skip <html>/<body>: their page-level classes (e.g. body class "privacy-policy")
        // describe the PAGE, not the nav's role, and would wrongly trigger the exclusion.
        else if (!m[3] && !VOID.has(name) && name !== "html" && name !== "body") stack.push(`${name} ${m[0]}`);
      }
      return stack.join(" ").toLowerCase();
    };
    const isSecondary = (block: string, offset: number) => {
      const ctx = ancestorTags(offset) + " " + block.slice(0, 200).toLowerCase();
      return /\b(footer|policy|policies|social|breadcrumb|legal)\b/.test(ctx)
        || /(mobile-menu|off-?canvas|offcanvas|menu-drawer|nav-drawer|slide-?menu|popup-menu|hamburger-menu)/.test(ctx)
        || !/<a\b/i.test(block);
    };
    const linkCount = (block: string) => (block.match(/<a\b/gi) ?? []).length;

    // First pass: among PRIMARY (non-secondary) navs, find the largest menu — that's the main
    // navigation. The booking tab belongs ONLY there, never in a small secondary/right menu
    // (e.g. a 3-item utility bar), so it always sits among the main items, before the rest.
    let maxLinks = 0;
    for (const m of html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)) {
      if (isSecondary(m[0], m.index ?? 0)) continue;
      maxLinks = Math.max(maxLinks, linkCount(m[0]));
    }
    if (maxLinks === 0) return null;

    let changed = false;
    const out = html.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, (block: string, offset: number, full: string) => {
      if (isSecondary(block, offset)) return block;
      // Only the main menu (and its desktop/sticky duplicates, which share the max size).
      if (linkCount(block) < maxLinks) return block;
      const updated = insertIntoBlock(block);
      if (updated && updated !== block) { changed = true; return updated; }
      return block;
    });
    return changed ? out : null;
  }

  const headerMatch = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/i);
  if (headerMatch) {
    const updated = insertIntoBlock(headerMatch[0]);
    return updated ? html.replace(headerMatch[0], updated) : null;
  }
  const updated = insertIntoBlock(html);
  return updated ?? null;
}

/**
 * Make a created page share the site's exact shell so navigation feels seamless and
 * "everything looks the same": copy index.html's <nav>/<header> into the page (so it has
 * the FULL site navigation, not a simplified one) and ensure the page's <head> links the
 * same stylesheets. The page's own <main> content is left untouched.
 *
 * Deterministic (no LLM cost). Returns the modified HTML (unchanged if nothing to sync).
 */
export function syncImportedPageShell(pageHtml: string, indexHtml: string): string {
  let out = pageHtml;

  // The site's canonical top navigation: prefer index.html's <header> (it usually wraps
  // the nav); otherwise its standalone <nav>.
  const shell =
    (indexHtml.match(/<header\b[^>]*>[\s\S]*?<\/header>/i) ?? [])[0] ??
    (indexHtml.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i) ?? [])[0] ??
    "";

  // 1. Replace the page's TOP navigation with the site's — exactly ONE bar, identical on
  //    every page. Remove EVERY existing <header> and <nav> first (the AI sometimes emits
  //    a header AND a nav → duplicate bar), then insert the canonical shell once after
  //    <body>. The <footer> is preserved untouched (it may contain its own nav links).
  if (shell) {
    const fIdx = out.search(/<footer\b/i);
    let headPart = fIdx >= 0 ? out.slice(0, fIdx) : out;
    const footPart = fIdx >= 0 ? out.slice(fIdx) : "";
    headPart = headPart
      .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<body[^>]*>/i, (m) => m + "\n" + shell);
    out = headPart + footPart;
  }

  // 2. Ensure the page links the same stylesheets as index.html (identical look).
  const linkRe = /<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi;
  const indexLinks = indexHtml.match(linkRe) ?? [];
  if (indexLinks.length && /<\/head>/i.test(out)) {
    const missing = indexLinks.filter((l) => !out.includes(l));
    if (missing.length) out = out.replace(/<\/head>/i, missing.join("\n") + "\n</head>");
  }

  return out;
}

export type DetectedNewPage = { filename: string; navLabel: string };

// Common page names (NL + EN) → file slug + nav label. Order matters: first match wins.
const PAGE_NAME_MAP: Array<{ re: RegExp; slug: string; label: string }> = [
  { re: /\b(bookings?|boeking|boekings|boeken|reserv|afspra)\w*/i, slug: "bookings", label: "Bookings" },
  { re: /\b(contact)\b/i,                                                slug: "contact",  label: "Contact" },
  { re: /\b(pricing|prijzen|tarieven|prijs)\b/i,                         slug: "pricing",  label: "Prijzen" },
  { re: /\b(about|over[\s-]?ons|over[\s-]?mij|about[\s-]?us)\b/i,        slug: "about",    label: "Over ons" },
  { re: /\b(services?|diensten|dienst)\b/i,                              slug: "diensten", label: "Diensten" },
  { re: /\b(portfolio|projecten|projects|werk)\b/i,                      slug: "portfolio",label: "Portfolio" },
  { re: /\b(gallery|galerij|foto'?s|photos?)\b/i,                        slug: "gallery",  label: "Gallery" },
  { re: /\b(blog|nieuws|news)\b/i,                                       slug: "blog",     label: "Blog" },
  { re: /\b(shop|winkel|webshop|store)\b/i,                              slug: "shop",     label: "Shop" },
  { re: /\b(faq|veelgestelde)\b/i,                                       slug: "faq",      label: "FAQ" },
  { re: /\b(team)\b/i,                                                   slug: "team",     label: "Team" },
  { re: /\b(agenda|schedule|rooster|kalender|calendar)\b/i,             slug: "agenda",   label: "Agenda" },
  { re: /\b(menu|kaart)\b/i,                                             slug: "menu",     label: "Menu" },
];

// "I want a new page/tab" phrasing — a page-word plus a create-verb (or explicit "new").
const PAGE_WORD = /\b(tab|tabblad|pagina|page|menu-?item|navigatie-?item)\b/i;
const CREATE_VERB = /\b(maak|voeg|add|create|cre[eë]er|bouw|wil|zet|nieuw\w*|new|extra|aparte?|los(se)?|aanmaken|toevoeg\w*)\b/i;

/**
 * Deterministic safety net for the LLM intent classifier.
 *
 * The Haiku classifier sometimes labels "add a bookings TAB with a booking TOOL" as
 * new_feature (because of the word "tool"/"widget"), which routes content into
 * index.html instead of a new file. This pure function catches UNAMBIGUOUS
 * new-page/new-tab requests so the pipeline can force category="new_page" regardless
 * of what the LLM returned.
 *
 * Conservative by design: fires only when BOTH a page-word ("tab"/"pagina"/"page")
 * AND a create-verb ("maak"/"voeg"/"nieuw"/"add"...) are present, AND the named page
 * does not already exist (an existing page → it's an edit, not a new page).
 *
 * @returns the new page {filename, navLabel}, or null when this is not clearly a new page.
 */
export function detectExplicitNewPage(
  content: string,
  existingPaths: string[],
): DetectedNewPage | null {
  if (!PAGE_WORD.test(content) || !CREATE_VERB.test(content)) return null;

  const exists = (slug: string): boolean =>
    existingPaths.some((p) => {
      const lp = p.toLowerCase();
      return lp === `${slug}.html` || lp === `pages/${slug}.html` || lp.endsWith(`/${slug}.html`);
    });

  for (const { re, slug, label } of PAGE_NAME_MAP) {
    if (re.test(content)) {
      if (exists(slug)) return null; // page already exists → edit, not new page
      return { filename: `pages/${slug}.html`, navLabel: label };
    }
  }
  // Clear new-page phrasing but no recognised name → generic new page.
  return { filename: "pages/nieuwe-pagina.html", navLabel: "Nieuw" };
}

/** Semantic keywords that indicate page/booking content — forbidden in nav_update_only files. */
export const BOOKING_BLOCK_KEYWORDS = [
  // Explicit booking action text
  "book a class",
  "boek een les",
  "book now",
  "boek nu",
  "online booking",
  "online boeking",
  "reserveer",
  "reserve a",
  "booking widget",
  // External services
  "calendly",
  "acuityscheduling",
  "simplybook",
  // Fake booking system indicators (must not appear in nav_update_only files)
  "nebula_bookings",
  "booking-section",
  "id=\"bookings\"",
  "id='bookings'",
  "class=\"booking",
  "class='booking",
  "time-slot",
  "timeslot",
  "nieuw boeken",
  "mijn boekingen",
  // iframe (never allowed in nav-only files)
  "iframe",
];

/**
 * Check whether a proposed write violates the WritePlan for the target file.
 *
 * @param path          File being written/edited
 * @param newContent    Full file content after the write
 * @param existingContent Content before the write (empty string for new files)
 * @param writePlan     Current WritePlan (null = no restrictions unless intent forces fail-closed)
 * @param toolName      Which tool is calling ("write_file" | "edit_file")
 * @param addedText     The text being ADDED: for write_file = full content;
 *                      for edit_file = new_string only
 * @param intent        Optional intent — when writePlan is null and intent.category is
 *                      "new_page", HTML entry-point files are treated as nav_update_only
 *                      (fail-closed: no unrestricted writes allowed).
 * @returns A BLOCKED reason string, or null if the write is allowed.
 */
export function checkWritePlanViolation(
  path: string,
  newContent: string,
  existingContent: string,
  writePlan: WritePlan | null | undefined,
  toolName: "write_file" | "edit_file",
  addedText: string,
  intent?: IntentForEnforcement | null,
): string | null {
  // Fail-closed: when writePlan is null but intent is new_page, build a minimal
  // in-memory plan so existing HTML files can never receive unrestricted writes.
  //
  // Key distinction:
  //   Root-level files (index.html, about.html — no "/" in path) are EXISTING files.
  //   They must only receive a nav link → "nav_update_only".
  //
  //   Files in subdirectories (pages/bookings.html) are NEW files being created.
  //   They must be ALLOWED full content → "new_page".
  //   Treating them as nav_update_only would block all booking content from pages/.
  let effectivePlan = writePlan ?? null;
  if (!effectivePlan && intent?.category === "new_page" && path.endsWith(".html")) {
    const roles = new Map<string, FileRole>();
    const isRootLevel = !path.includes("/");
    roles.set(path, isRootLevel ? "nav_update_only" : "new_page");
    effectivePlan = {
      fileRoles: roles,
      blockedPatterns: intent.bookingUrls,
      requiredNewFiles: [],
    };
  }

  if (!effectivePlan) return null;

  const role = effectivePlan.fileRoles.get(path);
  if (!role || role === "unrestricted" || role === "new_page") return null;

  if (role === "nav_update_only") {
    // 1. Line increase check
    const existingLines = existingContent.split("\n").length;
    const newLines = newContent.split("\n").length;
    const lineIncrease = newLines - existingLines;
    if (lineIncrease > 15) {
      return `BLOCKED [nav_update_only] "${path}": added ${lineIncrease} lines. Only a single <a> nav link (~1–2 lines) is allowed here. Put all page content in the new page file, then use edit_file to add just the nav link to this file.`;
    }

    // 2. Blocked URL/pattern check (booking URLs from the user's request)
    for (const pattern of effectivePlan.blockedPatterns) {
      if (pattern && addedText.includes(pattern)) {
        return `BLOCKED [nav_update_only] "${path}": contains "${pattern.slice(0, 80)}" which must go in the new page file, not here.`;
      }
    }

    // 3. Semantic booking-content check on the added text
    const added = addedText.toLowerCase();
    for (const kw of BOOKING_BLOCK_KEYWORDS) {
      if (added.includes(kw)) {
        return `BLOCKED [nav_update_only] "${path}": added text contains "${kw}" — this is page content, not a nav link. Put it in the new page file.`;
      }
    }

    // 4. Detect new block-level sections
    const newSectionTags = (addedText.match(/<(section|article)\b/gi) ?? []).length;
    if (newSectionTags > 0) {
      return `BLOCKED [nav_update_only] "${path}": added ${newSectionTags} <section>/<article> element(s). This file may only receive a nav link for this task.`;
    }

    // 5. Detect iframes
    if (/<iframe\b/i.test(addedText)) {
      return `BLOCKED [nav_update_only] "${path}": iframes are not allowed here. Add the iframe to the new page file.`;
    }
  }

  if (role === "style_only") {
    if (/<(section|article|iframe|main|header|footer)\b/i.test(addedText)) {
      return `BLOCKED [style_only] "${path}": structural HTML elements not allowed — CSS changes only.`;
    }
  }

  return null;
}
