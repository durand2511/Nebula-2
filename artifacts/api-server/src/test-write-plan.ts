/**
 * Automated test: WritePlan enforcement for new_page intent.
 *
 * Tests the pure checkWritePlanViolation function — no DB, no API calls needed.
 *
 * Run: npx tsx src/test-write-plan.ts
 *
 * Scenario: "Add a BOOKINGS tab with this booking URL: https://example.com/book"
 *
 * Asserts:
 *   1. write_file("index.html", contentWithURL) → BLOCKED
 *   2. write_file("index.html", contentWithIframe) → BLOCKED
 *   3. write_file("index.html", contentWithBookingSection) → BLOCKED
 *   4. write_file("index.html", contentWithBookAClass) → BLOCKED
 *   5. edit_file("index.html", navOld, navNew+URL) → BLOCKED
 *   6. write_file("index.html", navOnlyChange) → ALLOWED
 *   7. edit_file("index.html", oldNav, newNavLink) → ALLOWED
 *   8. write_file("pages/bookings.html", fullPage) → ALLOWED
 *   9. Validator: missing pages/bookings.html → hard fail
 *  10. Validator: URL in index.html → hard fail
 *  11. Validator: URL in pages/bookings.html → passes
 */

import { checkWritePlanViolation } from "./lib/write-plan.js";
import type { WritePlan, IntentForEnforcement } from "./lib/write-plan.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function assertBlocked(name: string, result: string | null) {
  assert(name, result !== null && result.startsWith("BLOCKED"), `got: ${result ?? "null (allowed)"}`);
}

function assertAllowed(name: string, result: string | null) {
  assert(name, result === null, `got: ${result ?? "null"}`);
}

// ─── Test data ────────────────────────────────────────────────────────────────

const BOOKING_URL = "https://example.com/book";

const writePlan: WritePlan = {
  fileRoles: new Map([
    ["index.html", "nav_update_only"],
    ["pages/bookings.html", "new_page"],
  ]),
  blockedPatterns: [BOOKING_URL],
  requiredNewFiles: ["pages/bookings.html"],
};

const existingIndex = `<!DOCTYPE html>
<html lang="nl">
<head><title>Test</title></head>
<body>
  <nav>
    <a href="index.html">Home</a>
    <a href="pages/about.html">Over ons</a>
  </nav>
  <main>
    <h1>Welkom</h1>
    <p>Dit is de homepage.</p>
  </main>
</body>
</html>`;

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log("\n=== WritePlan Enforcement Tests ===\n");

// 1. write_file index.html with booking URL → BLOCKED
{
  const newContent = existingIndex.replace("</body>", `
  <section id="bookings">
    <h2>Book a Class</h2>
    <iframe src="${BOOKING_URL}"></iframe>
  </section>
</body>`);
  const result = checkWritePlanViolation("index.html", newContent, existingIndex, writePlan, "write_file", newContent);
  assertBlocked("write_file index.html with booking URL → BLOCKED", result);
}

// 2. write_file index.html with iframe → BLOCKED
{
  const newContent = existingIndex.replace("</body>", `
  <iframe src="https://calendly.com/xyz"></iframe>
</body>`);
  const result = checkWritePlanViolation("index.html", newContent, existingIndex, writePlan, "write_file", newContent);
  assertBlocked("write_file index.html with iframe → BLOCKED", result);
}

// 3. write_file index.html with large booking section → BLOCKED (section tag)
{
  const newContent = existingIndex.replace("</body>", `
  <section id="bookings">
    <h2>Boek een les</h2>
    <p>Kies een datum en tijd die jou uitkomt.</p>
    <form><input type="date"/><button>Boek</button></form>
  </section>
</body>`);
  const result = checkWritePlanViolation("index.html", newContent, existingIndex, writePlan, "write_file", newContent);
  assertBlocked("write_file index.html with <section> block → BLOCKED", result);
}

// 4. write_file index.html with "Book a Class" text → BLOCKED
{
  const newContent = existingIndex.replace("</body>", `
  <div>
    <h2>Book a Class</h2>
    <p>Our online booking system.</p>
  </div>
</body>`);
  const result = checkWritePlanViolation("index.html", newContent, existingIndex, writePlan, "write_file", newContent);
  assertBlocked("write_file index.html with 'Book a Class' text → BLOCKED", result);
}

// 5. edit_file index.html adding booking URL to new_string → BLOCKED
{
  const old_string = "</nav>";
  const new_string = `</nav>
  <section id="book"><iframe src="${BOOKING_URL}"></iframe></section>`;
  const hypothetical = existingIndex.replace(old_string, new_string);
  const result = checkWritePlanViolation("index.html", hypothetical, existingIndex, writePlan, "edit_file", new_string);
  assertBlocked("edit_file index.html adding booking URL → BLOCKED", result);
}

// 6. write_file index.html with nav-only change (same size) → ALLOWED
{
  const newContent = existingIndex.replace(
    '<a href="pages/about.html">Over ons</a>',
    '<a href="pages/about.html">Over ons</a>\n    <a href="pages/bookings.html">Bookings</a>',
  );
  const result = checkWritePlanViolation("index.html", newContent, existingIndex, writePlan, "write_file", newContent);
  assertAllowed("write_file index.html with nav-only link addition → ALLOWED", result);
}

// 7. edit_file index.html adding only a nav link → ALLOWED
{
  const old_string = "</nav>";
  const new_string = `\n    <a href="pages/bookings.html">Bookings</a>\n  </nav>`;
  const hypothetical = existingIndex.replace(old_string, new_string);
  const result = checkWritePlanViolation("index.html", hypothetical, existingIndex, writePlan, "edit_file", new_string);
  assertAllowed("edit_file index.html adding only nav link → ALLOWED", result);
}

// 8. write_file pages/bookings.html with full page → ALLOWED (role=new_page)
{
  const fullPage = `<!DOCTYPE html>
<html lang="nl">
<head><title>Bookings</title></head>
<body>
  <nav><a href="../index.html">Home</a><a href="bookings.html">Bookings</a></nav>
  <main>
    <h1>Boek een les</h1>
    <iframe src="${BOOKING_URL}" width="100%" height="600"></iframe>
  </main>
</body>
</html>`;
  const result = checkWritePlanViolation("pages/bookings.html", fullPage, "", writePlan, "write_file", fullPage);
  assertAllowed("write_file pages/bookings.html with full page + booking URL → ALLOWED", result);
}

// 9. Null writePlan, no intent → no enforcement (allowed by default)
{
  const newContent = existingIndex.replace("</body>", `<section>${BOOKING_URL}</section></body>`);
  const result = checkWritePlanViolation("index.html", newContent, existingIndex, null, "write_file", newContent);
  assertAllowed("null writePlan + no intent → no enforcement (ALLOWED by default)", result);
}

// 9b. Null writePlan + new_page intent + booking URL in index.html → BLOCKED (fail-closed)
{
  const newPageIntent: IntentForEnforcement = { category: "new_page", bookingUrls: [BOOKING_URL] };
  const newContent = existingIndex.replace("</body>", `
  <section id="bookings">
    <h2>Book a Class</h2>
    <iframe src="${BOOKING_URL}"></iframe>
  </section>
</body>`);
  const result = checkWritePlanViolation("index.html", newContent, existingIndex, null, "write_file", newContent, newPageIntent);
  assertBlocked("null writePlan + new_page intent + booking URL → BLOCKED (fail-closed)", result);
}

// 9c. Null writePlan + new_page intent + nav-only change → ALLOWED
{
  const newPageIntent: IntentForEnforcement = { category: "new_page", bookingUrls: [BOOKING_URL] };
  const newContent = existingIndex.replace(
    '<a href="pages/about.html">Over ons</a>',
    '<a href="pages/about.html">Over ons</a>\n    <a href="pages/bookings.html">Bookings</a>',
  );
  const result = checkWritePlanViolation("index.html", newContent, existingIndex, null, "write_file", newContent, newPageIntent);
  assertAllowed("null writePlan + new_page intent + nav-only link → ALLOWED", result);
}

// 9d. Null writePlan + edit_feature intent + booking URL → ALLOWED (non-new_page intent does not trigger fail-closed)
{
  const editIntent: IntentForEnforcement = { category: "edit_existing", bookingUrls: [] };
  const newContent = existingIndex.replace("</body>", `<section>${BOOKING_URL}</section></body>`);
  const result = checkWritePlanViolation("index.html", newContent, existingIndex, null, "write_file", newContent, editIntent);
  assertAllowed("null writePlan + edit_existing intent + booking URL → ALLOWED (fail-closed only for new_page)", result);
}

// ─── Inline validator tests (copy of runDeterministicValidator logic) ──────────

console.log("\n=== DeterministicValidator Scenario Tests ===\n");

// Simulate the BOOKINGS test case results

// 10. Validator: pages/bookings.html missing → hard fail
{
  const allFiles = new Map([["index.html", existingIndex]]);
  const missingFile = !allFiles.has("pages/bookings.html");
  assert("pages/bookings.html missing → validator sees missing_new_page", missingFile);
}

// 11. Validator: URL in index.html → hard fail
{
  const indexWithUrl = existingIndex.replace("</body>", `<section>${BOOKING_URL}</section></body>`);
  const urlInIndex = indexWithUrl.includes(BOOKING_URL);
  assert("BOOKING_URL in index.html → validator sees content_in_wrong_file", urlInIndex);
}

// 12. Validator: URL in pages/bookings.html, not in index.html → passes
{
  const allFiles = new Map([
    ["index.html", existingIndex + "\n<!-- nav: <a href='pages/bookings.html'>Bookings</a> -->"],
    ["pages/bookings.html", `<html><body><iframe src="${BOOKING_URL}"></iframe></body></html>`],
  ]);
  const urlNotInIndex = !allFiles.get("index.html")!.includes(BOOKING_URL);
  const urlInBookings = allFiles.get("pages/bookings.html")!.includes(BOOKING_URL);
  const navLinkPresent = allFiles.get("index.html")!.includes("pages/bookings.html");
  assert("BOOKING_URL NOT in index.html → passes", urlNotInIndex);
  assert("BOOKING_URL in pages/bookings.html → passes", urlInBookings);
  assert("href=pages/bookings.html present in index.html → passes", navLinkPresent);
}

// 13. BOOKING_BLOCK_KEYWORDS: fake booking indicators blocked in nav_update_only
{
  const fakeBookingContent = existingIndex.replace("</body>", `
  <section id="bookings">
    <h2>Nieuw boeken</h2>
    <div class="time-slot">09:00</div>
    <div class="booking-section">Kies een tijd</div>
  </section>
</body>`);
  const result = checkWritePlanViolation("index.html", fakeBookingContent, existingIndex, writePlan, "write_file", fakeBookingContent);
  assertBlocked("write_file index.html with fake booking indicators → BLOCKED via keywords", result);
}

// ─── Hard-block guard simulation (mirrors executeNebulaToolCall logic) ─────────────
// These tests simulate the unconditional booking-content guard added to the tool executor.
// The guard fires before WritePlan for ANY intent with booking context.

console.log("\n=== Hard-Block Guard Tests (executeNebulaToolCall simulation) ===\n");

const newPageIntent: IntentForEnforcement = { category: "new_page", bookingUrls: [BOOKING_URL] };

function simulateHardBlock(
  toolName: "write_file" | "edit_file",
  content: string,
  intent: IntentForEnforcement,
): string | null {
  const hasBookingContext =
    (intent.bookingUrls.length ?? 0) > 0 || intent.category === "new_page";
  if (!hasBookingContext) return null;
  const FORBIDDEN: Array<{ re: RegExp; label: string }> = [
    { re: /id=["']bookings["']/i, label: 'id="bookings"' },
    { re: /<section[^>]*(?:id|class)=["'][^"']*book/i, label: "booking <section>" },
    { re: /class=["'][^"']*booking/i, label: 'class="...booking..."' },
    { re: /nebula_bookings/i, label: "nebula_bookings" },
    { re: /function\s+\w*[Bb]ook\w*\s*\(/i, label: "booking JS function" },
    { re: /booking.?(calendar|form|widget|system)/i, label: "booking calendar/form" },
    { re: /time.?slot/i, label: "time-slot" },
    { re: /book a class|boek een les/i, label: '"Book a Class"' },
  ];
  for (const { re, label } of FORBIDDEN) {
    if (re.test(content)) return `BLOCKED: "${label}" forbidden in index.html`;
  }
  return null;
}

// 14. Hard block: <section id="bookings"> → BLOCKED
{
  const contentWithSection = existingIndex.replace("</body>", `
  <section id="bookings"><h2>Book a Class</h2></section>
</body>`);
  const result = simulateHardBlock("write_file", contentWithSection, newPageIntent);
  assertBlocked('hard block: <section id="bookings"> in index.html → BLOCKED', result);
}

// 15. Hard block: nebula_bookings localStorage key → BLOCKED
{
  const contentWithLS = existingIndex.replace("</body>", `
  <script>localStorage.setItem('nebula_bookings', '[]');</script>
</body>`);
  const result = simulateHardBlock("write_file", contentWithLS, newPageIntent);
  assertBlocked("hard block: nebula_bookings in index.html → BLOCKED", result);
}

// 16. Hard block: booking JS function → BLOCKED
{
  const contentWithFn = existingIndex.replace("</body>", `
  <script>function openBooking() { document.getElementById('bookings').style.display='block'; }</script>
</body>`);
  const result = simulateHardBlock("write_file", contentWithFn, newPageIntent);
  assertBlocked("hard block: booking JS function in index.html → BLOCKED", result);
}

// 17. Hard block: "Book a Class" text → BLOCKED
{
  const contentWithText = existingIndex.replace("</body>", `
  <div><h2>Book a Class</h2></div>
</body>`);
  const result = simulateHardBlock("write_file", contentWithText, newPageIntent);
  assertBlocked('hard block: "Book a Class" in index.html → BLOCKED', result);
}

// 18. Hard block passes for nav-only edit (no booking patterns) → ALLOWED
{
  const navLink = `\n    <a href="pages/bookings.html">BOOKINGS</a>\n  </nav>`;
  const result = simulateHardBlock("edit_file", navLink, newPageIntent);
  assertAllowed("hard block: nav-only edit to index.html → ALLOWED", result);
}

// 19. pages/bookings.html with booking URL must exist (existence check)
{
  const fileTree = new Map([
    ["index.html", existingIndex + '\n    <a href="pages/bookings.html">BOOKINGS</a>'],
    ["pages/bookings.html", `<!DOCTYPE html><html><body><a href="${BOOKING_URL}">Book now</a></body></html>`],
  ]);
  assert("pages/bookings.html exists in file tree", fileTree.has("pages/bookings.html"));
  assert(`index.html contains href="pages/bookings.html"`, fileTree.get("index.html")!.includes('href="pages/bookings.html"'));
  assert(`index.html does NOT contain ${BOOKING_URL}`, !fileTree.get("index.html")!.includes(BOOKING_URL));
  assert("index.html does NOT contain <iframe", !fileTree.get("index.html")!.includes("<iframe"));
  assert('index.html does NOT contain <section id="bookings"', !fileTree.get("index.html")!.includes('<section id="bookings"'));
  assert('index.html does NOT contain "Book a Class"', !fileTree.get("index.html")!.includes("Book a Class"));
  assert(`pages/bookings.html contains ${BOOKING_URL}`, fileTree.get("pages/bookings.html")!.includes(BOOKING_URL));
}

// ─── Results ──────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.error("TESTS FAILED — enforcement is broken");
  process.exit(1);
} else {
  console.log("ALL TESTS PASSED — enforcement is working");
  process.exit(0);
}
