---
name: Buildly AI request timeout (undici Body Timeout)
description: Long app builds aborted mid-stream by undici's 5-min default timeout; how it's bounded now.
---

# Long generations and the undici Body Timeout

A rich app build/rebuild can legitimately stream for many minutes. The OpenAI SDK
(v6) uses Node's global `fetch` (undici), whose **default headers/body timeouts
are 5 minutes**. A long generation (large imported site + the rich/~4000-line
design directive) streams past that and dies with:

> `TypeError: terminated` caused by `BodyTimeoutError: Body Timeout Error`

surfaced to the user in the app-builder UI as "Something went wrong while building
your app." It is a transport timeout, NOT a model/content error.

**Fix (in `buildSystemPrompt`'s file, `artifacts/api-server/src/routes/projects.ts`):**
a dedicated undici `Agent` (`aiDispatcher`) with 20-min `headersTimeout` +
`bodyTimeout`, plus a 20-min SDK-level `timeout`, bundled as `aiRequestOptions`
and passed as the 2nd arg to the long-running `openai.chat.completions.create`
calls (the streaming `stream-completion` and the sync `generateWithContinuation`).

**Why bounded, not disabled (0):** disabling would let a truly hung upstream
request stick forever. 20 min covers real builds while still failing eventually.

**How to apply / gotchas:**
- If builds are made even richer/longer in future, raise `AI_REQUEST_TIMEOUT_MS`
  in lockstep — the design ambition and this timeout are coupled.
- Passing a 2nd options arg makes TS overload resolution pick the base overload,
  which returns `ChatCompletion | Stream` (breaks `stream.controller` / `for await`).
  The options object is cast to `Parameters<typeof openai.chat.completions.create>[1]`
  so the streaming overload still resolves to `Stream`. Keep that cast if you touch it.
- Files/assistant message persist only AFTER the whole stream finishes
  (`persistGeneratedFiles` at the end), so "no files yet" during a build is normal,
  not a hang.
