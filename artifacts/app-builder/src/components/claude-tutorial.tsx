/**
 * ClaudeTutorial — super-simple, step-by-step "jip-en-janneke" instructions for using Claude Code
 * as the website editor. Shown above the terminal (collapsible). Two blocks:
 *   1) eenmalig koppelen (abonnement kopen → account → inloggen in de terminal),
 *   2) hoe je daarna je website aanpast.
 */
import { ExternalLink, ShoppingCart, UserPlus, LogIn, Wand2, Check } from "lucide-react";

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="h-6 w-6 shrink-0 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">{n}</div>
        <div className="flex-1 w-px bg-white/10 my-1" />
      </div>
      <div className="pb-3">
        <div className="flex items-center gap-1.5 font-semibold text-white/90 text-[13px]">{icon}{title}</div>
        <div className="text-[12.5px] text-white/60 leading-relaxed mt-1 space-y-1">{children}</div>
      </div>
    </div>
  );
}

export function ClaudeTutorial({ connected }: { connected: boolean }) {
  return (
    <div className="text-white/70 space-y-4">
      {!connected && (
        <div>
          <div className="text-[13px] font-bold text-white/90 mb-2">Eerst één keer koppelen</div>
          <div>
            <Step n={1} icon={<ShoppingCart className="h-3.5 w-3.5 text-primary" />} title="Koop een Claude-abonnement">
              <p>Je bewerkt je website met Claude. Daar heb je een eigen Claude-abonnement voor nodig (dat is je enige kostenpost).</p>
              <a href="https://claude.ai/upgrade" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline font-medium">Ga naar claude.ai en kies Pro of Max <ExternalLink className="h-3 w-3" /></a>
            </Step>
            <Step n={2} icon={<UserPlus className="h-3.5 w-3.5 text-primary" />} title="Maak (of gebruik) je Claude-account">
              <p>Heb je nog geen account? Maak er één aan met je e-mailadres tijdens het afrekenen. Heb je er al één? Dan hoef je niets te doen.</p>
            </Step>
            <Step n={3} icon={<LogIn className="h-3.5 w-3.5 text-primary" />} title="Log in in de terminal hieronder">
              <p>In het zwarte venster hieronder verschijnt vanzelf een menu. Doe precies dit:</p>
              <ol className="list-decimal pl-4 space-y-0.5 mt-1">
                <li>Er staat al een keuze klaar: <span className="text-white/85 font-medium">"Claude account with subscription"</span>. Druk gewoon op <kbd className="px-1 py-0.5 rounded bg-white/10 text-white/80 text-[11px]">Enter</kbd>.</li>
                <li>Er verschijnt een <span className="text-white/85">link</span>. Klik erop (of kopieer 'm in je browser) en log in met je Claude-account.</li>
                <li>Je krijgt een <span className="text-white/85">code</span> te zien. Kopieer die.</li>
                <li>Klik in de terminal en plak de code (rechtermuisknop → plakken, of <kbd className="px-1 py-0.5 rounded bg-white/10 text-white/80 text-[11px]">⌘V</kbd> / <kbd className="px-1 py-0.5 rounded bg-white/10 text-white/80 text-[11px]">Ctrl&nbsp;V</kbd>) en druk op <kbd className="px-1 py-0.5 rounded bg-white/10 text-white/80 text-[11px]">Enter</kbd>.</li>
              </ol>
              <p className="mt-1">Klaar! Bovenaan verspringt het naar <span className="text-emerald-400 font-medium">"gekoppeld"</span>. Dit hoef je maar één keer te doen.</p>
            </Step>
          </div>
        </div>
      )}

      <div>
        <div className="text-[13px] font-bold text-white/90 mb-2 flex items-center gap-1.5">
          {connected && <Check className="h-4 w-4 text-emerald-400" />}
          Je website aanpassen
        </div>
        <div>
          <Step n={connected ? 1 : 4} icon={<Wand2 className="h-3.5 w-3.5 text-primary" />} title="Typ gewoon wat je wilt">
            <p>Schrijf in de terminal in gewone taal wat er anders moet. Bijvoorbeeld:</p>
            <ul className="space-y-1 mt-1">
              <li className="rounded bg-white/5 px-2 py-1 text-white/80">"Maak de titel op de homepage groter en zet 'm in het midden."</li>
              <li className="rounded bg-white/5 px-2 py-1 text-white/80">"Verander de knop 'Afspraak maken' naar de kleur groen."</li>
              <li className="rounded bg-white/5 px-2 py-1 text-white/80">"Voeg een pagina 'Over ons' toe met een korte tekst."</li>
            </ul>
            <p className="mt-1">Druk daarna op <kbd className="px-1 py-0.5 rounded bg-white/10 text-white/80 text-[11px]">Enter</kbd>. Claude gaat aan het werk.</p>
          </Step>
          <Step n={connected ? 2 : 5} icon={<Check className="h-3.5 w-3.5 text-primary" />} title="Bekijk het resultaat">
            <p>Je hoeft niets te bevestigen — Claude past je site direct aan. De wijziging verschijnt meteen in de <span className="text-white/85">preview</span> rechts en wordt automatisch opgeslagen.</p>
            <p>Niet tevreden? Typ gewoon wat er anders moet, bijvoorbeeld: <span className="text-white/80">"nee, maak 'm juist kleiner"</span>.</p>
          </Step>
          <Step n={connected ? 3 : 6} icon={<ExternalLink className="h-3.5 w-3.5 text-primary" />} title="Zet 'm online">
            <p>Blij met je site? Klik rechtsboven op de groene knop <span className="text-white/85 font-medium">"Publiceren"</span> om je website live te zetten op je Nebula-adres of je eigen domein.</p>
          </Step>
        </div>
        <p className="text-[11px] text-white/40 mt-1">Tip: typ <span className="text-white/60">/exit</span> om Claude te stoppen. De volgende keer start-ie vanzelf weer op.</p>
      </div>
    </div>
  );
}
