/**
 * Lightweight in-memory brute-force guard for login endpoints. Counts failed attempts per key
 * (e-mail and client IP) and temporarily blocks after too many within a window. Single-instance by
 * design (Render runs one web service) and it resets on redeploy — enough to stop password guessing,
 * not a distributed limiter for huge scale. Successful logins clear the counters.
 */
type Entry = { fails: number; first: number; blockedUntil: number };
const store = new Map<string, Entry>();
const WINDOW_MS = 15 * 60_000; // count failures within this rolling window
const MAX_FAILS = 10;          // …then block
const BLOCK_MS = 15 * 60_000;  // lockout duration

function prune(now: number): void {
  if (store.size < 5000) return;
  for (const [k, e] of store) if (e.blockedUntil < now && now - e.first > WINDOW_MS) store.delete(k);
}

/** Seconds remaining if any key is currently blocked, else 0. */
export function loginBlocked(keys: string[]): number {
  const now = Date.now();
  let max = 0;
  for (const k of keys) {
    const e = store.get(k);
    if (e && e.blockedUntil > now) max = Math.max(max, Math.ceil((e.blockedUntil - now) / 1000));
  }
  return max;
}

/** Record a failed attempt for every key; trips the lockout once the threshold is hit. */
export function loginFailure(keys: string[]): void {
  const now = Date.now();
  prune(now);
  for (const k of keys) {
    let e = store.get(k);
    if (!e || now - e.first > WINDOW_MS) { e = { fails: 0, first: now, blockedUntil: 0 }; store.set(k, e); }
    e.fails++;
    if (e.fails >= MAX_FAILS) e.blockedUntil = now + BLOCK_MS;
  }
}

/** Clear counters after a successful login. */
export function loginSuccess(keys: string[]): void {
  for (const k of keys) store.delete(k);
}

/** Best-effort client IP (behind Render's proxy the real IP is in X-Forwarded-For). */
export function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}
