import { setAuthTokenGetter } from "@workspace/api-client-react";

// Platform account session token (Bearer). Stored in localStorage; attached to every api-client
// request via setAuthTokenGetter so all project routes see the logged-in user.
const KEY = "nebula_token";

export function getToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setToken(t: string): void {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
}
export function clearToken(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Register once: every generated api-client call now sends Authorization: Bearer <token>.
setAuthTokenGetter(() => getToken());

export type PlatformUser = { id: number; email: string; name: string; birthdate: string; phone: string };
