import { Link, useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isWorkspace = location.startsWith("/projects/") && location !== "/projects";

  return (
    <div className={`min-h-screen bg-background text-foreground flex flex-col flex-1 ${isWorkspace ? "dark" : "light"}`}>
      {!isWorkspace && (
        <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 items-center px-4">
            <nav className="flex items-center space-x-6 text-sm font-medium">
              <Link href="/" className={`transition-colors hover:text-foreground/80 ${location === "/" ? "text-foreground" : "text-foreground/60"}`}>
                Home
              </Link>
              <Link href="/projects" className={`transition-colors hover:text-foreground/80 ${location === "/projects" ? "text-foreground" : "text-foreground/60"}`}>
                Projects
              </Link>
            </nav>
            <div className="ml-auto flex items-center space-x-4">
              <Link href="/">
                <Button variant="secondary" size="sm" className="gap-2" data-testid="button-new-project-nav">
                  <Plus className="h-4 w-4" />
                  New App
                </Button>
              </Link>
            </div>
          </div>
        </header>
      )}
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
