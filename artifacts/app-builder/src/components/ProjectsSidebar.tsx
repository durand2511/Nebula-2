import { useState, useEffect } from "react";
import { Plus, Trash2, ExternalLink, Clock, Globe, ChevronLeft, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type AppProject, getProjects, deleteProject } from "@/lib/projects";
import { toast } from "sonner";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onNewProject: () => void;
  onOpenProject: (project: AppProject) => void;
  activeProjectId?: string | null;
}

const ProjectsSidebar = ({ isOpen, onClose, onNewProject, onOpenProject, activeProjectId }: Props) => {
  const [projects, setProjects] = useState<AppProject[]>([]);

  const loadProjects = async () => {
    const data = await getProjects();
    setProjects(data);
  };

  useEffect(() => {
    if (isOpen) loadProjects();
  }, [isOpen]);

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (!confirm(`Weet je zeker dat je "${name}" wilt verwijderen?`)) return;
    await deleteProject(id);
    await loadProjects();
    toast.success(`"${name}" verwijderd`);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Zojuist";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}u`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />}
      <div className={`fixed top-0 left-0 z-50 h-full w-72 bg-card border-r border-border shadow-2xl transition-transform duration-300 flex flex-col ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Projecten</span>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-3 py-3">
          <Button onClick={() => { onNewProject(); onClose(); }} size="sm" className="w-full justify-start">
            <Plus className="h-4 w-4 mr-2" />
            Nieuw project
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {projects.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground"><p className="text-xs">Nog geen projecten</p></div>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                onClick={() => { onOpenProject(p); onClose(); }}
                className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors group ${activeProjectId === p.id ? "bg-primary/10 border border-primary/20" : "hover:bg-secondary border border-transparent"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate flex-1">{p.name || "Naamloos project"}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {p.publishedUrl && (
                      <span onClick={(e) => { e.stopPropagation(); window.open(p.publishedUrl!, "_blank"); }} className="text-primary hover:text-primary/80">
                        <ExternalLink className="h-3 w-3" />
                      </span>
                    )}
                    <span onClick={(e) => handleDelete(e, p.id, p.name)} className="text-destructive hover:text-destructive/80">
                      <Trash2 className="h-3 w-3" />
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{formatDate(p.updatedAt)}</span>
                  {p.publishedUrl && <span className="flex items-center gap-1 text-primary"><Globe className="h-2.5 w-2.5" />Live</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectsSidebar;
