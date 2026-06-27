/**
 * Optional Render integration: when a customer connects their own domain, register it with the
 * Render service so Render auto-issues a TLS certificate for it. Activates only when both
 * RENDER_API_KEY and RENDER_SERVICE_ID env vars are set; otherwise it's a no-op (the studio adds
 * the domain in the Render dashboard manually). Secrets live in env, never in code.
 */
import { logger } from "./logger";

export function renderConfigured(): boolean {
  return !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID);
}

/** Add a custom domain to the Render service so SSL is provisioned. Best-effort, idempotent-ish. */
export async function addRenderDomain(domain: string): Promise<{ ok: boolean; detail?: string }> {
  if (!renderConfigured()) return { ok: false, detail: "render-not-configured" };
  const sid = process.env.RENDER_SERVICE_ID;
  try {
    const r = await fetch(`https://api.render.com/v1/services/${sid}/custom-domains`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: domain }),
    });
    if (r.ok || r.status === 409 /* already added */) return { ok: true };
    const body = await r.text().catch(() => "");
    logger.warn({ domain, status: r.status, body }, "[render] add domain failed");
    return { ok: false, detail: `render-${r.status}` };
  } catch (err) {
    logger.warn({ err: (err as Error)?.message, domain }, "[render] add domain error");
    return { ok: false, detail: "render-error" };
  }
}
