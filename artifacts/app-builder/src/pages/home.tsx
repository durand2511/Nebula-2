import logoUrl from "../assets/nebula-logo-home.png";
import whereStarsUrl from "../assets/where-stars.png";

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
      </div>
    </div>
  );
}
