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

// The editor also makes RAW fetch() calls to our own /api (chat, build, publish, domains) that do NOT
// go through the api-client — those were missing the token, so auth'd routes (e.g. the AI build's
// requireOwner) returned 401 "Niet ingelogd" even while logged in. Patch window.fetch once to attach the
// Bearer token to same-origin /api requests that don't already carry an Authorization header.
if (typeof window !== "undefined" && typeof window.fetch === "function" && !(window as unknown as { __nebulaAuthFetch?: boolean }).__nebulaAuthFetch) {
  (window as unknown as { __nebulaAuthFetch?: boolean }).__nebulaAuthFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : (input as Request).url;
      if (typeof url === "string" && url.includes("/api/")) {
        const tok = getToken();
        if (tok) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          if (!headers.has("Authorization")) {
            headers.set("Authorization", "Bearer " + tok);
            return orig(input, { ...(init ?? {}), headers });
          }
        }
      }
    } catch { /* fall through to the unmodified call */ }
    return orig(input, init);
  };
}

export type PlatformUser = { id: number; email: string; name: string; birthdate: string; phone: string };
