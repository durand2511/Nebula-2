---
name: Buildly preview script inlining & dead buttons
description: Why generated/redesigned apps get "dead buttons" in the preview and the classic-script contract that prevents it.
---

# Generated-app buttons die in the preview

**Failure signature:** every button / interaction in a Buildly-generated or
redesigned web app is dead in the preview (clicks do nothing), even though the
HTML/CSS render fine. Small single-file apps are usually fine; large multi-file
redesigns (e.g. a big imported site rebuilt by "make it prettier") are where it
bites.

**Root cause:** the preview renders the app in ONE sandboxed `srcDoc` iframe with
no real base URL. It inlines every local `<script src="x.js">` into the document
as a script tag (in document order). If the generated JS uses ES module syntax
for its OWN local files — `type="module"` + `import './store.js'` across files —
those local imports can't resolve in `srcDoc` (opaque origin, no URL) and throw,
which kills ALL interactivity. Previously the inliner also stripped `type="module"`
and downgraded modules to classic scripts, so even a single self-contained module
or a CDN ESM import would throw `import outside a module`.

**Fix (two parts, must stay in sync):**
1. Preview inliner (`buildPreviewHtml` in `project-workspace.tsx`) PRESERVES
   `type="module"` on the inlined tag when the original `<script>` had it. This
   rescues single-file modules and CDN ESM (`import x from "https://..."`).
   Detection regex must tolerate unquoted/spaced attrs (`type=module`,
   `type = "module"`), not just `type="module"`.
2. Generation system prompt (`buildSystemPrompt` in api-server `projects.ts`,
   RUNTIME CONSTRAINTS / FILE STRUCTURE) FORBIDS ES module syntax for the app's
   OWN local files: no `type="module"`, no `import`/`export` between local .js
   files. Require plain classic scripts listed in dependency order, sharing state
   via ONE global namespace (`window.App`), each wrapped in an IIFE. CDN library
   imports are still allowed.

**Why:** local cross-file ESM is fundamentally unresolvable in the single-doc
`srcDoc` preview; avoiding it at generation time is the only reliable cure, and
preserving `type=module` covers the legitimate single-file / CDN-ESM cases.

**How to apply:** if "dead buttons" resurface, first check the generated
`index.html` for `type="module"` / local `import './...'`; the prompt should have
prevented it. The two fixes are coupled — don't relax the prompt without making
the inliner resolve local module graphs (it currently does NOT).
