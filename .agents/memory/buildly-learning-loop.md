---
name: Buildly learning-from-feedback loop
description: How Buildly accumulates global "lessons" from user adjustments and feeds them into every future generation.
---

Buildly distills a generalizable lesson from each user *adjustment* (a follow-up
message on an app that already has files — never the first build) and stores it in
a global `learnings` table. Accumulated lessons are injected into the generation
system prompt for ALL future projects, so apps improve over time.

**Why global, not per-project:** the user's intent is "betere apps maakt" — the AI
should get better at building apps in general, so lessons are pooled across projects.

**How to apply / constraints:**
- Distillation + insert (`recordLearning`) is fire-and-forget (`void`), runs AFTER
  the response is sent, fully wrapped in try/catch. It must NEVER block or break a
  user's generation. `buildLearningsContext()` likewise fails open to `""`.
- Distilled lessons are injected as raw text into the system prompt, so they are a
  persistent prompt-injection vector. There is a safety gate (reject meta-instruction
  markers like "ignore previous", "system prompt", length caps) + exact-match dedupe.
  Keep/extend this gate if you touch the distillation.
- Trigger condition is `existingFiles.length > 0` (sync route) / `!isFirstBuild`
  (stream route). Both message routes must stay in sync.
- Intentionally NOT built: durable job/outbox queue, moderation classifier — overkill
  for this single-user app builder. Revisit only if it becomes multi-tenant.
