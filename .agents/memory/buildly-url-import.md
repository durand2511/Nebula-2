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

## Escaped `<noscript>` fallbacks print as visible text (img AND tracking iframe)
`<noscript>` bodies are JS-disabled fallbacks (lazy-img copies, GTM/analytics hidden `<iframe>`, etc.). cheerio/parse5 parse a noscript body as a single raw TEXT node, so the importer's old "unwrap but keep contents" turned that markup into ESCAPED text (`&lt;img...&gt;`, `&lt;iframe...&gt;`) that the browser prints as visible tags. **Fix (canonical):** the importer now does `$("noscript").remove()` — correct because the preview runs `allow-scripts`, so noscript should never render. **Fix (migration, for already-imported projects):** `buildPreviewHtml` strips escaped `&lt;img...&gt;` (scoped to `lazyload`) and escaped `&lt;iframe...&lt;/iframe&gt;` (scoped to tracker hosts / hidden / zero-size), so legit escaped code a generated app displays is left alone. **Why scoped:** unscoped stripping would nuke instructional escaped-code snippets. Symptoms users report: "I see `<img .../>` text under the images" / "I see `<iframe googletagmanager...>` text on the page."

## Preview link behavior: same-site in-frame, external new-tab
The preview iframe is `allow-popups allow-popups-to-escape-sandbox`. `buildPreviewHtml` injects a click handler that makes it browser-like: it detects the imported site's primary host (most-frequent `href="https://HOST"`), then on anchor clicks navigates SAME-host links inside the preview (default, stays in the one frame) and opens OTHER-host links (WhatsApp/wa.me, booking, socials) in a real new tab via `window.open`. In-page `#anchors` and `mailto:`/`tel:` keep default behavior. **Why:** external sites refuse to render in a frame (X-Frame-Options/CSP) so they can't stay "in the same preview"; forcing ALL external links to new tabs (an earlier attempt) was wrong — the user wants the distinction.

## Imported live sites are inherently slow/flaky in preview — set expectations
A real WP import pulls ~100+ external assets from the live domain on every render, and its main stylesheet is render-blocking (e.g. ~700KB). The iframe paints WHITE until that CSS loads (~1.5-2s), and theme JS (Astra mobile menu, etc.) needs its external scripts loaded before it works — so "the hamburger doesn't work right after refresh, then works a moment later" is expected, not a bug we can fully fix. The reliably fixable part is image rendering (de-lazy above). Offer regeneration as the clean alternative.

## Gotcha
Scheme checks must normalize first (strip control/whitespace chars, lowercase) before comparing, or `java\tscript:` / entity-encoded schemes slip through.
