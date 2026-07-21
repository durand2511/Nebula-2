import { useState, type FormEvent } from "react";
import logoUrl from "../assets/nebula-logo-home.png";
import whereStarsUrl from "../assets/where-stars.png";

function ContactForm() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (phone.replace(/\D/g, "").length < 6) {
      setError("Vul een geldig telefoonnummer in.");
      setStatus("error");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      const r = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) setStatus("done");
      else {
        setStatus("error");
        setError(d.error || "Er ging iets mis. Probeer het opnieuw.");
      }
    } catch {
      setStatus("error");
      setError("Er ging iets mis. Probeer het opnieuw.");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/50 p-6 text-center">
        <div className="text-lg font-semibold text-foreground">Bedankt! 🎉</div>
        <p className="text-sm text-muted-foreground mt-1">
          We hebben je nummer ontvangen en nemen snel contact met je op.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border/60 bg-card/50 p-6 text-left space-y-4">
      <div>
        <div className="text-lg font-semibold text-foreground">Interesse? Laat je nummer achter.</div>
        <p className="text-sm text-muted-foreground mt-1">
          Vul je telefoonnummer in, dan bellen we je terug om je studio online te zetten.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Je naam (optioneel)"
          className="rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          required
          placeholder="Je telefoonnummer"
          className="rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary"
        />
      </div>
      {status === "error" && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {status === "sending" ? "Versturen…" : "Bel me terug"}
      </button>
    </form>
  );
}

export function Home() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 w-full py-16 gap-10">
      <img src={logoUrl} alt="Nebula" className="h-64 md:h-96 w-auto" />
      <img
        src={whereStarsUrl}
        alt="Where stars are born and develop"
        className="w-full max-w-md"
      />

      {/* Purpose */}
      <div className="w-full max-w-2xl text-center space-y-5">
        <h1 className="text-2xl md:text-3xl font-semibold text-foreground">
          Waar studio's groeien.
        </h1>
        <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
          Nebula is het platform waarmee yoga-, pilates- en wellnessstudio's in
          minuten een professionele website mét boekingssysteem bouwen — met AI.
          Importeer je bestaande site of bouw een nieuwe, neem online boekingen en
          betalingen aan, beheer lessen en abonnementen, en word automatisch beter
          gevonden in Google. Alles op één plek, op je eigen domein.
        </p>
        <div className="grid gap-4 sm:grid-cols-3 pt-2 text-left">
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="text-sm font-semibold text-foreground">Bouw met AI</div>
            <p className="text-xs text-muted-foreground mt-1">
              Beschrijf wat je wilt en Nebula bouwt of past je site aan — geen code nodig.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="text-sm font-semibold text-foreground">Boeken &amp; betalen</div>
            <p className="text-xs text-muted-foreground mt-1">
              Online boekingen, abonnementen en betalingen — direct geïntegreerd in je site.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="text-sm font-semibold text-foreground">Groei automatisch</div>
            <p className="text-xs text-muted-foreground mt-1">
              Automatische SEO-blogs en Google-koppeling zodat nieuwe klanten je vinden.
            </p>
          </div>
        </div>

        {/* Contact */}
        <div className="pt-4">
          <ContactForm />
        </div>
      </div>
    </div>
  );
}
