/** One-off: generate the e-mail branding (logo + name + AI copy) for every existing booking app. */
import { db, projectFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateEmailBrand } from "./lib/email-brand.js";

async function main() {
  const apps = await db.select().from(projectFiles).where(eq(projectFiles.path, "booking-app.html"));
  let done = 0;
  for (const app of apps) {
    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, app.projectId));
    await generateEmailBrand(app.projectId, files.map((f) => ({ path: f.path, content: f.content })));
    done++;
    console.log("  ✓ brand ensured for project", app.projectId);
  }
  console.log(`\nDone: ${done} projects.`);
  process.exit(0);
}
main();
