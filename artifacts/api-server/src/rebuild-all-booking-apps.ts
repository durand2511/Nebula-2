/** One-off: regenerate every project's booking-app.html so existing studios pick up new code. */
import { db, projectFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { rebuildBookingApp } from "./lib/actions.js";

async function main() {
  const apps = await db.select().from(projectFiles).where(eq(projectFiles.path, "booking-app.html"));
  let updated = 0, skipped = 0;
  for (const app of apps) {
    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, app.projectId));
    const rebuilt = rebuildBookingApp(files.map((f) => ({ path: f.path, content: f.content })));
    if (rebuilt && rebuilt.content && rebuilt.content !== app.content) {
      await db.update(projectFiles).set({ content: rebuilt.content, updatedAt: new Date() }).where(eq(projectFiles.id, app.id));
      updated++;
      console.log("  ✓ project", app.projectId, "rebuilt");
    } else {
      skipped++;
      console.log("  – project", app.projectId, rebuilt ? "unchanged" : "could not rebuild");
    }
  }
  console.log(`\nDone: ${updated} rebuilt, ${skipped} skipped.`);
  process.exit(0);
}
main();
