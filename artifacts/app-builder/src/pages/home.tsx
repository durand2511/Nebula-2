import { useState, type FormEvent } from "react";
import logoUrl from "../assets/nebula-logo-home.png";

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
        <div className="text-lg font-semibold text-foreground">Bedankt — we bellen je snel! 🎉</div>
        <p className="text-sm text-muted-foreground mt-1">
          We nemen zo snel mogelijk contact op voor een vrijblijvend gesprek over jouw website.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border/60 bg-card/50 p-6 text-left space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">Gratis &amp; vrijblijvend</div>
        <div className="text-lg font-semibold text-foreground mt-1">Klaar voor een nieuwe website?</div>
        <p className="text-sm text-muted-foreground mt-1">
          Laat je telefoonnummer achter, dan bellen we je voor een vrijblijvend gesprek over jouw nieuwe site.
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
      {/* Contact — bovenaan, boven het logo */}
      <div className="w-full max-w-lg">
        <ContactForm />
      </div>
      <img src={logoUrl} alt="Nebula" className="h-64 md:h-96 w-auto" />
      <p className="text-sm md:text-base uppercase tracking-[0.25em] text-muted-foreground text-center">
        Web design bureau
      </p>

      {/* Purpose */}
      <div className="w-full max-w-2xl text-center space-y-5">
        <h1 className="text-2xl md:text-3xl font-semibold text-foreground">
          Waar merken groeien.
        </h1>
        <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
          Nebula is een web design bureau dat merken online laat stralen. We ontwerpen en
          bouwen professionele websites — razendsnel met AI, maar met de smaak en afwerking
          van een echte designer. Van een frisse nieuwe site tot een complete redesign,
          inclusief SEO zodat nieuwe klanten je vinden. Alles op je eigen domein, volledig uit
          handen genomen.
        </p>
        <div className="grid gap-4 sm:grid-cols-3 pt-2 text-left">
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="text-sm font-semibold text-foreground">Ontworpen met AI</div>
            <p className="text-xs text-muted-foreground mt-1">
              We bouwen supersnel met AI — met de smaak en afwerking van een echte designer.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="text-sm font-semibold text-foreground">Volledig op maat</div>
            <p className="text-xs text-muted-foreground mt-1">
              Elke website uniek: jouw merk, kleuren en uitstraling. Geen sjabloon van de plank.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="text-sm font-semibold text-foreground">Gevonden in Google</div>
            <p className="text-xs text-muted-foreground mt-1">
              SEO ingebouwd, zodat nieuwe klanten je vanzelf online vinden.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
