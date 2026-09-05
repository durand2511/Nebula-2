/**
 * Run AI generation on a user's OWN coupled Claude subscription (Agent SDK, single-turn, no tools) —
 * no platform API key anywhere. Shared by the SEO engine, the Kennisbank, e-mail branding and the
 * "lessons learned" helper. If the relevant user hasn't coupled a login, the caller skips.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { isClaudeConnected, prepareUserClaudeEnv } from "./claude-terminal.js";
import { db, projects, platformUsers } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger";

export type SubEnv = Record<string, string | undefined>;

const OWNER_EMAILS = (process.env.PLATFORM_OWNER_EMAILS || "durand2511@gmail.com").toLowerCase().split(/[,\s]+/).filter(Boolean);

async function envForUser(userId: number | null | undefined): Promise<SubEnv | null> {
  if (!userId) return null;
  try {
    if (await isClaudeConnected(userId)) {
      const own = await prepareUserClaudeEnv(userId);
      if (own.connected) return own.env;
    }
  } catch (err) { logger.warn({ err: (err as Error)?.message, userId }, "[sub-ai] env setup failed"); }
  return null;
}

/** The env of a project's owner (for per-project generation). */
export async function projectOwnerEnv(projectId: number): Promise<SubEnv | null> {
  try {
    const [p] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
    return envForUser(p?.ownerId ?? null);
  } catch { return null; }
}

/** The platform owner's env (for the platform's OWN content, e.g. the Kennisbank blog). */
export async function platformOwnerEnv(): Promise<SubEnv | null> {
  try {
    const rows = await db.select({ id: platformUsers.id, email: platformUsers.email }).from(platformUsers).where(inArray(platformUsers.email, OWNER_EMAILS));
    for (const r of rows) { const env = await envForUser(r.id); if (env) return env; }
  } catch { /* ignore */ }
  return null;
}

/** Generate plain text on a subscription env. Returns "" on failure (callers degrade gracefully). */
export async function generateOnSubscription(env: SubEnv, prompt: string, timeoutMs = 120000): Promise<string> {
  const cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "nebula-ai-")));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const q = query({ prompt, options: { cwd, allowedTools: [], settingSources: [], maxTurns: 1, env, abortController: ac } as never });
    let text = "";
    for await (const msg of q as AsyncIterable<{ type: string; message?: { content: { type: string; text?: string }[] }; subtype?: string; result?: string }>) {
      if (msg.type === "assistant" && msg.message) { for (const b of msg.message.content) { if (b.type === "text" && b.text) text += b.text; } }
      else if (msg.type === "result" && msg.subtype === "success" && msg.result) text = msg.result;
    }
    return text.trim();
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "[sub-ai] generation failed");
    return "";
  } finally {
    clearTimeout(timer);
    await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}
