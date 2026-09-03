/**
 * Short-lived HMAC tickets that authorise the otherwise-public preview endpoints
 * (/projects/:id/preview-page and /projects/:id/asset/…) without a platform login.
 * The server mints one for its own headless-screenshot fetches and embeds one in
 * the asset URLs of a preview page it has just authorised. Stateless — nothing is
 * stored; the signature binds the ticket to one project and an expiry.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const material = process.env.EMAIL_SECRET_KEY || process.env.STRIPE_WEBHOOK_SECRET || "nebula-dev-email-key";

function sign(projectId: number, exp: number): string {
  return createHmac("sha256", material).update(`preview.${projectId}.${exp}`).digest("hex").slice(0, 32);
}

/** Mint a ticket for one project (default 6h — outlives an open editor tab's asset loads). */
export function makePreviewTicket(projectId: number, ttlMs = 6 * 60 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  return `${exp}.${sign(projectId, exp)}`;
}

export function checkPreviewTicket(projectId: number, ticket: string): boolean {
  const m = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(String(ticket || ""));
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = Buffer.from(sign(projectId, exp));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}
