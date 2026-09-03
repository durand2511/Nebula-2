/**
 * /uitleg — clean, structured guide page. Explains, to the dot, how to connect Claude Code (buy a
 * subscription → account → the exact on-screen login flow) and how to edit the site afterwards.
 * Reached from the "Uitleg" button above the terminal (not inside the terminal).
 * Fully bilingual via useLang().
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ClaudeTerminal } from "@/components/claude-terminal";
import { getToken } from "@/lib/session";
import { useLang } from "@/lib/i18n";
import {
  ArrowLeft, ArrowDown, ExternalLink, ShoppingCart, UserPlus, Terminal as TerminalIcon,
  MousePointerClick, ClipboardPaste, Check, Wand2, Eye, Rocket, KeyRound, LogIn, AlertTriangle, Unplug,
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
  const { t, lang } = useLang();
  const en = lang === "en";
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const loggedIn = !!getToken();

  useEffect(() => {
    if (!loggedIn) return;
    fetch("/api/claude/status").then((r) => r.json()).then((d) => setConnected(!!d.connected)).catch(() => setConnected(false));
  }, [loggedIn]);

  const scrollToTerminal = () => {
    const el = document.getElementById("koppel-terminal");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const disconnect = async () => {
    if (!window.confirm(t("Claude ontkoppelen? Je kunt daarna opnieuw inloggen met je Claude-account.", "Disconnect Claude? You can log in again with your Claude account afterwards."))) return;
    setBusy(true);
    try { await fetch("/api/claude/disconnect", { method: "POST" }); setConnected(false); } finally { setBusy(false); }
  };
  return (
    <div className="flex-1 w-full px-4 py-8 pb-20">
      <div className="mx-auto max-w-3xl">
        <button type="button" onClick={() => setLocation("/ai-editor")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-5" data-testid="button-back">
          <ArrowLeft className="h-4 w-4" /> {t("Terug", "Back")}
        </button>

        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary"><TerminalIcon className="h-3.5 w-3.5" /> {t("Handleiding", "Guide")}</div>
          <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">{t("Zo werkt het", "How it works")}</h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            {t(
              "Je bewerkt je website met Claude Code. Dat koppel je één keer aan je eigen Claude-account. Hieronder staat precies, stap voor stap, hoe dat gaat.",
              "You edit your website with Claude Code. You connect it once to your own Claude account. Below is exactly, step by step, how that works.",
            )}
          </p>
        </div>

        {/* Quick actions */}
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <a href="https://claude.ai/login" target="_blank" rel="noreferrer" className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition flex flex-col gap-1.5" data-testid="cta-account">
            <UserPlus className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">{t("Account maken", "Create account")}</span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">{t("Op claude.ai", "On claude.ai")} <ExternalLink className="h-3 w-3" /></span>
          </a>
          <a href="https://claude.ai/upgrade" target="_blank" rel="noreferrer" className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition flex flex-col gap-1.5" data-testid="cta-subscription">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">{t("Abonnement kopen", "Buy a subscription")}</span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">Claude Pro {t("of", "or")} Max <ExternalLink className="h-3 w-3" /></span>
          </a>
          <button type="button" onClick={scrollToTerminal} className="rounded-xl border border-primary bg-primary/5 p-4 hover:bg-primary/10 transition flex flex-col gap-1.5 text-left" data-testid="cta-connect">
            <TerminalIcon className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">{t("Open het koppel-venster", "Open the connect window")}</span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">{t("Onderaan deze pagina", "At the bottom of this page")} <ArrowDown className="h-3 w-3" /></span>
          </button>
        </div>

        {/* Section 1: connect */}
        <section className="mt-10 rounded-2xl border border-border bg-card shadow-sm p-6 md:p-8">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">{t("Deel 1", "Part 1")}</span>
            <span className="text-xs text-muted-foreground">{t("· eenmalig", "· one time only")}</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{t("Claude koppelen", "Connect Claude")}</h2>
          <p className="text-muted-foreground mt-1">{t("Dit doe je maar één keer. Daarna onthoudt Nebula je koppeling.", "You only do this once. Nebula remembers your connection afterwards.")}</p>

          <ol className="mt-6">
            <StepRow n={1} icon={<UserPlus className="h-4 w-4 text-primary" />} title={t("Maak een Claude-account", "Create a Claude account")}>
              {en
                ? <p>Go to claude.ai and create an account with your e-mail address. <strong className="text-foreground">Already have a Claude account? Skip this step.</strong></p>
                : <p>Ga naar claude.ai en maak een account aan met je e-mailadres. <strong className="text-foreground">Heb je al een Claude-account? Sla deze stap over.</strong></p>}
              <a href="https://claude.ai/login" target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1.5">{t("Account maken op claude.ai", "Create an account on claude.ai")} <ExternalLink className="h-3.5 w-3.5" /></Button></a>
            </StepRow>

            <StepRow n={2} icon={<ShoppingCart className="h-4 w-4 text-primary" />} title={t("Koop een Claude-abonnement", "Buy a Claude subscription")}>
              {en
                ? <p>Claude Code runs on your own Claude subscription — that's your only cost. Choose <strong className="text-foreground">Pro</strong> or <strong className="text-foreground">Max</strong>. <strong className="text-foreground">Already subscribed? Skip this step.</strong></p>
                : <p>Claude Code werkt op je eigen Claude-abonnement — dat is je enige kostenpost. Kies <strong className="text-foreground">Pro</strong> of <strong className="text-foreground">Max</strong>. <strong className="text-foreground">Heb je al een abonnement? Sla deze stap over.</strong></p>}
              <a href="https://claude.ai/upgrade" target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1.5">{t("Naar claude.ai/upgrade", "Go to claude.ai/upgrade")} <ExternalLink className="h-3.5 w-3.5" /></Button></a>
            </StepRow>

            <StepRow n={3} icon={<TerminalIcon className="h-4 w-4 text-primary" />} title={t("Open het koppel-venster (onderaan deze pagina)", "Open the connect window (bottom of this page)")}>
              {en
                ? <p>Scroll to the black window at the bottom of this page — or click <strong className="text-foreground">Open the connect window</strong> at the top. After a few seconds a menu titled <em>"Select login method"</em> appears <strong className="text-foreground">by itself</strong>.</p>
                : <p>Scroll naar het zwarte venster onderaan deze pagina — of klik op <strong className="text-foreground">Open het koppel-venster</strong> bovenaan. Na een paar seconden verschijnt daar <strong className="text-foreground">vanzelf</strong> een menu met de titel <em>"Select login method"</em>.</p>}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={scrollToTerminal} data-testid="button-jump-terminal">{t("Naar het koppel-venster", "To the connect window")} <ArrowDown className="h-3.5 w-3.5" /></Button>
            </StepRow>

            <StepRow n={4} icon={<LogIn className="h-4 w-4 text-primary" />} title={t("Kies de eerste optie en druk op Enter", "Pick the first option and press Enter")}>
              <p>{t("Er staat al een keuze klaar (er staat een pijltje ", "A choice is already selected (there's an arrow ")}<span className="font-mono text-foreground">❯</span>{t(" voor):", " in front):")}</p>
              <div className="rounded-lg border border-border bg-muted/50 p-3 font-mono text-[13px] text-foreground space-y-1">
                <div>❯ 1. Claude account with subscription</div>
                <div className="text-muted-foreground">&nbsp;&nbsp; 2. Anthropic Console account</div>
                <div className="text-muted-foreground">&nbsp;&nbsp; 3. 3rd-party platform (Bedrock / Vertex)</div>
              </div>
              <p>{t("Optie 1 staat al goed — druk gewoon op ", "Option 1 is already right — just press ")}<Kbd>Enter</Kbd>.</p>
              <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-amber-900 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {en
                  ? <span>Do <strong>not</strong> pick option 2 or 3. Don't type other numbers — you'll end up on the wrong screen. Only <Kbd>Enter</Kbd>.</span>
                  : <span>Kies <strong>niet</strong> optie 2 of 3. Typ geen andere cijfers — dan kom je op het verkeerde scherm terecht. Alleen <Kbd>Enter</Kbd>.</span>}
              </div>
            </StepRow>

            <StepRow n={5} icon={<MousePointerClick className="h-4 w-4 text-primary" />} title={t("Open de link die verschijnt", "Open the link that appears")}>
              {en
                ? <p>Claude now shows a long link (starting with <span className="font-mono text-foreground">https://claude.ai/…</span>). Click it, or copy it and paste it into a new browser tab.</p>
                : <p>Claude toont nu een lange link (begint met <span className="font-mono text-foreground">https://claude.ai/…</span>). Klik erop, of kopieer 'm en plak 'm in een nieuw browser-tabblad.</p>}
            </StepRow>

            <StepRow n={6} icon={<KeyRound className="h-4 w-4 text-primary" />} title={t("Log in en geef toestemming", "Log in and grant access")}>
              {en
                ? <p>On the page that opens, log in with your Claude account (if you weren't logged in yet) and click the button to grant access — <strong className="text-foreground">Authorize</strong>.</p>
                : <p>Op de pagina die opent log je in met je Claude-account (als je nog niet ingelogd was) en klik je op de knop om toegang te geven — <strong className="text-foreground">Authorize</strong> / <strong className="text-foreground">Toestaan</strong>.</p>}
            </StepRow>

            <StepRow n={7} icon={<ClipboardPaste className="h-4 w-4 text-primary" />} title={t("Kopieer de code en plak 'm in de terminal", "Copy the code and paste it into the terminal")}>
              {en
                ? <p>You'll be shown a <strong className="text-foreground">code</strong>. Copy it, click back into the black window, and paste the code:</p>
                : <p>Je krijgt een <strong className="text-foreground">code</strong> te zien. Kopieer die, klik terug in het zwarte venster, en plak de code:</p>}
              <ul className="list-disc pl-5 space-y-1">
                <li>{t("rechtermuisknop → Plakken, of", "right-click → Paste, or")}</li>
                <li><Kbd>⌘</Kbd>+<Kbd>V</Kbd> (Mac) / <Kbd>Ctrl</Kbd>+<Kbd>V</Kbd> (Windows)</li>
              </ul>
              <p>{t("Druk daarna op ", "Then press ")}<Kbd>Enter</Kbd>.</p>
            </StepRow>

            <StepRow n={8} last icon={<Check className="h-4 w-4 text-emerald-600" />} title={t("Klaar — je bent gekoppeld", "Done — you're connected")}>
              {en
                ? <p>At the top of the terminal it flips to <span className="text-emerald-700 font-medium">"connected"</span>. You never have to do this again. Want to disconnect later? Use the <strong className="text-foreground">Disconnect</strong> button above the terminal.</p>
                : <p>Bovenaan de terminal springt het op <span className="text-emerald-700 font-medium">"gekoppeld"</span>. Je hoeft dit nooit meer te doen. Wil je later loskoppelen? Gebruik de knop <strong className="text-foreground">Ontkoppelen</strong> boven de terminal.</p>}
            </StepRow>
          </ol>
        </section>

        {/* Section 2: edit */}
        <section className="mt-8 rounded-2xl border border-border bg-card shadow-sm p-6 md:p-8">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">{t("Deel 2", "Part 2")}</span>
            <span className="text-xs text-muted-foreground">{t("· elke keer dat je iets wilt wijzigen", "· every time you want to change something")}</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{t("Je website aanpassen", "Editing your website")}</h2>

          <ol className="mt-6">
            <StepRow n={1} icon={<Wand2 className="h-4 w-4 text-primary" />} title={t("Typ in gewone taal wat je wilt", "Type what you want in plain language")}>
              <p>{t("Schrijf in de terminal precies wat er anders moet, en druk op ", "Write in the terminal exactly what should change, and press ")}<Kbd>Enter</Kbd>. {t("Bijvoorbeeld:", "For example:")}</p>
              <ul className="space-y-1.5">
                <li className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground text-sm">{t('"Maak de titel op de homepage groter en zet \'m in het midden."', '"Make the homepage title bigger and center it."')}</li>
                <li className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground text-sm">{t("\"Verander de knop 'Afspraak maken' naar de kleur groen.\"", "\"Change the 'Book appointment' button to green.\"")}</li>
                <li className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground text-sm">{t("\"Voeg een pagina 'Over ons' toe met een korte tekst.\"", "\"Add an 'About us' page with a short text.\"")}</li>
              </ul>
            </StepRow>
            <StepRow n={2} icon={<Eye className="h-4 w-4 text-primary" />} title={t("Bekijk het resultaat", "Check the result")}>
              {en
                ? <p>Nothing to confirm. Claude edits your site directly, the change appears in the <strong className="text-foreground">preview</strong> next to it right away and is saved automatically. Not happy? Just type what should be different, e.g. <span className="text-foreground">"no, make it smaller instead"</span>.</p>
                : <p>Je hoeft niks te bevestigen. Claude past je site direct aan, de wijziging verschijnt meteen in de <strong className="text-foreground">preview</strong> ernaast en wordt automatisch opgeslagen. Niet goed? Typ gewoon wat er anders moet, bijv. <span className="text-foreground">"nee, maak 'm juist kleiner"</span>.</p>}
            </StepRow>
            <StepRow n={3} last icon={<Rocket className="h-4 w-4 text-primary" />} title={t("Zet je site online", "Put your site online")}>
              {en
                ? <p>Happy with it? Click the green <strong className="text-foreground">Publish</strong> button top right to put your website live on your Nebula address or your own domain.</p>
                : <p>Blij? Klik rechtsboven op de groene knop <strong className="text-foreground">Publiceren</strong> om je website live te zetten op je Nebula-adres of je eigen domein.</p>}
            </StepRow>
          </ol>

          <p className="text-xs text-muted-foreground mt-4">{t("Tip: typ ", "Tip: type ")}<span className="font-mono">/exit</span>{t(" om Claude te stoppen. De volgende keer start-ie vanzelf weer op.", " to stop Claude. Next time it starts up again by itself.")}</p>
        </section>

        {/* Koppel-venster onderaan de pagina */}
        <section id="koppel-terminal" className="mt-8 rounded-2xl border border-border bg-card shadow-sm overflow-hidden scroll-mt-4">
          <div className="p-6 md:p-7 border-b border-border/60 flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[240px]">
              <div className="text-xs font-bold uppercase tracking-wider text-primary">{t("Koppel-venster", "Connect window")}</div>
              <h2 className="mt-1 text-2xl font-bold tracking-tight">{t("Koppel hier je Claude-account", "Connect your Claude account here")}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{t("Volg de stappen hierboven in dit venster. Eén keer doen.", "Follow the steps above in this window. One time only.")}</p>
            </div>
            {loggedIn && connected !== null && (
              connected ? (
                <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm"><Check className="h-4 w-4" /> {t("Gekoppeld", "Connected")}</div>
                  <button type="button" onClick={disconnect} disabled={busy} className="mt-1 text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1" data-testid="button-uitleg-disconnect"><Unplug className="h-3 w-3" /> {t("Ontkoppelen", "Disconnect")}</button>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-amber-900 text-sm font-medium">{t("Nog niet gekoppeld", "Not connected yet")}</div>
              )
            )}
          </div>
          <div className="p-3 md:p-4 bg-[#0f0e14]">
            {loggedIn ? (
              <ClaudeTerminal projectId={0} className="h-[460px]" onConnected={(c) => { if (c) setConnected(true); }} />
            ) : (
              <div className="h-[200px] flex flex-col items-center justify-center text-center text-white/70 gap-3">
                <p>{t("Log eerst in op je Nebula-account om te kunnen koppelen.", "Log in to your Nebula account first to connect.")}</p>
                <Button onClick={() => setLocation("/ai-editor")} data-testid="button-login-first">{t("Inloggen", "Log in")}</Button>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
