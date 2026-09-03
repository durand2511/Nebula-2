/**
 * /welkom — introduction shown above the two guides on /help. A warm welcome + what you need to
 * know and read before you start. Fully bilingual via useLang().
 */
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Sparkles, CheckCircle2 } from "lucide-react";
import { useLang } from "@/lib/i18n";

export function Welkom() {
  const [, setLocation] = useLocation();
  const { t, lang } = useLang();
  const en = lang === "en";
  return (
    <div className="flex-1 w-full px-4 py-10 pb-20">
      <div className="mx-auto max-w-2xl">
        <button type="button" onClick={() => setLocation("/help")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-6" data-testid="button-back">
          <ArrowLeft className="h-4 w-4" /> {t("Terug", "Back")}
        </button>

        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary"><Sparkles className="h-3.5 w-3.5" /> {t("Introductie", "Introduction")}</div>
          <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">{t("Welkom bij mijn platform", "Welcome to my platform")}</h1>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            {t(
              "Fijn dat je er bent! Met Nebula bouw en beheer je je eigen professionele website — je typt gewoon in gewone taal wat je wilt, en Claude Code maakt het. Voordat je begint, is het handig om even twee dingen door te nemen. Zo haal je er meteen het meeste uit en zet je je site goed neer.",
              "Great to have you here! With Nebula you build and manage your own professional website — you simply type what you want in plain language, and Claude Code makes it happen. Before you start, it helps to go through two things. That way you get the most out of it right away and set your site up properly.",
            )}
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-card shadow-sm p-6 md:p-7">
          <h2 className="text-lg font-bold tracking-tight">{t("Wat je moet weten voor je begint", "What to know before you start")}</h2>
          <ul className="mt-3 space-y-2.5 text-[15px] text-muted-foreground">
            <li className="flex gap-2"><CheckCircle2 className="h-5 w-5 text-primary shrink-0" /> <span>{en ? <>First read the <strong className="text-foreground">platform guide</strong> — it explains how everything works: publishing, your own domain, auto-SEO, subscription and more.</> : <>Lees eerst de <strong className="text-foreground">uitleg over het platform</strong> — daarin staat hoe alles werkt: publiceren, je eigen domein, auto-SEO, abonnement en meer.</>}</span></li>
            <li className="flex gap-2"><CheckCircle2 className="h-5 w-5 text-primary shrink-0" /> <span>{en ? <>Then go through the <strong className="text-foreground">Claude Code guide</strong> — it explains step by step how to connect and how to build and edit your website.</> : <>Doorloop daarna de <strong className="text-foreground">Claude Code-handleiding</strong> — die legt stap voor stap uit hoe je koppelt en je website bouwt en bewerkt.</>}</span></li>
            <li className="flex gap-2"><CheckCircle2 className="h-5 w-5 text-primary shrink-0" /> <span>{t("Daarna kun je meteen aan de slag: typ wat je wilt, bekijk de preview en publiceer je site.", "After that you can get going right away: type what you want, check the preview and publish your site.")}</span></li>
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => setLocation("/help")} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid="welkom-back-help"><ArrowLeft className="h-4 w-4" /> {t("Terug naar de handleidingen", "Back to the guides")}</button>
          <span className="text-muted-foreground">·</span>
          <button type="button" onClick={() => setLocation("/ai-editor")} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid="welkom-start">{t("Naar mijn websites", "To my websites")} <ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
