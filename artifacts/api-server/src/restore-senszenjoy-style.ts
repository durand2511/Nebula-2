/** One-off: restore senszenjoy.nl's styling after the www.yin-mindfulness.com TLS outage.
 * The homepage used that site's stylesheet/scripts live; https://www.… hangs (TLS), so we localise:
 *  - fonts + background images → import_assets (assets/nm-…), served from the site's own /assets/
 *  - styles.css + grt-youtube-popup.css inlined in <style> (font/image urls rewritten to /assets/)
 *  - scripts.js + grt-youtube-popup.js inlined in <script>
 *  - subpages' font urls (/fonts/…, from the earlier hotfix) → /assets/nm-…
 * Then republish the live snapshot. */
import { readFileSync, readdirSync } from "node:fs";
import { db, projectFiles, importAssets } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { publishSite } from "./lib/site-publish.js";

const PROJECT = 65;
const S = process.env.SCRATCH || "";
if (!S) { console.error("SCRATCH env ontbreekt"); process.exit(1); }

const TYPES: Record<string, string> = { woff: "font/woff", woff2: "font/woff2", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

function localised(css: string): string {
  return css.replace(/url\((['"]?)\.\.\/(fonts|images)\//g, "url($1/assets/nm-");
}

async function upsertAsset(path: string, contentType: string, data: string) {
  const [ex] = await db.select({ id: importAssets.id }).from(importAssets)
    .where(and(eq(importAssets.projectId, PROJECT), eq(importAssets.path, path)));
  if (ex) await db.update(importAssets).set({ data, contentType }).where(eq(importAssets.id, ex.id));
  else await db.insert(importAssets).values({ projectId: PROJECT, path, contentType, data });
}

async function main() {
  // 1. Fonts + images als assets
  for (const name of readdirSync(`${S}/nm`)) {
    const ext = name.split(".").pop() || "";
    const data = readFileSync(`${S}/nm/${name}`).toString("base64");
    await upsertAsset(`assets/nm-${name}`, TYPES[ext] || "application/octet-stream", data);
    console.log("  asset ✓", `assets/nm-${name}`);
  }

  // 2. Homepage herstellen vanaf de originele kopie, met alles inline/lokaal
  const styles = localised(readFileSync(`${S}/styles.css`, "utf8"));
  const popupCss = localised(readFileSync(`${S}/grt-youtube-popup.css`, "utf8"));
  const scripts = readFileSync(`${S}/scripts.js`, "utf8");
  const popupJs = readFileSync(`${S}/grt-youtube-popup.js`, "utf8");
  let idx = readFileSync(`${S}/idx.html`, "utf8");
  const before = idx.length;
  idx = idx
    .replace(/<link rel="stylesheet" href="https:\/\/www\.yin-mindfulness\.com\/styles\/grt-youtube-popup\.css">/, () => `<style>\n${popupCss}\n</style>`)
    .replace(/<link rel="stylesheet" href="https:\/\/www\.yin-mindfulness\.com\/styles\/styles\.css\?v=1\.5" type="text\/css">/, () => `<style>\n${styles}\n</style>`)
    .replace(/<script src="https:\/\/www\.yin-mindfulness\.com\/scripts\/grt-youtube-popup\.js"><\/script>/, () => `<script>\n${popupJs}\n</script>`)
    .replace(/<script src="https:\/\/www\.yin-mindfulness\.com\/scripts\/scripts\.js"><\/script>/, () => `<script>\n${scripts}\n</script>`);
  if (idx.length <= before) { console.error("index.html-vervanging niet gelukt — tags niet gevonden"); process.exit(1); }
  if (/yin-mindfulness\.com\/(styles|scripts|fonts)/.test(idx)) { console.error("nog live yin-refs in index.html"); process.exit(1); }
  const [row] = await db.select({ id: projectFiles.id }).from(projectFiles)
    .where(and(eq(projectFiles.projectId, PROJECT), eq(projectFiles.path, "index.html")));
  if (!row) { console.error("index.html niet gevonden"); process.exit(1); }
  await db.update(projectFiles).set({ content: idx, updatedAt: new Date() }).where(eq(projectFiles.id, row.id));
  console.log("  index.html ✓ hersteld met inline styling (", idx.length, "bytes )");

  // 3. Subpagina's: /fonts/…woff (eerdere hotfix) → /assets/nm-…
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  let sub = 0;
  for (const f of files) {
    if (f.path === "index.html" || !/\/fonts\/(segoeui|seguisb)[a-z]*\.woff2?/.test(f.content)) continue;
    const next = f.content.replace(/(['"(])\/fonts\/((?:segoeui|seguisb)[a-z]*\.woff2?)/g, "$1/assets/nm-$2");
    if (next === f.content) continue;
    await db.update(projectFiles).set({ content: next, updatedAt: new Date() }).where(eq(projectFiles.id, f.id));
    sub++;
  }
  console.log("  subpagina-fonts ✓", sub, "bestanden");

  const v = await publishSite(PROJECT);
  console.log("Gepubliceerd, versie", v);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
