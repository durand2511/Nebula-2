---
name: WordPress/Elementor → Astro static refactor
description: Durable approach for turning an imported WP HTML export into a clean shared-layout Astro site without breaking design.
---
When refactoring an imported WordPress/Elementor/Astra site (flat HTML export, JS stripped) into Astro:

- **Share the real repetition, not the CSS.** Header, footer, body shell (`<div id="page">`), and SEO *structure* are the genuine duplication — centralize those. Do NOT dedup the per-page CSS (external siteground-combined hashed bundles + large inline `<style>`): keep each page's head verbatim in original order. **Why:** cascade order can't be visually verified in this environment; hoisting shared style blocks into a global file reorders the cascade and risks subtle visual breakage for ~no real benefit.
- **Nav active-state:** take header/footer from a baseline page with zero active state (the home page), then re-apply `current-menu-item`/`current_page_item` + `aria-current="page"` per route by matching the menu `<a href>` to the route. **Verify** the generated active set equals each original page's active set across all pages — a provable correctness check.
- **Balanced fragments:** the WP body wrapper (`<div id="page">`) opens before the header and closes after the footer. You cannot split an unbalanced tag across Astro `set:html` fragments (the HTML parser auto-closes it). Put the wrapper as a literal balanced element in the layout JSX and only `set:html` balanced chunks (beforePage, content, afterPage).
- **Links:** rewrite absolute internal page links to local routes only when the path is in the canonical set; leave assets/external absolute. Preserve `#anchor`/`?query` suffixes. Keep `<link rel="canonical">` and `og:url` absolute (SEO intact).
- **Delivery:** not registerable as a Replit artifact (no Astro template) and won't render in Buildly's sandbox preview — deliver as a downloadable ZIP that runs locally (`npm install && npm run build`).
