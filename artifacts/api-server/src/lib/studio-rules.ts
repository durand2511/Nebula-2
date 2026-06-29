/**
 * Pure booking rules (no DB) — the server-side equivalent of the booking-app's localStorage logic.
 * Kept pure so they're unit-testable: credit/membership eligibility, monthly reset, booking window,
 * cancellation deadline. The DB layer (routes/studio.ts) calls these and persists the result.
 */
export type Wallet = {
  credits: number;
  membership: string | null;
  unlimited: boolean;
  monthlyLimit: number | null;
  monthlyRemaining: number | null;
  monthlyPeriod: string;       // YYYY-MM
  validUntil: string | null;   // yyyy-mm-dd (abonnement)
  creditsUntil: string | null; // yyyy-mm-dd: strippenkaart-credits vervallen hierna (null = nooit)
  needsPayment: boolean;
};

export function ymd(d: Date): string {
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

export function membershipExpired(validUntil: string | null, todayYmd: string): boolean {
  return !!(validUntil && validUntil < todayYmd);
}

/** Returns the monthly fields after applying a reset if the stored period is not the current month. */
export function applyMonthlyReset(w: Wallet, nowMonth: string): { monthlyRemaining: number | null; monthlyPeriod: string; changed: boolean } {
  if (w.monthlyLimit == null) return { monthlyRemaining: w.monthlyRemaining, monthlyPeriod: w.monthlyPeriod, changed: false };
  if (w.monthlyPeriod !== nowMonth) return { monthlyRemaining: w.monthlyLimit, monthlyPeriod: nowMonth, changed: true };
  return { monthlyRemaining: w.monthlyRemaining, monthlyPeriod: w.monthlyPeriod, changed: false };
}

export type CreditDecision = { ok: boolean; type?: "credit" | "monthly" | "unlimited"; reason?: string };

/** Returns the credits after expiry: a strippenkaart whose creditsUntil has passed drops to 0. */
export function applyCreditExpiry(w: Wallet, todayYmd: string): { credits: number; creditsUntil: string | null; changed: boolean } {
  if ((w.credits || 0) > 0 && w.creditsUntil && w.creditsUntil < todayYmd) return { credits: 0, creditsUntil: null, changed: true };
  return { credits: w.credits, creditsUntil: w.creditsUntil, changed: false };
}

/** What can this wallet use to book? Assumes the monthly period + credit expiry are reset for today. */
export function creditDecision(w: Wallet, todayYmd: string): CreditDecision {
  // Strippenkaart-credits gelden alleen binnen hun geldigheidsperiode; verlopen credits tellen niet mee.
  if ((w.credits || 0) > 0 && !(w.creditsUntil && w.creditsUntil < todayYmd)) return { ok: true, type: "credit" };
  if (w.membership) {
    if (membershipExpired(w.validUntil, todayYmd)) return { ok: false, reason: "Je abonnement is verlopen. Verleng het of betaal met Stripe." };
    if (w.needsPayment) return { ok: false, reason: "Je abonnement heeft nog geen betaalmethode. Neem contact op met de studio om je betaling te koppelen." };
    if (w.monthlyLimit != null) {
      if ((w.monthlyRemaining || 0) > 0) return { ok: true, type: "monthly" };
      return { ok: false, reason: "Je maandtegoed is op. Volgende maand heb je weer " + w.monthlyLimit + " lessen." };
    }
    return { ok: true, type: "unlimited" };
  }
  return { ok: false, reason: "Je hebt geen tegoed: geen strippenkaart-credits en geen lopend abonnement. Koop er een of betaal met Stripe." };
}

// What a paid purchase does to the wallet. Strippenkaart adds credits; an unlimited abonnement sets
// an unlimited membership; an "X per maand" abonnement sets a monthly allotment. When the plan has
// resetMonthly, the credits become a monthly allotment too (leftovers expire each month via
// applyMonthlyReset → no pile-up if the customer doesn't show). Pure → unit-tested.
export type PurchaseMember = { name: string; type: string; unlimited: boolean; credits: number | null; resetMonthly?: boolean };
export type WalletUpdate = { credits: number; membership: string | null; unlimited: boolean; monthlyLimit: number | null; monthlyRemaining: number | null; monthlyPeriod: string; validUntil: string; creditsUntil: string | null; needsPayment: boolean };
export function purchaseWalletUpdate(m: PurchaseMember, existingCredits: number, validUntil: string, nowMonth: string, existingCreditsUntil: string | null = null): WalletUpdate {
  if (m.type === "abonnement") {
    if (m.unlimited) return { credits: existingCredits, membership: m.name, unlimited: true, monthlyLimit: null, monthlyRemaining: null, monthlyPeriod: nowMonth, validUntil, creditsUntil: existingCreditsUntil, needsPayment: false };
    const lim = m.credits || 0;
    return { credits: existingCredits, membership: m.name, unlimited: false, monthlyLimit: lim, monthlyRemaining: lim, monthlyPeriod: nowMonth, validUntil, creditsUntil: existingCreditsUntil, needsPayment: false };
  }
  // Strippenkaart met "tegoed vervalt elke maand" → maandbundel i.p.v. opstapelende credits.
  if (m.resetMonthly && (m.credits || 0) > 0) {
    const lim = m.credits || 0;
    return { credits: existingCredits, membership: m.name, unlimited: false, monthlyLimit: lim, monthlyRemaining: lim, monthlyPeriod: nowMonth, validUntil, creditsUntil: existingCreditsUntil, needsPayment: false };
  }
  // Gewone strippenkaart: credits stapelen op; ze vervallen op de gekozen geldigheidsdatum (validUntil).
  return { credits: existingCredits + (m.credits || 0), membership: null, unlimited: false, monthlyLimit: null, monthlyRemaining: null, monthlyPeriod: nowMonth, validUntil, creditsUntil: validUntil, needsPayment: false };
}

/** Add whole months to a yyyy-mm-dd date (clamps day to month length). Used for fixed-term contracts. */
export function addMonths(ymdStr: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdStr || "");
  if (!m || !months) return ymdStr;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  const target = new Date(Date.UTC(y, mo + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return ymd(target);
}

function lessonStartMs(date: string, time: string): number {
  return new Date((date || "") + "T" + (time || "00:00") + ":00").getTime();
}

export function isPast(date: string, time: string, nowMs: number): boolean {
  const t = lessonStartMs(date, time);
  return !isNaN(t) && t < nowMs;
}

/** Booking window: bookDays = how many days before the lesson booking opens (0 = no limit). */
export function bookTooEarly(bookDays: number, date: string, time: string, nowMs: number): boolean {
  if (!bookDays || bookDays <= 0) return false;
  const t = lessonStartMs(date, time);
  return !isNaN(t) && nowMs < t - bookDays * 86400000;
}

export function bookOpensOn(bookDays: number, date: string, time: string): string {
  if (!bookDays || bookDays <= 0) return "";
  const t = lessonStartMs(date, time);
  return isNaN(t) ? "" : ymd(new Date(t - bookDays * 86400000));
}

/** Cancellation deadline: cancelHours = until how many hours before start you may cancel (0 = always). */
export function cancelClosed(cancelHours: number, date: string, time: string, nowMs: number): boolean {
  if (!cancelHours || cancelHours <= 0) return false;
  const t = lessonStartMs(date, time);
  return !isNaN(t) && nowMs > t - cancelHours * 3600000;
}
