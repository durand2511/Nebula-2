import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateProject, useGetRecentProjects, getListProjectsQueryKey, getGetRecentProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowRight, Loader2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";

export function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  
  const createProject = useCreateProject();
  const { data: recentProjects, isLoading: isLoadingRecent } = useGetRecentProjects();

  const handleCreate = () => {
    if (!prompt.trim()) return;
    
    // Generate a quick name based on prompt
    const name = prompt.split(" ").slice(0, 3).join(" ") + " App";
    
    createProject.mutate(
      { data: { name, description: prompt } },
      {
        onSuccess: (project) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
          // Store prompt so workspace auto-sends it as the first AI message
          sessionStorage.setItem(`initial-prompt-${project.id}`, prompt);
          setLocation(`/projects/${project.id}`);
        }
      }
    );
  };

  return (
    <div className="flex-1 flex flex-col items-center pt-24 px-4 pb-12 w-full max-w-4xl mx-auto">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-foreground">
          What do you want to <span className="text-primary">build?</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Describe your app in natural language. We'll generate the code, set up the database, and deploy it.
        </p>
      </div>

      <div className="w-full max-w-3xl relative mb-20">
        <div className="relative bg-card rounded-xl border border-border shadow-lg p-2 flex flex-col">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Build a habit tracker with a dark theme and daily streaks..."
            className="min-h-[160px] resize-none border-0 bg-transparent text-lg focus-visible:ring-0 p-4"
            data-testid="input-home-prompt"
          />
          <div className="flex justify-end items-center px-4 pb-2 pt-2 border-t border-border/50">
            <Button 
              size="lg" 
              onClick={handleCreate} 
              disabled={!prompt.trim() || createProject.isPending}
              className="font-bold"
              data-testid="button-create-from-prompt"
            >
              {createProject.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Building...
                </>
              ) : (
                <>
                  Generate App
                  <ArrowRight className="ml-2 h-5 w-5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-5 h-5 text-muted-foreground" />
            Recent Projects
          </h2>
          <Link href="/projects" className="text-sm text-primary hover:underline" data-testid="link-view-all-projects">
            View all
          </Link>
        </div>

        {isLoadingRecent ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map(i => (
              <div key={i} className="h-32 rounded-xl bg-card border border-border animate-pulse" />
            ))}
          </div>
        ) : recentProjects && recentProjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recentProjects.slice(0, 4).map(project => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full bg-card hover:bg-card/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">
                      {project.name}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">{project.description || "No description"}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">
                      Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center p-12 border border-dashed border-border rounded-xl text-muted-foreground">
            No recent projects. Start by typing a prompt above.
          </div>
        )}
      </div>
    </div>
  );
}
