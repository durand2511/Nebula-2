import { useState } from "react";
import { useLocation } from "wouter";
import {
  useImportProjectFromUrl,
  getListProjectsQueryKey,
  getGetRecentProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Globe, Loader2, Sparkles } from "lucide-react";

export function AiEditor() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const importProject = useImportProjectFromUrl();

  const handleImport = () => {
    const trimmed = url.trim();
    if (!trimmed || importProject.isPending) return;
    setError(null);

    importProject.mutate(
      { data: { url: trimmed } },
      {
        onSuccess: (project) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
          setLocation(`/projects/${project.id}`);
        },
        onError: (err: unknown) => {
          const fallback =
            "We konden deze website niet importeren. Controleer de URL en probeer het opnieuw.";
          let message = fallback;
          if (err && typeof err === "object") {
            const data = (err as { data?: unknown }).data;
            const serverError =
              data && typeof data === "object" && "error" in data
                ? (data as { error?: unknown }).error
                : undefined;
            if (typeof serverError === "string" && serverError.trim()) {
              message = serverError;
            }
          }
          setError(message);
        },
      },
    );
  };

  return (
    <div className="flex-1 flex flex-col items-center pt-24 px-4 pb-12 w-full max-w-4xl mx-auto">
      <div className="flex flex-col items-center text-center mb-10">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-card shadow-sm mb-6">
          <Globe className="h-7 w-7 text-foreground" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight mb-3">AI Editor</h1>
        <p className="text-muted-foreground max-w-md text-base leading-relaxed">
          Plak de link van een bestaande website. Buildly haalt de pagina op,
          waarna je hem met AI kunt aanpassen.
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <div className="relative bg-card rounded-xl border border-border shadow-lg p-2 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 flex items-center">
            <Globe className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleImport();
              }}
              placeholder="bijv. stripe.com of https://voorbeeld.nl"
              className="h-12 border-0 bg-transparent pl-9 text-base focus-visible:ring-0"
              data-testid="input-import-url"
              autoFocus
            />
          </div>
          <Button
            size="lg"
            onClick={handleImport}
            disabled={!url.trim() || importProject.isPending}
            className="h-12 font-bold disabled:opacity-100 shrink-0"
            data-testid="button-import-url"
          >
            {importProject.isPending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Importeren...
              </>
            ) : (
              <>
                Website importeren
                <ArrowRight className="ml-2 h-5 w-5" />
              </>
            )}
          </Button>
        </div>

        {error && (
          <p
            className="mt-3 text-sm text-destructive text-center"
            data-testid="text-import-error"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex items-start gap-2 justify-center text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-foreground/50" />
          <span className="max-w-md text-center">
            We importeren de opmaak en stijl van de pagina als startpunt.
            Interactieve scripts worden niet meegenomen — die bouw je daarna
            opnieuw op met AI.
          </span>
        </div>
      </div>
    </div>
  );
}
