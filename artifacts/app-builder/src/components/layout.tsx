import { Link, useLocation } from "wouter";
import bgUrl from "@assets/AdobeStock_352407837_1781027880746.jpeg";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isWorkspace = location.startsWith("/projects/") && location !== "/projects";

  return (
    <div className={`relative min-h-screen text-foreground flex flex-col flex-1 light ${isWorkspace ? "bg-background" : ""}`}>
      {!isWorkspace && (
        <>
          <div
            className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${bgUrl})` }}
            aria-hidden="true"
          />
          <div className="fixed inset-0 -z-10 bg-white/30" aria-hidden="true" />
        </>
      )}
      {!isWorkspace && (
        <header className="sticky top-0 z-50 w-full flex justify-center pt-4 pb-2">
          <nav className="flex items-center gap-0.5 rounded-full border border-border bg-card/90 backdrop-blur px-1.5 py-1 shadow-md">
            {/* Plain anchor (NOT a wouter Link) so it escapes the /app base and returns to the marketing
                site at the domain root. When the marketing root isn't active this simply goes to the app home. */}
            <a href="/" className="rounded-full px-3.5 py-1 text-xs font-medium transition-colors text-foreground/60 hover:text-foreground hover:bg-foreground/5">
              ← Website
            </a>
            <Link href="/" className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${location === "/" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}>
              Home
            </Link>
            <Link href="/ai-editor" className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors ${(location === "/ai-editor" || location === "/projects") ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}>
              Nebula
            </Link>
          </nav>
        </header>
      )}
      <main className="flex-1 flex flex-col">{children}</main>
      {!isWorkspace && (
        <footer className="w-full mt-auto py-6 px-4">
          <div className="mx-auto max-w-3xl flex flex-col items-center gap-2 text-xs text-foreground/60">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <Link href="/privacy" className="hover:text-foreground hover:underline">Privacybeleid</Link>
              <Link href="/voorwaarden" className="hover:text-foreground hover:underline">Algemene voorwaarden</Link>
              <a href="mailto:durand2511@gmail.com" className="hover:text-foreground hover:underline">Contact</a>
            </div>
            <p>© {new Date().getFullYear()} Nebula — Durand van Konijnenburg · KVK 70776857</p>
          </div>
        </footer>
      )}
    </div>
  );
}
