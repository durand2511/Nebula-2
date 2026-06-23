import { Router } from "express";
import type { Request, Response } from "express";
import { readCookies, storeCookies, isPrivateHostname } from "../lib/preview-session";

const router = Router();

// ── Proxy handler ─────────────────────────────────────────────────────────────
async function handleProxy(req: Request, res: Response): Promise<void> {
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
    const upstream = await fetch(target.href, { method, headers: fwdHeaders, body, redirect: "follow" });

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

    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.status(upstream.status);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("[proxy] upstream error:", err);
    res.status(502).json({ error: "upstream error" });
  }
}

router.get("/proxy", handleProxy);
router.post("/proxy", handleProxy);
// OPTIONS is handled by the global cors() middleware in app.ts

export default router;
