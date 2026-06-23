/** Unit test for the branded e-mail templates (buildEmail). PURE — no DB, no network. */
import { buildEmail } from "./lib/email.js";
import { defaultBrand } from "./lib/email-brand-copy.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n, extra));

const brand = { studio: "Yoga Studio Rotterdam", logo: "https://x.nl/logo.png", accent: "#7a00df", copy: defaultBrand("Yoga Studio Rotterdam").copy };

const booking = buildEmail("booking", { name: "Sam", classTitle: "Vinyasa", date: "2026-06-23", time: "09:00" }, brand);
ok("booking: subject + studio name + logo + class + readable date", booking.subject.includes("Vinyasa") && booking.html.includes("Yoga Studio Rotterdam") && booking.html.includes("https://x.nl/logo.png") && booking.html.includes("Vinyasa") && booking.html.includes("23 juni 2026"));
ok("uses the accent colour in the header", booking.html.includes("#7a00df"));
ok("bigger, friendlier body text (>=17px)", /font-size:1[789]px|font-size:2[0-9]px/.test(booking.html));

const welcome = buildEmail("welcome", { name: "Sam" }, brand);
ok("welcome: branded + greets by name", welcome.subject.includes("Yoga Studio Rotterdam") && welcome.html.includes("Hoi Sam"));

const reset = buildEmail("reset", { name: "Sam", password: "abcd1234" }, brand);
ok("reset: shows the new password prominently", reset.html.includes("abcd1234"));

const test = buildEmail("test", {}, brand);
ok("test mail is branded", test.html.includes("Yoga Studio Rotterdam") && /Test geslaagd/.test(test.html));

// Deliverability: a plain-text alternative + studio display name (avoids spam).
ok("has a plain-text alternative (multipart-ready)", booking.text.length > 20 && booking.text.includes("Vinyasa") && !booking.text.includes("<"));
ok("fromName is the studio (nice sender name)", booking.fromName === "Yoga Studio Rotterdam" && welcome.fromName === "Yoga Studio Rotterdam");

// No brand passed → still renders nicely with the studio from data + default copy (no logo).
const noBrand = buildEmail("booking", { studio: "Studio X", classTitle: "Les", date: "2026-07-01" });
ok("falls back to a default brand when none stored", noBrand.html.includes("Studio X") && !noBrand.html.includes("<img"));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
