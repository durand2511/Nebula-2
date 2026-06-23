/**
 * OFFLINE clean-up + clean-nav test harness — ZERO API/AI cost.
 *
 * Clones a source project, then on EVERY page:
 *   1) light-cleans the HTML (strip comments, trackers, blank-line runs),
 *   2) replaces the messy multi-variant navigation with ONE clean, identical nav bar
 *      (built from the primary menu items + a Bookings tab), preserving the footer.
 *
 * Result: every page shares the exact same clean menu, so the Bookings tab stays visible
 * while navigating, and the code panel shows readable HTML. Re-run after tweaks — free.
 *
 * Run:  export $(grep DATABASE_URL .env) && tsx src/nav-clean-clone.ts <sourceId> [bookingHref]
 */
import { db, projects, projectFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  extractPrimaryNavItems, buildCleanNavBar, normalizeImportedNav, cleanupImportedHtml,
  type NavItem,
} from "./lib/write-plan.js";

const sourceId = Number(process.argv[2] ?? 80);
const bookingHref = process.argv[3] ?? "pages/bookings.html";

async function main() {
  const [src] = await db.select().from(projects).where(eq(projects.id, sourceId));
  if (!src) throw new Error(`Source project ${sourceId} not found`);
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, sourceId));
  console.log(`Source ${sourceId} "${src.name}" — ${files.length} files`);

  // Derive the canonical menu ONCE from index.html, then add the Bookings tab.
  const index = files.find((f) => f.path.toLowerCase() === "index.html");
  let items: NavItem[] = index ? extractPrimaryNavItems(index.content) : [];
  if (!items.some((i) => i.href.toLowerCase().includes("bookings"))) {
    items = [...items, { href: bookingHref, label: "Bookings" }];
  }
  const cleanNav = buildCleanNavBar(items);
  console.log(`Clean menu items: ${items.map((i) => i.label).join(" | ")}`);

  const [clone] = await db.insert(projects).values({
    name: `${src.name} [CLEAN]`, description: src.description, source: src.source,
  }).returning();
  console.log(`Created clone project ${clone.id}`);

  let cleaned = 0;
  for (const f of files) {
    let content = f.content;
    if (f.path.toLowerCase().endsWith(".html") && f.path !== bookingHref) {
      content = cleanupImportedHtml(content);
      content = normalizeImportedNav(content, cleanNav);
      cleaned++;
    } else if (f.path === bookingHref) {
      content = cleanupImportedHtml(content);
    }
    await db.insert(projectFiles).values({
      projectId: clone.id, path: f.path, content, language: f.language,
    });
  }

  console.log(`Cleaned + unified nav on ${cleaned} pages.`);
  console.log(`\nOPEN (no AI cost):  http://localhost:5173/projects/${clone.id}`);
  console.log(`  single page:      http://localhost:5001/api/projects/${clone.id}/preview-page?page=tarieven.html`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
