import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useImportProjectFromUrl, useListProjects, useDeleteProject,
  getListProjectsQueryKey, getGetRecentProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowRight, Globe, Loader2, FileCode, MessageSquare, Clock, Trash2, Sparkles, CalendarCheck, Rocket, User as UserIcon, LogOut, X, CreditCard, Check, Copy, Eye, EyeOff, CheckCircle2, Plug, Download } from "lucide-react";
import logoUrl from "../assets/nebula-logo.png";
import { getToken, setToken, clearToken, type PlatformUser } from "@/lib/session";

async function authApi(path: string, body?: unknown): Promise<{ ok: boolean; status: number; d: any }> {
  const r = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, d };
}

export function AiEditor() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // ── auth state ──
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState<"login" | "register" | "forgot">("login");
  const [f, setF] = useState({ email: "", password: "", name: "", birthdate: "", phone: "" });
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);

  // ── project/import state ──
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const { data: projects } = useListProjects({ query: { enabled: !!user } });
  const importProject = useImportProjectFromUrl();
  const deleteProject = useDeleteProject();
  const project = user && projects && projects.length > 0
    ? [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
    : null;
  // A WordPress import arrives as its OWN project (source "wordpress"), so it never mixes with a
  // URL-imported one. Newest first (GET /projects is already ordered by updatedAt desc).
  const wpProject = user && projects ? projects.find((p) => String((p as { source?: string }).source) === "wordpress") ?? null : null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
  }, [queryClient]);

  useEffect(() => {
    if (!getToken()) { setAuthChecked(true); return; }
    authApi("me").then((r) => { if (r.ok && r.d.user) setUser(r.d.user); else clearToken(); }).finally(() => setAuthChecked(true));
  }, []);

  const onAuthSuccess = (token: string, u: PlatformUser) => { setToken(token); setUser(u); setF({ email: "", password: "", name: "", birthdate: "", phone: "" }); setAuthErr(null); refresh(); };

  const doLogin = async () => {
    setAuthBusy(true); setAuthErr(null);
    const r = await authApi("login", { email: f.email, password: f.password });
    setAuthBusy(false);
    if (r.ok && r.d.token) onAuthSuccess(r.d.token, r.d.user); else setAuthErr(r.d.error || "Inloggen mislukt.");
  };
  const doRegister = async () => {
    setAuthBusy(true); setAuthErr(null);
    const r = await authApi("register", { email: f.email, password: f.password, name: f.name, birthdate: f.birthdate, phone: f.phone });
    setAuthBusy(false);
    if (r.ok && r.d.token) onAuthSuccess(r.d.token, r.d.user); else setAuthErr(r.d.error || "Registreren mislukt.");
  };
  const doForgot = async () => {
    setAuthBusy(true); setAuthErr(null); setNotice(null);
    const r = await authApi("forgot", { email: f.email });
    setAuthBusy(false);
    if (!r.ok) { setAuthErr(r.d.error || "Reset mislukt."); return; }
    // Always generic — we never reveal whether the account exists or show a password on screen.
    setNotice("Als er een account bij dit e-mailadres hoort, hebben we een nieuw wachtwoord gemaild. Geen mail? Controleer of je studio een e-mail (SMTP) heeft ingesteld onder Integraties.");
    setView("login");
  };
  const doLogout = async () => { await authApi("logout", {}); clearToken(); setUser(null); setMenuOpen(false); setLocation("/ai-editor"); };
  const doAdminUnlock = async () => {
    setMenuOpen(false);
    const code = window.prompt("Voer je admin-code in om alle features gratis te ontgrendelen:");
    if (!code) return;
    const r = await authApi("admin-unlock", { code });
    if (r.ok && r.d.ok) { window.alert("Ontgrendeld! Alle features zijn nu gratis beschikbaar."); window.location.reload(); }
    else window.alert(r.d.error || "Ontgrendelen mislukt.");
  };

  const handleImport = () => {
    const trimmed = url.trim();
    if (!trimmed || importProject.isPending) return;
    setError(null);
    importProject.mutate({ data: { url: trimmed } }, {
      onSuccess: (p) => { refresh(); setLocation(`/projects/${p.id}`); },
      onError: (err: unknown) => {
        let message = "We konden deze website niet importeren. Controleer de URL en probeer het opnieuw.";
        if (err && typeof err === "object") {
          const data = (err as { data?: unknown }).data;
          const se = data && typeof data === "object" && "error" in data ? (data as { error?: unknown }).error : undefined;
          if (typeof se === "string" && se.trim()) message = se;
        }
        setError(message);
      },
    });
  };
  const handleDelete = () => {
    if (!project) return;
    deleteProject.mutate({ projectId: project.id }, { onSuccess: () => { refresh(); setConfirmDel(false); } });
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (!authChecked) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  // ── Not logged in: auth screen ──
  if (!user) {
    return (
      <div className="flex-1 flex flex-col items-center pt-16 px-4 pb-12 w-full max-w-md mx-auto">
        <img src={logoUrl} alt="Nebula" className="h-40 md:h-52 w-auto mb-8" />
        <div className="w-full rounded-2xl border border-border bg-card shadow-lg p-7">
          <h1 className="text-2xl font-bold tracking-tight text-center mb-1">
            {view === "login" ? "Inloggen" : view === "register" ? "Account aanmaken" : "Wachtwoord vergeten"}
          </h1>
          <p className="text-sm text-muted-foreground text-center mb-5">
            {view === "login" ? "Log in op je Nebula-account." : view === "register" ? "Maak je eigen Nebula-werkruimte." : "Vul je e-mail in voor een nieuw wachtwoord."}
          </p>
          {notice && <p className="mb-4 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

          {view === "register" && (<>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Naam</label>
            <Input className="mb-3" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Voor- en achternaam" data-testid="input-name" />
            <label className="block text-xs font-medium text-muted-foreground mb-1">Geboortedatum</label>
            <Input className="mb-3" type="date" value={f.birthdate} onChange={(e) => setF({ ...f, birthdate: e.target.value })} data-testid="input-birthdate" />
            <label className="block text-xs font-medium text-muted-foreground mb-1">Telefoonnummer (optioneel)</label>
            <Input className="mb-3" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="06 12345678" data-testid="input-phone" />
          </>)}

          <label className="block text-xs font-medium text-muted-foreground mb-1">E-mailadres</label>
          <Input className="mb-3" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="naam@voorbeeld.nl" data-testid="input-email"
            onKeyDown={(e) => { if (e.key === "Enter" && view === "forgot") doForgot(); }} />

          {view !== "forgot" && (<>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Wachtwoord</label>
            <Input className="mb-4" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="••••••••" data-testid="input-password"
              onKeyDown={(e) => { if (e.key === "Enter") view === "login" ? doLogin() : doRegister(); }} />
          </>)}

          {authErr && <p className="mb-3 text-sm text-destructive">{authErr}</p>}

          <Button className="w-full h-11 font-bold" disabled={authBusy} data-testid="button-auth-submit"
            onClick={() => (view === "login" ? doLogin() : view === "register" ? doRegister() : doForgot())}>
            {authBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : view === "login" ? "Inloggen" : view === "register" ? "Account aanmaken" : "Nieuw wachtwoord sturen"}
          </Button>

          <div className="mt-4 text-center text-sm text-muted-foreground space-y-1">
            {view === "login" && (<>
              <p><button className="text-primary font-medium hover:underline" onClick={() => { setView("forgot"); setAuthErr(null); setNotice(null); }}>Wachtwoord vergeten?</button></p>
              <p>Nog geen account? <button className="text-primary font-medium hover:underline" onClick={() => { setView("register"); setAuthErr(null); setNotice(null); }}>Registreren</button></p>
            </>)}
            {view === "register" && (<p>Al een account? <button className="text-primary font-medium hover:underline" onClick={() => { setView("login"); setAuthErr(null); }}>Inloggen</button></p>)}
            {view === "forgot" && (<p><button className="text-primary font-medium hover:underline" onClick={() => { setView("login"); setAuthErr(null); }}>← Terug naar inloggen</button></p>)}
          </div>
        </div>
      </div>
    );
  }

  // ── Logged in: profile top-right + single-project dashboard ──
  return (
    <div className="flex-1 flex flex-col items-center pt-6 px-4 pb-12 w-full max-w-4xl mx-auto">
      {/* Profile top-right */}
      <div className="w-full flex justify-end mb-2 relative">
        <button className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm shadow-sm hover:bg-muted/40" onClick={() => setMenuOpen((o) => !o)} data-testid="button-profile">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">{(user.name || user.email)[0]?.toUpperCase()}</span>
          <span className="max-w-[160px] truncate">{user.name || user.email}</span>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-border bg-card shadow-xl p-1.5 text-sm">
            <div className="px-3 py-2 border-b border-border/60">
              <div className="font-medium truncate">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            </div>
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2" onClick={() => { setProfileOpen(true); setMenuOpen(false); }}><UserIcon className="h-4 w-4" /> Profiel</button>
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2" onClick={() => { setBillingOpen(true); setMenuOpen(false); }} data-testid="menu-billing"><CreditCard className="h-4 w-4" /> Abonnement</button>
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2" onClick={doAdminUnlock} data-testid="menu-admin-unlock"><Sparkles className="h-4 w-4" /> Admin code</button>
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2 text-destructive" onClick={doLogout}><LogOut className="h-4 w-4" /> Uitloggen</button>
          </div>
        )}
      </div>

      <img src={logoUrl} alt="Nebula" className="h-40 md:h-52 w-auto mb-8" />

      {wpProject ? (
        // Een WordPress-import ging goed → toon direct het succes-paneel met "ga verder naar de editor",
        // vóór de generieke projectkaart, zodat je de verificatie ziet en niet verdwaalt.
        <div className="w-full max-w-2xl">
          <WordPressImportPanel
            wpProject={wpProject}
            onContinue={(id) => setLocation(`/projects/${id}`)}
            onDelete={(id) => deleteProject.mutate({ projectId: id }, { onSuccess: () => refresh() })}
            refresh={refresh} />
        </div>
      ) : project ? (
        <div className="w-full max-w-2xl">
          <div className="relative rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
            <Button variant="ghost" size="icon" className="absolute top-4 right-4 z-10 h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDel(true)} aria-label="Project verwijderen" data-testid="button-delete-project"><Trash2 className="h-5 w-5" /></Button>
            <div className="h-2 w-full bg-gradient-to-r from-primary to-rose-400" />
            <div className="p-8">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Jouw project</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight pr-10">{project.name}</h1>
              <p className="mt-2 text-muted-foreground line-clamp-2">{project.description || "Je website + boekingssysteem."}</p>
              <div className="mt-5 flex flex-wrap gap-5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><FileCode className="w-4 h-4" />{project.fileCount} bestanden</span>
                <span className="flex items-center gap-1.5"><MessageSquare className="w-4 h-4" />{project.messageCount} berichten</span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" />Bijgewerkt {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}</span>
              </div>
              <Button size="lg" className="mt-7 w-full h-12 font-bold text-base" onClick={() => setLocation(`/projects/${project.id}`)} data-testid="button-open-project">Project openen <ArrowRight className="ml-2 h-5 w-5" /></Button>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">Eén project tegelijk. Verwijder dit project om een nieuwe website te importeren.</p>
        </div>
      ) : (
        <div className="w-full max-w-2xl">
          <div className="relative bg-card rounded-xl border border-border shadow-lg p-2 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 flex items-center">
              <Globe className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input value={url} onChange={(e) => { setUrl(e.target.value); if (error) setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") handleImport(); }} placeholder="bijv. stripe.com of https://voorbeeld.nl" className="h-12 border-0 bg-transparent pl-9 text-base focus-visible:ring-0" data-testid="input-import-url" autoFocus />
            </div>
            <Button size="lg" onClick={handleImport} disabled={!url.trim() || importProject.isPending} className="h-12 font-bold disabled:opacity-100 shrink-0" data-testid="button-import-url">
              {importProject.isPending ? (<><Loader2 className="mr-2 h-5 w-5 animate-spin" />Importeren...</>) : (<>Website importeren<ArrowRight className="ml-2 h-5 w-5" /></>)}
            </Button>
          </div>
          {error && (<p className="mt-3 text-sm text-destructive text-center" data-testid="text-import-error">{error}</p>)}

          {/* WordPress-import via de plugin: verifieer of de push is aangekomen en ga door naar de editor. */}
          <WordPressImportPanel wpProject={wpProject} onContinue={(id) => setLocation(`/projects/${id}`)} refresh={refresh} />

          <div className="mt-8 rounded-2xl border border-border bg-card shadow-lg p-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">Begin je project</h2>
            <p className="mt-2 text-muted-foreground">Importeer je bestaande website hierboven — Nebula bouwt 'm om tot een slimme, bewerkbare site mét boekingssysteem.</p>
            <div className="mt-7 grid gap-4 sm:grid-cols-3 text-left">
              <div className="rounded-xl border border-border/70 p-4"><Sparkles className="h-6 w-6 text-primary" /><h3 className="mt-2 font-semibold text-sm">Slim bewerken</h3><p className="text-xs text-muted-foreground mt-1">Pas je site aan met gewone taal of klik-en-bewerk — geen code nodig.</p></div>
              <div className="rounded-xl border border-border/70 p-4"><CalendarCheck className="h-6 w-6 text-primary" /><h3 className="mt-2 font-semibold text-sm">Boekingssysteem</h3><p className="text-xs text-muted-foreground mt-1">Lessen, abonnementen, betalingen, presentielijst en video's — ingebouwd.</p></div>
              <div className="rounded-xl border border-border/70 p-4"><Rocket className="h-6 w-6 text-primary" /><h3 className="mt-2 font-semibold text-sm">Direct online</h3><p className="text-xs text-muted-foreground mt-1">Publiceer op een gratis Nebula-adres of je eigen domein met SSL.</p></div>
            </div>
          </div>
        </div>
      )}

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} user={user} onSaved={(u) => setUser(u)} onDeleted={() => { clearToken(); setUser(null); setProfileOpen(false); refresh(); }} />
      <BillingDialog open={billingOpen} onClose={() => setBillingOpen(false)} />

      <AlertDialog open={confirmDel} onOpenChange={(open) => { if (!open) { setConfirmDel(false); deleteProject.reset(); } }}>
        <AlertDialogContent className="light bg-white border-neutral-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-semibold text-neutral-900">Project verwijderen?</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-neutral-600">Dit verwijdert <span className="font-semibold text-neutral-900">{project?.name}</span> en al z'n bestanden en berichten definitief.</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteProject.isError && (<p className="text-sm font-medium text-red-600">Verwijderen mislukt. Probeer het opnieuw.</p>)}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending} className="border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100">Annuleren</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleDelete(); }} disabled={deleteProject.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete">
              {deleteProject.isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verwijderen...</>) : "Verwijderen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Leesbaar, niet-doorzichtig kopieerveld (donker codeblok + kopieerknop) ──
function CopyField({ label, value, testId, mask = false }: { label: string; value: string; testId?: string; mask?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!mask);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setRevealed(true); } // clipboard geblokkeerd → toon 'm zodat je handmatig kunt kopiëren
  };
  const shown = revealed ? value : (value ? value.slice(0, 6) + "••••••••••" + value.slice(-4) : "");
  return (
    <div>
      <label className="block text-xs font-semibold text-foreground mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-neutral-900 text-neutral-50 border border-neutral-700 px-3 py-2 text-sm font-mono" data-testid={testId}>{value ? shown : "—"}</code>
        {mask && <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setRevealed((r) => !r)} aria-label={revealed ? "Verbergen" : "Tonen"}>{revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>}
        <Button size="sm" className="h-9 shrink-0 font-medium" onClick={copy} disabled={!value} data-testid={testId ? `${testId}-copy` : undefined}>{copied ? (<><CheckCircle2 className="mr-1.5 h-4 w-4" />Gekopieerd</>) : (<><Copy className="mr-1.5 h-4 w-4" />Kopieer</>)}</Button>
      </div>
    </div>
  );
}

// ── WordPress-import: plugin downloaden, gegevens kopiëren, verifiëren en door naar de chat ──
function WordPressImportPanel({ wpProject, onContinue, onDelete, refresh }: {
  wpProject: { id: number; name: string; fileCount: number } | null;
  onContinue: (id: number) => void;
  onDelete?: (id: number) => void;
  refresh: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checkedEmpty, setCheckedEmpty] = useState(false);
  const [status, setStatus] = useState<{ textFiles: number; mediaAssets: number } | null>(null);
  const apiBase = typeof window !== "undefined" ? window.location.origin : "";
  const token = getToken() || "";

  // Toon wat er ÉCHT is binnengekomen (code-bestanden + media), zodat je kunt bevestigen dat de
  // import compleet is voordat je doorgaat — niet blind doorspringen omdat er een project bestaat.
  useEffect(() => {
    if (!wpProject) { setStatus(null); return; }
    fetch(`/api/import/wordpress/status?projectId=${wpProject.id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d) => setStatus({ textFiles: Number(d.textFiles) || 0, mediaAssets: Number(d.mediaAssets) || 0 }))
      .catch(() => setStatus(null));
  }, [wpProject, token]);

  // Verifieer: haal de projecten vers op. Vinden we de WordPress-import, dan verschijnt het
  // resultaat-paneel (met tellingen). We springen NIET automatisch door — dat is een aparte klik.
  const verify = async () => {
    setChecking(true); setCheckedEmpty(false);
    try {
      const r = await fetch("/api/projects", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const list = await r.json().catch(() => []);
      const wp = Array.isArray(list) ? list.find((p: { source?: string }) => String(p.source) === "wordpress") : null;
      refresh(); // parent re-rendert → resultaat-paneel verschijnt als de import binnen is
      if (!wp) setCheckedEmpty(true);
    } catch { setCheckedEmpty(true); }
    finally { setChecking(false); }
  };

  if (wpProject) {
    return (
      <div className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-left" data-testid="panel-wp-success">
        <div className="flex items-center gap-2 text-emerald-700 font-semibold"><CheckCircle2 className="h-5 w-5" /> WordPress-import gevonden</div>
        <p className="text-sm text-emerald-800/80 mt-1">Project <span className="font-semibold">{wpProject.name}</span> — controleer of alles binnen is:</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white border border-emerald-200 px-3 py-2 text-center">
            <div className="text-xl font-bold text-emerald-700">{status ? status.textFiles : "…"}</div>
            <div className="text-xs text-emerald-800/70">code-bestanden</div>
          </div>
          <div className="rounded-lg bg-white border border-emerald-200 px-3 py-2 text-center">
            <div className="text-xl font-bold text-emerald-700">{status ? status.mediaAssets : "…"}</div>
            <div className="text-xs text-emerald-800/70">media (afbeeldingen)</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-emerald-800/70">Klopt het aantal ongeveer met je site? Zo niet, draai de export in WordPress nog eens (hij vult aan). Pas als het goed staat, ga je door.</p>
        <Button className="mt-3 w-full h-11 font-bold" onClick={() => onContinue(wpProject.id)} data-testid="button-wp-continue">Alles staat er — ga naar de chat <ArrowRight className="ml-2 h-5 w-5" /></Button>
        {onDelete && (
          <button
            className="mt-3 w-full text-center text-xs text-red-600 hover:text-red-700 hover:underline inline-flex items-center justify-center gap-1"
            onClick={() => { if (window.confirm(`De WordPress-import "${wpProject.name}" verwijderen? Alle bestanden en media gaan definitief weg.`)) onDelete(wpProject.id); }}
            data-testid="button-wp-delete">
            <Trash2 className="h-3.5 w-3.5" /> Deze import verwijderen
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card shadow-sm p-5 text-left">
      <div className="flex items-center gap-2 mb-1"><Plug className="h-4 w-4 text-primary" /><h3 className="font-semibold text-sm">Importeren vanuit WordPress</h3></div>
      <p className="text-xs text-muted-foreground mb-4">Download de plugin, installeer 'm in WordPress en push je hele site (code + media) hierheen.</p>

      {/* 1) Plugin downloaden */}
      <a href="/api/import/wordpress/plugin.zip" download
         className="inline-flex items-center justify-center w-full h-11 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition-colors mb-4"
         data-testid="link-download-plugin">
        <Download className="mr-2 h-5 w-5" /> Download de WordPress-plugin (.zip)
      </a>

      {/* 2) API-URL + token (leesbaar) */}
      <div className="space-y-3 mb-4">
        <CopyField label="API-URL (in de plugin)" value={apiBase} testId="text-api-url" />
        <CopyField label="Token (in de plugin)" value={token} testId="text-wp-token" mask />
      </div>

      {/* 3) Stappen */}
      <ol className="text-xs text-muted-foreground space-y-1 mb-4 list-decimal pl-4">
        <li>WordPress → <span className="font-medium">Plugins → Nieuwe plugin → Plugin uploaden</span> → kies de .zip → activeren.</li>
        <li>Ga naar <span className="font-medium">Extra → Nebula Export</span>.</li>
        <li>Plak de <span className="font-medium">API-URL</span> en het <span className="font-medium">token</span> hierboven, klik <span className="font-medium">Exporteren</span>.</li>
        <li>Kom hier terug en klik op de knop hieronder.</li>
      </ol>

      {/* 4) Verifiëren + door naar de chat */}
      <Button className="w-full h-11 font-bold" onClick={verify} disabled={checking} data-testid="button-wp-verify">
        {checking ? (<><Loader2 className="mr-2 h-5 w-5 animate-spin" />Website verifiëren…</>) : (<>Verifieer de website &amp; ga naar de chat <ArrowRight className="ml-2 h-5 w-5" /></>)}
      </Button>
      {checkedEmpty && !checking && (<p className="mt-2 text-xs text-muted-foreground">Nog niks ontvangen. Heb je in WordPress op <span className="font-medium">Exporteren</span> geklikt? Een grote site kan enkele minuten duren — probeer het zo nog eens.</p>)}
    </div>
  );
}

async function billingApi(path: string, body?: unknown): Promise<{ ok: boolean; d: any }> {
  const r = await fetch(`/api/billing${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, d };
}

// ── Abonnement + AI-tegoed ──
function BillingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [topup, setTopup] = useState("10");
  const load = () => billingApi("").then((r) => { if (r.ok) setData(r.d); });
  useEffect(() => { if (open) { setData(null); load(); } }, [open]);
  if (!open) return null;

  const subscribe = async () => { setBusy(true); const r = await billingApi("/subscribe", {}); setBusy(false); if (r.ok && r.d.url) window.location.href = r.d.url; else alert(r.d.error || "Abonneren mislukt."); };
  const doTopup = async () => { const amt = Math.max(5, parseFloat(topup) || 0); setBusy(true); const r = await billingApi("/topup", { amount: amt }); setBusy(false); if (r.ok && r.d.url) window.location.href = r.d.url; else alert(r.d.error || "Bijkopen mislukt."); };
  const cancel = async () => { if (!window.confirm("Je abonnement opzeggen? Je houdt toegang tot het einde van de periode.")) return; setBusy(true); const r = await billingApi("/cancel", {}); setBusy(false); if (r.ok) load(); else alert(r.d.error || "Opzeggen mislukt."); };

  const credit = data ? data.aiCredit : 0;
  const pct = data ? Math.max(0, Math.min(100, (credit / (data.monthlyCredit || 7.5)) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-[min(540px,96%)] max-h-[88vh] overflow-y-auto rounded-xl bg-background border shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-semibold flex items-center gap-2"><CreditCard className="h-5 w-5" /> Abonnement</h3><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="h-4 w-4" /></Button></div>
        {!data ? (<div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>) : (<>
          {/* Subscription */}
          {data.subscribed ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4">
              <div className="flex items-center gap-2 text-emerald-700 font-medium"><Check className="h-4 w-4" /> Actief abonnement — €{data.priceEur}/maand</div>
              {data.currentPeriodEnd && <p className="text-xs text-emerald-700/80 mt-1">Verlengt op {data.currentPeriodEnd}</p>}
              <Button variant="outline" size="sm" className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={busy} onClick={cancel}>Opzeggen</Button>
            </div>
          ) : (
            <div className="rounded-xl border p-5 mb-4 text-center">
              <h4 className="text-xl font-bold">Nebula Pro</h4>
              <p className="text-3xl font-extrabold mt-1">€{data.priceEur}<span className="text-base font-medium text-muted-foreground">/maand</span></p>
              <ul className="text-sm text-muted-foreground mt-3 space-y-1 text-left max-w-xs mx-auto">
                <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0" /> Volledige AI-chat (€{data.monthlyCredit} tegoed/maand)</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0" /> Publiceren op je eigen domein</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0" /> Geen Nebula-logo op je site</li>
              </ul>
              <Button className="mt-4 w-full h-11 font-bold" disabled={busy} onClick={subscribe} data-testid="button-subscribe">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Abonneren"}</Button>
              <button className="mt-3 text-xs text-muted-foreground underline hover:text-destructive" disabled={busy} onClick={cancel} data-testid="button-cancel-inline">Al een abonnement? Opzeggen</button>
            </div>
          )}
          {/* AI credit */}
          <div className="rounded-xl border p-4 mb-4">
            <div className="flex items-center justify-between"><span className="font-medium text-sm">AI-tegoed</span><span className="font-bold">€{credit.toFixed(2)}</span></div>
            <div className="h-2 w-full rounded-full bg-muted mt-2 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
            <p className="text-xs text-muted-foreground mt-1">€{data.monthlyCredit} per maand inbegrepen; bijkopen blijft staan.</p>
            <div className="flex items-end gap-2 mt-3">
              <div className="flex-1"><label className="text-xs text-muted-foreground">Bijkopen (€, zelf invullen)</label><Input type="number" min="5" step="5" value={topup} onChange={(e) => setTopup(e.target.value)} /></div>
              <Button size="sm" className="h-10" disabled={busy || !(parseFloat(topup) >= 5)} onClick={doTopup} data-testid="button-topup">Bijkopen</Button>
            </div>
          </div>
          {/* Usage */}
          <h4 className="font-medium text-sm mb-2">Recent verbruik</h4>
          {(!data.usage || data.usage.length === 0) ? (<p className="text-xs text-muted-foreground">Nog geen AI-wijzigingen.</p>) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {data.usage.map((u: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs border-b border-border/40 py-1.5">
                  <span className="truncate pr-2 text-muted-foreground">{u.summary || "AI-wijziging"}</span>
                  <span className="shrink-0 font-medium">€{(u.costEur || 0).toFixed(3)}</span>
                </div>
              ))}
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}

// ── Profile editor (name / birthdate / phone + change password) ──
function ProfileDialog({ open, onClose, user, onSaved, onDeleted }: { open: boolean; onClose: () => void; user: PlatformUser; onSaved: (u: PlatformUser) => void; onDeleted: () => void }) {
  const [name, setName] = useState(user.name);
  const [birthdate, setBirthdate] = useState(user.birthdate);
  const [phone, setPhone] = useState(user.phone);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delErr, setDelErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(user.name); setBirthdate(user.birthdate); setPhone(user.phone); setCur(""); setNext(""); setMsg(null); setDelOpen(false); setDelPw(""); setDelErr(null); } }, [open, user]);
  if (!open) return null;

  const saveProfile = async () => {
    setBusy(true); setMsg(null);
    const r = await authApi("profile", { name, birthdate, phone });
    setBusy(false);
    if (r.ok) { if (r.d.user) onSaved(r.d.user); setMsg("Profiel opgeslagen."); } else setMsg(r.d.error || "Opslaan mislukt.");
  };
  const savePassword = async () => {
    if (!cur || !next) return;
    setBusy(true); setMsg(null);
    const r = await authApi("password", { current: cur, next });
    setBusy(false);
    if (r.ok) { setCur(""); setNext(""); setMsg("Wachtwoord gewijzigd."); } else setMsg(r.d.error || "Wijzigen mislukt.");
  };
  const doDelete = async () => {
    if (!delPw) return;
    setBusy(true); setDelErr(null);
    const r = await authApi("delete-account", { password: delPw });
    setBusy(false);
    if (r.ok) onDeleted(); else setDelErr(r.d.error || "Verwijderen mislukt.");
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-[min(460px,96%)] rounded-xl bg-background border shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-semibold">Profiel</h3><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="h-4 w-4" /></Button></div>
        <label className="block text-xs text-muted-foreground mb-1">Naam</label>
        <Input className="mb-3" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="block text-xs text-muted-foreground mb-1">Geboortedatum</label>
        <Input className="mb-3" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
        <label className="block text-xs text-muted-foreground mb-1">Telefoonnummer</label>
        <Input className="mb-3" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button size="sm" disabled={busy} onClick={saveProfile}>Profiel opslaan</Button>
        <div className="my-5 border-t border-border" />
        <h4 className="font-medium text-sm mb-2">Wachtwoord wijzigen</h4>
        <Input className="mb-2" type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Huidig wachtwoord" />
        <Input className="mb-3" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Nieuw wachtwoord (min. 6 tekens)" />
        <Button size="sm" variant="outline" disabled={busy || !cur || !next} onClick={savePassword}>Wachtwoord wijzigen</Button>
        {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}

        <div className="my-5 border-t border-border" />
        <h4 className="font-medium text-sm text-destructive mb-1">Gevarenzone</h4>
        {!delOpen ? (
          <>
            <p className="text-xs text-muted-foreground mb-2">Verwijder je account en alles wat erbij hoort (je project, website, boekingen) — definitief.</p>
            <Button size="sm" variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => { setDelOpen(true); setDelErr(null); }} data-testid="button-delete-account">Account verwijderen</Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">Dit kan niet ongedaan worden. Bevestig met je wachtwoord:</p>
            <Input className="mb-2" type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} placeholder="Je wachtwoord" data-testid="input-delete-password" />
            {delErr && <p className="mb-2 text-sm text-destructive">{delErr}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setDelOpen(false); setDelPw(""); setDelErr(null); }}>Annuleren</Button>
              <Button size="sm" disabled={busy || !delPw} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete} data-testid="button-confirm-delete-account">Definitief verwijderen</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
