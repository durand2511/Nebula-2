/**
 * OFFLINE nav-placement test harness — ZERO API/AI cost.
 *
 * Clones a source project, resets any existing booking nav links to the clean imported
 * state, then re-inserts the booking nav link with insertNavLink() on every page. You then
 * open the clone in the browser (preview-page endpoint, free) to verify the tab is on every
 * page AND sits inline in the nav bar (not below it) — all WITHOUT a single AI call.
 *
 * Run:  node dist (built) OR tsx src/nav-test-clone.ts <sourceProjectId> [bookingHref]
 * Re-run after tweaking insertNavLink to iterate for free; it makes a FRESH clone each time.
 */
import { db, projects, projectFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { insertNavLink } from "./lib/write-plan.js";

const sourceId = Number(process.argv[2] ?? 80);
const bookingHref = process.argv[3] ?? "pages/bookings.html";
const bookingLabel = "Bookings";

// Remove any existing nav link to the booking page so we test from the clean imported state.
function stripBookingsNav(html: string): string {
  return html
    // a whole <li>…bookings…</li>
    .replace(/<li\b[^>]*>(?:(?!<\/li>)[\s\S])*?href=["'][^"']*bookings[^"']*["'][\s\S]*?<\/li>/gi, "")
    // a bare <a …bookings…>…</a>
    .replace(/<a\b[^>]*href=["'][^"']*bookings[^"']*["'][\s\S]*?<\/a>/gi, "");
}

async function main() {
  const [src] = await db.select().from(projects).where(eq(projects.id, sourceId));
  if (!src) throw new Error(`Source project ${sourceId} not found`);
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, sourceId));
  console.log(`Source project ${sourceId} "${src.name}" — ${files.length} files`);

  // Fresh clone each run.
  const [clone] = await db.insert(projects).values({
    name: `${src.name} [NAV TEST]`,
    description: src.description,        // keep "Imported from …" so preview uses the proxy
    source: src.source,
  }).returning();
  console.log(`Created clone project ${clone.id}`);

  let withNav = 0;
  for (const f of files) {
    let content = f.content;
    if (f.path.toLowerCase().endsWith(".html")) {
      // Reset to clean state, then add the booking nav link (skip the booking page itself).
      if (f.path !== bookingHref && !f.path.includes("/")) {
        content = stripBookingsNav(content);
        const updated = insertNavLink(content, bookingHref, bookingLabel);
        if (updated) { content = updated; withNav++; }
      }
    }
    await db.insert(projectFiles).values({
      projectId: clone.id, path: f.path, content, language: f.language,
    });
  }

  console.log(`Booking nav inserted into ${withNav} root pages.`);
  console.log(`\nOPEN IN BROWSER (no AI cost):`);
  console.log(`  http://localhost:5173/projects/${clone.id}`);
  console.log(`  (or a single page directly: http://localhost:5001/api/projects/${clone.id}/preview-page?page=tarieven.html )`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
