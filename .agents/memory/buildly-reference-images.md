---
name: Buildly reference-image attachment
description: How image attachments flow to the AI builder and the non-obvious constraints around them
---

Users can attach reference image(s) so the AI rebuilds an app in that visual style (vision input to the model).

- **Images are NOT persisted to the DB and NOT re-sent in history.** They attach only to the most recent user turn for the current generation. **Why:** the built code already reflects the reference, so resending bloats tokens/cost. Tradeoff: reloaded history won't show which image shaped a build.
- **Image-only sends are allowed (no text).** Both client and server fall back to a fixed prompt when only images are attached. The client sends that fallback text so the optimistic chat bubble equals the persisted message (the "pending user" match logic compares content strings). **How to apply:** if you change the fallback wording, keep `REFERENCE_IMAGE_PROMPT` (client `lib/image.ts`) and `REFERENCE_ONLY_PROMPT` (server `routes/projects.ts`) identical.
- **Body-limit is scoped, not global.** The chat stream route opts in to a large JSON limit (~25mb) for base64 images; the global parser stays small (~1mb) and skips that one path. **Why:** avoid widening the DoS payload surface across the whole unauthenticated API for one endpoint's needs.
- First-build images are handed off from home via `sessionStorage` (`initial-images-<id>`), mirroring the `initial-prompt-<id>` flow; the workspace auto-send must trigger on images OR prompt, not prompt alone.
- **Reference images MUST be downscaled before sending** (the client does this in `lib/image.ts`). A raw multi-MB screenshot (~4.6M base64 chars) makes a single generation run past 10+ minutes and get aborted; a ~1024px JPEG (~90k chars) finishes in ~3 min. **How to apply:** if you ever drive generation outside the UI, downscale first (e.g. ImageMagick `convert -resize 1024x\> -quality 72`).
- **Generated apps must use a text wordmark for the header logo, never a generic placeholder icon/emoji/monogram glyph.** Enforced via the BRANDING / LOGO section in `buildSystemPrompt` (server `routes/projects.ts`). **Why:** users perceived the auto-invented top-left logo icons as unfinished AI output.
- **Driving generation programmatically:** use the persistent `code_execution` notebook (Node fetch, await the full SSE stream to completion) — NOT a bash `nohup curl &`. The bash tool is ephemeral per-call: `/tmp` is wiped and background processes are killed between calls. The stream route stops on client disconnect (`clientGone`), so the client must stay alive the whole time. Note `code_execution` has its own ~600s cap.
- **Checkpoint rollback rolls back the Postgres DB (projects/files), not source code.** Projects can silently vanish (e.g. "Project not found") after a rollback while your code edits survive; re-check `SELECT id,name FROM projects` before assuming a project still exists.
