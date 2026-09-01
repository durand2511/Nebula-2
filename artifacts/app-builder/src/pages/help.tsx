/**
 * /help — uitleg-hub. Two big, equal choices: the Claude Code setup guide (/uitleg) and the full
 * platform manual (/platform-uitleg).
 */
import { useLocation } from "wouter";
import { Terminal as TerminalIcon, BookOpen, ArrowRight, Sparkles } from "lucide-react";

export function Help() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex-1 w-full px-4 py-12 pb-20">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Uitleg &amp; handleidingen</h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">Kies waar je meer over wilt weten. Alles staat er stap voor stap in.</p>
        </div>

        <button
          type="button"
          onClick={() => setLocation("/welkom")}
          className="group mt-10 mx-auto block w-full max-w-sm text-center rounded-2xl border border-border bg-card shadow-sm p-6 hover:border-primary/60 hover:shadow-md transition"
          data-testid="help-welkom"
        >
          <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center mx-auto"><Sparkles className="h-5 w-5 text-primary" /></div>
          <h2 className="mt-3 text-lg font-bold tracking-tight">Welkom — start hier</h2>
          <p className="mt-1 text-sm text-muted-foreground">Korte introductie: wat je moet weten voordat je begint.</p>
          <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary">Lees de introductie <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" /></span>
        </button>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setLocation("/uitleg")}
            className="group text-left rounded-2xl border border-border bg-card shadow-sm p-7 hover:border-primary/60 hover:shadow-md transition min-h-[220px] flex flex-col"
            data-testid="help-claude"
          >
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center"><TerminalIcon className="h-6 w-6 text-primary" /></div>
            <h2 className="mt-4 text-xl font-bold tracking-tight">Claude Code instellen</h2>
            <p className="mt-2 text-sm text-muted-foreground flex-1">Zo koppel je één keer je Claude-account en bewerk je daarna je website: abonnement, inloggen en de stappen in de terminal.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">Open de handleiding <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" /></span>
          </button>

          <button
            type="button"
            onClick={() => setLocation("/platform-uitleg")}
            className="group text-left rounded-2xl border border-border bg-card shadow-sm p-7 hover:border-primary/60 hover:shadow-md transition min-h-[220px] flex flex-col"
            data-testid="help-platform"
          >
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center"><BookOpen className="h-6 w-6 text-primary" /></div>
            <h2 className="mt-4 text-xl font-bold tracking-tight">Uitleg over het platform</h2>
            <p className="mt-2 text-sm text-muted-foreground flex-1">Een complete uitleg van alle functies: publiceren, je eigen domein, auto-SEO, abonnementen, Google en meer.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">Bekijk de uitleg <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" /></span>
          </button>
        </div>
      </div>
    </div>
  );
}
