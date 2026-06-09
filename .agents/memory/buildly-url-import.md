---
name: Buildly URL import (AI Editor)
description: How website-URL import works and the safety constraints (SSRF rebinding + active-JS-in-iframe) it must keep satisfying.
---

# AI Editor URL import

The "AI Editor" tab imports a live website by URL: the backend fetches the page, stores it as a new project's single `index.html`, then the user edits it via the normal AI chat workspace. Imports must NOT trigger auto-generation (unlike a fresh new project — do not seed the initial-prompt sessionStorage).

## Asset rewriting is REQUIRED, not cosmetic
The preview iframe strips relative `link`/`script` refs and inlines only local css/js. So imported pages render correctly only if their asset URLs are rewritten to ABSOLUTE on import (the preview keeps external/absolute refs). Keep absolutizing href/src/srcset/etc. whenever touching import.

## Two safety constraints that are easy to regress
1. **SSRF DNS-rebinding:** validating a host's IP *before* the fetch is not enough — the host can resolve to a public IP at validation time and a private IP at connect time. The connection itself must be pinned to an IP that is re-validated at connect time (reject private/link-local/CGNAT ranges). Keep the literal-IP/localhost prechecks and per-redirect-hop revalidation as defense in depth.
   **Why:** otherwise internal services and cloud metadata (169.254.169.254) are reachable from a user-supplied URL.
2. **Active JS in the preview iframe:** the preview runs with `allow-scripts`. Removing `<script>` tags is NOT sufficient on its own. The full set of vectors that must also be neutralized: inline `on*` event-handler attributes, `javascript:`/`vbscript:` URLs in any URL attribute, `data:text/html` document sources, and `srcdoc` (it embeds a whole scriptable document). New active-JS sinks creep in over time — sanitize on a parsed DOM, not with regex, so quoted/unquoted/entity-encoded variants are all handled.
   **Why:** imported third-party markup is untrusted; any surviving vector executes in the sandboxed preview.

## Imported sites render via the preview's de-lazy pass
Imported WordPress/Elementor pages ship lazy-loaded images: real URL in `data-src`/`data-srcset`, `src` is a 1x1 placeholder gif, and a `.lazyload` class holds them at `opacity:0` until the site's lazy-loader JS swaps them — which usually does NOT run in our sandbox, so images/quote-cards stay blank. `buildPreviewHtml` fixes this at render time: for any `<img>`/`<source>` carrying `data-src*`, strip the placeholder `src`/`srcset` (quoted or unquoted) FIRST, then rename `data-src*`→`src*`, and force `.lazyload{opacity:1}`. Strip-before-rename matters or a duplicate `src` survives and the browser keeps the placeholder. No-op for generated apps (they don't use `data-src`).

## Imported live sites are inherently slow/flaky in preview — set expectations
A real WP import pulls ~100+ external assets from the live domain on every render, and its main stylesheet is render-blocking (e.g. ~700KB). The iframe paints WHITE until that CSS loads (~1.5-2s), and theme JS (Astra mobile menu, etc.) needs its external scripts loaded before it works — so "the hamburger doesn't work right after refresh, then works a moment later" is expected, not a bug we can fully fix. The reliably fixable part is image rendering (de-lazy above). Offer regeneration as the clean alternative.

## Gotcha
Scheme checks must normalize first (strip control/whitespace chars, lowercase) before comparing, or `java\tscript:` / entity-encoded schemes slip through.
