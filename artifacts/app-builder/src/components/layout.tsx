import { Link, useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isWorkspace = location.startsWith("/projects/") && location !== "/projects";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col flex-1 dark">
      {!isWorkspace && (
        <header className="sticky top-0 z-50 w-full border-b border-border/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="mx-auto w-full max-w-6xl flex h-16 items-center px-6">
            <Link href="/" className="mr-8" data-testid="link-home-logo">
              <Logo />
            </Link>
            <nav className="hidden sm:flex items-center gap-7 text-sm font-medium">
              <Link
                href="/projects"
                className={`transition-colors hover:text-foreground ${location === "/projects" ? "text-foreground" : "text-muted-foreground"}`}
              >
                Projects
              </Link>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <Link href="/">
                <Button size="sm" className="gap-1.5 font-medium" data-testid="button-new-project-nav">
                  <Plus className="h-4 w-4" />
                  New build
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
