/** One-off (herstel): schrijf index.html van senszenjoy (project 65) opnieuw vanaf de SCHONE
 * originele kopie, met de yin-mindfulness stylesheet/scripts inline en font/afbeelding-urls naar de
 * eigen /assets/. Daarna de live snapshot publiceren. */
import { readFileSync } from "node:fs";
import { db, projectFiles } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { publishSite } from "./lib/site-publish.js";

const PROJECT = 65;
const S = process.env.SCRATCH || "";
if (!S) { console.error("SCRATCH env ontbreekt"); process.exit(1); }

const localised = (css: string) => css.replace(/url\((['"]?)\.\.\/(fonts|images)\//g, "url($1/assets/nm-");

async function main() {
  const styles = localised(readFileSync(`${S}/styles.css`, "utf8"));
  const popupCss = localised(readFileSync(`${S}/grt-youtube-popup.css`, "utf8"));
  const scripts = readFileSync(`${S}/scripts.js`, "utf8");
  const popupJs = readFileSync(`${S}/grt-youtube-popup.js`, "utf8");
  let idx = readFileSync(`${S}/idx-original.html`, "utf8");
  idx = idx
    .replace(/<link rel="stylesheet" href="https:\/\/www\.yin-mindfulness\.com\/styles\/grt-youtube-popup\.css">/, () => `<style>\n${popupCss}\n</style>`)
    .replace(/<link rel="stylesheet" href="https:\/\/www\.yin-mindfulness\.com\/styles\/styles\.css\?v=1\.5" type="text\/css">/, () => `<style>\n${styles}\n</style>`)
    .replace(/<script src="https:\/\/www\.yin-mindfulness\.com\/scripts\/grt-youtube-popup\.js"><\/script>/, () => `<script>\n${popupJs}\n</script>`)
    .replace(/<script src="https:\/\/www\.yin-mindfulness\.com\/scripts\/scripts\.js"><\/script>/, () => `<script>\n${scripts}\n</script>`);
  if (/yin-mindfulness\.com\/(styles|scripts|fonts)/.test(idx)) { console.error("nog live yin-refs — vervanging niet compleet"); process.exit(1); }
  if (idx.length < 90000 || !/Proefles/i.test(idx) || !idx.includes(".btnCTA")) { console.error("sanity check faalde", idx.length); process.exit(1); }
  const [row] = await db.select({ id: projectFiles.id }).from(projectFiles)
    .where(and(eq(projectFiles.projectId, PROJECT), eq(projectFiles.path, "index.html")));
  if (!row) { console.error("index.html niet gevonden"); process.exit(1); }
  await db.update(projectFiles).set({ content: idx, updatedAt: new Date() }).where(eq(projectFiles.id, row.id));
  console.log("index.html ✓", idx.length, "bytes");
  const v = await publishSite(PROJECT);
  console.log("Gepubliceerd, versie", v);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
