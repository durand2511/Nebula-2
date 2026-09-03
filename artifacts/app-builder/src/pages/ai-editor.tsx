import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useLang } from "@/lib/i18n";
import {
  useImportProjectFromUrl, useCreateProject, useListProjects, useDeleteProject,
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
import { ArrowRight, Globe, Loader2, FileCode, MessageSquare, Clock, Trash2, Sparkles, Palette, Rocket, User as UserIcon, LogOut, X, CreditCard, Check, Terminal as TerminalIcon, Unplug, History } from "lucide-react";
import logoUrl from "../assets/nebula-logo.png";
import { getToken, setToken, clearToken, type PlatformUser } from "@/lib/session";

/** "Claude Code"-koppeling: status + één knop naar /claude (koppelen) of ontkoppelen. */
function ClaudeStatusCard() {
  const [, setLocation] = useLocation();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { fetch("/api/claude/status").then((r) => r.json()).then((d) => setConnected(!!d.connected)).catch(() => setConnected(false)); }, []);
  useEffect(() => { load(); }, [load]);
  const disconnect = async () => {
    if (!window.confirm("Claude ontkoppelen? Je kunt daarna opnieuw inloggen met je Claude-account.")) return;
    setBusy(true);
    try { await fetch("/api/claude/disconnect", { method: "POST" }); setConnected(false); } finally { setBusy(false); }
  };
  return (
    <div className={`mt-8 rounded-2xl border p-5 flex flex-wrap items-center gap-4 ${connected ? "border-emerald-300/60 bg-emerald-50/60" : "border-amber-300/60 bg-amber-50/60"}`} data-testid="card-claude-status">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${connected ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"}`}><TerminalIcon className="h-5 w-5" /></div>
      <div className="flex-1 min-w-[220px]">
        <div className="font-semibold text-foreground flex items-center gap-2">
          Claude Code {connected === null ? "" : connected ? <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium"><Check className="h-3.5 w-3.5" /> gekoppeld</span> : <span className="text-amber-800 text-xs font-medium">nog niet gekoppeld</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {connected ? "Je websites worden bewerkt met Claude Code op je eigen Claude-abonnement." : "Koppel één keer je Claude-abonnement; daarna bewerk je al je websites met Claude Code."}
        </p>
      </div>
      {connected ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setLocation("/uitleg")} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2" data-testid="link-uitleg">Uitleg</button>
          <button type="button" onClick={disconnect} disabled={busy} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1" data-testid="button-claude-disconnect"><Unplug className="h-3.5 w-3.5" /> Ontkoppelen</button>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setLocation("/claude")} className="gap-2" data-testid="button-claude-connect">Claude koppelen <ArrowRight className="h-4 w-4" /></Button>
          <button type="button" onClick={() => setLocation("/uitleg")} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2" data-testid="link-uitleg">Hoe werkt dit? Bekijk de uitleg</button>
        </div>
      )}
    </div>
  );
}

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
  const { t } = useLang();
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
  const [backupsOpen, setBackupsOpen] = useState(false);

  // ── project/import state ──
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const { data: projects } = useListProjects({ query: { enabled: !!user } });
  const importProject = useImportProjectFromUrl();
  const createProject = useCreateProject();
  const handleCreateBlank = () => {
    if (createProject.isPending) return;
    createProject.mutate({ data: { name: "Mijn nieuwe website", description: "" } }, {
      onSuccess: (p) => { refresh(); setLocation(`/projects/${p.id}`); },
    });
  };
  const deleteProject = useDeleteProject();
  const project = user && projects && projects.length > 0
    ? [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
    : null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentProjectsQueryKey() });
  }, [queryClient]);

  useEffect(() => {
    if (!getToken()) { setAuthChecked(true); return; }
    authApi("me").then((r) => { if (r.ok && r.d.user) setUser(r.d.user); else clearToken(); }).finally(() => setAuthChecked(true));
  }, []);

  // Back from an iDEAL bank authorisation (Stripe return_url): finish the subscription server-side
  // on the saved SEPA mandate, then clean the URL and show the billing dialog with the result.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const seti = params.get("setup_intent");
    if (!seti || !getToken()) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (params.get("redirect_status") && params.get("redirect_status") !== "succeeded") {
      window.alert("De betaling is niet afgerond. Probeer het opnieuw.");
      return;
    }
    billingApi("/subscribe/complete", { setupIntentId: seti }).then((r) => {
      if (r.ok) setBillingOpen(true); // the dialog now shows the green "Actief abonnement" state
      else window.alert(r.d.error || "Abonneren is niet gelukt. Probeer het opnieuw.");
    });
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
            {view === "login" ? t("Inloggen", "Log in") : view === "register" ? t("Account aanmaken", "Create account") : t("Wachtwoord vergeten", "Forgot password")}
          </h1>
          <p className="text-sm text-muted-foreground text-center mb-5">
            {view === "login" ? t("Log in op je Nebula-account.", "Log in to your Nebula account.") : view === "register" ? t("Maak je eigen Nebula-werkruimte.", "Create your own Nebula workspace.") : t("Vul je e-mail in voor een nieuw wachtwoord.", "Enter your e-mail to get a new password.")}
          </p>
          {notice && <p className="mb-4 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

          {view === "register" && (<>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Naam", "Name")}</label>
            <Input className="mb-3" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("Voor- en achternaam", "First and last name")} data-testid="input-name" />
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Geboortedatum", "Date of birth")}</label>
            <Input className="mb-3" type="date" value={f.birthdate} onChange={(e) => setF({ ...f, birthdate: e.target.value })} data-testid="input-birthdate" />
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Telefoonnummer (optioneel)", "Phone number (optional)")}</label>
            <Input className="mb-3" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="06 12345678" data-testid="input-phone" />
          </>)}

          <label className="block text-xs font-medium text-muted-foreground mb-1">{t("E-mailadres", "E-mail address")}</label>
          <Input className="mb-3" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="naam@voorbeeld.nl" data-testid="input-email"
            onKeyDown={(e) => { if (e.key === "Enter" && view === "forgot") doForgot(); }} />

          {view !== "forgot" && (<>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("Wachtwoord", "Password")}</label>
            <Input className="mb-4" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="••••••••" data-testid="input-password"
              onKeyDown={(e) => { if (e.key === "Enter") view === "login" ? doLogin() : doRegister(); }} />
          </>)}

          {authErr && <p className="mb-3 text-sm text-destructive">{authErr}</p>}

          <Button className="w-full h-11 font-bold" disabled={authBusy} data-testid="button-auth-submit"
            onClick={() => (view === "login" ? doLogin() : view === "register" ? doRegister() : doForgot())}>
            {authBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : view === "login" ? t("Inloggen", "Log in") : view === "register" ? t("Account aanmaken", "Create account") : t("Nieuw wachtwoord sturen", "Send new password")}
          </Button>

          <div className="mt-4 text-center text-sm text-muted-foreground space-y-1">
            {view === "login" && (<>
              <p><button className="text-primary font-medium hover:underline" onClick={() => { setView("forgot"); setAuthErr(null); setNotice(null); }}>{t("Wachtwoord vergeten?", "Forgot password?")}</button></p>
              <p>{t("Nog geen account?", "No account yet?")} <button className="text-primary font-medium hover:underline" onClick={() => { setView("register"); setAuthErr(null); setNotice(null); }}>{t("Registreren", "Sign up")}</button></p>
            </>)}
            {view === "register" && (<p>{t("Al een account?", "Already have an account?")} <button className="text-primary font-medium hover:underline" onClick={() => { setView("login"); setAuthErr(null); }}>{t("Inloggen", "Log in")}</button></p>)}
            {view === "forgot" && (<p><button className="text-primary font-medium hover:underline" onClick={() => { setView("login"); setAuthErr(null); }}>{t("← Terug naar inloggen", "← Back to log in")}</button></p>)}
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
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2" onClick={() => { setProfileOpen(true); setMenuOpen(false); }}><UserIcon className="h-4 w-4" /> {t("Profiel", "Profile")}</button>
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2" onClick={() => { setBillingOpen(true); setMenuOpen(false); }} data-testid="menu-billing"><CreditCard className="h-4 w-4" /> {t("Abonnement", "Subscription")}</button>
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2" onClick={() => { setBackupsOpen(true); setMenuOpen(false); }} data-testid="menu-backups"><History className="h-4 w-4" /> {t("Back-ups", "Back-ups")}</button>
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2" onClick={doAdminUnlock} data-testid="menu-admin-unlock"><Sparkles className="h-4 w-4" /> Admin code</button>
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2 text-destructive" onClick={doLogout}><LogOut className="h-4 w-4" /> {t("Uitloggen", "Log out")}</button>
          </div>
        )}
      </div>

      <img src={logoUrl} alt="Nebula" className="h-40 md:h-52 w-auto mb-8" />

      {project ? (
        <div className="w-full max-w-2xl">
          <div className="relative rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
            <Button variant="ghost" size="icon" className="absolute top-4 right-4 z-10 h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDel(true)} aria-label="Project verwijderen" data-testid="button-delete-project"><Trash2 className="h-5 w-5" /></Button>
            <div className="h-2 w-full bg-gradient-to-r from-primary to-rose-400" />
            <div className="p-8">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("Jouw project", "Your project")}</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight pr-10">{project.name}</h1>
              <p className="mt-2 text-muted-foreground line-clamp-2">{project.description || t("Je website.", "Your website.")}</p>
              <div className="mt-5 flex flex-wrap gap-5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><FileCode className="w-4 h-4" />{project.fileCount} {t("bestanden", "files")}</span>
                <span className="flex items-center gap-1.5"><MessageSquare className="w-4 h-4" />{project.messageCount} {t("berichten", "messages")}</span>
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" />{t("Bijgewerkt", "Updated")} {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}</span>
              </div>
              <Button size="lg" className="mt-7 w-full h-12 font-bold text-base" onClick={() => setLocation(`/projects/${project.id}`)} data-testid="button-open-project">{t("Project openen", "Open project")} <ArrowRight className="ml-2 h-5 w-5" /></Button>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">{t("Eén project tegelijk. Verwijder dit project om een nieuwe website te importeren.", "One project at a time. Delete this project to import a new website.")}</p>
        </div>
      ) : (
        <div className="w-full max-w-2xl">
          <div className="relative bg-card rounded-xl border border-border shadow-lg p-2 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 flex items-center">
              <Globe className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input value={url} onChange={(e) => { setUrl(e.target.value); if (error) setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") handleImport(); }} placeholder={t("bijv. stripe.com of https://voorbeeld.nl", "e.g. stripe.com or https://example.com")} className="h-12 border-0 bg-transparent pl-9 text-base focus-visible:ring-0" data-testid="input-import-url" autoFocus />
            </div>
            <Button size="lg" onClick={handleImport} disabled={!url.trim() || importProject.isPending} className="h-12 font-bold disabled:opacity-100 shrink-0" data-testid="button-import-url">
              {importProject.isPending ? (<><Loader2 className="mr-2 h-5 w-5 animate-spin" />{t("Importeren...", "Importing...")}</>) : (<>{t("Website importeren", "Import website")}<ArrowRight className="ml-2 h-5 w-5" /></>)}
            </Button>
          </div>
          {error && (<p className="mt-3 text-sm text-destructive text-center" data-testid="text-import-error">{error}</p>)}
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" /> {t("of", "or")} <div className="h-px flex-1 bg-border" /></div>
          <Button variant="outline" size="lg" className="mt-3 w-full h-12 font-semibold gap-2" disabled={createProject.isPending} onClick={handleCreateBlank} data-testid="button-new-website">
            {createProject.isPending ? (<><Loader2 className="h-5 w-5 animate-spin" /> {t("Aanmaken…", "Creating…")}</>) : (<><Sparkles className="h-5 w-5" /> {t("Nieuwe website vanaf nul met Claude Code", "New website from scratch with Claude Code")}</>)}
          </Button>
          <ClaudeStatusCard />
          <div className="mt-8 rounded-2xl border border-border bg-card shadow-lg p-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">{t("Begin je project", "Start your project")}</h2>
            <p className="mt-2 text-muted-foreground">{t("Importeer je bestaande website hierboven of open een project — daarna bewerk je alles met Claude Code, rechtstreeks in je browser.", "Import your existing website above or open a project — then edit everything with Claude Code, right in your browser.")}</p>
            <div className="mt-7 grid gap-4 sm:grid-cols-3 text-left">
              <div className="rounded-xl border border-border/70 p-4"><TerminalIcon className="h-6 w-6 text-primary" /><h3 className="mt-2 font-semibold text-sm">{t("Claude Code als editor", "Claude Code as your editor")}</h3><p className="text-xs text-muted-foreground mt-1">{t("Vertel in gewone taal wat er anders moet; Claude past de bestanden van je site direct aan.", "Say what should change in plain language; Claude edits your site’s files directly.")}</p></div>
              <div className="rounded-xl border border-border/70 p-4"><Sparkles className="h-6 w-6 text-primary" /><h3 className="mt-2 font-semibold text-sm">{t("Jouw eigen abonnement", "Your own subscription")}</h3><p className="text-xs text-muted-foreground mt-1">{t("Koppel één keer je Claude-account. Je betaalt alleen je Claude-abonnement, niets extra's.", "Link your Claude account once. You only pay for your Claude subscription, nothing extra.")}</p></div>
              <div className="rounded-xl border border-border/70 p-4"><Rocket className="h-6 w-6 text-primary" /><h3 className="mt-2 font-semibold text-sm">{t("Jij bent eigenaar", "You own it")}</h3><p className="text-xs text-muted-foreground mt-1">{t("Je site, je bestanden, je domein — publiceer op een Nebula-adres of je eigen domein met SSL.", "Your site, your files, your domain — publish on a Nebula address or your own domain with SSL.")}</p></div>
            </div>
          </div>
        </div>
      )}

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} user={user} onSaved={(u) => setUser(u)} onDeleted={() => { clearToken(); setUser(null); setProfileOpen(false); refresh(); }} />
      <BillingDialog open={billingOpen} onClose={() => setBillingOpen(false)} />
      <BackupsDialog open={backupsOpen} onClose={() => setBackupsOpen(false)} onOpenProject={(id) => setLocation(`/projects/${id}`)} onRestored={() => refresh()} />

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

async function billingApi(path: string, body?: unknown): Promise<{ ok: boolean; d: any }> {
  const r = await fetch(`/api/billing${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, d };
}

// ── Back-ups (incl. van VERWIJDERDE projecten — herstel als nieuw project) ──
function BackupsDialog({ open, onClose, onOpenProject, onRestored }: { open: boolean; onClose: () => void; onOpenProject: (id: number) => void; onRestored: () => void }) {
  const { t } = useLang();
  const [list, setList] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    setList(null);
    fetch("/api/backups", { headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) } })
      .then((r) => r.json()).then((d) => setList(d.backups || [])).catch(() => setList([]));
  }, [open]);
  if (!open) return null;
  const restoreNew = async (backupId: number) => {
    if (busy) return;
    setBusy(backupId);
    try {
      const r = await fetch(`/api/backups/${backupId}/restore-new`, { method: "POST", headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) } });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.projectId) { onRestored(); onClose(); onOpenProject(d.projectId); }
      else alert(d.error || t("Herstellen mislukt.", "Restore failed."));
    } catch { alert(t("Herstellen mislukt.", "Restore failed.")); }
    finally { setBusy(null); }
  };
  const deleteBackup = async (backupId: number) => {
    if (busy) return;
    if (!window.confirm(t("Deze back-up verwijderen?", "Delete this back-up?"))) return;
    if (!window.confirm(t("Weet je het zeker? Een verwijderde back-up is definitief weg en kan NIET meer worden teruggezet.", "Are you sure? A deleted back-up is gone for good and can NOT be restored."))) return;
    setBusy(backupId);
    try {
      const r = await fetch(`/api/backups/${backupId}`, { method: "DELETE", headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) } });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) setList((prev) => (prev || []).filter((x) => x.id !== backupId));
      else alert(d.error || t("Verwijderen mislukt.", "Delete failed."));
    } catch { alert(t("Verwijderen mislukt.", "Delete failed.")); }
    finally { setBusy(null); }
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-[min(560px,96%)] max-h-[88vh] overflow-y-auto rounded-xl bg-background border shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1"><h3 className="text-lg font-semibold flex items-center gap-2"><History className="h-5 w-5" /> {t("Back-ups", "Back-ups")}</h3><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="h-4 w-4" /></Button></div>
        <p className="text-xs text-muted-foreground mb-4">{t("Al je back-ups — ook van projecten die je hebt verwijderd. Een verwijderd project kun je hier terugzetten als nieuw project, zodat er niks verloren gaat.", "All your back-ups — including from projects you deleted. You can restore a deleted project here as a new project, so nothing is lost.")}</p>
        {list === null ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{t("Nog geen back-ups.", "No back-ups yet.")}</p>
        ) : (
          <ul className="space-y-2">
            {list.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">{b.projectName || t("Naamloos project", "Untitled project")}{b.deleted && <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">{t("verwijderd", "deleted")}</span>}</div>
                  <div className="text-[11px] text-muted-foreground">{new Date(b.createdAt).toLocaleString()} · {b.kind === "manual" ? t("handmatig", "manual") : t("automatisch", "automatic")} · {b.fileCount} {t("bestanden", "files")}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {b.deleted ? (
                    <Button size="sm" variant="outline" className="h-8" disabled={busy === b.id} onClick={() => restoreNew(b.id)} data-testid={`button-restore-new-${b.id}`}>
                      {busy === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Terugzetten", "Restore")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => { onClose(); onOpenProject(b.projectId); }}>{t("Open project", "Open project")}</Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" disabled={busy === b.id} onClick={() => deleteBackup(b.id)} title={t("Back-up verwijderen", "Delete back-up")} data-testid={`button-delbackup-${b.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Abonnement (€50/maand, volledige toegang) ──
function BillingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLang();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState<{ clientSecret: string; publishableKey: string; email?: string } | null>(null);
  const load = () => billingApi("").then((r) => { if (r.ok) setData(r.d); });
  useEffect(() => { if (open) { setData(null); load(); } }, [open]);
  if (!open) return null;

  const subscribe = async () => {
    setBusy(true);
    const r = await billingApi("/subscribe", {});
    setBusy(false);
    if (!r.ok) { alert(r.d.error || "Abonneren mislukt."); return; }
    if (r.d.clientSecret && r.d.publishableKey) { setCheckout({ clientSecret: r.d.clientSecret, publishableKey: r.d.publishableKey, email: r.d.email || "" }); return; }
    if (r.d.url) { window.location.href = r.d.url; return; }
    alert("Abonneren mislukt.");
  };
  const cancel = async () => { if (!window.confirm("Je abonnement opzeggen? Je houdt toegang tot het einde van de periode.")) return; setBusy(true); const r = await billingApi("/cancel", {}); setBusy(false); if (r.ok) load(); else alert(r.d.error || "Opzeggen mislukt."); };
  const price = data?.priceEur ?? 50;

  // One dialog at a time: while the checkout is open it fully replaces the plan dialog instead of
  // stacking a popup on a popup. Closing the checkout falls back to the plan; success reloads it.
  if (checkout) {
    return <CheckoutModal clientSecret={checkout.clientSecret} publishableKey={checkout.publishableKey} initialEmail={checkout.email || ""} price={price} onClose={() => setCheckout(null)} onDone={() => { setCheckout(null); load(); }} />;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-[min(500px,96%)] max-h-[88vh] overflow-y-auto rounded-xl bg-background border shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-semibold flex items-center gap-2"><CreditCard className="h-5 w-5" /> {t("Abonnement", "Subscription")}</h3><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="h-4 w-4" /></Button></div>
        {!data ? (<div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>) : data.subscribed ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-center gap-2 text-emerald-700 font-semibold"><Check className="h-4 w-4" /> {t("Actief abonnement", "Active subscription")} — €{price}{t("/maand", "/month")}</div>
            {data.currentPeriodEnd && <p className="text-xs text-emerald-700/80 mt-1">{t("Verlengt op", "Renews on")} {data.currentPeriodEnd}</p>}
            <p className="text-sm text-emerald-900/80 mt-2">{t("Je hebt volledige toegang: Claude Code instellen & bewerken, je eigen domein koppelen en publiceren zonder watermerk.", "You have full access: set up & edit with Claude Code, connect your own domain and publish without a watermark.")}</p>
            <Button variant="outline" size="sm" className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={busy} onClick={cancel}>{t("Opzeggen", "Cancel plan")}</Button>
          </div>
        ) : (
          <div className="rounded-xl border p-5 text-center">
            <h4 className="text-xl font-bold">{t("Volledige toegang", "Full access")}</h4>
            <p className="text-4xl font-extrabold mt-1">€{price}<span className="text-base font-medium text-muted-foreground">{t("/maand", "/month")}</span></p>
            <ul className="text-sm text-muted-foreground mt-4 space-y-1.5 text-left max-w-xs mx-auto">
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0" /> {t("Je website bewerken met Claude Code", "Edit your website with Claude Code")}</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0" /> {t("Je eigen domein koppelen", "Connect your own domain")}</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0" /> {t("Geen watermerk op je site", "No watermark on your site")}</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-primary shrink-0" /> {t("Auto-SEO en alle platformfuncties", "Auto-SEO and all platform features")}</li>
            </ul>
            <Button className="mt-5 w-full h-11 font-bold" disabled={busy} onClick={subscribe} data-testid="button-subscribe">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t("Abonneren met iDEAL of creditcard", "Subscribe with iDEAL or credit card")}</Button>
            <p className="text-[11px] text-muted-foreground mt-2">{t("Betalen gaat veilig via Stripe (iDEAL, creditcard). Je vult je naam en adres in voor de factuur. Maandelijks opzegbaar.", "Payments are handled securely by Stripe (iDEAL, credit card). You fill in your name and address for the invoice. Cancel monthly.")}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{t("Het bewerken zelf werkt op je eigen Claude-abonnement.", "Editing itself runs on your own Claude subscription.")}</p>
            <button className="mt-3 text-xs text-muted-foreground underline hover:text-destructive" disabled={busy} onClick={cancel} data-testid="button-cancel-inline">{t("Al een abonnement? Opzeggen", "Already subscribed? Cancel")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Custom in-app Stripe payment (Payment Element: card + iDEAL) ──
function CheckoutModal({ clientSecret, publishableKey, initialEmail, price, onClose, onDone }: { clientSecret: string; publishableKey: string; initialEmail?: string; price: number; onClose: () => void; onDone: () => void }) {
  const payRef = useRef<HTMLDivElement | null>(null);
  const addrRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{ stripe: any; elements: any } | null>(null);
  const { t, lang } = useLang();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const [paying, setPaying] = useState(false);
  // Own e-mail field so EVERY payment method collects it (the Payment Element only shows one for
  // iDEAL). Prefilled with the account e-mail; ends up on the Stripe customer → on the invoice.
  const [email, setEmail] = useState(initialEmail || "");
  const emailRef = useRef(email);
  emailRef.current = email;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { loadStripe } = await import("@stripe/stripe-js");
        const stripe = await loadStripe(publishableKey);
        if (!stripe) throw new Error("Stripe kon niet laden.");
        if (cancelled) return;
        const elements = stripe.elements({ clientSecret, locale: lang, appearance: { theme: "stripe", variables: { colorPrimary: "#e0855b", borderRadius: "10px" } } });
        stateRef.current = { stripe, elements };
        const addr = elements.create("address", { mode: "billing" });
        // email: "never" — we collect it with our own field above the element (for ALL methods)
        // and pass it in confirmSetup; without "never" Stripe would double-collect it for iDEAL.
        const pay = elements.create("payment", { layout: "tabs", fields: { billingDetails: { email: "never" } } });
        // "ready" only when the Payment Element ACTUALLY rendered — mounting can fail (e.g. a
        // live/test key mismatch), and pretending it's ready gives an empty form plus a confusing
        // "elements should have a mounted Payment Element" on submit.
        pay.on("ready", () => { if (!cancelled) setStatus("ready"); });
        pay.on("loaderror", (ev: any) => { if (!cancelled) { setErr(ev?.error?.message || t("Het betaalformulier kon niet laden. Probeer het later opnieuw.", "The payment form could not load. Please try again later.")); setStatus("error"); } });
        const mount = () => {
          if (cancelled) return;
          if (addrRef.current) addr.mount(addrRef.current);
          if (payRef.current) pay.mount(payRef.current);
        };
        setTimeout(mount, 30);
      } catch (e) {
        if (!cancelled) { setErr((e as Error).message || t("Betalen kon niet laden.", "Payments could not load.")); setStatus("error"); }
      }
    })();
    return () => { cancelled = true; };
  }, [clientSecret, publishableKey]);

  const pay = async () => {
    const st = stateRef.current;
    if (!st) return;
    const mail = emailRef.current.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { setErr(t("Vul een geldig e-mailadres in — daar sturen we je factuur naartoe.", "Enter a valid e-mail address — that's where we send your invoice.")); return; }
    setPaying(true); setErr("");
    try {
      // The clientSecret is a SETUP intent: the customer authorises the payment method here (card
      // stays in-app; iDEAL hops to the bank and returns to the return_url), and the server then
      // creates the €50/mo subscription on the saved method via /subscribe/complete.
      const { error, setupIntent } = await st.stripe.confirmSetup({
        elements: st.elements,
        confirmParams: {
          return_url: `${window.location.origin}/ai-editor?sub=done`,
          payment_method_data: { billing_details: { email: mail } },
        },
        redirect: "if_required",
      });
      if (error) { setErr(error.message || t("Betaling mislukt.", "Payment failed.")); setPaying(false); return; }
      if (setupIntent?.status === "succeeded") {
        const r = await billingApi("/subscribe/complete", { setupIntentId: setupIntent.id });
        if (!r.ok) { setErr(r.d.error || t("Abonneren mislukt.", "Subscribing failed.")); setPaying(false); return; }
        onDone();
        return;
      }
      // A redirect flow (iDEAL) navigates away — nothing more to do here.
    } catch (e) { setErr((e as Error).message || t("Betaling mislukt.", "Payment failed.")); setPaying(false); }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="w-[min(480px,96%)] my-8 rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200">
          <span className="font-semibold text-neutral-900">{t("Afrekenen", "Checkout")} — €{price}{t("/maand", "/month")}</span>
          <button onClick={onClose} className="h-8 w-8 rounded-full hover:bg-neutral-100 flex items-center justify-center text-neutral-500" data-testid="button-close-checkout"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {status === "loading" && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>}
          {status === "error" && <p className="text-sm text-red-600">{err || t("Betalen kon niet laden. Probeer het later opnieuw.", "Payments could not load. Please try again later.")}</p>}
          <div className={status === "ready" ? "space-y-4" : "hidden"}>
            <div><p className="text-xs font-medium text-neutral-500 mb-1.5">{t("Factuurgegevens", "Billing details")}</p><div ref={addrRef} /></div>
            <div>
              <p className="text-xs font-medium text-neutral-500 mb-1.5">{t("E-mailadres", "E-mail address")} <span className="font-normal text-neutral-400">{t("(voor je factuur)", "(for your invoice)")}</span></p>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("jouwnaam@voorbeeld.nl", "yourname@example.com")} autoComplete="email"
                className="w-full h-11 rounded-[10px] border border-neutral-300 bg-white px-3 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-[#e0855b] focus:ring-2 focus:ring-[#e0855b]/25" data-testid="input-checkout-email" />
            </div>
            <div><p className="text-xs font-medium text-neutral-500 mb-1.5">{t("Betaalmethode", "Payment method")}</p><div ref={payRef} /></div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button onClick={pay} disabled={paying} className="w-full h-11 rounded-xl bg-neutral-900 text-white font-semibold hover:bg-neutral-800 disabled:opacity-60 flex items-center justify-center gap-2" data-testid="button-pay">
              {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : t(`Betaal €${price}/maand`, `Pay €${price}/month`)}
            </button>
            <p className="text-[11px] text-neutral-400 text-center">{t("Veilig betalen via Stripe · iDEAL & creditcard · maandelijks opzegbaar", "Secure payment via Stripe · iDEAL & credit card · cancel monthly")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Profile editor (name / birthdate / phone + change password) ──
function ProfileDialog({ open, onClose, user, onSaved, onDeleted }: { open: boolean; onClose: () => void; user: PlatformUser; onSaved: (u: PlatformUser) => void; onDeleted: () => void }) {
  const { t } = useLang();
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
        <label className="block text-xs text-muted-foreground mb-1">{t("Naam", "Name")}</label>
        <Input className="mb-3" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="block text-xs text-muted-foreground mb-1">{t("Geboortedatum", "Date of birth")}</label>
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
            <p className="text-xs text-muted-foreground mb-2">Verwijder je account en alles wat erbij hoort (je project en website) — definitief.</p>
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
