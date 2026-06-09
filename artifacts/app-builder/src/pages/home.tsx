import { useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useCreateProject, getListProjectsQueryKey, getGetRecentProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Loader2, ImagePlus, X } from "lucide-react";
import logoUrl from "@assets/JRD_logo_trimmed.png";
import {
  fileToReferenceImage,
  MAX_ATTACHED_IMAGES,
  type AttachedImage,
} from "@/lib/image";

export function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createProject = useCreateProject();

  const addImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const processed = await Promise.all(imageFiles.map(fileToReferenceImage));
    setAttachedImages((prev) => [...prev, ...processed].slice(0, MAX_ATTACHED_IMAGES));
  }, []);

  const handleImageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    void addImageFiles(files);
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.some((f) => f.type.startsWith("image/"))) {
      void addImageFiles(files);
    }
  };

  const removeAttachedImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleCreate = () => {
    if (!prompt.trim() && attachedImages.length === 0) return;

    // Generate a quick name based on prompt
    const base = prompt.trim() || "Reference design";
    const name = base.split(" ").slice(0, 3).join(" ") + " App";

    createProject.mutate(
      { data: { name, description: prompt } },
      {
        onSuccess: (project) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
          // Store prompt + images so workspace auto-sends them as the first AI message
          sessionStorage.setItem(`initial-prompt-${project.id}`, prompt);
          if (attachedImages.length > 0) {
            sessionStorage.setItem(
              `initial-images-${project.id}`,
              JSON.stringify(attachedImages.map((img) => img.dataUrl))
            );
          }
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
            onPaste={handlePaste}
            placeholder="Build a habit tracker with a dark theme and daily streaks... (or attach a screenshot to match its style)"
            className="min-h-[160px] resize-none border-0 bg-transparent text-lg focus-visible:ring-0 p-4"
            data-testid="input-home-prompt"
          />
          {attachedImages.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              {attachedImages.map((img) => (
                <div
                  key={img.id}
                  className="relative h-20 w-20 rounded-md overflow-hidden border border-border group"
                >
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachedImage(img.id)}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/80 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove image"
                    data-testid={`button-remove-image-${img.id}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between items-center px-4 pb-2 pt-2 border-t border-border/50">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageInput}
              data-testid="input-image-file"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachedImages.length >= MAX_ATTACHED_IMAGES}
              className="gap-2 text-muted-foreground hover:text-foreground"
              data-testid="button-attach-image"
            >
              <ImagePlus className="h-4 w-4" />
              Attach image
            </Button>
            <Button 
              size="lg" 
              onClick={handleCreate} 
              disabled={(!prompt.trim() && attachedImages.length === 0) || createProject.isPending}
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
