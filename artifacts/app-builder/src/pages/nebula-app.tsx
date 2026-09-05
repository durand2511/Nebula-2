/**
 * /app — "Nebula app" tab. Promotes and installs the mobile PWA: talk to Claude by voice and let it
 * change your Nebula website live from your phone. Installs via the browser (add to home screen), so
 * there's no App Store. The actual assistant lives at /assistent.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useLang } from "@/lib/i18n";
import { Mic, MessageSquare, BarChart3, Server, Share, Plus, ArrowRight, Smartphone, Download } from "lucide-react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function NebulaApp() {
  const [, setLocation] = useLocation();
  const { t } = useLang();
  const [installEvt, setInstallEvt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    setIsIOS(/iphone|ipad|ipod/i.test(ua));
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(!!standalone);
    const onBIP = (e: Event) => { e.preventDefault(); setInstallEvt(e as BIPEvent); };
    const onInstalled = () => { setInstalled(true); setInstallEvt(null); };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onBIP); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  async function install() {
    if (!installEvt) return;
    await installEvt.prompt();
    try { await installEvt.userChoice; } catch { /* ignore */ }
    setInstallEvt(null);
  }

  const features = [
    { icon: Mic, title: t("Praat gewoon", "Just talk"), body: t("Houd de knop ingedrukt en zeg wat er anders moet. Je stem wordt omgezet naar loepzuivere tekst.", "Hold the button and say what you want changed. Your voice becomes crisp Dutch text.") },
    { icon: MessageSquare, title: t("Claude past alles aan", "Claude changes anything"), body: t("Teksten, kleuren, pagina's, prijzen — Claude wijzigt je site en praat hardop terug wat hij deed.", "Text, colours, pages, prices — Claude edits your site and speaks back what it did.") },
    { icon: BarChart3, title: t("Vraag je cijfers", "Ask your numbers"), body: t("\"Hoeveel bezoekers had ik deze week?\" — vraag het gewoon en je krijgt antwoord.", "\"How many visitors this week?\" — just ask and get an answer.") },
    { icon: Server, title: t("Werkt via de server", "Runs on the server"), body: t("Alles draait server-side. De web-editor hoeft niet open te staan — je wijzigingen gaan meteen live.", "Everything runs server-side. The web editor doesn't need to be open — your changes go live instantly.") },
  ];

  return (
    <div className="flex-1 w-full px-4 py-12 pb-20">
      <div className="mx-auto max-w-3xl">
        {/* Hero */}
        <div className="text-center">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Smartphone className="h-8 w-8 text-primary" />
          </div>
          <h1 className="mt-5 text-3xl md:text-4xl font-bold tracking-tight">{t("De Nebula app", "The Nebula app")}</h1>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto text-[15px] leading-relaxed">
            {t("Praat met Claude vanaf je telefoon en je website past zichzelf aan. Geen App Store nodig — installeer 'm rechtstreeks in één tik.",
               "Talk to Claude from your phone and your website changes itself. No App Store needed — install it directly in one tap.")}
          </p>

          <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => setLocation("/assistent")}
              className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-6 py-3 text-sm font-semibold hover:opacity-90 transition"
            >
              <Mic className="h-4 w-4" /> {t("Open de assistent", "Open the assistant")}
            </button>
            {installEvt && !installed && (
              <button onClick={install} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3 text-sm font-semibold hover:border-primary/60 transition">
                <Download className="h-4 w-4" /> {t("Installeer op dit toestel", "Install on this device")}
              </button>
            )}
          </div>
          {installed && <p className="mt-3 text-sm text-emerald-600 font-medium">{t("✓ De app is geïnstalleerd op dit toestel.", "✓ The app is installed on this device.")}</p>}
        </div>

        {/* Install instructions */}
        {!installed && (
          <div className="mt-10 rounded-2xl border border-border bg-card shadow-sm p-6">
            <h2 className="text-lg font-bold tracking-tight">{t("Op je beginscherm zetten", "Add it to your home screen")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("Open deze pagina op je telefoon en volg de stappen. Daarna staat Nebula als een echte app op je scherm.", "Open this page on your phone and follow the steps. Nebula then sits on your screen like a real app.")}</p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className={`rounded-xl border p-4 ${isIOS ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                <div className="text-sm font-semibold flex items-center gap-2"><span className="text-base"></span>iPhone / iPad (Safari)</div>
                <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Share className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> {t("Tik op de deel-knop onderin.", "Tap the Share button at the bottom.")}</li>
                  <li className="flex items-start gap-2"><Plus className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> {t("Kies 'Zet op beginscherm'.", "Choose 'Add to Home Screen'.")}</li>
                  <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> {t("Tik op 'Voeg toe' — klaar.", "Tap 'Add' — done.")}</li>
                </ol>
              </div>
              <div className={`rounded-xl border p-4 ${!isIOS ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                <div className="text-sm font-semibold flex items-center gap-2"><span className="text-base"></span>Android (Chrome)</div>
                <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Download className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> {t("Tik hierboven op 'Installeer op dit toestel'.", "Tap 'Install on this device' above.")}</li>
                  <li className="flex items-start gap-2"><Plus className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> {t("Of: menu (⋮) → 'App installeren'.", "Or: menu (⋮) → 'Install app'.")}</li>
                  <li className="flex items-start gap-2"><ArrowRight className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> {t("Bevestig — klaar.", "Confirm — done.")}</li>
                </ol>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{t("Op de computer? Open ", "On a computer? Open ")}<span className="font-mono text-foreground">nebulabookings.com/app</span>{t(" op je telefoon.", " on your phone.")}</p>
          </div>
        )}

        {/* Features */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card shadow-sm p-5">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center"><f.icon className="h-5 w-5 text-primary" /></div>
              <h3 className="mt-3 text-base font-bold tracking-tight">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          {t("Je moet ingelogd zijn en je Claude-account gekoppeld hebben. De app gebruikt dezelfde live sessie als de web-editor.",
             "You need to be logged in with your Claude account linked. The app uses the same live session as the web editor.")}
        </p>
      </div>
    </div>
  );
}
