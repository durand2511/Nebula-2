/** One-off: strip render-blocking <link>/<script> tags pointing at the dead host
 * www.yin-mindfulness.com from senszenjoy.nl (project 65), then republish the live snapshot.
 * The site's own /_nebula/imported.css already contains the full imported styling. */
import { db, projectFiles } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { publishSite } from "./lib/site-publish.js";

const PROJECT = Number(process.env.FIX_PROJECT || 65);

async function main() {
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  let changed = 0;
  for (const f of files) {
    if (!f.content.includes("yin-mindfulness.com")) continue;
    const next = f.content
      .replace(/[ \t]*<link[^>]*yin-mindfulness\.com[^>]*>\s*\n?/g, "")
      .replace(/[ \t]*<script[^>]*yin-mindfulness\.com[^>]*>\s*<\/script>\s*\n?/g, "")
      // @font-face urls naar de dode host: lokaal pad → snelle 404 → direct systeem-fallback
      // (Segoe UI zit in de fallback-stack) i.p.v. een hangende request.
      .replace(/https?:\/\/(www\.)?yin-mindfulness\.com\/fonts\//g, "/fonts/");
    if (next === f.content) { console.log("  ! nog steeds referenties in", f.path); continue; }
    await db.update(projectFiles).set({ content: next, updatedAt: new Date() }).where(and(eq(projectFiles.projectId, PROJECT), eq(projectFiles.id, f.id)));
    changed++;
    console.log("  ✓", f.path, next.includes("yin-mindfulness.com") ? "(LET OP: rest-referentie blijft)" : "");
  }
  console.log("Gewijzigd:", changed, "bestanden. Publiceren…");
  const v = await publishSite(PROJECT);
  console.log("Gepubliceerd, versie", v);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
