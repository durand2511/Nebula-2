import { useEffect, useMemo, useRef, useState } from "react";
import {
  Gauge, BarChart3, RefreshCw, Loader2, Sparkles, Wand2, AlertTriangle, AlertCircle,
  CheckCircle2, Info, Users, Eye, Clock, Monitor, Smartphone, Tablet, ArrowUpRight, Globe,
  Accessibility, Zap, Trophy, Link2, Target, X, Search, Gift, ChevronDown, ChevronRight,
  TrendingUp, Palette, Languages, Image as ImageIcon, Mail, Wrench, Flame, Download, Upload, MousePointerClick,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { getToken } from "@/lib/session";

type Severity = "error" | "warn" | "good" | "info";
type AuditKind = "seo" | "a11y" | "speed";
type Finding = { id: string; page: string; severity: Severity; category: string; title: string; detail: string; fix?: string; fixPrompt?: string };
type Report = {
  kind: AuditKind; score: number; grade: string; counts: { error: number; warn: number; good: number };
  categories: { key: string; label: string; score: number }[];
  pages: string[]; findings: Finding[]; generatedAt: string;
};
type Summary = {
  days: number; totals: { views: number; visitors: number; avgSeconds: number };
  byDay: { day: string; views: number; visitors: number }[];
  topPages: { path: string; views: number }[];
  devices: { device: string; views: number }[];
  referrers: { host: string; views: number }[];
  screens: { label: string; views: number }[];
  online: number;
  conversions: { total: number; rate: number; goals: { goal: string; count: number }[] };
  hasData: boolean;
};

const sevMeta: Record<Severity, { ring: string; text: string; Icon: typeof AlertTriangle }> = {
  error: { ring: "border-rose-500/30", text: "text-rose-500", Icon: AlertCircle },
  warn: { ring: "border-amber-500/30", text: "text-amber-500", Icon: AlertTriangle },
  info: { ring: "border-sky-500/30", text: "text-sky-500", Icon: Info },
  good: { ring: "border-emerald-500/30", text: "text-emerald-500", Icon: CheckCircle2 },
};

function ScoreRing({ score, grade, size = 128 }: { score: number; grade?: string; size?: number }) {
  const R = 52, C = 2 * Math.PI * R;
  const col = score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="relative shrink-0" style={{ height: size, width: size }}>
      <svg viewBox="0 0 120 120" className="-rotate-90" style={{ height: size, width: size }}>
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-muted/40" />
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" stroke={col} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C - (C * score) / 100} style={{ transition: "stroke-dashoffset .8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold tabular-nums" style={{ color: col, fontSize: size * 0.24 }}>{score}</span>
        {grade && <span className="text-[11px] font-semibold text-muted-foreground">{grade}</span>}
      </div>
    </div>
  );
}

export function SeoPanel({ projectId, onFix }: { projectId: number; onFix: (prompt: string) => boolean }) {
  const { t } = useLang();
  const [view, setView] = useState<"seo" | "a11y" | "speed" | "google" | "competitor" | "visitors" | "tools">("seo");
  const tabs: { key: typeof view; label: string; Icon: typeof Gauge }[] = [
    { key: "seo", label: t("SEO", "SEO"), Icon: Gauge },
    { key: "a11y", label: t("Toegankelijkheid", "Accessibility"), Icon: Accessibility },
    { key: "speed", label: t("Snelheid", "Speed"), Icon: Zap },
    { key: "google", label: t("Google-posities", "Google positions"), Icon: TrendingUp },
    { key: "competitor", label: t("Concurrent", "Competitor"), Icon: Trophy },
    { key: "visitors", label: t("Bezoekers", "Visitors"), Icon: BarChart3 },
    { key: "tools", label: t("Tools", "Tools"), Icon: Wrench },
  ];
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="shrink-0 border-b border-border px-4 pt-2 flex items-center gap-1 overflow-x-auto">
        {tabs.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setView(key)}
            className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${view === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === "visitors" ? <VisitorsView projectId={projectId} />
          : view === "competitor" ? <CompetitorView projectId={projectId} onFix={onFix} />
          : view === "google" ? <GoogleView projectId={projectId} />
          : view === "tools" ? <ToolsView projectId={projectId} onFix={onFix} />
          : <AuditView projectId={projectId} kind={view} onFix={onFix} />}
      </div>
    </div>
  );
}

const AUDIT_META: Record<AuditKind, { title: string; blurb: string }> = {
  seo: { title: "SEO-score", blurb: "Hoe goed vindbaar je site is in Google." },
  a11y: { title: "Toegankelijkheid", blurb: "Hoe bruikbaar je site is voor iedereen, incl. schermlezers." },
  speed: { title: "Snelheid", blurb: "Hoe snel je pagina's laden (Core Web Vitals)." },
};

function AuditView({ projectId, kind, onFix }: { projectId: number; kind: AuditKind; onFix: (prompt: string) => boolean }) {
  const { t } = useLang();
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setErr(false); setData(null);
    fetch(`/api/projects/${projectId}/seo-audit?kind=${kind}`).then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData).catch(() => setErr(true)).finally(() => setLoading(false));
  };
  useEffect(load, [projectId, kind]);

  const fixable = useMemo(() => (data?.findings || []).filter((f) => f.fixPrompt), [data]);
  const grouped = useMemo(() => {
    const g = new Map<string, Finding[]>();
    for (const f of data?.findings || []) (g.get(f.category) || g.set(f.category, []).get(f.category)!).push(f);
    return g;
  }, [data]);

  const doFix = (f: Finding) => {
    if (!f.fixPrompt) return;
    if (onFix(f.fixPrompt)) { setFixing(f.id); setTimeout(() => setFixing(null), 2500); }
  };
  const fixAll = () => {
    if (!fixable.length) return;
    const list = fixable.map((f, i) => `${i + 1}. ${f.fixPrompt}`).join("\n");
    const head = kind === "a11y" ? t(`Verbeter de toegankelijkheid van deze website. Los deze ${fixable.length} punten op`, `Improve this website's accessibility. Fix these ${fixable.length} issues`)
      : kind === "speed" ? t(`Maak deze website sneller. Los deze ${fixable.length} punten op`, `Make this website faster. Fix these ${fixable.length} issues`)
      : t(`Verbeter de SEO van deze website. Los deze ${fixable.length} punten op`, `Improve this website's SEO. Fix these ${fixable.length} issues`);
    const msg = `${head}, ${t("behoud de bestaande vormgeving en tekst zoveel mogelijk", "keep the existing design and copy as much as possible")}:\n${list}`;
    if (onFix(msg)) { setFixing("__all__"); setTimeout(() => setFixing(null), 3000); }
  };
  const improveLinks = () => {
    const msg = t(
      "Analyseer alle pagina's van de site en voeg waar zinvol interne links toe tussen gerelateerde pagina's, diensten en blogs, met beschrijvende ankertekst. Houd het natuurlijk (geen keyword-stuffing) en overdrijf het aantal links niet.",
      "Analyse all pages and add helpful internal links between related pages, services and blog posts, with descriptive anchor text. Keep it natural (no keyword-stuffing) and don't overdo the number of links.",
    );
    if (onFix(msg)) { setFixing("__links__"); setTimeout(() => setFixing(null), 3000); }
  };

  if (loading) return <Centered><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">{t("Website analyseren…", "Analysing website…")}</p></Centered>;
  if (err || !data) return <Centered><AlertCircle className="h-6 w-6 text-rose-500" /><p className="mt-3 text-sm text-muted-foreground">{t("Analyse mislukt.", "Analysis failed.")}</p><Button variant="outline" size="sm" className="mt-3" onClick={load}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />{t("Opnieuw", "Retry")}</Button></Centered>;
  if (!data.pages.length) return <Centered><Gauge className="h-8 w-8 text-muted-foreground/50" /><p className="mt-3 text-sm text-muted-foreground max-w-xs text-center">{t("Nog geen pagina's om te analyseren. Bouw eerst je website.", "No pages to analyse yet. Build your website first.")}</p></Centered>;

  const meta = AUDIT_META[kind];
  return (
    <div className="max-w-4xl mx-auto p-5 md:p-7">
      <div className="flex flex-col md:flex-row md:items-center gap-5 rounded-2xl border border-border bg-card/40 p-5">
        <ScoreRing score={data.score} grade={data.grade} />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{t(meta.title, meta.title)}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t(meta.blurb, meta.blurb)}</p>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t(`${data.pages.length} pagina's`, `${data.pages.length} pages`)} · {" "}
            <span className="text-rose-500 font-medium">{data.counts.error} {t("problemen", "errors")}</span>, {" "}
            <span className="text-amber-500 font-medium">{data.counts.warn} {t("aandachtspunten", "warnings")}</span>
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {data.categories.map((c) => (
              <span key={c.key} className={`text-[11px] px-2 py-1 rounded-full border ${c.score >= 75 ? "border-emerald-500/25 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5" : c.score >= 50 ? "border-amber-500/25 text-amber-600 dark:text-amber-400 bg-amber-500/5" : "border-rose-500/25 text-rose-600 dark:text-rose-400 bg-rose-500/5"}`}>
                {c.label} {c.score}
              </span>
            ))}
          </div>
        </div>
        <div className="flex md:flex-col gap-2 shrink-0">
          {fixable.length > 0 && (
            <Button size="sm" className="gap-1.5" onClick={fixAll} disabled={fixing === "__all__"}>
              {fixing === "__all__" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t(`Alles fixen (${fixable.length})`, `Fix all (${fixable.length})`)}
            </Button>
          )}
          {kind === "seo" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={improveLinks} disabled={fixing === "__links__"}>
              {fixing === "__links__" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Link2 className="h-3.5 w-3.5" />}
              {t("Interne links", "Internal links")}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" /> {t("Opnieuw", "Rescan")}
          </Button>
        </div>
      </div>

      {fixable.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
          <Wand2 className="h-3.5 w-3.5" /> {t("Klik op “Fix met Claude” bij een punt — Claude past het meteen in je site aan.", "Click “Fix with Claude” on an item — Claude edits your site right away.")}
        </p>
      )}

      <div className="mt-5 space-y-5">
        {[...grouped.entries()].map(([cat, items]) => {
          const label = data.categories.find((c) => c.key === cat)?.label || cat;
          return (
            <div key={cat}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</h3>
              <div className="space-y-2">
                {items.map((f) => {
                  const m = sevMeta[f.severity];
                  return (
                    <div key={f.id} className={`rounded-xl border ${m.ring} bg-card/30 p-3.5 flex gap-3`}>
                      <m.Icon className={`shrink-0 mt-0.5 ${m.text}`} style={{ width: 18, height: 18 }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-foreground">{f.title}</span>
                          {f.page && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{f.page}</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{f.detail}</p>
                      </div>
                      {f.fixPrompt && (
                        <Button size="sm" variant="outline" className="shrink-0 self-center gap-1.5 h-8"
                          onClick={() => doFix(f)} disabled={fixing === f.id}>
                          {fixing === f.id ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{t("Verstuurd", "Sent")}</> : <><Wand2 className="h-3.5 w-3.5" />{t("Fix met Claude", "Fix with Claude")}</>}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground/60 mt-6 text-center">
        {t("Gratis analyse — geen extern account nodig.", "Free analysis — no external account needed.")}
      </p>
    </div>
  );
}

function CompetitorView({ projectId, onFix }: { projectId: number; onFix: (prompt: string) => boolean }) {
  const { t } = useLang();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<null | { ok: boolean; error?: string; competitorUrl: string; yourScore: number; theirScore: number; items: { label: string; you: boolean; them: boolean }[]; wins: string[] }>(null);
  const [sent, setSent] = useState(false);

  const run = () => {
    if (!url.trim()) return;
    setLoading(true); setRes(null);
    fetch(`/api/projects/${projectId}/competitor?url=${encodeURIComponent(url.trim())}`).then((r) => r.json()).then(setRes).catch(() => setRes({ ok: false, error: t("Vergelijking mislukt.", "Comparison failed."), competitorUrl: url, yourScore: 0, theirScore: 0, items: [], wins: [] })).finally(() => setLoading(false));
  };
  const fixWins = () => {
    if (!res?.wins.length) return;
    const msg = t(
      `Een concurrent (${res.competitorUrl}) doet deze SEO-dingen beter dan wij. Verbeter onze site op deze punten: ${res.wins.join("; ")}.`,
      `A competitor (${res.competitorUrl}) does these SEO things better than us. Improve our site on: ${res.wins.join("; ")}.`,
    );
    if (onFix(msg)) { setSent(true); setTimeout(() => setSent(false), 3000); }
  };

  return (
    <div className="max-w-3xl mx-auto p-5 md:p-7">
      <h2 className="text-lg font-semibold text-foreground">{t("Vergelijk met een concurrent", "Compare with a competitor")}</h2>
      <p className="text-sm text-muted-foreground mt-1">{t("Plak de website van een concurrent. We vergelijken jullie on-page SEO en tonen waar zij sterker zijn.", "Paste a competitor's website. We compare on-page SEO and show where they're stronger.")}</p>
      <div className="flex gap-2 mt-4">
        <div className="flex-1 flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder="bijv. concurrent.nl" className="flex-1 bg-transparent py-2.5 text-sm outline-none text-foreground placeholder:text-muted-foreground/60" />
        </div>
        <Button onClick={run} disabled={loading || !url.trim()} className="gap-1.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}{t("Vergelijk", "Compare")}
        </Button>
      </div>

      {res && !res.ok && (
        <div className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {res.error}
        </div>
      )}

      {res && res.ok && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex flex-col items-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{t("Jouw site", "Your site")}</span>
              <ScoreRing score={res.yourScore} size={96} />
            </div>
            <div className="rounded-2xl border border-border bg-card/40 p-4 flex flex-col items-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 truncate max-w-full">{new URL(res.competitorUrl).hostname.replace(/^www\./, "")}</span>
              <ScoreRing score={res.theirScore} size={96} />
            </div>
          </div>

          {res.wins.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
              <Target className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{t("Zo haal je ze in", "How to catch up")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("Punten waarop de concurrent sterker is:", "Where the competitor is stronger:")} {res.wins.join(", ")}.</p>
              </div>
              <Button size="sm" className="shrink-0 gap-1.5" onClick={fixWins} disabled={sent}>
                {sent ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}{t("Fix met Claude", "Fix with Claude")}
              </Button>
            </div>
          )}

          <div className="mt-3 rounded-2xl border border-border bg-card/40 overflow-hidden">
            {res.items.map((i, idx) => (
              <div key={idx} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${idx > 0 ? "border-t border-border/60" : ""}`}>
                <span className="flex-1 text-foreground/90">{i.label}</span>
                <span className={`flex items-center gap-1 w-24 justify-end ${i.you ? "text-emerald-500" : "text-muted-foreground/50"}`}>
                  {i.you ? <CheckCircle2 className="h-4 w-4" /> : <X className="h-4 w-4" />}<span className="text-xs">{t("jij", "you")}</span>
                </span>
                <span className={`flex items-center gap-1 w-24 justify-end ${i.them ? "text-emerald-500" : "text-muted-foreground/50"}`}>
                  {i.them ? <CheckCircle2 className="h-4 w-4" /> : <X className="h-4 w-4" />}<span className="text-xs">{t("zij", "them")}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VisitorsView({ projectId }: { projectId: number }) {
  const { t } = useLang();
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState<"overview" | "heatmap">("overview");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(0);
  const onlineTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load the full summary (spinner only on the very first load; later refreshes are silent).
  const loadSummary = (spinner = false) => {
    if (spinner) setLoading(true);
    fetch(`/api/projects/${projectId}/analytics?days=${days}`).then((r) => r.json()).then((d: Summary) => { setData(d); setOnline(d.online || 0); }).catch(() => { if (spinner) setData(null); }).finally(() => { if (spinner) setLoading(false); });
  };
  useEffect(() => { loadSummary(true); }, [projectId, days]);

  // Live: refresh the "online now" counter every 5s, and quietly refresh the whole overview every 20s
  // so the numbers keep updating without the user pressing anything.
  useEffect(() => {
    const live = setInterval(() => fetch(`/api/projects/${projectId}/analytics/live`).then((r) => r.json()).then((d) => setOnline(d.online || 0)).catch(() => {}), 5000);
    const full = setInterval(() => loadSummary(false), 20000);
    onlineTimer.current = live;
    return () => { clearInterval(live); clearInterval(full); };
  }, [projectId, days]);

  const maxDay = useMemo(() => Math.max(1, ...(data?.byDay || []).map((d) => d.views)), [data]);
  const fmtDur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

  if (loading && !data) return <Centered><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Centered>;

  return (
    <div className="max-w-4xl mx-auto p-5 md:p-7">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t("Bezoekers", "Visitors")}</h2>
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
            {online} {t("nu online", "online now")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button onClick={() => setMode("overview")} className={`px-3 py-1.5 transition-colors ${mode === "overview" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>{t("Overzicht", "Overview")}</button>
            <button onClick={() => setMode("heatmap")} className={`px-3 py-1.5 flex items-center gap-1 transition-colors ${mode === "heatmap" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}><Flame className="h-3 w-3" />{t("Heatmap", "Heatmap")}</button>
          </div>
          {mode === "overview" && (
            <div className="flex rounded-lg border border-border overflow-hidden text-xs">
              {[7, 30, 90].map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`px-3 py-1.5 transition-colors ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                  {d}{t(" dagen", " days")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {mode === "heatmap" && <HeatmapPanel projectId={projectId} />}
      {mode === "overview" && (<>

      {!data?.hasData ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
          <BarChart3 className="h-9 w-9 mx-auto text-muted-foreground/40" />
          <h3 className="mt-3 text-sm font-medium text-foreground">{t("Nog geen bezoekers gemeten", "No visitors measured yet")}</h3>
          <p className="mt-1.5 text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            {t("Zodra je site gepubliceerd is en mensen 'm bezoeken, zie je hier hoeveel bezoekers je hebt, hoe lang ze blijven, welke pagina's ze bekijken, op welk apparaat, waar ze vandaan komen — en hoeveel er nú online zijn. De meting werkt automatisch.",
               "Once your site is published and people visit it, you'll see how many visitors you get, how long they stay, which pages they view, on which device, where they come from — and how many are online right now. Tracking works automatically.")}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric icon={Eye} label={t("Weergaven", "Pageviews")} value={data.totals.views.toLocaleString()} />
            <Metric icon={Users} label={t("Unieke bezoekers", "Unique visitors")} value={data.totals.visitors.toLocaleString()} />
            <Metric icon={Clock} label={t("Gem. tijd", "Avg. time")} value={fmtDur(data.totals.avgSeconds)} />
            <Metric icon={Target} label={t("Conversies", "Conversions")} value={`${data.conversions.total}`} sub={data.conversions.total > 0 ? `${data.conversions.rate}%` : undefined} />
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-card/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t("Weergaven per dag", "Pageviews per day")}</div>
            <div className="flex items-end gap-[3px] h-32">
              {data.byDay.map((d) => (
                <div key={d.day} className="flex-1 min-w-0 h-full group relative flex flex-col justify-end">
                  <div className="w-full rounded-t bg-primary/70 hover:bg-primary transition-colors" style={{ height: `${Math.max(2, (d.views / maxDay) * 100)}%` }} />
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block whitespace-nowrap rounded bg-foreground px-2 py-1 text-[10px] text-background shadow">
                    {new Date(d.day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}: {d.views} {t("weergaven", "views")}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3 mt-3">
            <BarList title={t("Populairste pagina's", "Top pages")} items={data.topPages.map((p) => ({ label: p.path, value: p.views }))} />
            <BarList title={t("Waar bezoekers vandaan komen", "Where visitors come from")} icon={Globe}
              items={data.referrers.length ? data.referrers.map((r) => ({ label: r.host, value: r.views })) : [{ label: t("Direct / onbekend", "Direct / unknown"), value: data.totals.views }]} />
          </div>

          {data.conversions.goals.length > 0 && (
            <div className="mt-3">
              <BarList title={t("Conversies (doelen)", "Conversions (goals)")} icon={Target}
                items={data.conversions.goals.map((g) => ({ label: g.goal, value: g.count }))} />
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-3 mt-3">
            <div className="rounded-2xl border border-border bg-card/40 p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t("Apparaat", "Device")}</div>
              <div className="space-y-2.5">
                {data.devices.map((d) => {
                  const Ic = d.device === "mobile" ? Smartphone : d.device === "tablet" ? Tablet : Monitor;
                  const pct = Math.round((d.views / Math.max(1, data.totals.views)) * 100);
                  const nl = d.device === "mobile" ? t("Telefoon", "Mobile") : d.device === "tablet" ? "Tablet" : t("Computer", "Desktop");
                  return (
                    <div key={d.device} className="flex items-center gap-3">
                      <Ic className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-foreground w-20 shrink-0">{nl}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary/70" style={{ width: `${pct}%` }} /></div>
                      <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <BarList title={t("Schermgrootte", "Screen size")} items={data.screens.map((s) => ({ label: s.label, value: s.views }))} />
          </div>
        </>
      )}

      <div className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("Groei-instellingen", "Growth settings")}</div>
      <ExitPopupCard projectId={projectId} />
      <NewsletterCard projectId={projectId} />
      <WelcomeBackCard projectId={projectId} />
      <ABTestCard projectId={projectId} />
      </>)}
    </div>
  );
}

function ExitPopupCard({ projectId }: { projectId: number }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState({ enabled: false, title: "", body: "", button: "", code: "" });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/exit-popup`).then((r) => r.json()).then((d) => setCfg({
      enabled: !!d.enabled, title: d.title || "", body: d.body || "", button: d.button || "", code: d.code || "",
    })).catch(() => {});
  }, [projectId]);

  const save = async (next = cfg) => {
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/exit-popup`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally { setBusy(false); }
  };
  const set = (patch: Partial<typeof cfg>) => setCfg((c) => ({ ...c, ...patch }));

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card/40 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/30 transition-colors">
        <Gift className="h-4.5 w-4.5 text-primary shrink-0" style={{ width: 18, height: 18 }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{t("Conversie-booster: exit-pop-up", "Conversion booster: exit pop-up")}</div>
          <div className="text-xs text-muted-foreground">{t("Toon een aanbod net voordat een bezoeker wegklikt.", "Show an offer right before a visitor leaves.")}</div>
        </div>
        {cfg.enabled && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">{t("aan", "on")}</span>}
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border/60 space-y-3">
          <label className="flex items-center gap-2.5 cursor-pointer pt-3">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => { const v = e.target.checked; set({ enabled: v }); save({ ...cfg, enabled: v }); }} className="h-4 w-4 accent-primary" />
            <span className="text-sm text-foreground">{t("Exit-pop-up inschakelen op mijn site", "Enable exit pop-up on my site")}</span>
          </label>
          <div className="grid gap-2.5">
            <Field label={t("Titel", "Title")} value={cfg.title} onChange={(v) => set({ title: v })} placeholder={t("Wacht — mis dit niet!", "Wait — don't miss this!")} />
            <Field label={t("Tekst", "Text")} value={cfg.body} onChange={(v) => set({ body: v })} placeholder={t("Boek nu je gratis proefles.", "Book your free trial class now.")} />
            <div className="grid grid-cols-2 gap-2.5">
              <Field label={t("Knoptekst", "Button text")} value={cfg.button} onChange={(v) => set({ button: v })} placeholder={t("Ja, ik wil dit", "Yes, I want this")} />
              <Field label={t("Kortingscode (optioneel)", "Discount code (optional)")} value={cfg.code} onChange={(v) => set({ code: v })} placeholder="WELKOM10" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => save()} disabled={busy}>
              {saved ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />{t("Opgeslagen", "Saved")}</> : t("Opslaan", "Save")}
            </Button>
            <span className="text-[11px] text-muted-foreground">{t("Wijzigingen gelden op je gepubliceerde site.", "Changes apply to your published site.")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-muted-foreground mb-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary text-foreground placeholder:text-muted-foreground/50" />
    </label>
  );
}

function Metric({ icon: Icon, label, value, sub }: { icon: typeof Eye; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-4">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="mt-2 text-2xl font-bold text-foreground tabular-nums flex items-baseline gap-1.5">
        {value}{sub && <span className="text-sm font-semibold text-emerald-500">{sub}</span>}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function BarList({ title, items, icon: Icon }: { title: string; items: { label: string; value: number }[]; icon?: typeof Globe }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5" />}{title}
      </div>
      <div className="space-y-2">
        {items.slice(0, 8).map((i, idx) => (
          <div key={idx} className="relative">
            <div className="flex items-center justify-between gap-2 text-sm relative z-10 px-2 py-1">
              <span className="truncate text-foreground/90 flex items-center gap-1">{i.label.startsWith("http") && <ArrowUpRight className="h-3 w-3 opacity-50" />}{i.label || "/"}</span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{i.value}</span>
            </div>
            <div className="absolute inset-0 rounded-md bg-primary/10" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        ))}
        {!items.length && <p className="text-xs text-muted-foreground italic">{"—"}</p>}
      </div>
    </div>
  );
}

// ── Shared collapsible growth card + site-config section hook ──────────────────────────────────
function useSiteSection<T extends Record<string, unknown>>(projectId: number, key: string, initial: T) {
  const [val, setVal] = useState<T>(initial);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/projects/${projectId}/site-config`).then((r) => r.json()).then((d) => { if (d && d[key]) setVal({ ...initial, ...d[key] }); }).catch(() => {});
  }, [projectId]);
  const patch = (p: Partial<T>) => setVal((v) => ({ ...v, ...p }));
  const save = async (next: T = val) => {
    setBusy(true);
    try { await fetch(`/api/projects/${projectId}/site-config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: next }) }); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    catch { /* ignore */ } finally { setBusy(false); }
  };
  return { val, patch, save, saved, busy };
}

function GrowthCard({ icon: Icon, title, subtitle, on, children }: { icon: typeof Gift; title: string; subtitle: string; on: boolean; children: React.ReactNode }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-2xl border border-border bg-card/40 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/30 transition-colors">
        <Icon className="text-primary shrink-0" style={{ width: 18, height: 18 }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
        {on && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">{t("aan", "on")}</span>}
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-border/60 space-y-3">{children}</div>}
    </div>
  );
}

function SaveRow({ onSave, saved, busy, note }: { onSave: () => void; saved: boolean; busy: boolean; note?: string }) {
  const { t } = useLang();
  return (
    <div className="flex items-center gap-3 pt-1">
      <Button size="sm" onClick={onSave} disabled={busy}>
        {saved ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />{t("Opgeslagen", "Saved")}</> : t("Opslaan", "Save")}
      </Button>
      <span className="text-[11px] text-muted-foreground">{note || t("Wijzigingen gelden op je gepubliceerde site.", "Changes apply to your published site.")}</span>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer pt-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-primary" />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

function NewsletterCard({ projectId }: { projectId: number }) {
  const { t } = useLang();
  const { val, patch, save, saved, busy } = useSiteSection(projectId, "newsletter", { enabled: false, title: "", text: "" });
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { fetch(`/api/projects/${projectId}/subscribers`).then((r) => r.json()).then((d) => setCount(d.count ?? 0)).catch(() => {}); }, [projectId]);
  // Export via authed fetch (the <a> tag wouldn't carry the Bearer token) → download the blob.
  const exportCsv = async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/subscribers?format=csv`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `nieuwsbrief-${projectId}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { /* ignore */ }
  };
  return (
    <GrowthCard icon={Mail} title={t("Nieuwsbrief-inschrijving", "Newsletter sign-up")} subtitle={t("Verzamel e-mailadressen met een aanmeldblok op je site.", "Collect emails with a sign-up block on your site.")} on={!!val.enabled}>
      <Toggle checked={!!val.enabled} onChange={(v) => { patch({ enabled: v }); save({ ...val, enabled: v }); }} label={t("Aanmeldblok tonen op mijn site", "Show a sign-up block on my site")} />
      <Field label={t("Titel", "Title")} value={val.title} onChange={(v) => patch({ title: v })} placeholder={t("Blijf op de hoogte", "Stay in the loop")} />
      <Field label={t("Tekst", "Text")} value={val.text} onChange={(v) => patch({ text: v })} placeholder={t("Meld je aan voor nieuws en aanbiedingen.", "Sign up for news and offers.")} />
      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
        <span className="text-sm text-foreground">{count === null ? "…" : count} {t("aanmeldingen", "sign-ups")}</span>
        <button onClick={exportCsv} className="text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline"><Download className="h-3.5 w-3.5" />{t("Exporteer CSV", "Export CSV")}</button>
      </div>
      <SaveRow onSave={() => save()} saved={saved} busy={busy} />
    </GrowthCard>
  );
}

function WelcomeBackCard({ projectId }: { projectId: number }) {
  const { t } = useLang();
  const { val, patch, save, saved, busy } = useSiteSection(projectId, "welcomeBack", { enabled: false, message: "" });
  return (
    <GrowthCard icon={Users} title={t("“Welkom terug” voor terugkerende bezoekers", "“Welcome back” for returning visitors")} subtitle={t("Toon een vriendelijke banner aan wie al eerder langskwam.", "Show a friendly banner to people who visited before.")} on={!!val.enabled}>
      <Toggle checked={!!val.enabled} onChange={(v) => { patch({ enabled: v }); save({ ...val, enabled: v }); }} label={t("Welkom-terug-banner inschakelen", "Enable welcome-back banner")} />
      <Field label={t("Bericht", "Message")} value={val.message} onChange={(v) => patch({ message: v })} placeholder={t("Welkom terug! Leuk dat je er weer bent 👋", "Welcome back! Great to see you again 👋")} />
      <SaveRow onSave={() => save()} saved={saved} busy={busy} />
    </GrowthCard>
  );
}

function ABTestCard({ projectId }: { projectId: number }) {
  const { t } = useLang();
  const { val, patch, save, saved, busy } = useSiteSection(projectId, "abTest", { enabled: false, label: "", selector: "", variant: "" });
  return (
    <GrowthCard icon={Target} title={t("A/B-test", "A/B test")} subtitle={t("Test twee versies van een tekst en zie welke beter converteert.", "Test two versions of a text and see which converts better.")} on={!!val.enabled}>
      <Toggle checked={!!val.enabled} onChange={(v) => { patch({ enabled: v }); save({ ...val, enabled: v }); }} label={t("A/B-test inschakelen", "Enable A/B test")} />
      <Field label={t("Naam van de test", "Test name")} value={val.label} onChange={(v) => patch({ label: v })} placeholder={t("Koptekst homepage", "Homepage headline")} />
      <Field label={t("CSS-selector van het element", "CSS selector of the element")} value={val.selector} onChange={(v) => patch({ selector: v })} placeholder="h1, .hero-title" />
      <Field label={t("Variant B (nieuwe tekst)", "Variant B (new text)")} value={val.variant} onChange={(v) => patch({ variant: v })} placeholder={t("Boek nu je gratis proefles", "Book your free trial now")} />
      <p className="text-[11px] text-muted-foreground leading-relaxed">{t("De helft van je bezoekers ziet de originele tekst (A), de andere helft variant B. Conversies worden per variant geteld — kijk bij Conversies welke wint (bijv. “boeking [A]” vs “boeking [B]”).", "Half your visitors see the original (A), the other half variant B. Conversions are counted per variant — check Conversions to see which wins (e.g. “booking [A]” vs “booking [B]”).")}</p>
      <SaveRow onSave={() => save()} saved={saved} busy={busy} note={t("Werkt op je gepubliceerde site.", "Works on your published site.")} />
    </GrowthCard>
  );
}

// ── Google Search Console positions ────────────────────────────────────────────────────────────
function GoogleView({ projectId }: { projectId: number }) {
  const { t } = useLang();
  const [data, setData] = useState<null | { ok: boolean; detail: string; rows: { query: string; position: number; clicks: number; impressions: number; ctr: number }[]; totals: { clicks: number; impressions: number; position: number } }>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(`/api/projects/${projectId}/gsc/positions`).then((r) => r.json()).then(setData).catch(() => setData({ ok: false, detail: t("Ophalen mislukt.", "Fetch failed."), rows: [], totals: { clicks: 0, impressions: 0, position: 0 } })).finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <Centered><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Centered>;
  if (!data?.ok) return (
    <div className="max-w-2xl mx-auto p-5 md:p-7">
      <div className="rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
        <TrendingUp className="h-9 w-9 mx-auto text-muted-foreground/40" />
        <h3 className="mt-3 text-sm font-medium text-foreground">{t("Nog geen Google-posities", "No Google positions yet")}</h3>
        <p className="mt-1.5 text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">{data?.detail || t("Koppel Google Search Console (in de zijbalk bij SEO) en publiceer je site. Na een paar dagen zie je hier op welke zoekwoorden je in Google staat, je positie, klikken en vertoningen.", "Connect Google Search Console (in the SEO sidebar) and publish your site. After a few days you'll see which search terms you rank for, your position, clicks and impressions.")}</p>
      </div>
    </div>
  );
  return (
    <div className="max-w-4xl mx-auto p-5 md:p-7">
      <h2 className="text-lg font-semibold text-foreground">{t("Je posities in Google", "Your Google positions")}</h2>
      <p className="text-sm text-muted-foreground mt-0.5">{t("Echte data uit Google Search Console (laatste 28 dagen).", "Real data from Google Search Console (last 28 days).")}</p>
      <div className="grid grid-cols-3 gap-3 mt-4">
        <Metric icon={Search} label={t("Vertoningen", "Impressions")} value={data.totals.impressions.toLocaleString()} />
        <Metric icon={MousePointerClick} label={t("Klikken", "Clicks")} value={data.totals.clicks.toLocaleString()} />
        <Metric icon={TrendingUp} label={t("Gem. positie", "Avg. position")} value={data.totals.position ? data.totals.position.toFixed(1) : "—"} />
      </div>
      {data.rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{data.detail}</p>
      ) : (
        <div className="mt-4 rounded-2xl border border-border bg-card/40 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">
            <span className="flex-1">{t("Zoekwoord", "Search term")}</span>
            <span className="w-16 text-right">{t("Positie", "Position")}</span>
            <span className="w-16 text-right">{t("Klikken", "Clicks")}</span>
            <span className="w-16 text-right">CTR</span>
          </div>
          {data.rows.map((r, i) => (
            <div key={i} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${i > 0 ? "border-t border-border/50" : ""}`}>
              <span className="flex-1 truncate text-foreground/90">{r.query}</span>
              <span className={`w-16 text-right font-semibold tabular-nums ${r.position <= 3 ? "text-emerald-500" : r.position <= 10 ? "text-amber-500" : "text-muted-foreground"}`}>{r.position.toFixed(1)}</span>
              <span className="w-16 text-right tabular-nums text-muted-foreground">{r.clicks}</span>
              <span className="w-16 text-right tabular-nums text-muted-foreground">{r.ctr}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Click heat-map ──────────────────────────────────────────────────────────────────────────────
// Map a tracked click path ("/", "/contact", "/contact.html") to the project's page file.
function heatmapPageFile(path: string): string {
  let p = (path || "/").split("?")[0].split("#")[0];
  if (p === "/" || p === "") return "index.html";
  p = p.replace(/^\//, "").replace(/\/$/, "");
  if (!/\.html$/i.test(p)) p += ".html";
  return p;
}

// The heat-map "stage": the real page rendered same-origin (so we can read its height and line the
// dots up), with the click dots overlaid. Non-interactive itself — the parent handles clicks.
function HeatStage({ src, points, maxWidth }: { src: string; points: { x: number; y: number }[]; maxWidth: number }) {
  const [h, setH] = useState(900);
  const ref = useRef<HTMLIFrameElement | null>(null);
  const measure = () => {
    try {
      const doc = ref.current?.contentWindow?.document;
      const hh = doc ? Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0) : 0;
      if (hh > 100) setH(Math.min(hh, 8000));
    } catch { /* keep fallback height */ }
  };
  return (
    <div className="relative mx-auto rounded-xl border border-border overflow-hidden bg-white" style={{ maxWidth, height: h }}>
      <iframe ref={ref} src={src} onLoad={() => { measure(); setTimeout(measure, 600); }} title="heatmap-page" scrolling="no"
        sandbox="allow-same-origin" className="absolute inset-0 w-full h-full border-0 pointer-events-none" style={{ background: "#fff" }} />
      <div className="absolute inset-0 pointer-events-none">
        {points.map((pt, i) => (
          <span key={i} className="absolute rounded-full" style={{
            left: `${pt.x / 10}%`, top: `${pt.y / 10}%`, width: 30, height: 30, transform: "translate(-50%,-50%)",
            background: "radial-gradient(circle, rgba(244,63,94,.5) 0%, rgba(244,63,94,0) 72%)", mixBlendMode: "multiply",
          }} />
        ))}
      </div>
    </div>
  );
}

function HeatmapPanel({ projectId }: { projectId: number }) {
  const { t } = useLang();
  const [data, setData] = useState<null | { page: string; pages: { path: string; clicks: number }[]; points: { x: number; y: number }[] }>(null);
  const [page, setPage] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [full, setFull] = useState(false);

  const load = () => {
    const q = page ? `?page=${encodeURIComponent(page)}` : "";
    fetch(`/api/projects/${projectId}/heatmap${q}`).then((r) => r.json()).then((d) => { setData(d); if (!page && d.page) setPage(d.page); }).catch(() => setData(null)).finally(() => setLoading(false));
  };
  useEffect(() => { setLoading(true); load(); }, [projectId, page]);
  // Keep the heat-map fresh (new clicks come in live).
  useEffect(() => { const id = setInterval(load, 10000); return () => clearInterval(id); }, [projectId, page]);
  // Esc closes full-screen.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  if (loading && !data) return <Centered><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Centered>;
  if (!data || !data.pages.length) return (
    <div className="rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center">
      <Flame className="h-9 w-9 mx-auto text-muted-foreground/40" />
      <h3 className="mt-3 text-sm font-medium text-foreground">{t("Nog geen klikken gemeten", "No clicks measured yet")}</h3>
      <p className="mt-1.5 text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">{t("Zodra bezoekers op je gepubliceerde site klikken, zie je hier — over je échte pagina heen — waar ze klikken. Handig om te zien wat opvalt en wat genegeerd wordt.", "Once visitors click on your published site, you'll see — right over your real page — where they click. Great for spotting what draws attention and what's ignored.")}</p>
    </div>
  );
  const file = heatmapPageFile(page || data.page || "/");
  const src = `/api/projects/${projectId}/preview-page?page=${encodeURIComponent(file)}&token=${encodeURIComponent(getToken() || "")}`;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {data.pages.map((p) => (
          <button key={p.path} onClick={() => setPage(p.path)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${page === p.path ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {p.path} <span className="opacity-60">({p.clicks})</span>
          </button>
        ))}
        <Button size="sm" variant="outline" className="ml-auto h-7 gap-1.5" onClick={() => setFull(true)}>
          <Maximize2 className="h-3.5 w-3.5" /> {t("Volledig scherm", "Full screen")}
        </Button>
      </div>

      {/* Click the map to open it larger. */}
      <div className="cursor-zoom-in group relative" onClick={() => setFull(true)} title={t("Klik om te vergroten", "Click to enlarge")}>
        <HeatStage src={src} points={data.points} maxWidth={900} />
        {data.points.length === 0 && <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none"><span className="text-xs bg-foreground/80 text-background rounded-full px-3 py-1">{t("Nog geen klikken op deze pagina", "No clicks on this page yet")}</span></div>}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"><span className="inline-flex items-center gap-1 text-[11px] bg-foreground/80 text-background rounded-full px-2 py-1"><Maximize2 className="h-3 w-3" />{t("Vergroten", "Enlarge")}</span></div>
      </div>
      <p className="text-[11px] text-muted-foreground/70 mt-2 text-center">{t("Klikposities over je echte pagina (rood = geklikt). Klik om te vergroten · ververst automatisch.", "Click positions over your real page (red = clicked). Click to enlarge · refreshes automatically.")}</p>

      {full && (
        <div className="fixed inset-0 z-[95] bg-black/80 flex flex-col" onClick={() => setFull(false)}>
          <div className="flex items-center justify-between px-4 py-3 text-white shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 flex-wrap">
              <Flame className="h-4 w-4 text-rose-400" />
              <span className="text-sm font-medium">{t("Heatmap", "Heatmap")} · {file}</span>
              {data.pages.map((p) => (
                <button key={p.path} onClick={() => setPage(p.path)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${page === p.path ? "border-white bg-white/15" : "border-white/30 text-white/70 hover:text-white"}`}>{p.path} <span className="opacity-60">({p.clicks})</span></button>
              ))}
            </div>
            <button onClick={() => setFull(false)} className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white shrink-0" title={t("Sluiten (Esc)", "Close (Esc)")}><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <HeatStage src={src} points={data.points} maxWidth={1200} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tools: merk-kit, meertalig, AI-fotobewerking ────────────────────────────────────────────────
function ToolsView({ projectId, onFix }: { projectId: number; onFix: (prompt: string) => boolean }) {
  return (
    <div className="max-w-3xl mx-auto p-5 md:p-7 space-y-4">
      <BrandKitTool projectId={projectId} onFix={onFix} />
      <TranslateTool onFix={onFix} />
      <ImageTool />
    </div>
  );
}

function BrandKitTool({ projectId, onFix }: { projectId: number; onFix: (prompt: string) => boolean }) {
  const { t } = useLang();
  const { val, patch, save, saved, busy } = useSiteSection(projectId, "brandKit", { primary: "#1f2937", accent: "#7a00df", font: "", logoUrl: "" });
  const [applied, setApplied] = useState(false);
  const apply = () => {
    const msg = t(
      `Pas de huisstijl van de hele website consequent aan: primaire kleur ${val.primary}, accentkleur ${val.accent}${val.font ? `, lettertype "${val.font}"` : ""}${val.logoUrl ? `, logo ${val.logoUrl}` : ""}. Werk knoppen, links, koppen en accenten bij zodat alles bij deze huisstijl past, en houd het toegankelijk (genoeg contrast).`,
      `Apply the brand identity consistently across the whole website: primary color ${val.primary}, accent color ${val.accent}${val.font ? `, font "${val.font}"` : ""}${val.logoUrl ? `, logo ${val.logoUrl}` : ""}. Update buttons, links, headings and accents to match, keeping it accessible (enough contrast).`,
    );
    if (onFix(msg)) { setApplied(true); setTimeout(() => setApplied(false), 3000); }
  };
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="flex items-center gap-2.5 mb-1"><Palette className="h-5 w-5 text-primary" /><h3 className="text-base font-semibold text-foreground">{t("Merk-kit", "Brand kit")}</h3></div>
      <p className="text-sm text-muted-foreground mb-4">{t("Leg je kleuren, lettertype en logo vast en pas ze in één klik toe op je hele site.", "Set your colors, font and logo and apply them across your whole site in one click.")}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <ColorField label={t("Primaire kleur", "Primary color")} value={val.primary} onChange={(v) => patch({ primary: v })} />
        <ColorField label={t("Accentkleur", "Accent color")} value={val.accent} onChange={(v) => patch({ accent: v })} />
        <Field label={t("Lettertype", "Font")} value={val.font} onChange={(v) => patch({ font: v })} placeholder="Poppins, Inter, …" />
        <Field label={t("Logo-URL", "Logo URL")} value={val.logoUrl} onChange={(v) => patch({ logoUrl: v })} placeholder="https://…" />
      </div>
      <div className="flex items-center gap-2 mt-4">
        <Button size="sm" variant="outline" onClick={() => save()} disabled={busy}>{saved ? t("Opgeslagen", "Saved") : t("Bewaar merk-kit", "Save brand kit")}</Button>
        <Button size="sm" className="gap-1.5" onClick={apply} disabled={applied}>
          {applied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}{t("Toepassen met Claude", "Apply with Claude")}
        </Button>
      </div>
    </div>
  );
}

function TranslateTool({ onFix }: { onFix: (prompt: string) => boolean }) {
  const { t } = useLang();
  const langs = [{ c: "en", n: "Engels" }, { c: "de", n: "Duits" }, { c: "fr", n: "Frans" }, { c: "es", n: "Spaans" }];
  const [sel, setSel] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const toggle = (c: string) => setSel((s) => s.includes(c) ? s.filter((x) => x !== c) : [...s, c]);
  const run = () => {
    if (!sel.length) return;
    const names = langs.filter((l) => sel.includes(l.c)).map((l) => l.n).join(", ");
    const msg = t(
      `Maak de website meertalig: voeg vertalingen toe voor ${names}. Maak per taal een nette versie van de pagina's, met een taalwissel-knop in het menu en correcte hreflang-tags en lang-attributen voor SEO. Behoud de vormgeving.`,
      `Make the website multilingual: add translations for ${names}. Create clean per-language versions of the pages, with a language switcher in the menu and correct hreflang tags and lang attributes for SEO. Keep the design.`,
    );
    if (onFix(msg)) { setDone(true); setTimeout(() => setDone(false), 3000); }
  };
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="flex items-center gap-2.5 mb-1"><Languages className="h-5 w-5 text-primary" /><h3 className="text-base font-semibold text-foreground">{t("Meertalige site (1 klik)", "Multilingual site (1 click)")}</h3></div>
      <p className="text-sm text-muted-foreground mb-4">{t("Laat Claude je hele site vertalen, met taalwisselaar en correcte SEO-tags.", "Let Claude translate your whole site, with a language switcher and correct SEO tags.")}</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {langs.map((l) => (
          <button key={l.c} onClick={() => toggle(l.c)} className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${sel.includes(l.c) ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {t(l.n, l.n)}
          </button>
        ))}
      </div>
      <Button size="sm" className="gap-1.5" onClick={run} disabled={!sel.length || done}>
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Languages className="h-3.5 w-3.5" />}{t("Vertaal met Claude", "Translate with Claude")}
      </Button>
    </div>
  );
}

// Client-side image optimiser (crop-free): resize + re-compress to a lighter file. 100% in the browser.
function ImageTool() {
  const { t } = useLang();
  const [maxW, setMaxW] = useState(1600);
  const [quality, setQuality] = useState(80);
  const [orig, setOrig] = useState<{ name: string; kb: number; w: number; h: number } | null>(null);
  const [out, setOut] = useState<{ url: string; kb: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = (file: File) => {
    setBusy(true); setOut(null);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      setOrig({ name: file.name, kb: Math.round(file.size / 1024), w: img.width, h: img.height });
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (blob) {
          const base = file.name.replace(/\.[^.]+$/, "");
          setOut({ url: URL.createObjectURL(blob), kb: Math.round(blob.size / 1024), name: `${base}-geoptimaliseerd.webp` });
        }
        URL.revokeObjectURL(url);
        setBusy(false);
      }, "image/webp", quality / 100);
    };
    img.onerror = () => { setBusy(false); URL.revokeObjectURL(url); };
    img.src = url;
  };

  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="flex items-center gap-2.5 mb-1"><ImageIcon className="h-5 w-5 text-primary" /><h3 className="text-base font-semibold text-foreground">{t("Foto-optimalisatie", "Image optimiser")}</h3></div>
      <p className="text-sm text-muted-foreground mb-4">{t("Maak zware afbeeldingen lichter (verkleinen + WebP) — direct in je browser, gratis. Snellere site = betere SEO.", "Make heavy images lighter (resize + WebP) — right in your browser, free. A faster site means better SEO.")}</p>
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <label className="block"><span className="block text-[11px] font-medium text-muted-foreground mb-1">{t("Max. breedte", "Max width")}: {maxW}px</span>
          <input type="range" min={400} max={2400} step={100} value={maxW} onChange={(e) => setMaxW(Number(e.target.value))} className="w-full accent-primary" /></label>
        <label className="block"><span className="block text-[11px] font-medium text-muted-foreground mb-1">{t("Kwaliteit", "Quality")}: {quality}%</span>
          <input type="range" min={40} max={95} step={5} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full accent-primary" /></label>
      </div>
      <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-6 cursor-pointer hover:border-primary/50 transition-colors text-sm text-muted-foreground">
        <Upload className="h-4 w-4" />{busy ? t("Bezig…", "Working…") : t("Kies een afbeelding", "Choose an image")}
        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </label>
      {orig && out && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-4 py-3">
          <div className="text-sm">
            <div className="text-foreground">{orig.kb} KB → <span className="font-semibold text-emerald-500">{out.kb} KB</span> <span className="text-xs text-muted-foreground">({Math.max(0, Math.round((1 - out.kb / Math.max(1, orig.kb)) * 100))}% {t("lichter", "lighter")})</span></div>
            <div className="text-xs text-muted-foreground">{orig.w}px → {Math.min(orig.w, maxW)}px</div>
          </div>
          <a href={out.url} download={out.name} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90"><Download className="h-4 w-4" />{t("Download", "Download")}</a>
        </div>
      )}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-muted-foreground mb-1">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 rounded cursor-pointer border-0 bg-transparent p-0" />
        <input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 bg-transparent text-sm outline-none text-foreground" />
      </div>
    </label>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col items-center justify-center py-20">{children}</div>;
}
