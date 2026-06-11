---
name: Buildly detached build sessions
description: Why/how generation runs decoupled from the SSE request so a dropped connection no longer aborts long builds, and the client reconnect contract.
---

# Detached build sessions

Long builds (e.g. a 30-page imported-site rebuild, several minutes) used to run
inside a single SSE request handler. A mid-build client/connection drop — page
refresh, iframe reload, navigation, or an edge-proxy duration cap (~184s) — killed
the request socket, which aborted the whole build ("request aborted"). Heartbeat
pings already ruled out idle-timeout, so the cause was a *connection drop*, not idle.

**Decision:** generation runs DETACHED from any HTTP request. A build is an in-memory
session in an `activeBuilds` Map keyed by projectId, holding an ordered `events`
buffer + a `listeners` Set. `runBuild()` is started with `void` and streams events
into the session via `emitBuildEvent`. HTTP clients attach as SSE listeners.

**Why:** a Node async handler keeps running after its socket closes unless code aborts
it. The old handler aborted on disconnect; now a passive disconnect only detaches a
listener — the build keeps running and still persists its files. Only an explicit
`POST /build/cancel` (sets `session.cancelled` + `session.abort()` to tear down the
OpenAI stream) stops it. On cancel, already-complete file blocks are still persisted.

**Reconnect contract (critical):** `attachToBuild` replays the FULL event buffer on
every (re)connect, then forwards live events. Therefore the client MUST reset its
accumulators (`rawStreamRef`, `shownLenRef`, `streamedText`, `filesWritten`) before
each (re)connect, or it double-counts files and duplicates streamed text. The client
`drive()` loop: POST first, then on a non-terminal drop polls `GET /build/status` and
reconnects via `GET /build/stream` until a terminal event (`done`/`error`), `idle`, or
a reconnect cap. `finally { finalizeStream() }` guarantees `isStreaming` clears (no
stuck spinner). On mount it reattaches if a build is already running.

**Routes:** `POST /projects/:id/messages/stream` (start detached build + attach; if one
is already running it just attaches, ignoring new content), `GET .../build/status`,
`GET .../build/stream` (reattach; emits `{type:"idle"}` if none), `POST .../build/cancel`.

**Lifecycle:** `finishBuildSession` sets terminal status and sweeps the session after a
~2min TTL, but only if `activeBuilds.get(projectId) === session` (so it never deletes a
newer build). Sessions are in-memory: an api-server restart kills in-flight builds; the
client then gets `idle` on reattach and finalizes (files may be partial/none).

**Gotcha:** api-server `dev` = build&start with NO watch, so you MUST restart its
workflow after server edits. app-builder is Vite HMR (no restart).
