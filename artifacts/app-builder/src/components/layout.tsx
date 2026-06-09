import { Link, useLocation } from "wouter";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isWorkspace = location.startsWith("/projects/") && location !== "/projects";

  return (
    <div className={`min-h-screen bg-background text-foreground flex flex-col flex-1 light`}>
      {!isWorkspace && (
        <header className="sticky top-0 z-50 w-full flex justify-center pt-6 pb-3">
          <nav className="flex items-center gap-1 rounded-full border border-border bg-card/90 backdrop-blur px-2 py-1.5 shadow-lg">
            <Link href="/" className={`rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${location === "/" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}>
              Jordy
            </Link>
            <Link href="/projects" className={`rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${location === "/projects" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}>
              Projects
            </Link>
            <Link href="/ai-editor" className={`rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${location === "/ai-editor" ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"}`}>
              Yogilates
            </Link>
          </nav>
        </header>
      )}
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
