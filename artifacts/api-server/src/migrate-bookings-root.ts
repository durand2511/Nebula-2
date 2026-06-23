/**
 * One-off migration (NO AI): move a flat imported site's booking page from pages/bookings.html
 * to ROOT bookings.html, so its relative links don't break under the preview proxy's <base href>
 * (the "../pages/…" link previously escaped the domain segment → "external link blocked").
 *
 * Run: export $(grep DATABASE_URL .env) && tsx src/migrate-bookings-root.ts <projectId>
 */
import { db, projectFiles } from "@workspace/db";
import { eq } from "drizzle-orm";

const PID = Number(process.argv[2] ?? 94);

async function main() {
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, PID));
  const get = (p: string) => files.find((f) => f.path === p);
  const old = get("pages/bookings.html");
  if (get("bookings.html")) { console.log("bookings.html already exists at root — nothing to do."); process.exit(0); }

  // Repoint EVERY page's booking link to the root path "bookings.html" (handles both
  // "pages/bookings.html" and "../pages/bookings.html").
  let repointed = 0;
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith(".html")) continue;
    const next = f.content.replace(/href=("|')(?:\.\.\/)*pages\/bookings\.html\1/gi, 'href="bookings.html"');
    if (next !== f.content) {
      await db.update(projectFiles).set({ content: next, updatedAt: new Date() }).where(eq(projectFiles.id, f.id));
      repointed++;
    }
  }

  // Build the ROOT booking page from a normal page's shell (so it has the site's exact
  // header/nav/footer and routes correctly), with the booking content in <main>.
  const shellSrc = get("tarieven.html") ?? files.find((f) => f.path.endsWith(".html") && f.path !== "pages/bookings.html");
  if (shellSrc && old) {
    const bookingMain = (old.content.match(/<main\b[\s\S]*?<\/main>/i) ?? [])[0]
      ?? '<main style="max-width:800px;margin:0 auto;padding:48px 24px;"><h1>Boekingen</h1></main>';
    let root = shellSrc.content;
    root = /<main\b[\s\S]*?<\/main>/i.test(root)
      ? root.replace(/<main\b[\s\S]*?<\/main>/i, bookingMain)
      : root.replace(/<\/body>/i, bookingMain + "</body>");
    // its own nav's booking link → self at root
    root = root.replace(/href=("|')(?:\.\.\/)*pages\/bookings\.html\1/gi, 'href="bookings.html"');
    await db.insert(projectFiles).values({ projectId: PID, path: "bookings.html", content: root, language: "html" });
    console.log("Created root bookings.html (site shell + booking content).");
  }

  // Remove the old subdirectory page so nothing points into pages/ anymore.
  if (old) { await db.delete(projectFiles).where(eq(projectFiles.id, old.id)); console.log("Deleted pages/bookings.html."); }

  console.log(`Repointed booking links on ${repointed} page(s).`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
