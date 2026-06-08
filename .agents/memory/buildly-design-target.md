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
`DESIGN` / `DESIGN PRINCIPLES` section), then restart the API server and verify e2e.
Only touch Buildly's own UI if the user explicitly says the builder interface itself.

**Current target = "think like a world-class product designer; every app must look
like a premium $10k product."** This SUPERSEDES the earlier FIXED dark-green design
system (exact dark palette + STRICT no-gradients/no-shadows/green-only rules), which
the user rejected as too rigid/flat. The prompt is now PRINCIPLE-driven, not a locked
theme: cohesive limited palette of the model's choosing (light/dark/branded as fits
the app), strong type scale, generous spacing, clear hierarchy, tasteful soft shadows
+ subtle gradients allowed, smooth 150-250ms motion, polished components & states,
pixel-perfect alignment, "would Linear/Stripe/Vercel/Notion ship this?" bar.
**It now HONORS the brief** — if the user asks for light mode / a brand color / a vibe,
design to it (the opposite of the old non-overridable rule).
**Why:** user said the rigid forced theme looked cheap; wanted real design thinking.
Verify e2e by generating an app and judging polish in the preview screenshot; don't
grep for a fixed hex anymore.

## Auth only when the user asks
- The generation prompt must NOT add login / sign-up / accounts / auth by default —
  apps open straight into their main view. Build an auth flow ONLY when the request
  explicitly mentions accounts/login/users/sign-in (see `AUTHENTICATION — ONLY WHEN
  THE USER ASKS` in the prompt).
- **Why:** user complained every generated app started with a login wall.

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


## app-builder (Buildly chrome) theme is inverted
- In `artifacts/app-builder/src/index.css`, `:root` holds the DARK palette (background ~4%) and `.light` holds the WHITE palette (background 100%); `.dark` is empty ("force dark"). So which class is on the wrapper decides the theme.
- `artifacts/app-builder/src/components/layout.tsx` sets that wrapper class. It now always uses `light` so the whole Buildly UI (home, projects, AND the project workspace) is white. The code-viewer pane stays intentionally dark (`bg-[#0d1117]`).
- **Why:** user repeatedly asked for white backgrounds + black text across Buildly; the workspace route previously forced `dark`, making the chat panel/header black.

## SSE stop/abort: listen on res, not req
- In the `/messages/stream` route, detect client disconnect (the Stop button) with `res.on("close", ...)` guarded by `!res.writableEnded` — NOT `req.on("close")`.
- **Why:** for a POST, `req` ("close") fires the instant the request body is fully read (right after `express.json()` parses it), long before any disconnect. Using it falsely flags an abort immediately, so `send()` is suppressed and nothing ever streams (0 bytes, request hangs to max-time). This cost two debugging rounds.
- On real disconnect: set a `clientGone` flag, call `stream.controller.abort()` to stop the OpenAI call, break the generation loop, and still persist any COMPLETE files already in `full` (incomplete trailing file has no closing ``` so it's skipped by FILE_BLOCK_REGEX — safe).
- The stream route also emits `{ type: "delta", text }` per token so the client can render code being written live (client parses the current FILE block via `extractLiveFile`).
