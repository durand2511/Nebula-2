/**
 * Project back-ups — restore points that survive project deletion, so a customer never loses work.
 *
 *  • Auto: a scheduler snapshots a project ~5 minutes AFTER its last file change (settled = safe).
 *  • Manual: the "Nu opslaan" button snapshots immediately.
 *  • Dedup by content hash (no snapshot if nothing changed); retention keeps storage bounded.
 *  • Rows are NOT foreign-keyed to projects, so deleting a project keeps its back-ups — the owner
 *    can restore them (into the project, or as a fresh project if it was deleted).
 *
 * `files` is gzip+base64 of JSON. v1 = a bare array [{path,content,language}] (files only). v2 =
 * { v:2, files:[…], assets:[{path,contentType,sha}] } where the binary bytes live once in
 * backup_assets (content-addressed) — so images/fonts survive a restore without bloating every blob.
 */
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { db, projects, projectFiles, projectBackups, importAssets, backupAssets } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "./logger";

const SETTLE_MS = 5 * 60 * 1000;   // back up 5 min after the last change
const KEEP_AUTO = 12;              // retained auto back-ups per project (manual ones are always kept)

type FileRec = { path: string; content: string; language: string };
type AssetRef = { path: string; contentType: string; sha: string };
type Payload = { files: FileRec[]; assets: AssetRef[] };

function pack(files: FileRec[], assets: AssetRef[]): { blob: string; hash: string; count: number } {
  const json = JSON.stringify({ v: 2, files, assets });
  const hash = createHash("sha256").update(json).digest("hex");
  const blob = gzipSync(Buffer.from(json, "utf8")).toString("base64");
  return { blob, hash, count: files.length };
}
/** Parse a blob into files + asset refs, tolerating the old v1 (bare files array) format. */
function unpack(blob: string): Payload {
  try {
    const o = JSON.parse(gunzipSync(Buffer.from(blob, "base64")).toString("utf8"));
    if (Array.isArray(o)) return { files: o, assets: [] };            // v1
    return { files: o.files || [], assets: o.assets || [] };          // v2
  } catch { return { files: [], assets: [] }; }
}
/** Back-compat export: callers that only want the files keep working. */
export function unpackBackup(blob: string): FileRec[] { return unpack(blob).files; }

async function projectFileRecs(projectId: number): Promise<FileRec[]> {
  // ORDER BY path so the file list is DETERMINISTIC — without it Postgres may return rows in a
  // different order each call, which changes the pack hash and triggers a spurious "changed" back-up
  // even when nothing actually changed.
  const rows = await db.select({ path: projectFiles.path, content: projectFiles.content, language: projectFiles.language })
    .from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(projectFiles.path);
  return rows.map((r) => ({ path: r.path, content: r.content ?? "", language: r.language ?? "plaintext" }));
}

// Snapshot a project's binary assets into the content-addressed store, returning light refs. Each
// unique image is written to backup_assets ONCE (on-conflict-do-nothing), so N back-ups of the same
// site share one copy of each asset.
async function snapshotAssets(projectId: number): Promise<AssetRef[]> {
  const rows = await db.select({ path: importAssets.path, contentType: importAssets.contentType, data: importAssets.data })
    .from(importAssets).where(eq(importAssets.projectId, projectId)).orderBy(importAssets.path); // deterministic order → stable hash
  const refs: AssetRef[] = [];
  for (const r of rows) {
    const data = r.data ?? "";
    const sha = createHash("sha256").update(data).digest("hex");
    await db.insert(backupAssets).values({ sha, contentType: r.contentType ?? "application/octet-stream", data }).onConflictDoNothing();
    refs.push({ path: r.path, contentType: r.contentType ?? "application/octet-stream", sha });
  }
  return refs;
}

// Write asset refs back into a target project's import_assets (fetching bytes from the store).
async function restoreAssets(projectId: number, assets: AssetRef[]): Promise<number> {
  let n = 0;
  for (const a of assets) {
    const [row] = await db.select({ data: backupAssets.data }).from(backupAssets).where(eq(backupAssets.sha, a.sha));
    if (!row) continue; // bytes gone (shouldn't happen — store is never GC'd here)
    await db.insert(importAssets).values({ projectId, path: a.path, contentType: a.contentType, data: row.data }).onConflictDoNothing();
    n++;
  }
  return n;
}

/** Create a back-up of a project's current files. Skips when identical to the newest back-up (unless
 *  forced by a manual save). Returns the new backup id, or null when nothing was stored. */
export async function createBackup(projectId: number, kind: "auto" | "manual" = "auto"): Promise<number | null> {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!proj) return null;
  const files = await projectFileRecs(projectId);
  if (!files.length) return null;
  const assets = await snapshotAssets(projectId); // images/fonts (content-addressed) — restore needs these
  const { blob, hash, count } = pack(files, assets);
  const [latest] = await db.select({ hash: projectBackups.hash }).from(projectBackups)
    .where(eq(projectBackups.projectId, projectId)).orderBy(desc(projectBackups.createdAt)).limit(1);
  if (kind === "auto" && latest?.hash === hash) return null; // nothing changed → no new auto backup
  const [row] = await db.insert(projectBackups).values({
    ownerId: proj.ownerId ?? null, projectId, projectName: proj.name, kind, hash, files: blob, fileCount: count,
  }).returning({ id: projectBackups.id });
  // Retention: keep the newest KEEP_AUTO auto back-ups per project; manual ones are never pruned.
  const old = await db.select({ id: projectBackups.id }).from(projectBackups)
    .where(and(eq(projectBackups.projectId, projectId), eq(projectBackups.kind, "auto")))
    .orderBy(desc(projectBackups.createdAt)).offset(KEEP_AUTO);
  if (old.length) await db.delete(projectBackups).where(sql`${projectBackups.id} in (${sql.join(old.map((o) => sql`${o.id}`), sql`, `)})`);
  logger.info({ projectId, kind, count, backupId: row.id }, "[backups] created");
  return row.id;
}

/** Save status for the UI: is the current state covered by a back-up? */
export async function backupStatus(projectId: number): Promise<{ saved: boolean; lastBackupAt: string | null; changedAt: string | null }> {
  const [chg] = await db.select({ t: sql<string | null>`max(${projectFiles.updatedAt})` }).from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const [bk] = await db.select({ t: sql<string | null>`max(${projectBackups.createdAt})` }).from(projectBackups).where(eq(projectBackups.projectId, projectId));
  const changedAt = chg?.t ? new Date(chg.t).toISOString() : null;
  const lastBackupAt = bk?.t ? new Date(bk.t).toISOString() : null;
  const saved = !changedAt || (!!lastBackupAt && new Date(lastBackupAt).getTime() >= new Date(changedAt).getTime());
  return { saved, lastBackupAt, changedAt };
}

/** Restore a back-up into a project's files (full replace). */
export async function restoreBackup(backupId: number, targetProjectId: number): Promise<boolean> {
  const [bk] = await db.select().from(projectBackups).where(eq(projectBackups.id, backupId));
  if (!bk) return false;
  const { files, assets } = unpack(bk.files);
  if (!files.length) return false;
  // Safety net: snapshot the current state before overwriting, so a wrong restore is itself undoable.
  await createBackup(targetProjectId, "manual").catch(() => {});
  await db.delete(projectFiles).where(eq(projectFiles.projectId, targetProjectId));
  for (const f of files) {
    await db.insert(projectFiles).values({ projectId: targetProjectId, path: f.path, content: f.content, language: f.language || "plaintext" });
  }
  // Restore binary assets too (images/fonts) — replace the target's set to match the back-up.
  await db.delete(importAssets).where(eq(importAssets.projectId, targetProjectId));
  const nAssets = await restoreAssets(targetProjectId, assets);
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, targetProjectId));
  logger.info({ backupId, targetProjectId, count: files.length, assets: nAssets }, "[backups] restored");
  return true;
}

/** Recreate a NEW project from a back-up (used when the original was deleted). Returns new id. */
export async function restoreAsNewProject(backupId: number, ownerId: number): Promise<number | null> {
  const [bk] = await db.select().from(projectBackups).where(eq(projectBackups.id, backupId));
  if (!bk || bk.ownerId !== ownerId) return null;
  const { files, assets } = unpack(bk.files);
  if (!files.length) return null;
  const [proj] = await db.insert(projects).values({ ownerId, name: bk.projectName || "Hersteld project", description: "Hersteld uit back-up" }).returning({ id: projects.id });
  for (const f of files) {
    await db.insert(projectFiles).values({ projectId: proj.id, path: f.path, content: f.content, language: f.language || "plaintext" });
  }
  const nAssets = await restoreAssets(proj.id, assets); // images/fonts mee (content-addressed)
  logger.info({ backupId, newProjectId: proj.id, ownerId, assets: nAssets }, "[backups] restored as new project");
  return proj.id;
}

/** Permanently delete one back-up. Only the owner's rows (ownerless legacy rows are cleanable by
 *  any logged-in owner, matching the restore access rule). Returns whether a row was deleted. */
export async function deleteBackup(backupId: number, ownerId: number): Promise<boolean> {
  const [bk] = await db.select({ id: projectBackups.id, ownerId: projectBackups.ownerId })
    .from(projectBackups).where(eq(projectBackups.id, backupId));
  if (!bk || (bk.ownerId != null && bk.ownerId !== ownerId)) return false;
  await db.delete(projectBackups).where(eq(projectBackups.id, backupId));
  logger.info({ backupId, ownerId }, "[backups] deleted");
  return true;
}

// ── Scheduler: back up projects ~5 min after their last change ──────────────────────────────────
let started = false;
export function startBackupScheduler(): void {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      // Projects whose newest file change settled between 5 and ~12 min ago, and whose newest change
      // isn't yet backed up. One backup per settled edit-burst.
      const rows = await db.select({
        projectId: projectFiles.projectId,
        changed: sql<string>`max(${projectFiles.updatedAt})`,
      }).from(projectFiles).groupBy(projectFiles.projectId)
        .having(sql`max(${projectFiles.updatedAt}) < now() - interval '5 minutes' and max(${projectFiles.updatedAt}) > now() - interval '12 minutes'`);
      for (const r of rows) {
        try { await createBackup(r.projectId, "auto"); } catch (err) { logger.warn({ err, projectId: r.projectId }, "[backups] auto failed"); }
      }
    } catch (err) { logger.warn({ err }, "[backups] tick failed"); }
  };
  setTimeout(() => { void tick(); }, 60 * 1000);
  setInterval(() => { void tick(); }, 2 * 60 * 1000); // every 2 min
  logger.info("[backups] scheduler started");
  void SETTLE_MS; // documented interval; the SQL above encodes the 5-min settle window
}
