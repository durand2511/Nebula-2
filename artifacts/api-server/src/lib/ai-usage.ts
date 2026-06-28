/**
 * Per-request AI token accounting. A build/chat edit makes many anthropic.messages.create calls;
 * we instrument the client once so every call adds its token usage to an AsyncLocalStorage context.
 * The chat endpoint wraps its work in runWithUsage(), then charges the accumulated cost (×2) to the
 * user's AI credit. Calls made OUTSIDE a context (SEO auto-articles, e-mail branding) aren't charged.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type UsageTotals = Record<string, { input: number; output: number }>; // per model
const als = new AsyncLocalStorage<UsageTotals>();

export function recordUsage(model: string, usage: { input_tokens?: number; output_tokens?: number } | null | undefined): void {
  const t = als.getStore();
  if (!t || !usage) return;
  const m = (t[model] ||= { input: 0, output: 0 });
  m.input += usage.input_tokens || 0;
  m.output += usage.output_tokens || 0;
}

export async function runWithUsage<T>(fn: () => Promise<T>): Promise<{ result: T; totals: UsageTotals }> {
  const totals: UsageTotals = {};
  const result = await als.run(totals, fn);
  return { result, totals };
}

/** Monkey-patch the shared Anthropic client so every messages.create records its usage. Safe for
 *  streamed responses (they have no .usage on the immediate return → skipped). Idempotent. */
export function instrumentAnthropic(client: { messages: { create: (...args: any[]) => any; __instrumented?: boolean } }): void {
  if (!client?.messages || client.messages.__instrumented) return;
  const orig = client.messages.create.bind(client.messages);
  client.messages.create = async (...args: any[]) => {
    const res = await orig(...args);
    try { if (res && res.usage) recordUsage(args[0]?.model || "claude-sonnet-4-5", res.usage); } catch { /* ignore */ }
    return res;
  };
  client.messages.__instrumented = true;
}
