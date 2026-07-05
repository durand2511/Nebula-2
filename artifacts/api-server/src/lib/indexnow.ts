/**
 * IndexNow — instantly notify Bing / Yandex / Seznam of new or updated URLs (Google does NOT
 * participate in IndexNow). We host ONE platform key file at /<key>.txt on every connected domain
 * (served by host-site.ts), which proves we control the host, so we can submit URLs for any customer
 * site we serve. Best-effort: never throws, failures are logged and ignored.
 */
import { logger } from "./logger";

// The key is public (it's served in a .txt file) — a fixed default is fine; override via env if wanted.
export const INDEXNOW_KEY = (process.env.INDEXNOW_KEY || "d8f3a91c74b2465e8a0f1c6b9e5d2a7f")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

export async function submitToIndexNow(host: string, urls: string[]): Promise<void> {
  try {
    const list = Array.from(new Set(urls.filter(Boolean))).slice(0, 100);
    if (!host || list.length === 0 || INDEXNOW_KEY.length < 8) return;
    const body = { host, key: INDEXNOW_KEY, keyLocation: `https://${host}/${INDEXNOW_KEY}.txt`, urlList: list };
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    logger.info({ host, count: list.length, status: res.status }, "[indexnow] submitted");
  } catch (err) {
    logger.warn({ err: (err as Error)?.message, host }, "[indexnow] submit failed");
  }
}
