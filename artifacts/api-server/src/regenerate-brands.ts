/** Re-generate the e-mail brand for booking apps whose studio name improved (e.g. "Home" → domain). */
import { db, projectFiles } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { emailBrandSeed } from "./lib/actions.js";
import { generateEmailBrand, loadEmailBrand, BRAND_PATH } from "./lib/email-brand.js";

async function main() {
  const apps = await db.select().from(projectFiles).where(eq(projectFiles.path, "booking-app.html"));
  let changed = 0;
  for (const app of apps) {
    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, app.projectId));
    const seed = emailBrandSeed(files.map((f) => ({ path: f.path, content: f.content })));
    const brand = await loadEmailBrand(app.projectId);
    if (brand && brand.studio === seed.studio) { console.log("  – project", app.projectId, "ok (" + seed.studio + ")"); continue; }
    await db.delete(projectFiles).where(and(eq(projectFiles.projectId, app.projectId), eq(projectFiles.path, BRAND_PATH)));
    await generateEmailBrand(app.projectId, files.map((f) => ({ path: f.path, content: f.content })));
    changed++;
    console.log("  ✓ project", app.projectId, "->", seed.studio);
  }
  console.log(`\nDone: ${changed} regenerated.`);
  process.exit(0);
}
main();
