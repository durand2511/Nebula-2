---
name: Buildly AI builder — streaming & preview
description: Non-obvious constraints for the SSE build-streaming and multi-file preview in the app-builder + api-server artifacts.
---

# Buildly: live build streaming + multi-file preview

The AI generates MULTIPLE files (index.html linking styles.css / script.js with relative paths), not a monolith.

## SSE streaming endpoint
- Build progress streams over `POST /api/projects/:id/messages/stream` (Server-Sent Events), NOT the generated react-query hook. The frontend uses a manual `fetch` + `ReadableStream` reader.
- **`X-Accel-Buffering: no` header is required** on the SSE response, otherwise the Replit reverse proxy buffers the whole stream and the client sees nothing until completion. Also set `Cache-Control: no-cache, no-transform`.
- Server detects `FILE: <path>` markers in the accumulating buffer as the model streams, emitting `{type:"file"}` events live. Final events: `{type:"message"}` (clean explanation) then `{type:"done"}`.
- Assistant chat message stores ONLY the extracted explanation (text after the last code fence), never the raw code. File content lives in the `projectFiles` table and is fed back as context on edits — so chat history stays small and avoids token bloat.

## Preview inlining
- **Why:** the iframe uses `srcDoc`, which cannot resolve relative `href="styles.css"` / `src="script.js"` against our DB. So `buildPreviewHtml()` inlines every `.css` into `<style>` and every `.js` into `<script>` before rendering. Keep that helper in sync if the file-link format in the system prompt changes.
