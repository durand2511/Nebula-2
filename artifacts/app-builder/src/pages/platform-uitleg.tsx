/**
 * /platform-uitleg — complete, plain-language manual of every platform feature: editing with Claude,
 * preview tools, publishing, own domain, auto-SEO, subscription, Google, booking system.
 * Fully bilingual via useLang().
 */
import { useLocation } from "wouter";
import {
  ArrowLeft, Terminal as TerminalIcon, MousePointerClick, Rocket, Globe, Sparkles,
  Search, CreditCard, CalendarCheck, Image as ImageIcon, ArrowRight,
} from "lucide-react";
import { useLang } from "@/lib/i18n";

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
  const { t, lang } = useLang();
  const en = lang === "en";
  return (
    <div className="flex-1 w-full px-4 py-8 pb-20">
      <div className="mx-auto max-w-3xl">
        <button type="button" onClick={() => setLocation("/help")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-5" data-testid="button-back">
          <ArrowLeft className="h-4 w-4" /> {t("Terug", "Back")}
        </button>

        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{t("Alles over het platform", "Everything about the platform")}</h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{t("Een complete uitleg van alle functies, in gewone taal. Zo weet je precies wat er kan en hoe het werkt.", "A complete explanation of every feature, in plain language. So you know exactly what's possible and how it works.")}</p>
        </div>

        <div className="mt-8 space-y-4">
          <Feature icon={<TerminalIcon className="h-5 w-5 text-primary" />} title={t("Je website bewerken met Claude Code", "Editing your website with Claude Code")}>
            {en ? <>
              <p>You edit your website by typing what should change in plain language — Claude Code edits your site's files directly. Nothing to confirm: every change shows up in the <strong>preview</strong> immediately and is saved automatically.</p>
              <p>You connect once, with your own Claude subscription.</p>
            </> : <>
              <p>Je bewerkt je website door in gewone taal te typen wat er anders moet — Claude Code past de bestanden van je site direct aan. Je hoeft niets te bevestigen: elke wijziging staat meteen in de <strong>preview</strong> en wordt automatisch opgeslagen.</p>
              <p>Koppelen doe je één keer met je eigen Claude-abonnement.</p>
            </>}
            <button type="button" onClick={() => setLocation("/uitleg")} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{t("Naar de instel-handleiding", "To the setup guide")} <ArrowRight className="h-3.5 w-3.5" /></button>
          </Feature>

          <Feature icon={<MousePointerClick className="h-5 w-5 text-primary" />} title={t("Markeren, bestanden & screenshots", "Marking, files & screenshots")}>
            {en ? <ul>
              <li><strong>Mark:</strong> drag a box over a part of your site; a screenshot of that area is taken and sent to Claude, so he sees exactly what you mean.</li>
              <li><strong>Drag files:</strong> drag any file (photo, logo, PDF, text) into the editor — it goes to Claude to use on your site.</li>
              <li><strong>Paste:</strong> take a screenshot (⌘⇧4) and paste it with ⌘V / Ctrl+V.</li>
            </ul> : <ul>
              <li><strong>Markeren:</strong> sleep een kader over een stuk van je site; er wordt een schermafbeelding van dat gebied gemaakt die je naar Claude stuurt, zodat hij precies ziet wat je bedoelt.</li>
              <li><strong>Bestanden slepen:</strong> sleep elk bestand (foto, logo, PDF, tekst) de editor in — het gaat mee naar Claude om te gebruiken op je site.</li>
              <li><strong>Plakken:</strong> maak een screenshot (⌘⇧4) en plak 'm met ⌘V / Ctrl+V.</li>
            </ul>}
          </Feature>

          <Feature icon={<Rocket className="h-5 w-5 text-primary" />} title={t("Publiceren", "Publishing")}>
            {en ? <>
              <p>Top right you'll find the green <strong>Publish</strong> button. It puts the current version of your site live. Until you publish, your changes stay a draft — so you can experiment freely and publish once you're happy.</p>
              <p>Made more changes later? The button turns into <strong>Republish</strong> to push the newest version live.</p>
            </> : <>
              <p>Rechtsboven staat de groene knop <strong>Publiceren</strong>. Daarmee zet je de huidige versie van je site live. Zolang je niet publiceert, blijven je wijzigingen een concept — je kunt dus rustig proberen en pas publiceren als je tevreden bent.</p>
              <p>Heb je later meer aangepast? Dan verandert de knop in <strong>Republiceren</strong> om de nieuwste versie live te zetten.</p>
            </>}
          </Feature>

          <Feature icon={<Globe className="h-5 w-5 text-primary" />} title={t("Je eigen domein koppelen", "Connecting your own domain")}>
            {en ? <>
              <p>Your site starts on a free Nebula address. Want your own domain (e.g. <strong>yourstudio.com</strong>)? Type it in the publish panel and click <strong>Connect</strong> — that's all.</p>
              <p>The technical part (DNS) needs a provider-specific approach, so <strong>the owner of Nebula handles that for you</strong>. Once your domain is live, the <strong>SSL certificate</strong> (the padlock/https) is added automatically. This can take a few hours.</p>
            </> : <>
              <p>Je site komt eerst op een gratis Nebula-adres. Wil je je eigen domein (bijv. <strong>jouwstudio.nl</strong>)? Typ het in het publiceer-venster en klik op <strong>Koppelen</strong> — dat is alles.</p>
              <p>De technische koppeling (DNS) vergt een specifieke aanpak per domeinprovider, dus <strong>dat regelt de eigenaar van Nebula voor je</strong>. Zodra je domein live is, staat het <strong>SSL-certificaat</strong> (het slotje/https) er automatisch bij. Dit kan een paar uur duren.</p>
            </>}
          </Feature>

          <Feature icon={<Sparkles className="h-5 w-5 text-primary" />} title={t("Auto-SEO — automatisch gevonden worden", "Auto-SEO — get found automatically")}>
            {en ? <>
              <p>SEO makes people find your site on Google. With <strong>Auto-SEO</strong>, Nebula automatically writes and publishes a fresh, relevant article on your site at a steady pace, so your visibility grows without you lifting a finger.</p>
              <ul>
                <li>Toggle it with the <strong>Auto-SEO</strong> button above the preview.</li>
                <li>At most one article per day is written, so it stays natural.</li>
                <li>Turning it off stops new articles — which can hurt your visibility.</li>
              </ul>
            </> : <>
              <p>SEO zorgt dat mensen je site vinden in Google. Met <strong>Auto-SEO</strong> schrijft en publiceert Nebula automatisch geregeld een nieuw, relevant artikel op je site, zodat je vindbaarheid groeit zonder dat je er iets voor hoeft te doen.</p>
              <ul>
                <li>Zet het aan/uit met de knop <strong>Auto-SEO</strong> boven de preview.</li>
                <li>Er wordt hooguit één artikel per dag geschreven, zodat het natuurlijk blijft.</li>
                <li>Zet je het uit, dan stoppen de nieuwe artikelen — dat kan je vindbaarheid schaden.</li>
              </ul>
            </>}
          </Feature>

          <Feature icon={<Search className="h-5 w-5 text-primary" />} title={t("Google Search Console koppelen", "Connecting Google Search Console")}>
            {en
              ? <p>In the publish panel you can connect <strong>Google Search Console</strong> with one click. Your site gets verified with Google automatically and your sitemap is submitted, so you show up in Google faster — no DNS hassle.</p>
              : <p>In het publiceer-venster kun je met één klik <strong>Google Search Console</strong> koppelen. Daarmee wordt je site automatisch bij Google geverifieerd en je sitemap ingediend, zodat je sneller in Google verschijnt — zonder gedoe met DNS.</p>}
          </Feature>

          <Feature icon={<CreditCard className="h-5 w-5 text-primary" />} title={t("Abonnement & kosten", "Subscription & costs")}>
            {en ? <>
              <p>Editing runs on your <strong>own Claude subscription</strong> (Pro or Max, bought at claude.ai). That's your only fixed cost for building and editing; you connect it once.</p>
              <p>Your site, your content and your domain are and remain yours — you are the owner and administrator.</p>
            </> : <>
              <p>Het bewerken werkt op je <strong>eigen Claude-abonnement</strong> (Pro of Max, dat koop je bij claude.ai). Dat is je enige vaste kostenpost voor het bouwen en aanpassen; je koppelt het één keer.</p>
              <p>Je site zelf, je teksten en je domein zijn en blijven van jou — je bent zelf eigenaar en beheerder.</p>
            </>}
          </Feature>

          <Feature icon={<CalendarCheck className="h-5 w-5 text-primary" />} title={t("Boekingssysteem (optioneel)", "Booking system (optional)")}>
            {en
              ? <p>Want customers to book and pay online? Just ask Claude in the chat, for example: <em>"Add a booking system to my website."</em> You'll get a calendar, bookings, payments (via Stripe) and automatic confirmations. In the admin you set your business details and payment connection.</p>
              : <p>Wil je dat klanten online kunnen boeken en betalen? Vraag Claude in de chat bijvoorbeeld: <em>"Voeg een boekingssysteem toe aan mijn website."</em> Je krijgt dan een agenda, boekingen, betalingen (via Stripe) en automatische bevestigingen. In het beheer stel je je bedrijfsgegevens en betaalkoppeling in.</p>}
          </Feature>

          <Feature icon={<ImageIcon className="h-5 w-5 text-primary" />} title={t("Preview, code & volledig scherm", "Preview, code & full screen")}>
            {en ? <ul>
              <li><strong>Preview:</strong> watch your site update live while you edit it.</li>
              <li><strong>Code:</strong> view the underlying files if you want to.</li>
              <li><strong>Full screen:</strong> see your site big, the way visitors see it.</li>
              <li><strong>Refresh:</strong> reload the preview if something doesn't show.</li>
            </ul> : <ul>
              <li><strong>Preview:</strong> zie je site live meebewegen terwijl je hem aanpast.</li>
              <li><strong>Code:</strong> bekijk de onderliggende bestanden als je dat wilt.</li>
              <li><strong>Volledig scherm:</strong> bekijk je site groot, zoals bezoekers hem zien.</li>
              <li><strong>Refresh:</strong> ververs de preview als je iets niet ziet.</li>
            </ul>}
          </Feature>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">{t("Nog vragen? Begin gewoon in de chat met Claude — typ wat je wilt en probeer het uit. Je kunt altijd verder aanpassen.", "Questions? Just start chatting with Claude — type what you want and try it out. You can always keep adjusting.")}</p>
          <button type="button" onClick={() => setLocation("/ai-editor")} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">{t("Naar mijn websites", "To my websites")} <ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
