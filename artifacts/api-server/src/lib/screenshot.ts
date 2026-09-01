/**
 * Server-side region screenshots with headless Chromium (puppeteer-core).
 *
 * The browser cannot rasterise cross-origin images (a site's hero photo on a CDN), so an in-browser
 * screenshot of the preview comes out blank. Rendering the preview server-side with a real browser
 * captures the actual pixels — CDN images included — regardless of origin.
 *
 * Chromium is heavy, so: one capture at a time (a single-flight lock), a hard timeout, and a graceful
 * "no-chromium" error when the binary isn't installed (the client then falls back to paste).
 */
import fsSync from "node:fs";
import { createRequire } from "node:module";
import { logger } from "./logger";

const require = createRequire(import.meta.url);

type Clip = { x: number; y: number; width: number; height: number };
type Viewport = { width: number; height: number };

function chromiumPath(): string | null {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean) as string[];
  for (const c of candidates) { try { if (fsSync.existsSync(c)) return c; } catch { /* ignore */ } }
  return null;
}

let inFlight: Promise<Buffer> | null = null;

export async function captureRegion(opts: { projectId: number; page: string; clip: Clip; viewport: Viewport }): Promise<Buffer> {
  // Single-flight: serialise captures so we never run two Chromium instances at once (memory).
  while (inFlight) { try { await inFlight; } catch { /* ignore previous */ } }
  const run = doCapture(opts);
  inFlight = run;
  try { return await run; } finally { if (inFlight === run) inFlight = null; }
}

async function doCapture(opts: { projectId: number; page: string; clip: Clip; viewport: Viewport }): Promise<Buffer> {
  const exe = chromiumPath();
  if (!exe) throw new Error("no-chromium");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process", "--no-zygote", "--hide-scrollbars"],
  });
  try {
    const pg = await browser.newPage();
    const vw = Math.max(320, Math.min(2200, Math.round(opts.viewport.width || 1200)));
    const vh = Math.max(600, Math.min(8000, Math.round(opts.viewport.height || 900)));
    await pg.setViewport({ width: vw, height: vh, deviceScaleFactor: 2 });
    const port = process.env.PORT || "8080";
    const url = `http://127.0.0.1:${port}/api/projects/${opts.projectId}/preview-page?page=${encodeURIComponent(opts.page)}&sid=shot`;
    await pg.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
    await new Promise((r) => setTimeout(r, 700)); // let lazy images/fonts settle
    const clip = {
      x: Math.max(0, Math.round(opts.clip.x)),
      y: Math.max(0, Math.round(opts.clip.y)),
      width: Math.max(1, Math.round(opts.clip.width)),
      height: Math.max(1, Math.round(opts.clip.height)),
    };
    const buf = await pg.screenshot({ type: "png", clip });
    return buf as Buffer;
  } finally {
    await browser.close().catch(() => {});
  }
}

export function screenshotAvailable(): boolean {
  return chromiumPath() != null;
}

logger.info({ chromium: chromiumPath() || "not found" }, "[screenshot] engine init");
