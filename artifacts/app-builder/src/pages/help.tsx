/**
 * /help — uitleg-hub. Two big, equal choices: the Claude Code setup guide (/uitleg) and the full
 * platform manual (/platform-uitleg). Fully bilingual via useLang().
 */
import { useLocation } from "wouter";
import { Terminal as TerminalIcon, BookOpen, ArrowRight, Sparkles } from "lucide-react";
import { useLang } from "@/lib/i18n";

export function Help() {
  const [, setLocation] = useLocation();
  const { t } = useLang();
  return (
    <div className="flex-1 w-full px-4 py-12 pb-20">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{t("Uitleg & handleidingen", "Guides & manuals")}</h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{t("Kies waar je meer over wilt weten. Alles staat er stap voor stap in.", "Pick what you want to learn more about. Everything is explained step by step.")}</p>
        </div>

        <button
          type="button"
          onClick={() => setLocation("/welkom")}
          className="group mt-10 mx-auto block w-full max-w-sm text-center rounded-2xl border border-border bg-card shadow-sm p-6 hover:border-primary/60 hover:shadow-md transition"
          data-testid="help-welkom"
        >
          <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center mx-auto"><Sparkles className="h-5 w-5 text-primary" /></div>
          <h2 className="mt-3 text-lg font-bold tracking-tight">{t("Welkom — start hier", "Welcome — start here")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("Korte introductie: wat je moet weten voordat je begint.", "A short introduction: what to know before you start.")}</p>
          <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary">{t("Lees de introductie", "Read the introduction")} <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" /></span>
        </button>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setLocation("/uitleg")}
            className="group text-left rounded-2xl border border-border bg-card shadow-sm p-7 hover:border-primary/60 hover:shadow-md transition min-h-[220px] flex flex-col"
            data-testid="help-claude"
          >
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center"><TerminalIcon className="h-6 w-6 text-primary" /></div>
            <h2 className="mt-4 text-xl font-bold tracking-tight">{t("Claude Code instellen", "Set up Claude Code")}</h2>
            <p className="mt-2 text-sm text-muted-foreground flex-1">{t("Zo koppel je één keer je Claude-account en bewerk je daarna je website: abonnement, inloggen en de stappen in de terminal.", "Link your Claude account once and edit your website from then on: subscription, logging in and the steps in the terminal.")}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">{t("Open de handleiding", "Open the guide")} <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" /></span>
          </button>

          <button
            type="button"
            onClick={() => setLocation("/platform-uitleg")}
            className="group text-left rounded-2xl border border-border bg-card shadow-sm p-7 hover:border-primary/60 hover:shadow-md transition min-h-[220px] flex flex-col"
            data-testid="help-platform"
          >
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center"><BookOpen className="h-6 w-6 text-primary" /></div>
            <h2 className="mt-4 text-xl font-bold tracking-tight">{t("Uitleg over het platform", "About the platform")}</h2>
            <p className="mt-2 text-sm text-muted-foreground flex-1">{t("Een complete uitleg van alle functies: publiceren, je eigen domein, auto-SEO, abonnementen, Google en meer.", "A complete explanation of every feature: publishing, your own domain, auto-SEO, subscriptions, Google and more.")}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">{t("Bekijk de uitleg", "View the guide")} <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" /></span>
          </button>
        </div>
      </div>
    </div>
  );
}
