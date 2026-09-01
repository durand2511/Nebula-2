/**
 * /claude — "Claude koppelen": one button, one terminal. Claude Code starts on the server in the
 * user's own (empty) home; the CLI's own login flow runs in the terminal (link → log in with your
 * Claude subscription → paste the code). As soon as the login is detected the page flips to
 * "gekoppeld" and sends the user on to their websites.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ClaudeTerminal } from "@/components/claude-terminal";
import { getToken } from "@/lib/session";
import { ArrowLeft, ArrowRight, Check, ExternalLink, Sparkles, Unplug } from "lucide-react";

export function ClaudeConnect() {
  const [, setLocation] = useLocation();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) { setLocation("/ai-editor"); return; }
    fetch("/api/claude/status").then((r) => r.json()).then((d) => setConnected(!!d.connected)).catch(() => setConnected(false));
  }, [setLocation]);

  const disconnect = async () => {
    if (!window.confirm("Claude ontkoppelen? Je kunt daarna opnieuw inloggen met je Claude-account.")) return;
    setBusy(true);
    try { await fetch("/api/claude/disconnect", { method: "POST" }); setConnected(false); } finally { setBusy(false); }
  };

  return (
    <div className="flex-1 w-full px-4 py-8 pb-16">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={() => setLocation("/ai-editor")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4" data-testid="button-back">
          <ArrowLeft className="h-4 w-4" /> Terug naar mijn websites
        </button>

        <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
          <div className="p-6 md:p-8 border-b border-border/60 flex flex-wrap items-start gap-6">
            <div className="flex-1 min-w-[260px]">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Claude Code</div>
              <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">Koppel je Claude-account</h1>
              <p className="mt-2 text-muted-foreground max-w-xl">
                Je website wordt bewerkt door Claude Code, met jouw eigen Claude-abonnement. Koppelen doe je één keer:
                Claude start hieronder, geeft je een link, je logt in bij Claude en plakt de code terug in de terminal. Daarna is alles gekoppeld.
              </p>
              <ol className="mt-4 space-y-1.5 text-sm text-foreground/80 list-decimal pl-5">
                <li>Nog geen abonnement? <a className="text-primary font-medium hover:underline inline-flex items-center gap-1" href="https://claude.ai/upgrade" target="_blank" rel="noreferrer">Koop een Claude-abonnement <ExternalLink className="h-3 w-3" /></a> (Pro of Max).</li>
                <li>Kies in de terminal <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">Claude account with subscription</span> en open de link.</li>
                <li>Log in, kopieer de code en plak 'm in de terminal (rechtermuisknop of ⌘V / Ctrl+V).</li>
              </ol>
            </div>
            <div className="w-full sm:w-auto">
              {connected === null ? (
                <div className="text-sm text-muted-foreground">Status ophalen…</div>
              ) : connected ? (
                <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 p-4 min-w-[240px]">
                  <div className="flex items-center gap-2 text-emerald-800 font-semibold"><Check className="h-4 w-4" /> Claude is gekoppeld</div>
                  <p className="text-xs text-emerald-900/80 mt-1">Je kunt je websites nu bewerken met Claude Code.</p>
                  <Button className="mt-3 w-full gap-2" onClick={() => setLocation("/ai-editor")} data-testid="button-go-websites">Naar mijn websites <ArrowRight className="h-4 w-4" /></Button>
                  <button type="button" onClick={disconnect} disabled={busy} className="mt-2 w-full text-xs text-muted-foreground hover:text-destructive inline-flex items-center justify-center gap-1" data-testid="button-disconnect"><Unplug className="h-3 w-3" /> Ontkoppelen</button>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 min-w-[240px]">
                  <div className="text-amber-900 font-semibold">Nog niet gekoppeld</div>
                  <p className="text-xs text-amber-900/80 mt-1">Volg de stappen in de terminal hieronder.</p>
                </div>
              )}
            </div>
          </div>

          <div className="p-3 md:p-4 bg-[#0f0e14]">
            <ClaudeTerminal projectId={0} className="h-[520px]" onConnected={(c) => { if (c) setConnected(true); }} />
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Je Claude-login wordt versleuteld bewaard bij je Nebula-account en alleen gebruikt om Claude Code voor jou te starten. Nebula heeft geen toegang tot je Claude-wachtwoord.
        </p>
      </div>
    </div>
  );
}
