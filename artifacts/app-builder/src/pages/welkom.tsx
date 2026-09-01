/**
 * /welkom — introduction shown above the two guides on /help. A warm welcome + what you need to
 * know and read before you start, pointing to the platform manual and the Claude Code setup guide.
 */
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, BookOpen, Terminal as TerminalIcon, Sparkles, CheckCircle2 } from "lucide-react";

export function Welkom() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex-1 w-full px-4 py-10 pb-20">
      <div className="mx-auto max-w-2xl">
        <button type="button" onClick={() => setLocation("/help")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-6" data-testid="button-back">
          <ArrowLeft className="h-4 w-4" /> Terug
        </button>

        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary"><Sparkles className="h-3.5 w-3.5" /> Introductie</div>
          <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Welkom bij mijn platform</h1>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Fijn dat je er bent! Met Nebula bouw en beheer je je eigen professionele website — je typt
            gewoon in gewone taal wat je wilt, en Claude Code maakt het. Voordat je begint, is het
            handig om even twee dingen door te nemen. Zo haal je er meteen het meeste uit en zet je je
            site goed neer.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-card shadow-sm p-6 md:p-7">
          <h2 className="text-lg font-bold tracking-tight">Wat je moet weten voor je begint</h2>
          <ul className="mt-3 space-y-2.5 text-[15px] text-muted-foreground">
            <li className="flex gap-2"><CheckCircle2 className="h-5 w-5 text-primary shrink-0" /> <span>Lees eerst de <strong className="text-foreground">uitleg over het platform</strong> — daarin staat hoe alles werkt: publiceren, je eigen domein, auto-SEO, abonnement en meer.</span></li>
            <li className="flex gap-2"><CheckCircle2 className="h-5 w-5 text-primary shrink-0" /> <span>Doorloop daarna de <strong className="text-foreground">Claude Code-handleiding</strong> — die legt stap voor stap uit hoe je koppelt en je website bouwt en bewerkt.</span></li>
            <li className="flex gap-2"><CheckCircle2 className="h-5 w-5 text-primary shrink-0" /> <span>Daarna kun je meteen aan de slag: typ wat je wilt, bekijk de preview en publiceer je site.</span></li>
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => setLocation("/help")} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid="welkom-back-help"><ArrowLeft className="h-4 w-4" /> Terug naar de handleidingen</button>
          <span className="text-muted-foreground">·</span>
          <button type="button" onClick={() => setLocation("/ai-editor")} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid="welkom-start">Naar mijn websites <ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
