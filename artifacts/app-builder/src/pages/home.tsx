import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateProject, useGetRecentProjects, getListProjectsQueryKey, getGetRecentProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Loader2, ArrowUpRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";

const EXAMPLE_PROMPTS = [
  "A habit tracker with daily streaks and a calendar view",
  "A personal finance dashboard with budgets and charts",
  "A recipe box with search, tags, and a shopping list",
  "A kanban board for managing tasks across projects",
];

export function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");

  const createProject = useCreateProject();
  const { data: recentProjects, isLoading: isLoadingRecent } = useGetRecentProjects();

  const handleCreate = () => {
    if (!prompt.trim()) return;

    const name = prompt.split(" ").slice(0, 3).join(" ") + " App";

    createProject.mutate(
      { data: { name, description: prompt } },
      {
        onSuccess: (project) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
          sessionStorage.setItem(`initial-prompt-${project.id}`, prompt);
          setLocation(`/projects/${project.id}`);
        },
      }
    );
  };

  return (
    <div className="relative flex-1 flex flex-col w-full">
      {/* Blueprint texture backdrop — the Foundry surface */}
      <div className="pointer-events-none absolute inset-0 bg-blueprint mask-fade-b opacity-50" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-3xl mx-auto px-6 pt-24 pb-20">
        {/* Hero */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground mb-7">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            From prompt to running app
          </div>
          <h1 className="font-display text-5xl md:text-6xl font-bold tracking-tight leading-[1.02] text-foreground">
            Forge software
            <br />
            <span className="text-primary">from a sentence.</span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-xl leading-relaxed">
            Describe the app you have in mind. Buildly drafts the blueprint, writes
            every file, and hands you a working build you can watch come together live.
          </p>
        </div>

        {/* Composer */}
        <div className="rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Build a habit tracker with daily streaks and a dark theme..."
            className="min-h-[150px] resize-none border-0 bg-transparent text-base focus-visible:ring-0 p-5"
            data-testid="input-home-prompt"
          />
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border/70 bg-background/40">
            <span className="font-mono text-xs text-muted-foreground">
              describe → blueprint → build
            </span>
            <Button
              size="lg"
              onClick={handleCreate}
              disabled={!prompt.trim() || createProject.isPending}
              className="font-medium"
              data-testid="button-create-from-prompt"
            >
              {createProject.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Forging...
                </>
              ) : (
                <>
                  Start build
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Example chips */}
        <div className="mt-5 flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              className="rounded-full border border-border bg-card/40 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              data-testid={`chip-example-${ex.slice(0, 8)}`}
            >
              {ex}
            </button>
          ))}
        </div>

        {/* Recent builds */}
        <div className="mt-20">
          <div className="flex items-end justify-between mb-5">
            <div>
              <h2 className="font-display text-xl font-semibold">Recent builds</h2>
              <p className="text-sm text-muted-foreground mt-0.5">Pick up where you left off</p>
            </div>
            <Link
              href="/projects"
              className="text-sm font-medium text-primary hover:underline underline-offset-4"
              data-testid="link-view-all-projects"
            >
              View all
            </Link>
          </div>

          {isLoadingRecent ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-card border border-border animate-pulse" />
              ))}
            </div>
          ) : recentProjects && recentProjects.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recentProjects.slice(0, 4).map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <div
                    className="group h-full rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                    data-testid={`card-recent-${project.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display font-semibold text-foreground leading-snug">
                        {project.name}
                      </h3>
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0 transition-colors group-hover:text-primary" />
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                      {project.description || "No description"}
                    </p>
                    <p className="mt-3 font-mono text-[11px] text-muted-foreground/70">
                      {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No builds yet. Describe an app above to forge your first one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
