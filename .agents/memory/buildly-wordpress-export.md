---
name: Buildly/Nebula WordPress (WXR) download export
description: How the app-builder "Download code" button exports imported WP/Astra/Elementor sites as a WordPress-importable package, and why.
---

# Download export: WXR package for imported sites, formatted source otherwise

The app-builder "Download code" button (`handleDownload` in `project-workspace.tsx`) has two modes, decided at download time by `buildWordPressExport` in `src/lib/wxr-export.ts`:

- **Imported WP/Astra/Elementor site** → a ZIP containing a WordPress eXtended RSS (`*.wordpress.xml`, WXR 1.2) file + a Dutch `README.md`. Each page becomes a published `page` post with title, slug, content (incl. per-page inline `<style>` for fidelity), Yoast meta description (`_yoast_wpseo_metadesc`), and internal links preserved.
- **Anything else** → falls back to the plain formatted-source ZIP (`formatFileContent` from `format-code.ts`).

Detection: `index.html` must contain the Elementor/Astra markers (`<header data-elementor-type="header"`, `<footer class="site-footer"`, `<div class="hfeed site" id="page">`) AND a canonical link. Host/site-title are derived from the canonical + `og:site_name`. If detection fails, `buildWordPressExport` returns `null` → fallback.

**Why an earlier Astro-export approach was abandoned:** the user (Dutch, non-technical) wants to put the site *back into WordPress*, not get a new framework project or loose `.html` files. WXR is the only format WordPress reads under Tools → Import.

**Non-obvious decisions (don't regress):**
- **Reproduce the permalink hierarchy with real parent/child pages.** Nested routes (e.g. `/category/mindfulness/`) are built as hierarchical pages via `wp:post_parent`, synthesizing thin placeholder parents (`category`, `author`) when the import has no page for that segment. **Why:** content keeps the original absolute internal links; if nested pages were flattened to top-level slugs, those links would 404 after import. Slugs only need to be unique among siblings, so same slug under different parents is fine (no global `-2` collision hack needed except for two real pages on the identical permalink).
- **XML-escape every non-CDATA value** (`<link>`, `<guid>`, `base_site_url`, `pubDate`) and wrap all free text in CDATA (with `]]>` splitting). A raw `&` in a canonical URL otherwise makes the whole WXR invalid and the import fails. Always validate output is well-formed (e.g. with a real XML/sax parser), not just regex-count items.
- **Export-time only.** Like the formatted-source path, this never mutates stored `project_files` bytes or the live preview (`buildPreviewHtml` needs exact bytes). See `buildly-code-viewer.md`.

**Documented caveats (live in the generated README, not bugs):** external Astra/Elementor framework CSS isn't bundled (only per-page inline CSS); images stay absolute to the original host (use a search-replace plugin + media importer for a new domain); large XML can hit the host's upload limit.
