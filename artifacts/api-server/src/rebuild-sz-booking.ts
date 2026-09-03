/** One-off: booking-app.html van project 65 herbouwen met de nieuwste template en publiceren. */
import { db, projectFiles } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { rebuildBookingApp } from "./lib/actions.js";
import { publishSite } from "./lib/site-publish.js";

const PROJECT = 65;
async function main() {
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  const rebuilt = rebuildBookingApp(files.map((f) => ({ path: f.path, content: f.content })));
  if (!rebuilt) { console.error("geen booking-app gevonden"); process.exit(1); }
  const ex = files.find((f) => f.path === rebuilt.path);
  if (!ex) { console.error("booking-app.html rij niet gevonden"); process.exit(1); }
  if (!rebuilt.content.includes("stripe/pay-element")) { console.error("nieuwe template mist pay-element — verkeerde build?"); process.exit(1); }
  await db.update(projectFiles).set({ content: rebuilt.content, updatedAt: new Date() }).where(and(eq(projectFiles.projectId, PROJECT), eq(projectFiles.id, ex.id)));
  console.log("booking-app.html ✓ herbouwd (", rebuilt.content.length, "bytes )");
  const v = await publishSite(PROJECT);
  console.log("Gepubliceerd, versie", v);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
