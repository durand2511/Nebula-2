import { Link, useLocation } from "wouter";
import { bgUrl } from "@/lib/background";
import { useLang } from "@/lib/i18n";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { t, lang, setLang } = useLang();
  const isWorkspace = location.startsWith("/projects/") && location !== "/projects";
  // The mobile assistant (PWA) is a full-screen app: no nav pill, no footer, no page background.
  const chromeless = isWorkspace || location === "/assistent";

  return (
    // The editor workspace + mobile assistant must be EXACTLY viewport height (h-screen + overflow-hidden)
    // so their internal panels scroll. Other pages keep min-h-screen so they grow + scroll normally.
    <div className={`relative text-foreground flex flex-col light ${chromeless ? "h-screen overflow-hidden bg-background" : "min-h-screen flex-1"}`}>
      {!chromeless && (
        <>
          <div
            className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${bgUrl})` }}
            aria-hidden="true"
          />
          <div className="fixed inset-0 -z-10 bg-white/55" aria-hidden="true" />
        </>
      )}
      {!chromeless && (
        <header className="sticky top-0 z-50 w-full flex justify-center pt-4 pb-2">
          <nav className="flex items-center gap-0.5 rounded-full border border-border bg-card/90 backdrop-blur px-1.5 py-1 shadow-md">
            <Link href="/" className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${location === "/" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}>
              Home
            </Link>
            <Link href="/ai-editor" className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${(location === "/ai-editor" || location === "/projects") ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}>
              Nebula
            </Link>
            <Link href="/app" className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${(location === "/app" || location === "/assistent") ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}>
              {t("Nebula app", "Nebula app")}
            </Link>
            <Link href="/help" className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${(location === "/help" || location === "/uitleg" || location === "/platform-uitleg") ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}>
              {t("Uitleg", "Guide")}
            </Link>
            {/* Server-rendered SEO pages — a real <a>, not a wouter Link, so the browser leaves the SPA. */}
            <a href={t("/kennisbank", "/en/kennisbank")} className="rounded-full px-3.5 py-1 text-xs font-medium transition-colors text-foreground/60 hover:text-foreground hover:bg-foreground/5">
              {t("Kennisbank", "Knowledge base")}
            </a>
            {/* Language toggle — switches the WHOLE platform; shows the flag of the language you switch to. */}
            <button
              onClick={() => setLang(lang === "en" ? "nl" : "en")}
              className="ml-0.5 rounded-full px-2 py-1 text-base leading-none transition-colors hover:bg-foreground/5"
              title={lang === "en" ? "Nederlands" : "English"}
              aria-label={lang === "en" ? "Schakel naar Nederlands" : "Switch to English"}
              data-testid="button-lang-toggle"
            >
              {lang === "en" ? "🇳🇱" : "🇬🇧"}
            </button>
          </nav>
        </header>
      )}
      <main className={`flex-1 flex flex-col ${chromeless ? "min-h-0" : ""}`}>{children}</main>
      {!chromeless && (
        <footer className="w-full mt-auto py-6 px-4">
          <div className="mx-auto max-w-3xl flex flex-col items-center gap-2 text-xs text-foreground/60">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <Link href="/privacy" className="hover:text-foreground hover:underline">{t("Privacybeleid", "Privacy policy")}</Link>
              <Link href="/voorwaarden" className="hover:text-foreground hover:underline">{t("Algemene voorwaarden", "Terms & conditions")}</Link>
              <a href="mailto:durand2511@gmail.com" className="hover:text-foreground hover:underline">Contact</a>
            </div>
            <p>© {new Date().getFullYear()} Nebula · Durand van Konijnenburg · KVK 70776857</p>
          </div>
        </footer>
      )}
    </div>
  );
}
