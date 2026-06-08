import { useState } from "react";
import { useListProjects, useDeleteProject, getListProjectsQueryKey, getGetRecentProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { FileCode, MessageSquare, Clock, Plus, Trash2, Loader2, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function Projects() {
  const { data: projects, isLoading } = useListProjects();
  const queryClient = useQueryClient();
  const deleteProject = useDeleteProject();
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteProject.mutate(
      { projectId: pendingDelete.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
          setPendingDelete(null);
        },
      }
    );
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">All your generated applications</p>
        </div>
        <Link href="/">
          <Button data-testid="button-new-project">
            <Plus className="mr-2 h-4 w-4" /> New Project
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-[200px] rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => (
            <div key={project.id} className="relative group">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3 z-10 h-8 w-8 text-muted-foreground hover:text-destructive opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPendingDelete({ id: project.id, name: project.name });
                }}
                aria-label={`Delete ${project.name}`}
                data-testid={`button-delete-project-${project.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Link href={`/projects/${project.id}`} data-testid={`link-project-${project.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full flex flex-col">
                  <CardHeader>
                    <CardTitle className="pr-8">
                      {project.name}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">
                      {project.description || "No description"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <FileCode className="w-4 h-4" />
                        <span>{project.fileCount} files</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MessageSquare className="w-4 h-4" />
                        <span>{project.messageCount} msgs</span>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-4 border-t border-border/50 text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                  </CardFooter>
                </Card>
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No projects yet</h3>
          <p className="text-muted-foreground mb-6">Create your first application using natural language.</p>
          <Link href="/">
            <Button variant="secondary">Go to Home</Button>
          </Link>
        </div>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) { setPendingDelete(null); deleteProject.reset(); } }}>
        <AlertDialogContent className="light bg-white border-neutral-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-semibold text-neutral-900">Delete project?</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-neutral-600">
              This will permanently delete <span className="font-semibold text-neutral-900">{pendingDelete?.name}</span> and all of its files and messages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteProject.isError && (
            <p className="text-sm font-medium text-red-600" data-testid="text-delete-error">
              Couldn't delete the project. Please try again.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending} className="border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleteProject.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteProject.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
