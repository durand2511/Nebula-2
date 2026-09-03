import { useState } from "react";
import { useLocation } from "wouter";
import { Check, Minus, ArrowRight } from "lucide-react";
import logoUrl from "../assets/nebula-logo-home.png";
import { useLang } from "@/lib/i18n";

export function Home() {
  const { t, lang } = useLang();
  const [, setLocation] = useLocation();
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  // Subtle callback line under the tagline: leave a phone number → POST /api/contact e-mails the
  // owner (existing endpoint), who calls back for a briefing/chat.
  const submit = async () => {
    if (state === "busy" || phone.replace(/\D/g, "").length < 6) { setState("error"); return; }
    setState("busy");
    try {
      const r = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, note: lang === "en" ? "Briefing/gesprek met de eigenaar (via homepagina, ENGELSE versie — bel in het Engels)" : "Briefing/gesprek met de eigenaar (via homepagina, Nederlandse versie)" }) });
      setState(r.ok ? "done" : "error");
      if (r.ok) setPhone("");
    } catch { setState("error"); }
  };

  const bureau = [
    t("€2.000–5.000+ vooraf betalen", "€2,000–5,000+ up front"),
    t("Mailen en wachten voor elke tekstwijziging", "E-mail and wait for every text change"),
    t("Los onderhoudscontract per maand", "A separate maintenance contract each month"),
    t("SEO, hosting en boekingen kosten extra", "SEO, hosting and bookings cost extra"),
    t("Je blijft afhankelijk van het bureau", "You stay dependent on the agency"),
  ];
  const nebula = [
    t("€50 per maand, maandelijks opzegbaar", "€50 per month, cancel monthly"),
    t("Zelf aanpassen door te typen — direct live", "Edit it yourself by typing — instantly live"),
    t("Boekingssysteem, eigen domein en SSL inbegrepen", "Booking system, own domain and SSL included"),
    t("Automatische SEO die elke dag voor je schrijft", "Automatic SEO that writes for you every day"),
    t("Jij bent eigenaar van je site — altijd", "You own your site — always"),
  ];
  const included = [
    t("Onbeperkt bewerken met Claude Code", "Unlimited editing with Claude Code"),
    t("Boekingssysteem met iDEAL-betalingen", "Booking system with iDEAL payments"),
    t("Je eigen domein met gratis SSL", "Your own domain with free SSL"),
    t("Automatische SEO & vindbaarheid in Google", "Automatic SEO & Google visibility"),
    t("Hosting inbegrepen — niks extra's", "Hosting included — nothing extra"),
  ];

  return (
    <div className="flex-1 w-full flex flex-col items-center">
      {/* Hero */}
      <section className="min-h-[calc(100vh-5rem)] w-full flex flex-col items-center justify-center px-4 gap-9 py-12">
        <img src={logoUrl} alt="Nebula" className="h-56 md:h-80 w-auto" />
        <p className="text-sm md:text-base uppercase tracking-[0.25em] text-muted-foreground text-center">
          {t("Web design bureau", "Web design bureau")}
        </p>

        <div className="flex flex-col items-center gap-2 -mt-3">
          {state === "done" ? (
            <p className="text-xs text-emerald-700/90" data-testid="text-callback-done">
              {t("Dankjewel — je wordt snel gebeld voor een gesprek.", "Thank you — you'll get a call soon.")}
            </p>
          ) : (
            <>
              <p className="text-xs text-foreground/45">
                {t("Liever eerst een gesprek? Laat je nummer achter en de eigenaar belt je.", "Prefer a chat first? Leave your number and the owner will call you.")}
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); if (state === "error") setState("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                  placeholder={t("06 12345678", "+31 6 12345678")}
                  className="h-8 w-44 rounded-full border border-border/70 bg-card/70 backdrop-blur px-3.5 text-xs text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-foreground/30"
                  data-testid="input-callback-phone"
                />
                <button
                  onClick={() => void submit()}
                  disabled={state === "busy"}
                  className="h-8 rounded-full bg-foreground/85 px-3.5 text-xs font-medium text-background hover:bg-foreground transition-colors disabled:opacity-60"
                  data-testid="button-callback"
                >
                  {state === "busy" ? "…" : t("Bel mij", "Call me")}
                </button>
              </div>
              {state === "error" && <p className="text-[11px] text-destructive/80">{t("Vul een geldig telefoonnummer in.", "Please enter a valid phone number.")}</p>}
            </>
          )}
          <button
            onClick={() => setLocation("/ai-editor")}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background shadow-lg shadow-black/10 hover:-translate-y-0.5 transition-transform"
            data-testid="button-hero-start"
          >
            {t("Begin met je website", "Start your website")} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* Manifesto */}
      <section className="w-full max-w-3xl px-6 py-16 text-center">
        <h2 className="text-3xl md:text-[2.7rem] font-bold tracking-tight leading-[1.1] text-balance">
          {t("Geen bureau dat je laat wachten.", "Not an agency that keeps you waiting.")}<br />
          <span className="text-foreground/55">{t("Een platform waar jij de baas bent.", "A platform where you're in charge.")}</span>
        </h2>
        <p className="mt-6 text-[17px] leading-relaxed text-muted-foreground max-w-2xl mx-auto">
          {t(
            "Nebula bouwt je professionele website — en daarna bewerk je alles zelf door gewoon te typen wat er anders moet. Geen dure offertes, geen wachten op een developer. Inclusief boekingssysteem, eigen domein en automatische SEO. Voor één vast bedrag per maand.",
            "Nebula builds your professional website — then you edit everything yourself by simply typing what should change. No expensive quotes, no waiting on a developer. Booking system, own domain and automatic SEO included. For one fixed monthly price.",
          )}
        </p>
      </section>

      {/* Comparison */}
      <section className="w-full max-w-4xl px-4 pb-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/50 bg-card/70 backdrop-blur p-7 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
            <h3 className="text-lg font-semibold text-foreground/70">{t("Een webdesign bureau", "A web design agency")}</h3>
            <ul className="mt-5 space-y-3.5">
              {bureau.map((line) => (
                <li key={line} className="flex gap-3 text-[15px] text-muted-foreground">
                  <Minus className="h-4 w-4 mt-1 shrink-0 text-foreground/30" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-[#e0855b]/30 bg-card/90 backdrop-blur p-7 shadow-[0_14px_44px_rgba(0,0,0,0.12)] ring-1 ring-[#e0855b]/15">
            <h3 className="text-lg font-semibold text-foreground">Nebula</h3>
            <ul className="mt-5 space-y-3.5">
              {nebula.map((line) => (
                <li key={line} className="flex gap-3 text-[15px] text-foreground">
                  <Check className="h-4 w-4 mt-1 shrink-0 text-[#d1673a]" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="w-full max-w-md px-4 py-16">
        <div className="rounded-3xl border border-white/60 bg-card/90 backdrop-blur p-8 text-center shadow-[0_16px_50px_rgba(0,0,0,0.14)]">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">{t("Volledige toegang", "Full access")}</p>
          <div className="mt-3 flex items-end justify-center gap-1">
            <span className="text-6xl font-extrabold tracking-tight text-foreground">€50</span>
            <span className="mb-2 text-base font-medium text-muted-foreground">{t("/maand", "/month")}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("Maandelijks opzegbaar. Geen verrassingen.", "Cancel monthly. No surprises.")}</p>
          <ul className="mt-6 space-y-3 text-left">
            {included.map((line) => (
              <li key={line} className="flex gap-3 text-[15px] text-foreground">
                <Check className="h-4 w-4 mt-1 shrink-0 text-[#d1673a]" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => setLocation("/ai-editor")}
            className="mt-7 w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-6 py-3.5 text-sm font-semibold text-background hover:-translate-y-0.5 transition-transform"
            data-testid="button-pricing-start"
          >
            {t("Begin nu", "Start now")} <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-3 text-[11px] text-muted-foreground">{t("Het bewerken werkt op je eigen Claude-abonnement.", "Editing runs on your own Claude subscription.")}</p>
        </div>
      </section>
    </div>
  );
}
