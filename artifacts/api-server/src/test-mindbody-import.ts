/** Unit test for the Mindbody CSV parser + status rules (PURE — no DB writes). */
import { parseCsv, pickField, parseDate, computePackStatus, computeMembershipStatus, classifyRow } from "./lib/mindbody-import.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n, extra));

const csv = `First Name,Last Name,Email,Phone,Notes
Lisa,Jansen,lisa@example.com,06 12345678,"VIP, allergy"
Tom,de Vries,tom@example.com,,`;
const rows = parseCsv(csv);
ok("parses rows from header", rows.length === 2 && rows[0]["email"] === "lisa@example.com");
ok("handles quoted field with comma", rows[0]["notes"] === "VIP, allergy");
ok("empty cells are empty strings", rows[1]["phone"] === "" && rows[1]["notes"] === "");

ok("pickField matches alias (lowercased)", pickField(rows[0], ["first name", "voornaam"]) === "Lisa");
ok("pickField contains-fallback", pickField({ "client e-mail address": "x@y.nl" }, ["email"]) === "x@y.nl");
ok("pickField returns '' when missing", pickField(rows[0], ["nonexistent"]) === "");

ok("parseDate yyyy-mm-dd", parseDate("2026-06-30")?.getFullYear() === 2026);
ok("parseDate m/d/yyyy (US)", (() => { const d = parseDate("06/30/2026"); return !!d && d.getMonth() === 5 && d.getDate() === 30; })());
ok("parseDate empty → null", parseDate("") === null);

ok("pack depleted when 0 remaining", computePackStatus(0, parseDate("2099-01-01")) === "depleted");
ok("pack expired when past expiry", computePackStatus(5, parseDate("2020-01-01")) === "expired");
ok("pack active otherwise", computePackStatus(5, parseDate("2099-01-01")) === "active");

ok("membership expired when end passed", computeMembershipStatus(parseDate("2020-01-01")) === "expired");
ok("membership active when end in future / none", computeMembershipStatus(parseDate("2099-01-01")) === "active" && computeMembershipStatus(null) === "active");

// classifyRow: combined ("everything in one file") rows get routed to the right kind.
ok("classify by explicit type column → membership", classifyRow({ "type": "Membership", "name": "Gold" }) === "membership");
ok("classify by explicit type column → class_pack", classifyRow({ "soort": "Strippenkaart", "name": "10-rit" }) === "class_pack");
ok("classify by name (unlimited → membership)", classifyRow({ "pricing option": "Unlimited Monthly" }) === "membership");
ok("classify by name (pack → class_pack)", classifyRow({ "pricing option": "10 Class Pack" }) === "class_pack");
ok("classify by columns (per month → membership)", classifyRow({ "classes per month": "8" }) === "membership");
ok("classify by columns (count → class_pack)", classifyRow({ "sessions remaining": "5" }) === "class_pack");
ok("classify plain customer row → null", classifyRow({ "first name": "Lisa", "email": "l@x.nl" }) === null);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
