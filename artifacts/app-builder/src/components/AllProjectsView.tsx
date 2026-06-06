import { useState, useEffect } from "react";
import { Plus, Search, Clock, Globe, Trash2, LayoutGrid, List } from "lucide-react";
import { type AppProject, getProjects, deleteProject } from "@/lib/projects";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  onNewProject: () => void;
  onOpenProject: (project: AppProject) => void;
}

const AllProjectsView = ({ onNewProject, onOpenProject }: Props) => {
  const [projects, setProjects] = useState<AppProject[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const loadProjects = async () => {
    const data = await getProjects();
    setProjects(data);
  };

  useEffect(() => {
    loadProjects();

    // Realtime subscription
    const channel = supabase
      .channel("projects-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects" },
        () => {
          loadProjects();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
    return `${days} dagen geleden`;
  };

  const filtered = projects.filter((p) =>
    (p.name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-foreground">Projecten</h1>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Zoek projecten..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            <button onClick={() => setView("grid")} className={`p-2 transition-colors ${view === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button onClick={() => setView("list")} className={`p-2 transition-colors ${view === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        {view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <button onClick={onNewProject} className="group flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed border-border hover:border-primary/40 transition-colors bg-card/30">
              <Plus className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="mt-2 text-sm text-muted-foreground group-hover:text-foreground transition-colors">Nieuw project</span>
            </button>

            {filtered.map((p) => (
              <button key={p.id} onClick={() => onOpenProject(p)} className="group text-left rounded-xl border border-border bg-card hover:border-primary/30 transition-all overflow-hidden">
                <div className="h-36 bg-muted/30 overflow-hidden relative">
                  {p.html ? (
                    <iframe srcDoc={p.html} className="w-full h-full scale-[0.25] origin-top-left pointer-events-none" style={{ width: "400%", height: "400%" }} title={p.name} sandbox="" />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Geen preview</div>
                  )}
                  {p.publishedUrl && (
                    <span className="absolute bottom-2 left-2 text-[10px] px-2 py-0.5 rounded bg-primary/20 text-primary font-medium">Published</span>
                  )}
                  <span onClick={(e) => handleDelete(e, p.id, p.name)} className="absolute top-2 right-2 p-1.5 rounded-md bg-card/80 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all">
                    <Trash2 className="h-3 w-3" />
                  </span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-sm font-medium text-foreground truncate">{p.name || "Naamloos project"}</p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Bewerkt {formatDate(p.updatedAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((p) => (
              <button key={p.id} onClick={() => onOpenProject(p)} className="w-full flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-card transition-colors group text-left">
                <div className="w-10 h-10 rounded-lg bg-muted/30 flex items-center justify-center shrink-0">
                  {p.publishedUrl ? <Globe className="h-4 w-4 text-primary" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.name || "Naamloos project"}</p>
                  <p className="text-xs text-muted-foreground">Bewerkt {formatDate(p.updatedAt)}</p>
                </div>
                <span onClick={(e) => handleDelete(e, p.id, p.name)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all">
                  <Trash2 className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 && projects.length > 0 && (
          <p className="text-center text-muted-foreground text-sm py-12">Geen projecten gevonden voor "{search}"</p>
        )}
      </div>
    </div>
  );
};

export default AllProjectsView;
