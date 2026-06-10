---
name: Buildly imported-site context distillation
description: Why edits to imported WordPress/Elementor sites must use a distilled brief, not raw HTML, or generation silently emits nothing.
---

# Imported-site context distillation

When the AI edits a project, the existing files are dumped into the system prompt.
For IMPORTED WordPress/Elementor sites this is fatal: each project is ~30 pages of
minified Elementor markup (several MB). Even capped at ~2M chars of raw HTML, the
reasoning model burns its entire output-token budget "reading" the bloat and emits
ZERO tokens — the stream runs for minutes and the user sees nothing generated.

**Rule:** for imported projects, send a DISTILLED brief, never raw HTML.

**Why:** a reasoning model with a fixed completion-token budget produces no output
when the input is large enough to consume that budget during reasoning. Distillation
(per-page title, meta description, h1–h3 headings, key paragraphs, real absolute
image URLs, plus the main nav) drops the payload to ~64K chars, leaving room to write.

**Two phases — distill once, then edit incrementally:**
- A raw WP import is `.html`-only. The FIRST edit ("make it prettier") runs in
  `rebuild` mode: distilled brief + "rebuild as one SPA" + output only
  index.html/styles.css/script.js. After that the project has standalone css/js.
- EVERY later edit must be `edit` mode: feed the existing SPA files RAW (~25KB) and
  say "change only what's asked, do not redesign". Phase is decided by
  `importedSpaRebuilt(files)` = any non-`.html` editable file (css/js) exists.
- **Why:** without this, two forces forced a full rebuild on every follow-up:
  (1) buildImportedContext kept re-distilling + saying "rebuild the whole site";
  (2) buildSystemPrompt ALWAYS shipped a hardcoded "IMPORTED WEBSITE ASSETS" block
  with "REBUILD THE WHOLE SITE… Building only a home page is a FAILURE". The system
  prompt is now phase-aware: `importMode` none|rebuild|edit swaps that block for an
  INCREMENTAL-EDIT block in `edit` mode. Both routes compute importMode the same way.
- **Edge case (accepted, low-risk):** if a first rebuild ever emits only index.html
  (no css/js), the next edit is misclassified as `rebuild` and regenerates once —
  self-corrects after css/js exist. Don't "fix" this with an elementor/`wp-content`
  HTML fingerprint: rebuilt index.html legitimately reuses `wp-content` image URLs,
  and non-Elementor imports lack the marker, so a fingerprint would misclassify a
  fresh raw import as already-rebuilt (skipping distillation) — a worse regression.

**Redesign preservation contract (rebuild mode only):**
- The first rebuild gets a strict "REDESIGN PRESERVATION CONTRACT" appended to the
  system prompt: preserve every nav item, button/CTA (same label + action), section,
  and link; improve ONLY visuals (type, spacing, color, components, mobile); never
  remove/reorder/shorten. The distilled brief now also extracts per-page CTAs
  (`extractCtas`) and more copy so the model has the data to keep that structure.
- **Why:** the user supplied these PRESERVE/IMPROVE rules after redesigns dropped
  buttons/sections. Append it ONLY when `importMode === "rebuild"` — NOT in `edit`
  mode: edit mode already says "change only what's asked", and the contract's
  "improve the visuals" language would wrongly trigger a redesign on a tiny edit.
- The text-preservation line says "use the REAL wording PROVIDED below", not "keep
  all text exactly" — the brief is distilled/truncated, so promising verbatim full
  text is a claim the data can't satisfy. Structure (nav/buttons/sections/links) IS
  fully captured and can be promised; full body copy cannot.

**How to apply:**
- Detection: `project.description` starts with `"Imported from"` (same convention the
  frontend uses for `isImported`). Both the stream route and the non-stream messages
  route pass this flag into `buildFileContext(files, imported)`.
- `buildFileContext` dispatches: imported → `buildImportedContext`, else
  `buildRawFileContext` (the old behaviour, unchanged for normal projects).
- Protection: `buildImportedContext` returns every original `.html` page EXCEPT
  `index.html` in `omitted`. `persistGeneratedFiles` treats `omitted` as
  protectedPaths and skips writing them, so the verbatim source pages survive for
  WXR re-export while the model rebuilds `index.html` + `styles.css` + `script.js`
  into a clean single-page app. NEVER protect `index.html` — the SPA must overwrite it.
- Budget caps: `IMPORTED_CONTEXT_MAX_CHARS` (~180K total) / `PER_PAGE_MAX_CHARS` (~8K).
- Nav extraction picks the densest `<nav>` / `<ul …menu…>` / `<header>` block (most
  distinct short link labels) so it grabs the real menu, not a skip-to-content link.
