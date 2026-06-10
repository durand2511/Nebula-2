---
name: Buildly/Nebula code viewer formatting
description: How the app-builder Code tab renders stored file content, and the constraint that it must stay display-only.
---

# Code viewer (Code tab) formats display-only

The app-builder "Code" tab (`artifacts/app-builder/src/components/code-viewer.tsx`, wired into `project-workspace.tsx`) renders `project_files.content` through Prettier (re-indent) + highlight.js (syntax colors) + a line-number gutter.

**Why this exists:** imported sites are stored **minified/verbatim** — e.g. a 188KB `index.html` with ~15 newlines. Shown raw in a `<pre>` it's an unreadable wall; the user complained the code wasn't "netjes geordend". Generated apps are split into files by the system prompt but were still shown unformatted.

**Hard constraint — never mutate the stored bytes or the preview:**
- Never write formatted output back to the DB, and never feed it to the live preview. `buildPreviewHtml` relies on the exact stored bytes (imported pages are intentionally verbatim). Formatting is applied only at read-out time: the Code tab AND the ZIP download both format on the fly via the shared `formatFileContent` in `src/lib/format-code.ts`. The download getting pretty-printed code is an explicit user request — but it formats a copy at export time, it does not change what's stored.

**How to apply / gotchas:**
- Shared formatter lives in `src/lib/format-code.ts` (`langFromPath`, `formatFileContent`) — reuse it for any new read-out path; don't duplicate the Prettier wiring.
- Prettier is lazily dynamic-imported (`prettier/standalone` + only the needed plugin: html→`plugins/html`, css→`plugins/postcss`, js/json→`plugins/babel`+`plugins/estree`) to keep it out of the main bundle.
- Always fall back to raw text on format/highlight failure (malformed WP/Elementor HTML is common).
- Size guards: skip Prettier above 2MB, skip highlighting above 600KB (current files top out ~212KB, so they always format).
- `dangerouslySetInnerHTML` is safe here because it's fed highlight.js tokenized output (escapes the code), not raw user HTML.
