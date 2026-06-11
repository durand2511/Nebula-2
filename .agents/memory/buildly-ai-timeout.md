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

**Fix lives in the shared client `lib/integrations-openai-ai-server/src/client.ts`,
NOT at the call site.** The `openai` client is constructed with: a 20-min
`headersTimeout`+`bodyTimeout` undici `Agent` (`fetchOptions.dispatcher`), a 20-min
SDK-level `timeout`, AND undici's own `fetch` passed as the client's `fetch`.

**Critical gotcha — the dispatcher MUST come from the SAME undici as the fetch the
SDK uses.** The OpenAI SDK's default fetch is Node's *built-in* undici; handing it
a dispatcher from the workspace `undici` package throws at request time:
`APIConnectionError: ... invalid onRequestStart method`. Fix is to also pass
`fetch: undiciFetch` (from the same `undici` import) so fetch + dispatcher match.
This is why the fix had to move into the client constructor (one place to pair
fetch+dispatcher) instead of per-request `fetchOptions` in projects.ts.

**Why bounded, not disabled (0):** disabling would let a truly hung upstream
request stick forever. 20 min covers real builds while still failing eventually.

**How to apply / gotchas:**
- If builds are made even richer/longer in future, raise the 20-min constant in
  the client — the design ambition and this timeout are coupled.
- The `lib/integrations-openai-ai-server` package needs `undici` as a dependency
  for this (added). Keep fetch and dispatcher from that one undici import.
- Files/assistant message persist only AFTER the whole stream finishes
  (`persistGeneratedFiles` at the end), so "no files yet" during a build is normal,
  not a hang.
- Verified end-to-end: a real `/messages/stream` POST streams `delta` tokens with
  no connection error.
