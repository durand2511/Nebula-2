/** Unit test for the pure server-side booking rules (no DB). */
import { ymd, membershipExpired, applyMonthlyReset, creditDecision, isPast, bookTooEarly, bookOpensOn, cancelClosed, purchaseWalletUpdate, type Wallet } from "./lib/studio-rules.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n));

const W = (o: Partial<Wallet> = {}): Wallet => ({ credits: 0, membership: null, unlimited: false, monthlyLimit: null, monthlyRemaining: null, monthlyPeriod: "2026-06", validUntil: null, needsPayment: false, ...o });

// credit decision
ok("credit: uses a strippenkaart credit", creditDecision(W({ credits: 3 }), "2026-06-22").type === "credit");
ok("credit: unlimited membership ok, no type credit", creditDecision(W({ membership: "Onbeperkt", unlimited: true }), "2026-06-22").type === "unlimited");
ok("credit: monthly with remaining ok", creditDecision(W({ membership: "8/maand", monthlyLimit: 8, monthlyRemaining: 2 }), "2026-06-22").type === "monthly");
ok("credit: monthly empty blocked", creditDecision(W({ membership: "8/maand", monthlyLimit: 8, monthlyRemaining: 0 }), "2026-06-22").ok === false);
ok("credit: expired membership blocked", creditDecision(W({ membership: "X", validUntil: "2020-01-01" }), "2026-06-22").ok === false);
ok("credit: needsPayment blocked", creditDecision(W({ membership: "X", needsPayment: true }), "2026-06-22").ok === false);
ok("credit: nothing → blocked", creditDecision(W(), "2026-06-22").ok === false);

// monthly reset
const r1 = applyMonthlyReset(W({ monthlyLimit: 8, monthlyRemaining: 1, monthlyPeriod: "2026-05" }), "2026-06");
ok("monthly reset refills on new month", r1.changed === true && r1.monthlyRemaining === 8 && r1.monthlyPeriod === "2026-06");
const r2 = applyMonthlyReset(W({ monthlyLimit: 8, monthlyRemaining: 1, monthlyPeriod: "2026-06" }), "2026-06");
ok("monthly: no reset within same month", r2.changed === false && r2.monthlyRemaining === 1);

// time windows (use fixed 'now')
const now = new Date("2026-06-22T12:00:00").getTime();
ok("isPast true for yesterday", isPast("2026-06-21", "09:00", now) === true);
ok("isPast false for tomorrow", isPast("2026-06-23", "09:00", now) === false);
ok("bookTooEarly: 7-day window, lesson 20 days out → too early", bookTooEarly(7, "2026-07-12", "09:00", now) === true);
ok("bookTooEarly: 7-day window, lesson 3 days out → ok", bookTooEarly(7, "2026-06-25", "09:00", now) === false);
ok("bookTooEarly: 0 = no limit", bookTooEarly(0, "2027-01-01", "09:00", now) === false);
ok("bookOpensOn computes the open date", bookOpensOn(7, "2026-07-12", "09:00") === "2026-07-05");
ok("cancelClosed: 12h deadline, lesson in 2h → closed", cancelClosed(12, "2026-06-22", "14:00", now) === true);
ok("cancelClosed: 12h deadline, lesson in 24h → open", cancelClosed(12, "2026-06-23", "12:00", now) === false);
ok("cancelClosed: 0 = always open", cancelClosed(0, "2026-06-22", "12:01", now) === false);
ok("membershipExpired true when past", membershipExpired("2026-06-21", "2026-06-22") === true);

// purchaseWalletUpdate: how a paid purchase changes the wallet
const pk = purchaseWalletUpdate({ name: "10-rit", type: "strippenkaart", unlimited: false, credits: 10 }, 2, "2026-12-19", "2026-06");
ok("strippenkaart adds credits to existing", pk.credits === 12 && pk.membership === null && pk.monthlyLimit === null);
const un = purchaseWalletUpdate({ name: "Onbeperkt", type: "abonnement", unlimited: true, credits: null }, 0, "2026-07-22", "2026-06");
ok("unlimited abonnement → membership, no monthly", un.unlimited === true && un.membership === "Onbeperkt" && un.monthlyLimit === null && un.needsPayment === false);
const mo = purchaseWalletUpdate({ name: "8/maand", type: "abonnement", unlimited: false, credits: 8 }, 0, "2026-07-22", "2026-06");
ok("monthly abonnement → monthlyLimit/Remaining set", mo.monthlyLimit === 8 && mo.monthlyRemaining === 8 && mo.monthlyPeriod === "2026-06" && mo.membership === "8/maand");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
