/**
 * Draft → publish model for project sites. The builder edits live `project_files` (the draft); the
 * PUBLIC site (serveProjectSite) is served from the published snapshot in `site_publishes`. So edits
 * only go live when the user re-publishes — except auto-published SEO articles, which re-snapshot
 * ONLY the blog/SEO files automatically (republishMatching), leaving the rest of the draft untouched
 * so an unrelated edit isn't pushed live unintentionally.
 */
import { db, projectFiles, sitePublishes } from "@workspace/db";
import { eq } from "drizzle-orm";

export type PublishedFile = { content: string; language: string };

// Short-TTL cache of the parsed published map. Serving a page used to re-query AND re-parse the whole
// site blob on EVERY request, so clicking around a large published site spiked memory (many transient
// copies at once) → OOM → 502 on Render. Caching keeps ONE parsed copy per project and reuses it.
const CACHE_TTL_MS = 30_000;
const mapCache = new Map<number, { map: Record<string, PublishedFile> | null; at: number }>();

async function loadMap(projectId: number): Promise<Record<string, PublishedFile> | null> {
  const hit = mapCache.get(projectId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.map;
  const [row] = await db.select().from(sitePublishes).where(eq(sitePublishes.projectId, projectId));
  let map: Record<string, PublishedFile> | null = null;
  if (row) { try { map = JSON.parse(row.files) as Record<string, PublishedFile>; } catch { map = {}; } }
  if (mapCache.size > 200) mapCache.clear(); // bound the cache
  mapCache.set(projectId, { map, at: Date.now() });
  return map;
}

async function saveMap(projectId: number, map: Record<string, PublishedFile>): Promise<void> {
  const files = JSON.stringify(map);
  const [ex] = await db.select().from(sitePublishes).where(eq(sitePublishes.projectId, projectId));
  if (ex) await db.update(sitePublishes).set({ files, publishedAt: new Date() }).where(eq(sitePublishes.projectId, projectId));
  else await db.insert(sitePublishes).values({ projectId, files });
  mapCache.set(projectId, { map, at: Date.now() }); // keep cache consistent after a (re)publish
}

/** Snapshot ALL the project's current files as the published site (full publish). Returns file count. */
export async function publishSite(projectId: number): Promise<number> {
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const map: Record<string, PublishedFile> = {};
  for (const r of rows) map[r.path] = { content: r.content, language: r.language };
  await saveMap(projectId, map);
  return rows.length;
}

/** Re-publish ONLY the files whose path matches `match` (merge into the existing snapshot). No-op if
 *  the site was never fully published yet (so we never push a partial site live by surprise). */
export async function republishMatching(projectId: number, match: (path: string) => boolean): Promise<void> {
  const base = await loadMap(projectId);
  if (!base) return;
  const map = { ...base }; // clone so we never mutate the cached copy
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  for (const r of rows) if (match(r.path)) map[r.path] = { content: r.content, language: r.language };
  await saveMap(projectId, map);
}

/** The published file map (path → {content,language}), or null if never published. */
export async function getPublishedFiles(projectId: number): Promise<Record<string, PublishedFile> | null> {
  return loadMap(projectId);
}

export async function isPublished(projectId: number): Promise<boolean> {
  const [row] = await db.select().from(sitePublishes).where(eq(sitePublishes.projectId, projectId));
  return !!row;
}

/** Content-based: true when any draft file differs from the published snapshot (or never published). */
export async function hasUnpublishedChanges(projectId: number): Promise<boolean> {
  const map = await loadMap(projectId);
  if (!map) return true; // never published → there's something to publish
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  if (rows.some((r) => !map[r.path] || map[r.path].content !== r.content)) return true;
  const livePaths = new Set(rows.map((r) => r.path));
  return Object.keys(map).some((p) => !livePaths.has(p)); // a file was deleted since publish
}
