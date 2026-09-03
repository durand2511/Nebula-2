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
import { makePreviewTicket } from "./preview-ticket.js";
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
  // HARD 10s cap on the whole capture. Without it, a Chromium that died mid-flight (OOM on the
  // small instance) left puppeteer calls hanging forever — and every next capture queued behind it,
  // which felt like "screenshots take minutes". On timeout we also throw the browser away so the
  // next attempt starts from a clean launch.
  const run = (async () => {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        doCapture(opts),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("capture-timeout")), 10_000); }),
      ]);
    } catch (err) {
      if ((err as Error)?.message === "capture-timeout") {
        const b = sharedBrowser; sharedBrowser = null;
        if (b) b.close().catch(() => {});
        logger.warn("[screenshot] capture timed out — recycled Chromium");
      }
      throw err;
    } finally { if (timer) clearTimeout(timer); }
  })();
  inFlight = run;
  try { return await run; } finally { if (inFlight === run) inFlight = null; }
}

// Keep one Chromium alive between captures (launch is the slowest part, seconds on a small
// instance) and close it after a short idle so it never squats on memory.
let sharedBrowser: any = null;
let idleClose: NodeJS.Timeout | null = null;
const BROWSER_IDLE_MS = 90 * 1000;

async function getBrowser(): Promise<any> {
  if (sharedBrowser && sharedBrowser.connected !== false) return sharedBrowser;
  const exe = chromiumPath();
  if (!exe) throw new Error("no-chromium");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const puppeteer = require("puppeteer-core");
  sharedBrowser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process", "--no-zygote", "--hide-scrollbars"],
  });
  sharedBrowser.once("disconnected", () => { sharedBrowser = null; });
  return sharedBrowser;
}

function scheduleIdleClose(): void {
  if (idleClose) clearTimeout(idleClose);
  idleClose = setTimeout(() => {
    const b = sharedBrowser; sharedBrowser = null;
    if (b) b.close().catch(() => {});
  }, BROWSER_IDLE_MS);
}

async function doCapture(opts: { projectId: number; page: string; clip: Clip; viewport: Viewport }): Promise<Buffer> {
  const browser = await getBrowser();
  const pg = await browser.newPage();
  try {
    const vw = Math.max(320, Math.min(2200, Math.round(opts.viewport.width || 1200)));
    // Keep the viewport at window height: puppeteer's captureBeyondViewport clips below the fold
    // just fine, and NOT rasterising an 8000px-tall page at once is a big chunk of the speed-up.
    const vh = Math.max(600, Math.min(1400, Math.round(opts.viewport.height || 900)));
    await pg.setViewport({ width: vw, height: vh, deviceScaleFactor: 1.5 });
    // Never download video/audio: a 4K background video makes the capture take forever, and video
    // frames don't reliably render in a fresh headless page anyway. The style below paints the spot
    // where a video lives dark, so heroes don't come out as unreadable white-on-white.
    await pg.setRequestInterception(true);
    pg.on("request", (r: any) => { (r.resourceType() === "media" ? r.abort() : r.continue()).catch(() => {}); });
    const port = process.env.PORT || "8080";
    const url = `http://127.0.0.1:${port}/api/projects/${opts.projectId}/preview-page?page=${encodeURIComponent(opts.page)}&sid=shot&pt=${makePreviewTicket(opts.projectId)}`;
    // Proceed after AT MOST ~2.5s even when the page's load event hasn't fired (slow CDN images
    // kept eating the full timeout on every capture) — we screenshot whatever has rendered.
    await Promise.race([
      pg.goto(url, { waitUntil: "load", timeout: 8000 }).catch(() => { /* capture what's there */ }),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    await pg.addStyleTag({ content: "video{background:#171717 !important}" }).catch(() => {});
    // Scroll to the marked area so IntersectionObserver-style lazy images there actually load
    // (the viewport is window-sized now; captureBeyondViewport handles the clip itself).
    // eslint-disable-next-line @typescript-eslint/no-implied-eval — runs in the page, where scrollTo exists
    await pg.evaluate("window.scrollTo(0, Math.max(0, " + Math.max(0, Math.round(opts.clip.y) - 200) + "))").catch(() => {});
    await new Promise((r) => setTimeout(r, 300)); // let fonts/lazy images settle
    const clip = {
      x: Math.max(0, Math.round(opts.clip.x)),
      y: Math.max(0, Math.round(opts.clip.y)),
      width: Math.max(1, Math.round(opts.clip.width)),
      height: Math.max(1, Math.round(opts.clip.height)),
    };
    // puppeteer-core ≥22 returns a Uint8Array, not a Buffer — wrap it so .toString("base64") works.
    const buf = await pg.screenshot({ type: "png", clip });
    return Buffer.from(buf as Uint8Array);
  } finally {
    await pg.close().catch(() => {});
    scheduleIdleClose();
  }
}

export function screenshotAvailable(): boolean {
  return chromiumPath() != null;
}

/** Fire-and-forget pre-warm: launch (or keep) the shared Chromium so the next capture skips the
 *  slow launch. Called when the user enters "Markeren" mode. */
export async function warmup(): Promise<void> {
  try { await getBrowser(); scheduleIdleClose(); } catch { /* no chromium / launch failed — capture will fall back */ }
}

logger.info({ chromium: chromiumPath() || "not found" }, "[screenshot] engine init");
