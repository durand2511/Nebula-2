---
name: Buildly design directives target generated apps
description: Where "make the design better / no AI slop" instructions should be applied in the Buildly app builder.
---

# Design directives apply to GENERATED apps, not Buildly's own UI

When the user gives Buildly design-quality instructions (e.g. "no generic AI
aesthetics", "unique accent color", "font pairings", "strong visual direction
per app type"), they almost always mean the apps the builder GENERATES — not
Buildly's own chrome (home page, layout, chat panel).

**Why:** Once this was misread as a request to restyle Buildly itself; that whole
redesign was reverted, and the user clarified the directive was about the
generated output ("dit moet de ai app builder maken ... geen ai slop").

**How to apply:** Encode design rules in the generation system prompt
(`buildSystemPrompt` in `artifacts/api-server/src/routes/projects.ts`, the
DESIGN IDENTITY section), then restart the API server and verify e2e: generated
`styles.css`/`index.html` should show a real font pairing (Google Fonts),
several CSS custom properties for an accent system, and no purple/blue gradient
blobs or "Sparkles/AI" badges. Only touch Buildly's own UI if the user
explicitly says the builder interface itself.

# Generation pipeline robustness

- `buildSystemPrompt` also carries CONSISTENCY-ON-EDITS (preserve design system,
  smallest diff, keep existing files) and ACCESSIBILITY/UX rules. Apply quality
  directives here, not in Buildly's chrome.
- Both message routes (sync `/messages` and streaming `/messages/stream`) wrap the
  OpenAI call in a continuation loop: when `finish_reason === "length"` they re-ask
  ("continue where you stopped") up to MAX_CONTINUATIONS so large multi-file apps
  aren't saved half-written (the FILE_BLOCK_REGEX only persists CLOSED blocks, so a
  truncated tail would silently vanish without this). **Keep the two routes in sync.**
- All OpenAI calls go through `withRetry` (3 attempts, backoff) so transient blips
  don't fail a generation. On FIRST build (not adjustments) both routes fire-and-forget
  `generateProjectName` to replace the crude home-page placeholder name with a distilled
  2-4 word title; the frontend re-fetches the project after `done` to show it.
- Frontend `buildPreviewHtml` inlines sibling css/js into the srcDoc, then STRIPS any
  leftover LOCAL `<link rel=stylesheet>`/`<script src>` (external http(s)//data: kept) —
  in srcDoc there's no base URL so unresolved local refs 404 and silently break the app.
- **Whenever you add a behavior to one message route, mirror it in the other** (naming,
  continuation, no-valid-files guard) — they have drifted before.

