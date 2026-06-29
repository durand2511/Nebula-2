/** Unit test for the pure server-side booking rules (no DB). */
import { ymd, membershipExpired, applyMonthlyReset, applyCreditExpiry, creditDecision, isPast, bookTooEarly, bookOpensOn, cancelClosed, purchaseWalletUpdate, addMonths, lotActive, sumActiveCredits, pickLotToConsume, soonestExpiry, type Wallet, type CreditLot } from "./lib/studio-rules.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n));

const W = (o: Partial<Wallet> = {}): Wallet => ({ credits: 0, membership: null, unlimited: false, monthlyLimit: null, monthlyRemaining: null, monthlyPeriod: "2026-06", validUntil: null, creditsUntil: null, needsPayment: false, ...o });

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

// resetMonthly strippenkaart → maandbundel (vervalt elke maand i.p.v. opstapelen)
const rm = purchaseWalletUpdate({ name: "4/maand", type: "strippenkaart", unlimited: false, credits: 4, resetMonthly: true }, 3, "2026-12-19", "2026-06");
ok("resetMonthly strippenkaart → monthlyLimit set, geen opstapeling", rm.monthlyLimit === 4 && rm.monthlyRemaining === 4 && rm.membership === "4/maand");
const rmReset = applyMonthlyReset(W({ membership: "4/maand", monthlyLimit: 4, monthlyRemaining: 1, monthlyPeriod: "2026-05" }), "2026-06");
ok("resetMonthly: ongebruikt tegoed vervalt op nieuwe maand", rmReset.changed === true && rmReset.monthlyRemaining === 4);

// strippenkaart credit-expiry (geldigheidsperiode)
const pkExp = purchaseWalletUpdate({ name: "10-rit", type: "strippenkaart", unlimited: false, credits: 10 }, 0, "2026-09-27", "2026-06");
ok("strippenkaart zet creditsUntil = geldigheidsdatum", pkExp.creditsUntil === "2026-09-27" && pkExp.credits === 10);
ok("credit nog geldig → boekbaar", creditDecision(W({ credits: 5, creditsUntil: "2026-09-27" }), "2026-06-22").type === "credit");
ok("credit verlopen → niet boekbaar", creditDecision(W({ credits: 5, creditsUntil: "2026-05-01" }), "2026-06-22").ok === false);
ok("credit zonder einddatum → nooit verlopen", creditDecision(W({ credits: 5, creditsUntil: null }), "2099-01-01").type === "credit");
const ce = applyCreditExpiry(W({ credits: 5, creditsUntil: "2026-05-01" }), "2026-06-22");
ok("applyCreditExpiry: verlopen credits → 0, datum als tombstone behouden", ce.changed === true && ce.credits === 0 && ce.creditsUntil === "2026-05-01");
// Tombstone-test: een later teruggestorte credit blijft verlopen (geen eeuwige gratis credit)
const refundedAfterExpiry = applyCreditExpiry(W({ credits: 1, creditsUntil: "2026-05-01" }), "2026-06-22");
ok("tombstone: teruggestorte credit na vervaldatum blijft verlopen", refundedAfterExpiry.credits === 0);
const ce2 = applyCreditExpiry(W({ credits: 5, creditsUntil: "2026-12-31" }), "2026-06-22");
ok("applyCreditExpiry: geldige credits ongewijzigd", ce2.changed === false && ce2.credits === 5);
const aboKeepsCredits = purchaseWalletUpdate({ name: "Onbeperkt", type: "abonnement", unlimited: true, credits: null }, 3, "2026-07-22", "2026-06", "2026-08-01");
ok("abonnement laat bestaande creditsUntil ongemoeid", aboKeepsCredits.creditsUntil === "2026-08-01");

// addMonths: vaste looptijd-berekening
ok("addMonths +6", addMonths("2026-06-29", 6) === "2026-12-29");
ok("addMonths +12 (jaar)", addMonths("2026-06-29", 12) === "2027-06-29");
ok("addMonths +24 (2 jaar)", addMonths("2026-06-29", 24) === "2028-06-29");
ok("addMonths clamps 31→eind feb", addMonths("2026-01-31", 1) === "2026-02-28");
ok("addMonths 0 = ongewijzigd", addMonths("2026-06-29", 0) === "2026-06-29");

// credit lots ("potjes"): aparte strippenkaart-batches met eigen vervaldatum
const L = (id: number, credits: number, expiresAt: string): CreditLot => ({ id, credits, expiresAt });
const today2 = "2026-06-22";
ok("lotActive: geldig", lotActive(L(1, 3, "2026-09-01"), today2) === true);
ok("lotActive: verlopen", lotActive(L(1, 3, "2026-05-01"), today2) === false);
ok("lotActive: leeg potje telt niet", lotActive(L(1, 0, "2026-09-01"), today2) === false);
ok("lotActive: lege datum = nooit verloopt", lotActive(L(1, 3, ""), today2) === true);
const lots = [L(1, 3, "2026-09-01"), L(2, 5, "2026-07-01"), L(3, 2, "2026-05-01")];
ok("sumActiveCredits telt alleen geldige potjes (3+5, niet verlopen 2)", sumActiveCredits(lots, today2) === 8);
ok("pickLotToConsume kiest het potje dat het eerst verloopt", pickLotToConsume(lots, today2) === 2);
ok("pickLotToConsume slaat verlopen/lege potjes over", pickLotToConsume([L(3, 2, "2026-05-01"), L(4, 0, "2026-08-01"), L(5, 1, "2026-08-01")], today2) === 5);
ok("pickLotToConsume null als niets beschikbaar", pickLotToConsume([L(3, 2, "2026-05-01")], today2) === null);
ok("pickLotToConsume: nooit-verloopt potje gaat als laatste", pickLotToConsume([L(6, 1, ""), L(7, 1, "2026-08-01")], today2) === 7);
ok("soonestExpiry = eerstvolgende vervaldatum", soonestExpiry(lots, today2) === "2026-07-01");
ok("soonestExpiry negeert lege datums", soonestExpiry([L(6, 1, ""), L(7, 1, "2026-08-01")], today2) === "2026-08-01");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
