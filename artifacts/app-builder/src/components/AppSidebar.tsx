import { useState, useEffect } from "react";
import { Home, FolderOpen, Clock, Plus, Trash2 } from "lucide-react";
import mellowLogo from "@/assets/mellow-logo.png";
import { type AppProject, getProjects, deleteProject } from "@/lib/projects";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Props {
  onNewProject: () => void;
  onOpenProject: (project: AppProject) => void;
  onShowAllProjects: () => void;
  onGoHome: () => void;
  activeProjectId?: string | null;
  currentView: "home" | "editor" | "projects";
}

const AppSidebar = ({
  onNewProject,
  onOpenProject,
  onShowAllProjects,
  onGoHome,
  activeProjectId,
  currentView,
}: Props) => {
  const { signOut } = useAuth();
  const [projects, setProjects] = useState<AppProject[]>([]);

  const loadProjects = async () => {
    const data = await getProjects();
    setProjects(data);
  };

  useEffect(() => {
    loadProjects();
    const interval = setInterval(loadProjects, 5000);
    return () => clearInterval(interval);
  }, []);

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
    if (mins < 60) return `${mins} min geleden`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} uur geleden`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} dagen geleden`;
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  };

  const recentProjects = projects.slice(0, 10);

  return (
    <aside className="w-56 shrink-0 h-screen flex flex-col bg-sidebar-background border-r border-sidebar-border">
      <div className="px-4 py-4 flex items-center gap-2.5">
        <img src={mellowLogo} alt="Mellow" className="w-7 h-7 rounded-md object-contain" />
        <span className="text-sm font-semibold text-sidebar-foreground">Mellow</span>
      </div>

      <nav className="px-2 space-y-0.5">
        <button
          onClick={onGoHome}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
            currentView === "home" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
          }`}
        >
          <Home className="h-4 w-4" />
          Home
        </button>
      </nav>

      <div className="mt-5 px-2">
        <p className="px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Projecten</p>
        <button
          onClick={onShowAllProjects}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
            currentView === "projects" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
          }`}
        >
          <FolderOpen className="h-4 w-4" />
          Alle projecten
        </button>
      </div>

      <div className="mt-5 px-2 flex-1 overflow-hidden flex flex-col">
        <p className="px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Recent</p>
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {recentProjects.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">Nog geen projecten</p>
          ) : (
            recentProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => onOpenProject(p)}
                className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors group ${
                  activeProjectId === p.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                }`}
              >
                <div className="w-4 h-4 rounded bg-muted flex items-center justify-center shrink-0">
                  <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                </div>
                <span className="truncate flex-1">{p.name || "Naamloos"}</span>
                <span
                  onClick={(e) => handleDelete(e, p.id, p.name)}
                  className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
                >
                  <Trash2 className="h-3 w-3" />
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
        <button
          onClick={onNewProject}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nieuw project
        </button>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-destructive hover:bg-destructive/10 transition-colors"
        >
          Uitloggen
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
