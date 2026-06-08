import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateProject, getListProjectsQueryKey, getGetRecentProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Loader2 } from "lucide-react";
import logoUrl from "@assets/JRD_logo_trimmed.png";

export function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  
  const createProject = useCreateProject();

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
      <div className="flex justify-center mb-12">
        <img src={logoUrl} alt="JRD" className="h-44 w-auto" />
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
              className="font-bold disabled:opacity-100"
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
    </div>
  );
}
