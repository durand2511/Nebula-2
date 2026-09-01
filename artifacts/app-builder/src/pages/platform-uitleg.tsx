/**
 * /platform-uitleg — complete, plain-language manual of every platform feature: editing with Claude,
 * preview tools, publishing, own domain, auto-SEO, subscription, Google, booking system.
 */
import { useLocation } from "wouter";
import {
  ArrowLeft, Terminal as TerminalIcon, MousePointerClick, Rocket, Globe, Sparkles, FileText,
  Search, CreditCard, CalendarCheck, Image as ImageIcon, ArrowRight,
} from "lucide-react";

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm p-6 md:p-7">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">{icon}</div>
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      </div>
      <div className="mt-3 text-[15px] text-muted-foreground leading-relaxed space-y-2 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">{children}</div>
    </section>
  );
}

export function PlatformUitleg() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex-1 w-full px-4 py-8 pb-20">
      <div className="mx-auto max-w-3xl">
        <button type="button" onClick={() => setLocation("/help")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-5" data-testid="button-back">
          <ArrowLeft className="h-4 w-4" /> Terug
        </button>

        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Alles over het platform</h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">Een complete uitleg van alle functies, in gewone taal. Zo weet je precies wat er kan en hoe het werkt.</p>
        </div>

        <div className="mt-8 space-y-4">
          <Feature icon={<TerminalIcon className="h-5 w-5 text-primary" />} title="Je website bewerken met Claude Code">
            <p>Je bewerkt je website door in gewone taal te typen wat er anders moet — Claude Code past de bestanden van je site direct aan. Je hoeft niets te bevestigen: elke wijziging staat meteen in de <strong>preview</strong> en wordt automatisch opgeslagen.</p>
            <p>Koppelen doe je één keer met je eigen Claude-abonnement.</p>
            <button type="button" onClick={() => setLocation("/uitleg")} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Naar de instel-handleiding <ArrowRight className="h-3.5 w-3.5" /></button>
          </Feature>

          <Feature icon={<MousePointerClick className="h-5 w-5 text-primary" />} title="Markeren, bestanden & screenshots">
            <ul>
              <li><strong>Markeren:</strong> sleep een kader over een stuk van je site; er wordt een schermafbeelding van dat gebied gemaakt die je naar Claude stuurt, zodat hij precies ziet wat je bedoelt.</li>
              <li><strong>Bestanden slepen:</strong> sleep elk bestand (foto, logo, PDF, tekst) de editor in — het gaat mee naar Claude om te gebruiken op je site.</li>
              <li><strong>Plakken:</strong> maak een screenshot (⌘⇧4) en plak 'm met ⌘V / Ctrl+V.</li>
            </ul>
          </Feature>

          <Feature icon={<Rocket className="h-5 w-5 text-primary" />} title="Publiceren">
            <p>Rechtsboven staat de groene knop <strong>Publiceren</strong>. Daarmee zet je de huidige versie van je site live. Zolang je niet publiceert, blijven je wijzigingen een concept — je kunt dus rustig proberen en pas publiceren als je tevreden bent.</p>
            <p>Heb je later meer aangepast? Dan verandert de knop in <strong>Republiceren</strong> om de nieuwste versie live te zetten.</p>
          </Feature>

          <Feature icon={<Globe className="h-5 w-5 text-primary" />} title="Je eigen domein koppelen">
            <p>Je site komt eerst op een gratis Nebula-adres. Wil je je eigen domein (bijv. <strong>jouwstudio.nl</strong>)? In het publiceer-venster staat precies welke DNS-records je bij je domeinprovider toevoegt (een CNAME voor <strong>www</strong> en twee A-records voor het hoofddomein).</p>
            <p>Na het toevoegen klik je op <strong>Koppelen</strong> en daarna <strong>Verifiëren</strong>. Het <strong>SSL-certificaat</strong> (het slotje/https) wordt automatisch geregeld zodra de verificatie is gelukt. Dit kan een paar uur duren.</p>
          </Feature>

          <Feature icon={<Sparkles className="h-5 w-5 text-primary" />} title="Auto-SEO — automatisch gevonden worden">
            <p>SEO zorgt dat mensen je site vinden in Google. Met <strong>Auto-SEO</strong> schrijft en publiceert Nebula automatisch geregeld een nieuw, relevant artikel op je site, zodat je vindbaarheid groeit zonder dat je er iets voor hoeft te doen.</p>
            <ul>
              <li>Zet het aan/uit met de knop <strong>Auto-SEO</strong> boven de preview.</li>
              <li>Er wordt hooguit één artikel per dag geschreven, zodat het natuurlijk blijft.</li>
              <li>Zet je het uit, dan stoppen de nieuwe artikelen — dat kan je vindbaarheid schaden.</li>
            </ul>
          </Feature>

          <Feature icon={<Search className="h-5 w-5 text-primary" />} title="Google Search Console koppelen">
            <p>In het publiceer-venster kun je met één klik <strong>Google Search Console</strong> koppelen. Daarmee wordt je site automatisch bij Google geverifieerd en je sitemap ingediend, zodat je sneller in Google verschijnt — zonder gedoe met DNS.</p>
          </Feature>

          <Feature icon={<CreditCard className="h-5 w-5 text-primary" />} title="Abonnement & kosten">
            <p>Het bewerken werkt op je <strong>eigen Claude-abonnement</strong> (Pro of Max, dat koop je bij claude.ai). Dat is je enige vaste kostenpost voor het bouwen en aanpassen; je koppelt het één keer.</p>
            <p>Je site zelf, je teksten en je domein zijn en blijven van jou — je bent zelf eigenaar en beheerder.</p>
          </Feature>

          <Feature icon={<CalendarCheck className="h-5 w-5 text-primary" />} title="Boekingssysteem (optioneel)">
            <p>Wil je dat klanten online kunnen boeken en betalen? Vraag Claude in de chat bijvoorbeeld: <em>"Voeg een boekingssysteem toe aan mijn website."</em> Je krijgt dan een agenda, boekingen, betalingen (via Stripe) en automatische bevestigingen. In het beheer stel je je bedrijfsgegevens en betaalkoppeling in.</p>
          </Feature>

          <Feature icon={<ImageIcon className="h-5 w-5 text-primary" />} title="Preview, code & volledig scherm">
            <ul>
              <li><strong>Preview:</strong> zie je site live meebewegen terwijl je hem aanpast.</li>
              <li><strong>Code:</strong> bekijk de onderliggende bestanden als je dat wilt.</li>
              <li><strong>Volledig scherm:</strong> bekijk je site groot, zoals bezoekers hem zien.</li>
              <li><strong>Refresh:</strong> ververs de preview als je iets niet ziet.</li>
            </ul>
          </Feature>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">Nog vragen? Begin gewoon in de chat met Claude — typ wat je wilt en probeer het uit. Je kunt altijd verder aanpassen.</p>
          <button type="button" onClick={() => setLocation("/ai-editor")} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">Naar mijn websites <ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
