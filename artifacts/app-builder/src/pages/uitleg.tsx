/**
 * /uitleg — clean, structured guide page. Explains, to the dot, how to connect Claude Code (buy a
 * subscription → account → the exact on-screen login flow) and how to edit the site afterwards.
 * Reached from the "Uitleg" button above the terminal (not inside the terminal).
 */
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, ArrowRight, ExternalLink, ShoppingCart, UserPlus, Terminal as TerminalIcon,
  MousePointerClick, ClipboardPaste, Check, Wand2, Eye, Rocket, KeyRound, LogIn, AlertTriangle,
} from "lucide-react";

function StepRow({ n, last, icon, title, children }: { n: number; last?: boolean; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center shadow-sm">{n}</div>
        {!last && <div className="flex-1 w-px bg-border my-1.5" />}
      </div>
      <div className={last ? "" : "pb-6"}>
        <h3 className="flex items-center gap-2 font-semibold text-foreground">{icon}{title}</h3>
        <div className="text-[15px] text-muted-foreground leading-relaxed mt-1.5 space-y-2">{children}</div>
      </div>
    </li>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted text-foreground text-[12px] font-medium">{children}</kbd>
);

export function Uitleg() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex-1 w-full px-4 py-8 pb-20">
      <div className="mx-auto max-w-3xl">
        <button type="button" onClick={() => setLocation("/ai-editor")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-5" data-testid="button-back">
          <ArrowLeft className="h-4 w-4" /> Terug
        </button>

        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary"><TerminalIcon className="h-3.5 w-3.5" /> Handleiding</div>
          <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Zo werkt het</h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Je bewerkt je website met Claude Code. Dat koppel je één keer aan je eigen Claude-account.
            Hieronder staat precies, stap voor stap, hoe dat gaat.
          </p>
        </div>

        {/* Quick actions */}
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <a href="https://claude.ai/login" target="_blank" rel="noreferrer" className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition flex flex-col gap-1.5" data-testid="cta-account">
            <UserPlus className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Account maken</span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">Op claude.ai <ExternalLink className="h-3 w-3" /></span>
          </a>
          <a href="https://claude.ai/upgrade" target="_blank" rel="noreferrer" className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition flex flex-col gap-1.5" data-testid="cta-subscription">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Abonnement kopen</span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">Claude Pro of Max <ExternalLink className="h-3 w-3" /></span>
          </a>
          <button type="button" onClick={() => setLocation("/claude")} className="rounded-xl border border-primary bg-primary/5 p-4 hover:bg-primary/10 transition flex flex-col gap-1.5 text-left" data-testid="cta-connect">
            <TerminalIcon className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Nu koppelen</span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">Open het koppel-venster <ArrowRight className="h-3 w-3" /></span>
          </button>
        </div>

        {/* Section 1: connect */}
        <section className="mt-10 rounded-2xl border border-border bg-card shadow-sm p-6 md:p-8">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Deel 1</span>
            <span className="text-xs text-muted-foreground">· eenmalig</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">Claude koppelen</h2>
          <p className="text-muted-foreground mt-1">Dit doe je maar één keer. Daarna onthoudt Nebula je koppeling.</p>

          <ol className="mt-6">
            <StepRow n={1} icon={<ShoppingCart className="h-4 w-4 text-primary" />} title="Koop een Claude-abonnement">
              <p>Claude Code werkt op je eigen Claude-abonnement — dat is je enige kostenpost. Kies <strong className="text-foreground">Pro</strong> of <strong className="text-foreground">Max</strong>.</p>
              <a href="https://claude.ai/upgrade" target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1.5">Naar claude.ai/upgrade <ExternalLink className="h-3.5 w-3.5" /></Button></a>
            </StepRow>

            <StepRow n={2} icon={<UserPlus className="h-4 w-4 text-primary" />} title="Maak of gebruik je Claude-account">
              <p>Nog geen account? Maak er één met je e-mailadres. Heb je er al één? Dan sla je deze stap over.</p>
              <a href="https://claude.ai/login" target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1.5">Account maken op claude.ai <ExternalLink className="h-3.5 w-3.5" /></Button></a>
            </StepRow>

            <StepRow n={3} icon={<TerminalIcon className="h-4 w-4 text-primary" />} title="Open het koppel-venster">
              <p>Klik op <strong className="text-foreground">Nu koppelen</strong> hierboven (of op <strong className="text-foreground">Claude koppelen</strong> op je startscherm). Er opent een zwart venster — de terminal. Na een paar seconden verschijnt daar <strong className="text-foreground">vanzelf</strong> een menu met de titel <em>"Select login method"</em>.</p>
            </StepRow>

            <StepRow n={4} icon={<LogIn className="h-4 w-4 text-primary" />} title="Kies de eerste optie en druk op Enter">
              <p>Er staat al een keuze klaar (er staat een pijltje <span className="font-mono text-foreground">❯</span> voor):</p>
              <div className="rounded-lg border border-border bg-muted/50 p-3 font-mono text-[13px] text-foreground space-y-1">
                <div>❯ 1. Claude account with subscription</div>
                <div className="text-muted-foreground">&nbsp;&nbsp; 2. Anthropic Console account</div>
                <div className="text-muted-foreground">&nbsp;&nbsp; 3. 3rd-party platform (Bedrock / Vertex)</div>
              </div>
              <p>Optie 1 staat al goed — druk gewoon op <Kbd>Enter</Kbd>.</p>
              <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-amber-900 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Kies <strong>niet</strong> optie 2 of 3. Typ geen andere cijfers — dan kom je op het verkeerde scherm terecht. Alleen <Kbd>Enter</Kbd>.</span>
              </div>
            </StepRow>

            <StepRow n={5} icon={<MousePointerClick className="h-4 w-4 text-primary" />} title="Open de link die verschijnt">
              <p>Claude toont nu een lange link (begint met <span className="font-mono text-foreground">https://claude.ai/…</span>). Klik erop, of kopieer 'm en plak 'm in een nieuw browser-tabblad.</p>
            </StepRow>

            <StepRow n={6} icon={<KeyRound className="h-4 w-4 text-primary" />} title="Log in en geef toestemming">
              <p>Op de pagina die opent log je in met je Claude-account (als je nog niet ingelogd was) en klik je op de knop om toegang te geven — <strong className="text-foreground">Authorize</strong> / <strong className="text-foreground">Toestaan</strong>.</p>
            </StepRow>

            <StepRow n={7} icon={<ClipboardPaste className="h-4 w-4 text-primary" />} title="Kopieer de code en plak 'm in de terminal">
              <p>Je krijgt een <strong className="text-foreground">code</strong> te zien. Kopieer die, klik terug in het zwarte venster, en plak de code:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>rechtermuisknop → <em>Plakken</em>, of</li>
                <li><Kbd>⌘</Kbd>+<Kbd>V</Kbd> (Mac) / <Kbd>Ctrl</Kbd>+<Kbd>V</Kbd> (Windows)</li>
              </ul>
              <p>Druk daarna op <Kbd>Enter</Kbd>.</p>
            </StepRow>

            <StepRow n={8} last icon={<Check className="h-4 w-4 text-emerald-600" />} title="Klaar — je bent gekoppeld">
              <p>Bovenaan de terminal springt het op <span className="text-emerald-700 font-medium">"gekoppeld"</span>. Je hoeft dit nooit meer te doen. Wil je later loskoppelen? Gebruik de knop <strong className="text-foreground">Ontkoppelen</strong> boven de terminal.</p>
            </StepRow>
          </ol>
        </section>

        {/* Section 2: edit */}
        <section className="mt-8 rounded-2xl border border-border bg-card shadow-sm p-6 md:p-8">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Deel 2</span>
            <span className="text-xs text-muted-foreground">· elke keer dat je iets wilt wijzigen</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">Je website aanpassen</h2>

          <ol className="mt-6">
            <StepRow n={1} icon={<Wand2 className="h-4 w-4 text-primary" />} title="Typ in gewone taal wat je wilt">
              <p>Schrijf in de terminal precies wat er anders moet, en druk op <Kbd>Enter</Kbd>. Bijvoorbeeld:</p>
              <ul className="space-y-1.5">
                <li className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground text-sm">"Maak de titel op de homepage groter en zet 'm in het midden."</li>
                <li className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground text-sm">"Verander de knop 'Afspraak maken' naar de kleur groen."</li>
                <li className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground text-sm">"Voeg een pagina 'Over ons' toe met een korte tekst."</li>
              </ul>
            </StepRow>
            <StepRow n={2} icon={<Eye className="h-4 w-4 text-primary" />} title="Bekijk het resultaat">
              <p>Je hoeft niks te bevestigen. Claude past je site direct aan, de wijziging verschijnt meteen in de <strong className="text-foreground">preview</strong> ernaast en wordt automatisch opgeslagen. Niet goed? Typ gewoon wat er anders moet, bijv. <span className="text-foreground">"nee, maak 'm juist kleiner"</span>.</p>
            </StepRow>
            <StepRow n={3} last icon={<Rocket className="h-4 w-4 text-primary" />} title="Zet je site online">
              <p>Blij? Klik rechtsboven op de groene knop <strong className="text-foreground">Publiceren</strong> om je website live te zetten op je Nebula-adres of je eigen domein.</p>
            </StepRow>
          </ol>

          <p className="text-xs text-muted-foreground mt-4">Tip: typ <span className="font-mono">/exit</span> om Claude te stoppen. De volgende keer start-ie vanzelf weer op.</p>
        </section>

      </div>
    </div>
  );
}
