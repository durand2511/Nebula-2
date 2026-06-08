---
name: app-builder preview iframe & self-healing
description: How the Buildly preview renders generated apps and reports runtime errors back to the builder.
---

The app-builder preview combines generated project files into ONE self-contained HTML doc and renders it in an iframe via `srcDoc` (CSS/JS inlined by matching `<link>`/`<script src>` tags). It is sandboxed `allow-scripts allow-forms allow-modals allow-popups` — deliberately NO `allow-same-origin`.

**Why it matters / self-healing:** a reporter script injected into the preview `postMessage`s `window.onerror` / `unhandledrejection` to the parent; the workspace shows a "Fix automatically" banner that re-prompts the AI with the error text.

**Non-obvious constraint:** because the iframe has no `allow-same-origin`, its origin is opaque (`"null"`), so `e.origin` checks are useless. Validate inbound messages with `e.source === iframeRef.current?.contentWindow` instead — this is the reliable control against spoofed `__buildlyError` messages.

**Storage shim (no `allow-same-origin` side effect):** because the sandbox omits `allow-same-origin`, the iframe's `window.localStorage`/`sessionStorage` getters THROW `SecurityError` on access (not return null) — so every generated app's save flow failed ("could not be saved"). Fix: `buildPreviewHtml` injects an in-memory storage shim (a `mk()` object backed by a plain dict) ahead of app code, installed via `Object.defineProperty(window, name, {value, configurable})` (with a `window[name]=…` fallback) ONLY when a native probe throws. This keeps the sandbox locked (no privilege granted back) — data lives for the preview session and resets on iframe reload. Do NOT add `allow-same-origin` to "fix" storage; it would let generated code reach Buildly's real origin/storage.

**Backend parser:** generation expects `FILE: <path>` blocks (optional `LANGUAGE:` line, language may sit on the code fence). Parser is tolerant of CRLF and missing language (falls back to `inferLanguage(path)`). Triple-backticks inside generated file *content* can still prematurely end a block — a known limitation.
