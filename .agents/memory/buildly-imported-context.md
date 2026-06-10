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
