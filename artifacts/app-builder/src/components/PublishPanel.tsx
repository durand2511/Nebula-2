import { useState } from "react";
import { Globe, Copy, ExternalLink, CheckCircle2, X, Eye, EyeOff, Clock, AlertCircle, ShoppingCart, Link2, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { AppProject, DomainStatus } from "@/lib/projects";

interface Props {
  project: AppProject;
  html: string;
  onUpdate: (updates: Partial<AppProject>) => void;
  onClose: () => void;
}

const PublishPanel = ({ project, html, onUpdate, onClose }: Props) => {
  const [appName, setAppName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [domain, setDomain] = useState(project.domain);
  const [visibility, setVisibility] = useState(project.visibility);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showDns, setShowDns] = useState(false);

  const domainStatus: DomainStatus = project.domainStatus || "none";
  const hasDomain = project.domain.trim().length > 0;

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/publish-app`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Publiceren mislukt");
      onUpdate({ name: appName, description, domain, visibility, publishedUrl: data.url, domainStatus: hasDomain ? (domainStatus === "connected" ? "connected" : "pending") : "none" });
      toast.success("App gepubliceerd!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publiceren mislukt");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleSave = () => {
    onUpdate({ name: appName, description, visibility });
    toast.success("Instellingen opgeslagen");
  };

  const cp = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast.success("Gekopieerd!"); } catch { toast.error("Kopiëren mislukt"); }
  };

  const handleSaveDomain = () => {
    const val = domain.trim();
    if (!val) {
      onUpdate({ domain: "", domainStatus: "none" });
      toast.success("Domein verwijderd");
      setShowDns(false);
      return;
    }
    onUpdate({ domain: val, domainStatus: "pending" });
    toast("Domein opgeslagen", { description: "Volg de DNS-instructies hieronder om je domein te verbinden." });
    setShowDns(true);
  };

  const handleBuy = () => {
    toast.info("Je wordt doorgestuurd naar IONOS om een domein te kopen.");
    setTimeout(() => window.open("https://www.ionos.nl/domein-registreren", "_blank"), 600);
  };

  const handleMarkConnected = () => {
    onUpdate({ domain, domainStatus: "connected" });
    toast.success("Domein gemarkeerd als verbonden!");
  };

  const cnameTarget = project.publishedUrl ? new URL(project.publishedUrl).hostname : "jouw-app.supabase.co";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Publiceren</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">

          {/* ── URLS SECTION ── */}
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">App URLs</Label>

            {/* Live URL */}
            {project.publishedUrl ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Je app is live op</p>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-sm text-foreground truncate flex-1 font-medium">{project.publishedUrl}</p>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => cp(project.publishedUrl!)}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => window.open(project.publishedUrl!, "_blank")}><ExternalLink className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-sm text-muted-foreground">Nog niet gepubliceerd — klik op "Publiceer" om live te gaan.</p>
              </div>
            )}

            {/* Custom domain status — always visible when set */}
            {hasDomain && (
              <div className={`rounded-lg border p-3 space-y-1 ${
                domainStatus === "connected"
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-amber-500/20 bg-amber-500/5"
              }`}>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Eigen domein</p>
                <div className="flex items-center gap-2">
                  {domainStatus === "connected"
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    : <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                  }
                  <p className="text-sm text-foreground truncate flex-1 font-medium">{project.domain}</p>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    domainStatus === "connected"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-amber-500/15 text-amber-400"
                  }`}>
                    {domainStatus === "connected" ? "Verbonden" : "Niet verbonden"}
                  </span>
                </div>
                {domainStatus === "pending" && (
                  <p className="text-xs text-amber-400/70 mt-1">
                    ⚠️ Dit domein is nog niet actief. Configureer eerst je DNS-instellingen.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── SETTINGS ── */}
          <div className="space-y-4">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Instellingen</Label>
            <div className="space-y-2">
              <Label htmlFor="app-name" className="text-xs">App naam</Label>
              <Input id="app-name" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Mijn App" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-desc" className="text-xs">Beschrijving</Label>
              <Input id="app-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Korte beschrijving..." />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Zichtbaarheid</Label>
              <div className="flex gap-2">
                {(["public", "private"] as const).map((v) => (
                  <button key={v} onClick={() => setVisibility(v)}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors ${visibility === v ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
                    {v === "public" ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    {v === "public" ? "Openbaar" : "Privé"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── DOMAIN SECTION ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Domein</Label>
              {hasDomain && (
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  domainStatus === "connected"
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                    : domainStatus === "pending"
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
                      : "bg-muted text-muted-foreground border-border"
                }`}>
                  {domainStatus === "connected" ? "✅ Verbonden" : domainStatus === "pending" ? "⏳ Wacht op DNS" : "Niet ingesteld"}
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="bijv. mijnapp.nl" className="flex-1" />
              <Button variant="outline" size="sm" onClick={handleSaveDomain} className="shrink-0 px-4">Opslaan</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Voer je domeinnaam in en sla op. Je krijgt daarna instructies om het te verbinden.</p>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 text-xs h-9" onClick={handleBuy}>
                <ShoppingCart className="h-3.5 w-3.5 mr-1.5" /> Domein kopen
                <ArrowUpRight className="h-3 w-3 ml-1 opacity-50" />
              </Button>
              <Button
                variant={showDns ? "default" : "outline"}
                size="sm"
                className="flex-1 text-xs h-9"
                onClick={() => setShowDns(!showDns)}
              >
                <Link2 className="h-3.5 w-3.5 mr-1.5" />
                {showDns ? "Instructies verbergen" : "DNS-instructies bekijken"}
              </Button>
            </div>

            {/* DNS Instructions */}
            {showDns && (
              <div className="rounded-xl border border-border bg-background p-5 space-y-5 mt-1">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Verbind je domein</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Om {hasDomain ? <span className="text-foreground font-medium">{domain}</span> : "je domein"} te koppelen, 
                    moet je de DNS-instellingen bij je provider aanpassen.
                  </p>
                </div>

                <ol className="space-y-4 text-sm">
                  <li className="flex gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">1</span>
                    <div>
                      <p className="font-medium text-foreground">Log in bij je domeinprovider</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Bijv. IONOS, Cloudflare, TransIP, Versio of Antagonist</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">2</span>
                    <div>
                      <p className="font-medium text-foreground">Ga naar DNS-instellingen</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Bij IONOS: Domeinen &amp; SSL → selecteer je domein → DNS</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">3</span>
                    <div className="flex-1 space-y-2">
                      <p className="font-medium text-foreground">Voeg een A-record toe</p>
                      <div className="flex items-center font-mono text-xs bg-muted/50 rounded-lg border border-border px-3 py-2.5 gap-3">
                        <div className="flex gap-2 flex-1 min-w-0">
                          <span className="text-muted-foreground">Type</span><span className="text-foreground font-semibold">A</span>
                          <span className="text-muted-foreground ml-1">Naam</span><span className="text-foreground font-semibold">@</span>
                          <span className="text-muted-foreground ml-1">Waarde</span><span className="text-primary font-semibold">185.158.133.1</span>
                        </div>
                        <button onClick={() => cp("185.158.133.1")} className="text-muted-foreground hover:text-foreground transition-colors shrink-0"><Copy className="h-3.5 w-3.5" /></button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Dit koppelt je root domein (bijv. fitness.nl) aan je app.</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">4</span>
                    <div className="flex-1 space-y-2">
                      <p className="font-medium text-foreground">Voeg een CNAME-record toe voor www</p>
                      <div className="flex items-center font-mono text-xs bg-muted/50 rounded-lg border border-border px-3 py-2.5 gap-3">
                        <div className="flex gap-2 flex-1 min-w-0">
                          <span className="text-muted-foreground">Type</span><span className="text-foreground font-semibold">CNAME</span>
                          <span className="text-muted-foreground ml-1">Naam</span><span className="text-foreground font-semibold">www</span>
                          <span className="text-muted-foreground ml-1">Waarde</span><span className="text-primary font-semibold truncate max-w-[120px]">{cnameTarget}</span>
                        </div>
                        <button onClick={() => cp(cnameTarget)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0"><Copy className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">5</span>
                    <div>
                      <p className="font-medium text-foreground">Sla op en wacht</p>
                      <p className="text-xs text-muted-foreground mt-0.5">DNS-wijzigingen kunnen tot 72 uur duren om door te voeren.</p>
                    </div>
                  </li>
                </ol>

                {hasDomain && domainStatus === "pending" && (
                  <Button variant="outline" size="sm" className="w-full mt-2" onClick={handleMarkConnected}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                    Ik heb de DNS geconfigureerd — markeer als verbonden
                  </Button>
                )}

                <p className="text-[11px] text-muted-foreground border-t border-border pt-3">
                  💡 Je domein blijft gekoppeld aan dit project, ook als je de app bijwerkt of opnieuw publiceert.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" className="flex-1" onClick={handleSave}>Opslaan</Button>
          <Button className="flex-1" onClick={handlePublish} disabled={isPublishing}>
            <Globe className="h-4 w-4 mr-2" />
            {isPublishing ? "Publiceren..." : project.publishedUrl ? "Opnieuw publiceren" : "Publiceer"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PublishPanel;
