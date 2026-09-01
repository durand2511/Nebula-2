/**
 * Claude Code as THE website editor.
 *
 * Every platform user edits their website by running the real Claude Code CLI in a terminal inside
 * the web app, with their OWN Claude subscription (no Nebula API key involved). This module owns:
 *
 *   • one pty per (user, project): `claude` running in a workspace directory that mirrors the
 *     project's files (projectFiles table → disk on start, disk → DB on every change);
 *   • a per-user Claude home (CLAUDE_CONFIG_DIR) whose login credentials are persisted
 *     (encrypted) in platform_users.claude_auth, so the "koppeling" survives redeploys;
 *   • OS-level isolation in production: each user's pty runs as its own unix uid, its dirs are
 *     0700, and the child env carries NO platform secrets (no DATABASE_URL, no ANTHROPIC_API_KEY);
 *   • a WebSocket endpoint (/api/claude/terminal) that streams the pty to xterm.js in the browser
 *     and pushes "files changed" events so the preview refreshes live.
 *
 * Tool lockdown (no Bash/WebFetch/…) is enforced twice: a per-session settings.json in the user's
 * config dir AND, in the Docker image, /etc/claude-code/managed-settings.json (root-owned, so a
 * customer can't undo it).
 */
import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { db, platformUsers, projectFiles, projects } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getSessionUser } from "./platform-auth.js";
import { encryptSecret, decryptSecret } from "./email-config.js";
import { logger } from "./logger";

// node-pty is a CJS package with native bindings; load it through require so esbuild keeps it external.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pty: typeof import("node-pty") = require("node-pty");
// pnpm's prebuild copy of node-pty can lose the exec bit on its macOS `spawn-helper` (→ "posix_spawnp
// failed"). Restore it defensively at load; harmless on Linux where no helper is used.
try {
  const ptyDir = path.dirname(require.resolve("node-pty/package.json"));
  for (const arch of fsSync.readdirSync(path.join(ptyDir, "prebuilds"))) {
    const helper = path.join(ptyDir, "prebuilds", arch, "spawn-helper");
    if (fsSync.existsSync(helper)) fsSync.chmodSync(helper, 0o755);
  }
} catch { /* best effort */ }

// ── Config ────────────────────────────────────────────────────────────────────────────────────
const IS_LINUX_ROOT = process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0;
const ROOT = process.env.NEBULA_CLAUDE_ROOT || (IS_LINUX_ROOT ? "/nebula" : path.join(os.tmpdir(), "nebula-claude"));
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const IDLE_KILL_MS = 20 * 60 * 1000;      // no browser attached for this long → stop claude, free the workspace
const SCROLLBACK_MAX = 200 * 1024;        // bytes of output replayed to a (re)connecting client
const SYNC_DEBOUNCE_MS = 400;
const CRED_POLL_MS = 2000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const UID_BASE = 20000;                   // unix uid = UID_BASE + platform user id

// Folder for reference images (screenshots / uploads) the user gives Claude — never synced to the DB.
const REFS_DIR = "_refs";
// Folder holding a read-only export of THIS project's own data (scoped by project_id) — informational
// for Claude, never synced back to projectFiles.
const DB_DIR = "database";
// Per-project data tables (all keyed by project_id). Fixed allowlist — never user input.
const PROJECT_DATA_TABLES = [
  "studio_settings", "studio_locations", "studio_classes", "studio_members", "studio_bookings",
  "studio_purchases", "studio_products", "studio_codes", "studio_videos", "studio_video_plans",
  "studio_contacts", "studio_campaigns", "studio_wallets", "studio_credit_lots",
];
// Files/dirs in the workspace that are ours (never written back to the DB).
const SYNC_IGNORE = new Set(["CLAUDE.md", ".claude", REFS_DIR, DB_DIR, "node_modules", ".git", ".DS_Store"]);
const BINARY_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "woff", "woff2", "ttf", "otf", "eot", "zip", "mp4", "mp3", "webm"]);

// Tools a customer's Claude may use: file tools + internet (WebFetch/WebSearch are allowed — handy
// for fetching content/inspiration). Shell (Bash) and git stay off for now (a separate, opt-in
// decision). Cross-tenant isolation is enforced at the OS level (own unix uid, 0700 home/workspace,
// and a child env that carries NO platform secrets), independent of which tools are on.
const DENIED_TOOLS = ["Bash", "Agent", "Task", "NotebookEdit", "KillShell", "BashOutput", "TaskOutput"];

export const SESSION_SETTINGS = {
  permissions: { deny: DENIED_TOOLS, defaultMode: "acceptEdits", disableBypassPermissionsMode: "disable" },
  includeCoAuthoredBy: false,
};

// ── Types ─────────────────────────────────────────────────────────────────────────────────────
type FileRow = { id: number; path: string; content: string; updatedAt: number };

type ClientMsg =
  | { t: "i"; d: string }
  | { t: "r"; cols: number; rows: number }
  | { t: "ping" };

type Session = {
  key: string;
  userId: number;
  projectId: number;             // 0 = "koppelen" session (login only, no project)
  cwd: string;
  home: string;
  configDir: string;
  proc: import("node-pty").IPty | null;
  clients: Set<WebSocket>;
  scrollback: string;
  snapshot: Map<string, FileRow>; // path → row as last written to / read from the DB
  watcher: fsSync.FSWatcher | null;
  syncTimer: NodeJS.Timeout | null;
  syncing: Promise<void> | null;
  dirty: boolean;
  credTimer: NodeJS.Timeout | null;
  credHash: string;
  dbTimer: NodeJS.Timeout | null;
  applying: boolean;             // true while we write DB→disk (so the watcher's echo is a no-op)
  idleTimer: NodeJS.Timeout | null;
  exited: boolean;
};

const sessions = new Map<string, Session>();
const sessionKey = (userId: number, projectId: number) => `${userId}:${projectId}`;

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────
function inferLanguage(p: string): string {
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "html": case "htm": return "html";
    case "css": return "css";
    case "js": case "mjs": case "cjs": return "javascript";
    case "ts": return "typescript";
    case "json": return "json";
    case "svg": return "svg";
    case "md": return "markdown";
    default: return "plaintext";
  }
}

function safeJoin(root: string, rel: string): string | null {
  const full = path.resolve(root, rel);
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  return full === root || full.startsWith(withSep) ? full : null;
}

function isIgnored(rel: string): boolean {
  const first = rel.split("/")[0];
  if (SYNC_IGNORE.has(first)) return true;
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  return BINARY_EXT.has(ext);
}

async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  let entries: fsSync.Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (isIgnored(rel)) continue;
    if (e.isDirectory()) out.push(...(await walk(root, abs)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

function userDirs(userId: number) {
  const home = path.join(ROOT, "home", `u${userId}`);
  return { home, configDir: path.join(home, ".claude") };
}

function unixUser(userId: number): { uid: number; gid: number; name: string } | null {
  if (!IS_LINUX_ROOT) return null; // local dev (macOS) → run as ourselves
  const name = `nebula-u${userId}`;
  const uid = UID_BASE + userId;
  try {
    execFileSync("id", ["-u", name], { stdio: "ignore" });
  } catch {
    try {
      execFileSync("useradd", ["-u", String(uid), "-M", "-s", "/usr/sbin/nologin", name], { stdio: "ignore" });
    } catch (err) {
      logger.warn({ err, userId }, "[claude-terminal] useradd failed — running unisolated");
      return null;
    }
  }
  return { uid, gid: uid, name };
}

async function ownDir(dir: string, u: { uid: number; gid: number } | null) {
  await fs.mkdir(dir, { recursive: true });
  if (!u) return;
  try { execFileSync("chown", ["-R", `${u.uid}:${u.gid}`, dir], { stdio: "ignore" }); } catch { /* best effort */ }
  try { await fs.chmod(dir, 0o700); } catch { /* best effort */ }
}

function claudeMd(projectName: string): string {
  return [
    `# ${projectName} — website van de klant`,
    "",
    "Je bent de website-editor van Nebula. In deze map staat een kleine STATISCHE website: HTML-pagina's plus CSS- en JS-bestanden. Er is geen build-stap, geen framework en geen servercode — de bestanden worden 1-op-1 geserveerd.",
    "",
    "## Zo werk je",
    "- Doe precies wat de gebruiker vraagt — niet meer, niet minder. Geen ongevraagde refactors of 'verbeteringen'.",
    "- Lees een bestand altijd voordat je het bewerkt.",
    "- Pas het bestand aan dat de eigenaar is van de wijziging: styling → CSS, gedrag → JS, tekst → de HTML van die pagina.",
    "- Laat bestaande layout, secties, navigatie en content intact tenzij de wijziging dat vereist.",
    "- Nieuwe pagina = nieuw `.html`-bestand in de hoofdmap; koppel 'm in de navigatie van de andere pagina's.",
    "- Je mag dingen van internet ophalen (WebFetch/WebSearch) als dat helpt. Shell-commando's kun je (nog) niet uitvoeren; je werkt met de bestanden hier.",
    "- Elke opgeslagen wijziging verschijnt automatisch in de preview naast de terminal en wordt direct bewaard.",
    "- In de map `database/` staat een alleen-lezen momentopname van de EIGEN gegevens van dit project (JSON). Gebruik die om mee te denken; wijzigingen daarin veranderen de echte database niet.",
    "",
    "## HEEL BELANGRIJK — isolatie (nooit overtreden)",
    "- Deze map is UITSLUITEND het project van deze ene klant. Er is hier geen enkele toegang tot andere klanten, andere projecten, de gedeelde database of het Nebula-platform, en die komt er ook niet.",
    "- Beantwoord NOOIT vragen over andere klanten, andere websites, of gegevens buiten dit project, en probeer daar ook nooit bij te komen. Zeg dan vriendelijk dat je alleen met dit project mag werken.",
    "- Werk alleen binnen deze map. Ga niet buiten deze map zoeken of lezen.",
    "",
    "## Geïmporteerde sites",
    "Sommige bestanden zijn grote, geminificeerde HTML van een geïmporteerde site — herschrijf die niet. Voor een site-brede restyle: schrijf/verleng `.nebula-restyle.css` (wordt automatisch op elke pagina na de eigen CSS geladen) en richt je op de echte selectors van de site.",
    "",
    "## Taal",
    "Antwoord in het Nederlands, kort en duidelijk, en vat aan het einde samen wat je veranderd hebt.",
  ].join("\n");
}

// ── Credentials (the "koppeling") ─────────────────────────────────────────────────────────────
// key → where it lives (relative to the user's config dir / home). `.claude.json` (onboarding + oauth
// account info) lands in CLAUDE_CONFIG_DIR on current CLIs and in $HOME on older ones — keep both.
function credPaths(userId: number): Record<string, string> {
  const { home, configDir } = userDirs(userId);
  return {
    ".credentials.json": path.join(configDir, ".credentials.json"),
    ".claude.json": path.join(configDir, ".claude.json"),
    "home/.claude.json": path.join(home, ".claude.json"),
  };
}

async function readCredBlob(userId: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, abs] of Object.entries(credPaths(userId))) {
    try { out[k] = await fs.readFile(abs, "utf8"); } catch { /* absent */ }
  }
  return out;
}

function blobConnected(blob: Record<string, string>): boolean {
  const c = blob[".credentials.json"] || "";
  return /accessToken|claudeAiOauth|apiKey/.test(c);
}

export async function isClaudeConnected(userId: number): Promise<boolean> {
  // A live session may have logged in seconds ago — check disk first, then the DB copy.
  for (const s of sessions.values()) {
    if (s.userId === userId && blobConnected(await readCredBlob(userId))) return true;
  }
  const [u] = await db.select({ claudeAuth: platformUsers.claudeAuth }).from(platformUsers).where(eq(platformUsers.id, userId));
  if (!u?.claudeAuth) return false;
  try { return blobConnected(JSON.parse(decryptSecret(u.claudeAuth))); } catch { return false; }
}

export async function disconnectClaude(userId: number): Promise<void> {
  for (const s of [...sessions.values()]) if (s.userId === userId) await destroySession(s);
  for (const abs of Object.values(credPaths(userId))) await fs.rm(abs, { force: true }).catch(() => {});
  await db.update(platformUsers).set({ claudeAuth: "" }).where(eq(platformUsers.id, userId));
}

/**
 * Pre-answer Claude Code's first-run onboarding (theme, telemetry, "trust this folder") by seeding
 * the user-level .claude.json — WITHOUT touching any restored OAuth credentials. This takes the
 * customer straight to the login step instead of a multi-screen wizard in a tiny terminal.
 */
async function seedOnboarding(userId: number, cwd: string): Promise<void> {
  const { home, configDir } = userDirs(userId);
  for (const file of [path.join(configDir, ".claude.json"), path.join(home, ".claude.json")]) {
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* fresh */ }
    cfg.hasCompletedOnboarding = true;
    cfg.theme ??= "dark";
    cfg.autoUpdates = false;
    cfg.hasTrustDialogAccepted = true;
    const projects = (cfg.projects && typeof cfg.projects === "object") ? cfg.projects as Record<string, unknown> : {};
    projects[cwd] = { ...(projects[cwd] as object || {}), hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, allowedTools: [] };
    cfg.projects = projects;
    await fs.writeFile(file, JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}

async function restoreCreds(userId: number): Promise<string> {
  const [u] = await db.select({ claudeAuth: platformUsers.claudeAuth }).from(platformUsers).where(eq(platformUsers.id, userId));
  if (!u?.claudeAuth) return "";
  try {
    const blob = JSON.parse(decryptSecret(u.claudeAuth)) as Record<string, string>;
    const paths = credPaths(userId);
    for (const [f, content] of Object.entries(blob)) {
      if (!paths[f]) continue;
      await fs.writeFile(paths[f], content, { encoding: "utf8", mode: 0o600 });
    }
    return hashBlob(blob);
  } catch (err) {
    logger.warn({ err, userId }, "[claude-terminal] could not restore credentials");
    return "";
  }
}

function hashBlob(blob: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(blob)).digest("hex");
}

async function persistCredsIfChanged(s: Session): Promise<void> {
  const blob = await readCredBlob(s.userId);
  const h = hashBlob(blob);
  if (h === s.credHash) return;
  s.credHash = h;
  const wasConnected = blobConnected(blob);
  await db.update(platformUsers).set({ claudeAuth: Object.keys(blob).length ? encryptSecret(JSON.stringify(blob)) : "" }).where(eq(platformUsers.id, s.userId));
  broadcast(s, { t: "status", connected: wasConnected });
}

// ── DB ⇄ disk ─────────────────────────────────────────────────────────────────────────────────
async function materialise(s: Session, projectName: string): Promise<void> {
  const u = unixUser(s.userId);
  await fs.rm(s.cwd, { recursive: true, force: true });
  await fs.mkdir(s.cwd, { recursive: true });
  s.snapshot.clear();
  if (s.projectId > 0) {
    const rows = await db
      .select({ id: projectFiles.id, path: projectFiles.path, content: projectFiles.content, updatedAt: projectFiles.updatedAt })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, s.projectId));
    for (const row of rows) {
      const dest = safeJoin(s.cwd, row.path);
      if (!dest) continue;
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, row.content ?? "", "utf8");
      s.snapshot.set(row.path, { id: row.id, path: row.path, content: row.content, updatedAt: row.updatedAt.getTime() });
    }
    await fs.writeFile(path.join(s.cwd, "CLAUDE.md"), claudeMd(projectName), "utf8");
  }
  if (s.projectId > 0) await exportDatabase(s).catch((err) => logger.warn({ err, key: s.key }, "[claude-terminal] db export failed"));
  await ownDir(s.cwd, u);
}

// Write this project's OWN data (scoped strictly by project_id) as read-only JSON so Claude can see
// and reason about it. NEVER queries without the project_id filter → other customers are unreachable.
async function exportDatabase(s: Session): Promise<void> {
  const dir = path.join(s.cwd, DB_DIR);
  await fs.mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const table of PROJECT_DATA_TABLES) {
    try {
      // table names come from the fixed allowlist above (not user input); project_id is a bound param.
      const res = await db.execute(sql.raw(`SELECT * FROM ${table} WHERE project_id = ${Number(s.projectId)} LIMIT 2000`));
      const rows = (res as unknown as { rows?: unknown[] }).rows ?? (Array.isArray(res) ? (res as unknown[]) : []);
      if (rows.length) { await fs.writeFile(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2), "utf8"); written.push(`${table} (${rows.length})`); }
    } catch { /* table absent / query failed → skip */ }
  }
  const readme = [
    "# Database — de gegevens van DIT project (alleen-lezen export)",
    "",
    written.length
      ? `Hier staan de gegevens van jouw eigen project als JSON:\n${written.map((w) => `- ${w}`).join("\n")}`
      : "Dit project heeft nog geen opgeslagen gegevens (bijv. boekingen of leden).",
    "",
    "Dit is een momentopname, alleen om te bekijken en mee te denken. Wijzigingen in deze bestanden",
    "veranderen de echte database NIET. Je ziet hier uitsluitend de gegevens van dit ene project —",
    "gegevens van andere klanten zijn hier niet en zijn nergens bereikbaar.",
  ].join("\n");
  await fs.writeFile(path.join(dir, "README.md"), readme, "utf8");
}

function scheduleSync(s: Session) {
  s.dirty = true;
  if (s.syncTimer) clearTimeout(s.syncTimer);
  s.syncTimer = setTimeout(() => { s.syncTimer = null; void runSync(s); }, SYNC_DEBOUNCE_MS);
}

async function runSync(s: Session): Promise<void> {
  if (s.syncing) { await s.syncing; if (s.dirty) return runSync(s); return; }
  s.dirty = false;
  s.syncing = syncBack(s).catch((err) => logger.error({ err, key: s.key }, "[claude-terminal] sync failed"));
  await s.syncing;
  s.syncing = null;
}

async function syncBack(s: Session): Promise<void> {
  if (s.projectId <= 0 || s.applying) return;
  const onDisk = new Set(await walk(s.cwd));
  const changed: string[] = [], created: string[] = [], deleted: string[] = [];
  for (const rel of onDisk) {
    const abs = safeJoin(s.cwd, rel);
    if (!abs) continue;
    let st: fsSync.Stats;
    try { st = await fs.stat(abs); } catch { continue; }
    if (st.size > MAX_FILE_BYTES) continue;
    const content = await fs.readFile(abs, "utf8").catch(() => null);
    if (content == null) continue;
    const prev = s.snapshot.get(rel);
    if (!prev) {
      const [row] = await db.insert(projectFiles).values({ projectId: s.projectId, path: rel, content, language: inferLanguage(rel) }).returning({ id: projectFiles.id, updatedAt: projectFiles.updatedAt });
      s.snapshot.set(rel, { id: row.id, path: rel, content, updatedAt: row.updatedAt.getTime() });
      created.push(rel);
    } else if (content !== prev.content) {
      const [row] = await db.update(projectFiles).set({ content, language: inferLanguage(rel), updatedAt: new Date() }).where(eq(projectFiles.id, prev.id)).returning({ updatedAt: projectFiles.updatedAt });
      prev.content = content;
      prev.updatedAt = row?.updatedAt?.getTime() ?? Date.now();
      changed.push(rel);
    }
  }
  for (const [rel, row] of [...s.snapshot]) {
    if (!onDisk.has(rel)) {
      await db.delete(projectFiles).where(eq(projectFiles.id, row.id));
      s.snapshot.delete(rel);
      deleted.push(rel);
    }
  }
  if (changed.length || created.length || deleted.length) {
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, s.projectId));
    logger.info({ key: s.key, changed, created, deleted }, "[claude-terminal] synced to DB");
    broadcast(s, { t: "files", changed, created, deleted });
  }
}

/**
 * Other editors (klik-en-bewerk, blog, import, …) write projectFiles directly. Poll cheaply (ids +
 * updatedAt only) and pull any row that is newer than what we have onto disk, so Claude always
 * sees the latest files. Our own writes are recognised by their updatedAt and skipped.
 */
async function refreshFromDb(s: Session): Promise<void> {
  if (s.projectId <= 0 || s.exited || s.applying || s.syncing || s.syncTimer) return;
  const meta = await db.select({ id: projectFiles.id, path: projectFiles.path, updatedAt: projectFiles.updatedAt })
    .from(projectFiles).where(eq(projectFiles.projectId, s.projectId));
  const byId = new Map(meta.map((m) => [m.id, m]));
  const stale: number[] = [];
  for (const m of meta) {
    const prev = s.snapshot.get(m.path);
    if (!prev || prev.id !== m.id || m.updatedAt.getTime() > prev.updatedAt) stale.push(m.id);
  }
  const gone = [...s.snapshot.values()].filter((r) => !byId.has(r.id));
  if (!stale.length && !gone.length) return;
  s.applying = true;
  try {
    for (const r of gone) {
      const abs = safeJoin(s.cwd, r.path);
      if (abs) await fs.rm(abs, { force: true }).catch(() => {});
      s.snapshot.delete(r.path);
    }
    for (const id of stale) {
      const [row] = await db.select({ id: projectFiles.id, path: projectFiles.path, content: projectFiles.content, updatedAt: projectFiles.updatedAt })
        .from(projectFiles).where(eq(projectFiles.id, id));
      if (!row) continue;
      const abs = safeJoin(s.cwd, row.path);
      if (!abs) continue;
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, row.content ?? "", "utf8");
      s.snapshot.set(row.path, { id: row.id, path: row.path, content: row.content, updatedAt: row.updatedAt.getTime() });
    }
    logger.info({ key: s.key, pulled: stale.length, removed: gone.length }, "[claude-terminal] refreshed workspace from DB");
  } finally {
    // Let the watcher's echo of our own writes settle before re-enabling disk→DB sync.
    setTimeout(() => { s.applying = false; s.dirty = false; }, SYNC_DEBOUNCE_MS * 2);
  }
}

// ── Session lifecycle ─────────────────────────────────────────────────────────────────────────
function broadcast(s: Session, msg: Record<string, unknown>) {
  const data = JSON.stringify(msg);
  for (const c of s.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}

async function getOrCreateSession(userId: number, projectId: number, projectName: string): Promise<Session> {
  const key = sessionKey(userId, projectId);
  const existing = sessions.get(key);
  if (existing && !existing.exited) return existing;
  if (existing) await destroySession(existing);

  const { home, configDir } = userDirs(userId);
  let cwd = projectId > 0 ? path.join(ROOT, "ws", `u${userId}`, `p${projectId}`) : path.join(home, "koppelen");
  await fs.mkdir(cwd, { recursive: true });
  try { cwd = await fs.realpath(cwd); } catch { /* keep as-is */ }
  const u = unixUser(userId);
  for (const d of [home, configDir, path.join(home, ".config"), path.join(home, ".cache"), path.join(home, ".local", "share"), path.join(home, ".local", "state")]) {
    await fs.mkdir(d, { recursive: true });
  }
  // Session settings: deny shell/network tools, auto-accept file edits. Rewritten every start.
  await fs.writeFile(path.join(configDir, "settings.json"), JSON.stringify(SESSION_SETTINGS, null, 2), "utf8");
  const credHash = await restoreCreds(userId);
  await seedOnboarding(userId, cwd);
  await ownDir(home, u);

  const s: Session = {
    key, userId, projectId, cwd, home, configDir, proc: null, clients: new Set(), scrollback: "",
    snapshot: new Map(), watcher: null, syncTimer: null, syncing: null, dirty: false,
    credTimer: null, credHash, dbTimer: null, applying: false, idleTimer: null, exited: false,
  };
  sessions.set(key, s);

  await materialise(s, projectName);

  const env: Record<string, string> = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    USER: u?.name || os.userInfo().username,
    LOGNAME: u?.name || os.userInfo().username,
    SHELL: "/bin/sh",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    CLAUDE_CONFIG_DIR: configDir,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    // Deliberately NOT forwarded: ANTHROPIC_API_KEY, DATABASE_URL, STRIPE_*, EMAIL_SECRET_KEY, …
  };
  const args = ["--permission-mode", "acceptEdits", "--disallowedTools", DENIED_TOOLS.join(",")];

  try {
    s.proc = pty.spawn(CLAUDE_BIN, args, {
      name: "xterm-256color", cols: 100, rows: 30, cwd, env,
      ...(u ? { uid: u.uid, gid: u.gid } : {}),
    });
  } catch (err) {
    sessions.delete(key);
    logger.error({ err, key }, "[claude-terminal] spawn failed");
    throw new Error("Claude Code kon niet gestart worden op de server.");
  }
  logger.info({ key, cwd, pid: s.proc.pid, isolated: !!u }, "[claude-terminal] started");

  s.proc.onData((d) => {
    s.scrollback = (s.scrollback + d).slice(-SCROLLBACK_MAX);
    broadcast(s, { t: "o", d });
  });
  s.proc.onExit(({ exitCode }) => {
    logger.info({ key, exitCode }, "[claude-terminal] claude exited");
    s.exited = true;
    void (async () => {
      await runSync(s).catch(() => {});
      await persistCredsIfChanged(s).catch(() => {});
      broadcast(s, { t: "exit", code: exitCode });
      await destroySession(s);
    })();
  });

  if (projectId > 0) {
    try {
      s.watcher = fsSync.watch(cwd, { recursive: true }, () => scheduleSync(s));
      s.watcher.on("error", (err) => logger.warn({ err, key }, "[claude-terminal] watcher error"));
    } catch (err) {
      logger.warn({ err, key }, "[claude-terminal] recursive watch unavailable — falling back to polling");
      s.watcher = null;
      const poll = setInterval(() => { if (sessions.get(key) === s) scheduleSync(s); else clearInterval(poll); }, 3000);
    }
  }
  // Fresh + not logged in → open the login menu automatically (skips the "Run /login" hunt and the
  // 3rd-party/Vertex mis-selection). Preselected option is "Claude account with subscription".
  if (!blobConnected(await readCredBlob(userId))) {
    setTimeout(() => { if (!s.exited && s.proc) { try { s.proc.write("/login\r"); } catch { /* ignore */ } } }, 2500);
  }
  s.credTimer = setInterval(() => { void persistCredsIfChanged(s); }, CRED_POLL_MS);
  if (projectId > 0) s.dbTimer = setInterval(() => { refreshFromDb(s).catch((err) => logger.warn({ err, key }, "[claude-terminal] db refresh failed")); }, 5000);
  return s;
}

async function destroySession(s: Session): Promise<void> {
  if (sessions.get(s.key) === s) sessions.delete(s.key);
  if (s.idleTimer) clearTimeout(s.idleTimer);
  if (s.credTimer) clearInterval(s.credTimer);
  if (s.dbTimer) clearInterval(s.dbTimer);
  if (s.syncTimer) clearTimeout(s.syncTimer);
  s.watcher?.close();
  s.watcher = null;
  if (s.proc && !s.exited) { try { s.proc.kill(); } catch { /* already gone */ } }
  s.exited = true;
  if (s.dirty || s.syncing) await runSync(s).catch(() => {});
  for (const c of s.clients) { try { c.close(1000, "session-ended"); } catch { /* ignore */ } }
  s.clients.clear();
  if (s.projectId > 0) await fs.rm(s.cwd, { recursive: true, force: true }).catch(() => {});
}

function touchIdle(s: Session) {
  if (s.idleTimer) clearTimeout(s.idleTimer);
  s.idleTimer = null;
  if (s.clients.size === 0) {
    s.idleTimer = setTimeout(() => { if (s.clients.size === 0) void destroySession(s); }, IDLE_KILL_MS);
  }
}

/** Stop the session for a project (e.g. before another tool rewrites its files wholesale). */
export async function stopProjectSession(projectId: number): Promise<void> {
  for (const s of [...sessions.values()]) if (s.projectId === projectId) await destroySession(s);
}

export function hasLiveSession(projectId: number): boolean {
  for (const s of sessions.values()) if (s.projectId === projectId && !s.exited) return true;
  return false;
}

// ── Reference images ("aanwijzen"/upload) ───────────────────────────────────────────────────────
// The user marks an area of the preview (screenshot) or uploads an image; we drop it into the live
// session's workspace under _refs/ (never synced to the DB) so Claude can Read it. Requires a live
// session for that (user, project). Returns the workspace-relative path to reference in the prompt.
function liveSessionFor(userId: number, projectId: number): Session | null {
  const s = sessions.get(sessionKey(userId, projectId));
  return s && !s.exited && s.projectId === projectId ? s : null;
}

const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv", "application/json": "json", "text/html": "html", "application/zip": "zip" };

function sanitizeBase(name: string): string {
  const base = (name || "").split(/[\\/]/).pop() || "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 80);
  return cleaned;
}

// Save any file the user gives Claude (screenshot, dropped file of any type, pasted image) into the
// live session workspace under _refs/. Accepts a data: URL of any mime type; keeps the original file
// name when provided. Returns the workspace-relative path to reference in the prompt.
export async function writeSessionRef(userId: number, projectId: number, dataUrl: string, name?: string): Promise<{ path: string } | { error: string }> {
  const s = liveSessionFor(userId, projectId);
  if (!s) return { error: "Geen actieve Claude-sessie. Open eerst je project en wacht tot Claude klaar is." };
  const m = /^data:([a-zA-Z0-9.+/-]+)?;base64,(.+)$/.exec(dataUrl);
  if (!m) return { error: "Ongeldig bestand." };
  const mime = (m[1] || "application/octet-stream").toLowerCase();
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 25 * 1024 * 1024) return { error: "Bestand is te groot (max 25 MB)." };
  const dir = path.join(s.cwd, REFS_DIR);
  await fs.mkdir(dir, { recursive: true });
  const given = sanitizeBase(name || "");
  const ext = (given.includes(".") ? given.split(".").pop()! : (MIME_EXT[mime] || "bin")).toLowerCase();
  const stem = given.includes(".") ? given.slice(0, given.lastIndexOf(".")) : (given || "bestand");
  // Find a free name, keeping the given stem where possible.
  let rel = `${REFS_DIR}/${stem || "bestand"}.${ext}`;
  let n = 1;
  while (fsSync.existsSync(path.join(s.cwd, rel))) { rel = `${REFS_DIR}/${stem || "bestand"}-${n}.${ext}`; n++; if (n > 999) return { error: "Te veel bestanden." }; }
  const abs = safeJoin(s.cwd, rel);
  if (!abs) return { error: "Ongeldig pad." };
  await fs.writeFile(abs, buf);
  const u = unixUser(userId);
  if (u) { try { execFileSync("chown", [`${u.uid}:${u.gid}`, abs], { stdio: "ignore" }); } catch { /* best effort */ } }
  logger.info({ key: s.key, rel, bytes: buf.length, mime }, "[claude-terminal] saved reference file");
  return { path: rel };
}

export async function deleteSessionRef(userId: number, projectId: number, rel: string): Promise<{ ok: boolean }> {
  const s = liveSessionFor(userId, projectId);
  if (!s) return { ok: false };
  if (!/^_refs\/[A-Za-z0-9._-]+$/.test(rel)) return { ok: false };
  const abs = safeJoin(s.cwd, rel);
  if (!abs) return { ok: false };
  await fs.rm(abs, { force: true }).catch(() => {});
  return { ok: true };
}

// ── WebSocket endpoint ────────────────────────────────────────────────────────────────────────
export function attachClaudeTerminal(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname !== "/api/claude/terminal") return; // not ours (Vite HMR etc. never reach prod)
    void (async () => {
      const token = url.searchParams.get("token") || "";
      const user = await getSessionUser(token);
      if (!user) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
      const projectId = Number(url.searchParams.get("project") || "0") || 0;
      let projectName = "";
      if (projectId > 0) {
        const [p] = await db.select({ id: projects.id, ownerId: projects.ownerId, name: projects.name }).from(projects).where(eq(projects.id, projectId));
        if (!p || (p.ownerId != null && p.ownerId !== user.id)) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
        projectName = p.name;
      }
      wss.handleUpgrade(req, socket, head, (ws) => void onConnection(ws, user.id, projectId, projectName));
    })().catch((err) => { logger.error({ err }, "[claude-terminal] upgrade failed"); socket.destroy(); });
  });

  logger.info("[claude-terminal] websocket endpoint ready at /api/claude/terminal");
}

async function onConnection(ws: WebSocket, userId: number, projectId: number, projectName: string) {
  let s: Session;
  try {
    s = await getOrCreateSession(userId, projectId, projectName);
  } catch (err) {
    ws.send(JSON.stringify({ t: "err", message: (err as Error).message }));
    ws.close(1011, "spawn-failed");
    return;
  }
  s.clients.add(ws);
  touchIdle(s);
  ws.send(JSON.stringify({ t: "hello", projectId, connected: blobConnected(await readCredBlob(userId)) }));
  if (s.scrollback) ws.send(JSON.stringify({ t: "o", d: s.scrollback }));

  ws.on("message", (raw) => {
    let m: ClientMsg;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!s.proc || s.exited) return;
    if (m.t === "i" && typeof m.d === "string") s.proc.write(m.d);
    else if (m.t === "r" && m.cols > 0 && m.rows > 0) { try { s.proc.resize(Math.min(500, m.cols | 0), Math.min(200, m.rows | 0)); } catch { /* ignore */ } }
  });
  ws.on("close", () => { s.clients.delete(ws); touchIdle(s); });
  ws.on("error", () => { s.clients.delete(ws); touchIdle(s); });
}

// Graceful shutdown: flush every workspace to the DB before the process dies (deploys!).
async function shutdown() {
  const all = [...sessions.values()];
  await Promise.all(all.map((s) => destroySession(s).catch(() => {})));
}
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => { void shutdown().finally(() => process.exit(0)); });
}
