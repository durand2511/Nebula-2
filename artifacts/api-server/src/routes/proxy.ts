import { Router } from "express";
import type { Request, Response } from "express";
import { readCookies, storeCookies, isPrivateHostname } from "../lib/preview-session";

const router = Router();

// The proxy is open (no login) because it runs inside preview iframes that can't attach a token.
// SSRF is blocked below; these limits stop it being abused as a bandwidth relay.
const PROXY_MAX_BYTES = 15_000_000;            // cap a single fetched response
const RL = new Map<string, { count: number; start: number }>();
const RL_WINDOW_MS = 60_000, RL_MAX = 240;     // per-IP requests per minute (a heavy preview is well under)
function proxyIp(req: Request): string {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.ip || req.socket?.remoteAddress || "";
}

// ── Proxy handler ─────────────────────────────────────────────────────────────
async function handleProxy(req: Request, res: Response): Promise<void> {
  const ip = proxyIp(req);
  if (ip) {
    const now = Date.now();
    let e = RL.get(ip);
    if (!e || now - e.start > RL_WINDOW_MS) { e = { count: 0, start: now }; RL.set(ip, e); }
    e.count++;
    if (RL.size > 20_000) { for (const [k, v] of RL) if (now - v.start > RL_WINDOW_MS) RL.delete(k); }
    if (e.count > RL_MAX) { res.status(429).set("Retry-After", "30").json({ error: "rate limited" }); return; }
  }

  const rawUrl = (req.query.url as string) ?? "";
  if (!rawUrl) { res.status(400).json({ error: "url required" }); return; }

  let target: URL;
  try { target = new URL(rawUrl); }
  catch { res.status(400).json({ error: "invalid url" }); return; }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    res.status(400).json({ error: "only http/https" }); return;
  }
  if (isPrivateHostname(target.hostname)) {
    res.status(403).json({ error: "private addresses not allowed" }); return;
  }

  const sid = (req.headers["x-preview-session"] as string) || "";
  const domain = target.hostname;
  const cookieHdr = sid ? readCookies(sid, domain) : "";

  const siteOrigin = `${target.protocol}//${target.hostname}`;
  const fwdHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": (req.headers["accept"] as string) || "*/*",
    "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
    // Make the request look same-origin to the target server so CSRF checks pass
    "Origin": siteOrigin,
    "Referer": siteOrigin + "/",
  };
  if (cookieHdr) fwdHeaders["Cookie"] = cookieHdr;
  const reqCt = req.headers["content-type"] as string | undefined;
  if (reqCt) fwdHeaders["Content-Type"] = reqCt;
  // Forward AJAX indicator — WooCommerce and Shopify check for this
  fwdHeaders["X-Requested-With"] = (req.headers["x-requested-with"] as string) || "XMLHttpRequest";

  let body: string | undefined;
  const method = req.method.toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    if (reqCt?.includes("application/x-www-form-urlencoded") && req.body && typeof req.body === "object") {
      body = new URLSearchParams(req.body as Record<string, string>).toString();
    } else if (reqCt?.includes("application/json") && req.body != null) {
      body = JSON.stringify(req.body);
    }
  }

  try {
    // Follow redirects MANUALLY so each hop is re-checked against the SSRF blocklist — otherwise a
    // public URL could 3xx-redirect to a private address (e.g. cloud metadata) and fetch would follow.
    let hopUrl = target.href;
    let upstream: globalThis.Response;
    for (let hop = 0; ; hop++) {
      upstream = await fetch(hopUrl, { method, headers: fwdHeaders, body, redirect: "manual" });
      const status = upstream.status;
      const loc = upstream.headers.get("location");
      if (status < 300 || status >= 400 || !loc) break;
      if (hop >= 4) { res.status(508).json({ error: "too many redirects" }); return; }
      let next: URL;
      try { next = new URL(loc, hopUrl); } catch { res.status(502).json({ error: "bad redirect" }); return; }
      if ((next.protocol !== "http:" && next.protocol !== "https:") || isPrivateHostname(next.hostname)) {
        res.status(403).json({ error: "redirect to private address blocked" }); return;
      }
      hopUrl = next.href;
    }

    // Persist Set-Cookie headers into the session store
    if (sid) {
      const setCookies: string[] =
        typeof (upstream.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
          ? (upstream.headers as { getSetCookie: () => string[] }).getSetCookie()
          : upstream.headers.get("set-cookie")
            ? [upstream.headers.get("set-cookie")!]
            : [];
      if (setCookies.length) storeCookies(sid, domain, setCookies);
    }

    const declared = Number(upstream.headers.get("content-length") || 0);
    if (declared && declared > PROXY_MAX_BYTES) { res.status(413).json({ error: "response too large" }); return; }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > PROXY_MAX_BYTES) { res.status(413).json({ error: "response too large" }); return; }
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.status(upstream.status);
    res.send(buf);
  } catch (err) {
    console.error("[proxy] upstream error:", err);
    res.status(502).json({ error: "upstream error" });
  }
}

router.get("/proxy", handleProxy);
router.post("/proxy", handleProxy);
// OPTIONS is handled by the global cors() middleware in app.ts

export default router;
