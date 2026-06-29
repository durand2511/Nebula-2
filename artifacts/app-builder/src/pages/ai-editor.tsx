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
import { ArrowRight, Globe, Loader2, FileCode, MessageSquare, Clock, Trash2, Sparkles, CalendarCheck, Rocket, User as UserIcon, LogOut, X, CreditCard, Check } from "lucide-react";
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
    if (r.d.emailed) { setNotice("We hebben een nieuw wachtwoord naar je e-mail gestuurd."); setView("login"); }
    else if (r.d.tempPassword) { setNotice(`Je tijdelijke wachtwoord is: ${r.d.tempPassword} — log ermee in en wijzig het bij je profiel.`); setView("login"); }
  };
  const doLogout = async () => { await authApi("logout", {}); clearToken(); setUser(null); setMenuOpen(false); setLocation("/ai-editor"); };

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
            <button className="w-full text-left rounded-lg px-3 py-2 hover:bg-muted/50 flex items-center gap-2 text-destructive" onClick={doLogout}><LogOut className="h-4 w-4" /> Uitloggen</button>
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
