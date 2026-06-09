---
name: Buildly reference-image attachment
description: How image attachments flow to the AI builder and the non-obvious constraints around them
---

Users can attach reference image(s) so the AI rebuilds an app in that visual style (vision input to the model).

- **Images are NOT persisted to the DB and NOT re-sent in history.** They attach only to the most recent user turn for the current generation. **Why:** the built code already reflects the reference, so resending bloats tokens/cost. Tradeoff: reloaded history won't show which image shaped a build.
- **Image-only sends are allowed (no text).** Both client and server fall back to a fixed prompt when only images are attached. The client sends that fallback text so the optimistic chat bubble equals the persisted message (the "pending user" match logic compares content strings). **How to apply:** if you change the fallback wording, keep `REFERENCE_IMAGE_PROMPT` (client `lib/image.ts`) and `REFERENCE_ONLY_PROMPT` (server `routes/projects.ts`) identical.
- **Body-limit is scoped, not global.** The chat stream route opts in to a large JSON limit (~25mb) for base64 images; the global parser stays small (~1mb) and skips that one path. **Why:** avoid widening the DoS payload surface across the whole unauthenticated API for one endpoint's needs.
- First-build images are handed off from home via `sessionStorage` (`initial-images-<id>`), mirroring the `initial-prompt-<id>` flow; the workspace auto-send must trigger on images OR prompt, not prompt alone.
