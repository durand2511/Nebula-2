---
name: Buildly AI builder — streaming & preview
description: Non-obvious constraints for the SSE build-streaming and multi-file preview in the app-builder + api-server artifacts.
---

# Buildly: live build streaming + multi-file preview

The AI generates MULTIPLE files (index.html linking styles.css / script.js with relative paths), not a monolith.

## SSE streaming endpoint
- Build progress streams over `POST /api/projects/:id/messages/stream` (Server-Sent Events), NOT the generated react-query hook. The frontend uses a manual `fetch` + `ReadableStream` reader.
- **`X-Accel-Buffering: no` header is required** on the SSE response, otherwise the Replit reverse proxy buffers the whole stream and the client sees nothing until completion. Also set `Cache-Control: no-cache, no-transform`.
- **A periodic SSE heartbeat (`: ping\n\n` comment every ~10s) is required.** The reasoning model can take 30s+ before its first token on complex apps; with zero bytes flowing the edge proxy treats the connection as dead and drops it (~37s → server logs "request aborted", 0 files, browser shows generic error). The heartbeat keeps it alive. Comment lines are ignored by the client's `data:`-only parser. Clear the interval in a `finally`, and guard the write with `clientGone || res.writableEnded || res.destroyed` + try/catch. **Why:** localhost/curl never hits the idle drop, so this bug is invisible unless you test long (60s+) browser builds.
- Server detects `FILE: <path>` markers in the accumulating buffer as the model streams, emitting `{type:"file"}` events live. Final events: `{type:"message"}` (narration) then `{type:"done"}`.
- **Narration-first convention:** the system prompt makes the model write 1-2 conversational sentences BEFORE the first `FILE:` block (the "what I'll build" intro). The client shows that preamble (text before first `^FILE:`) as a live streaming assistant bubble, and the server persists it as the assistant message via `extractNarration()`. Parsers split on `FILE:` **at line start (`/^FILE:/m`)** so prose mentioning "FILE:" doesn't truncate. Never store raw code in chat — file content lives in `projectFiles` and is fed back as edit context.
- **Optimistic user bubble de-dupe:** the stream route persists the user message immediately, so a mid-build refetch of the messages query can briefly coexist with the optimistic `pendingUser` copy (visible double). Drop the optimistic bubble only once a NEW persisted user message lands (message count grew past a pre-send baseline ref), not on plain content-equality — otherwise identical re-prompts hide the new bubble prematurely.

## Preview inlining
- **Why:** the iframe uses `srcDoc`, which cannot resolve relative `href="styles.css"` / `src="script.js"` against our DB. So `buildPreviewHtml()` inlines every `.css` into `<style>` and every `.js` into `<script>` before rendering. Keep that helper in sync if the file-link format in the system prompt changes.
