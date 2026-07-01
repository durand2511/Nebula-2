/**
 * Bright Data Web Unlocker — fetch a URL from a residential/unblocked network so sites that block
 * datacenter IPs (SiteGround/Wordfence/Cloudflare, bot-checks, JS-only pages) still load. Used by the
 * website import (get the real HTML) and the preview proxy (load blocked CSS/fonts/images).
 *
 * Config via env (never hardcode the token):
 *   BRIGHTDATA_API_TOKEN = your Bright Data API token
 *   BRIGHTDATA_ZONE      = your Web Unlocker zone name (e.g. web_unlocker2)
 *
 * REST API: POST https://api.brightdata.com/request  { zone, url, format: "raw" }  -> raw body.
 */

const API = "https://api.brightdata.com/request";

const token = () => process.env.BRIGHTDATA_API_TOKEN || "";
// Default to the account's Web Unlocker zone so only the TOKEN needs to be set in the dashboard
// (the blueprint env from render.yaml doesn't always auto-apply). Override via BRIGHTDATA_ZONE.
const zone = () => process.env.BRIGHTDATA_ZONE || "web_unlocker2";

export function brightDataEnabled(): boolean {
  return !!(token() && zone());
}

export type BrightDataResult = { status: number; contentType: string; body: Buffer };

/** Fetch `url` through Bright Data. Throws if not configured or the API call fails/aborts. */
export async function fetchViaBrightData(url: string, timeoutMs = 60000): Promise<BrightDataResult> {
  if (!brightDataEnabled()) throw new Error("Bright Data niet geconfigureerd (BRIGHTDATA_API_TOKEN/ZONE).");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ zone: zone(), url, format: "raw" }),
      signal: controller.signal,
    });
    const body = Buffer.from(await r.arrayBuffer());
    // With format:"raw" Bright Data passes the target's body through; the response content-type
    // usually reflects the target, but fall back to guessing from the URL for assets.
    const contentType = r.headers.get("content-type") || guessContentType(url);
    return { status: r.status, contentType, body };
  } finally {
    clearTimeout(timer);
  }
}

function guessContentType(url: string): string {
  const ext = (url.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    css: "text/css; charset=utf-8", js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8", json: "application/json; charset=utf-8",
    svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
    mp4: "video/mp4", webm: "video/webm", html: "text/html; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}
