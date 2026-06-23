/**
 * PURE e-mail branding types + default copy (no DB, no AI, no logger) — safe to import anywhere,
 * including the e-mail templates. The heavy generate/load logic lives in lib/email-brand.ts.
 */
export type BrandCopy = { heading: string; intro: string; outro: string };
export type EmailBrand = {
  studio: string; logo: string; accent: string;
  copy: Record<string, BrandCopy>;
};

export const BRAND_KINDS = ["booking", "cancel", "welcome", "reset", "reminder"] as const;

/** Warm, friendly default copy (also the fallback when AI is unavailable) — studio name woven in. */
export function fallbackCopy(studio: string): Record<string, BrandCopy> {
  const s = studio || "onze studio";
  return {
    booking: { heading: "Je boeking is bevestigd 🎉", intro: `Wat fijn dat je erbij bent! We hebben je plekje bij ${s} voor je gereserveerd.`, outro: "We kijken ernaar uit je te zien. Tot snel!" },
    cancel: { heading: "Je boeking is geannuleerd", intro: `Je boeking bij ${s} is geannuleerd. Geen zorgen — je bent altijd weer welkom.`, outro: "Tot een volgende keer!" },
    welcome: { heading: `Welkom bij ${s}! 💜`, intro: `Wat leuk dat je er bent! Je account is aangemaakt en je kunt meteen je eerste les boeken.`, outro: "We kijken ernaar uit je te ontmoeten." },
    reset: { heading: "Je nieuwe wachtwoord", intro: `Je hebt een nieuw wachtwoord aangevraagd voor je account bij ${s}.`, outro: "Je kunt het hierna altijd weer wijzigen." },
    reminder: { heading: "Tot morgen! ⏰", intro: `Een vriendelijke herinnering aan je les bij ${s} — morgen is het zover.`, outro: "We zien je graag. Tot dan!" },
    promoted: { heading: "Goed nieuws — je hebt een plek! 🎉", intro: `Er is een plek vrijgekomen en je staat niet langer op de wachtlijst: je bent nu definitief geboekt bij ${s}.`, outro: "Tot snel!" },
  };
}

/** A brand with no logo + default copy — used when a project has no stored brand yet. */
export function defaultBrand(studio: string): EmailBrand {
  const s = studio || "onze studio";
  return { studio: s, logo: "", accent: "#7a00df", copy: fallbackCopy(s) };
}
