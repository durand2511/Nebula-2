/**
 * WordPress → Nebula import. A companion WordPress plugin (see /wordpress-plugin) pushes the WHOLE
 * site here: every wp-content file (theme / plugins / uploads) plus a full SQL dump of the database.
 * Everything lands as project_files rows, so the raw code is browsable and editable inside Nebula.
 *
 * Auth: the plugin sends the user's Nebula platform session token as a Bearer token, so the import
 * is owned by that account (the same token the console stores in localStorage after login).
 *
 * Protocol (chunked, so a multi-GB site can't hit a request body limit):
 *   POST /import/wordpress/init      { name, siteUrl }                         -> { projectId }
 *   POST /import/wordpress/files     { projectId, files: [FilePart, ...] }     -> { written }
 *   POST /import/wordpress/finalize  { projectId }                             -> { fileCount }
 *
 * A FilePart is { path, content, encoding?: "utf8"|"base64", append?: boolean }. Text files are sent
 * utf8 and stored inline in project_files (browsable code). Binary files (images, fonts, video) are
 * sent base64; their BYTES are written to the Render persistent disk (see lib/media-storage) with a
 * project_assets pointer row — so a big uploads folder doesn't bloat Postgres. A file larger than one
 * request is streamed as several parts with append:true (concatenated onto the row / appended to disk).
 */
import { Router, json } from "express";
import { db, projects, projectFiles, projectAssets } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getSessionUser, tokenFrom } from "../lib/platform-auth.js";
import { writeAsset, contentTypeFor } from "../lib/media-storage.js";
import { logger } from "../lib/logger";

const router = Router();

// Big ceiling: the plugin batches files so each request stays well under this, but base64 inflates
// binary payloads ~33%, so leave generous headroom.
const bigJson = json({ limit: "60mb" });

const MAX_PATH_LEN = 400;
const MAX_FILES_PER_BATCH = 2000;

function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    php: "php", html: "html", htm: "html", css: "css", scss: "scss", js: "javascript",
    mjs: "javascript", cjs: "javascript", json: "json", svg: "svg", ts: "typescript",
    tsx: "typescript", jsx: "javascript", md: "markdown", txt: "plaintext", xml: "xml",
    yml: "yaml", yaml: "yaml", sql: "sql", htaccess: "plaintext", ini: "ini",
  };
  return map[ext] ?? "plaintext";
}

// Normalise a WordPress-relative path: forward slashes, no leading slash, no ".." escapes, capped
// length. Returns null for anything we won't store.
function safePath(raw: unknown): string | null {
  let p = String(raw ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!p || p.length > MAX_PATH_LEN) return null;
  if (p.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  return p;
}

type OwnedResult =
  | { ok: false; code: 401 | 403 | 404 }
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>; project: typeof projects.$inferSelect };

async function ownedProject(req: unknown, projectId: number): Promise<OwnedResult> {
  const user = await getSessionUser(
    tokenFrom(req as { headers: Record<string, unknown>; query?: Record<string, unknown> }),
  );
  if (!user) return { ok: false, code: 401 };
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) return { ok: false, code: 404 };
  if (p.ownerId != null && p.ownerId !== user.id) return { ok: false, code: 403 };
  return { ok: true, user, project: p };
}

function denied(res: import("express").Response, code: 401 | 403 | 404) {
  const msg = code === 401 ? "Niet ingelogd (ongeldige of verlopen token)."
    : code === 403 ? "Geen toegang tot dit project."
    : "Project niet gevonden.";
  res.status(code).json({ error: msg });
}

// 1) Create the destination project. Owned by whoever the Bearer token belongs to.
router.post("/import/wordpress/init", bigJson, async (req, res) => {
  const user = await getSessionUser(
    tokenFrom(req as { headers: Record<string, unknown>; query?: Record<string, unknown> }),
  );
  if (!user) { denied(res, 401); return; }
  const name = String(req.body?.name ?? "").trim() || "WordPress-import";
  const siteUrl = String(req.body?.siteUrl ?? "").trim();
  try {
    const [project] = await db.insert(projects).values({
      ownerId: user.id,
      name: name.slice(0, 120),
      description: siteUrl ? `Geïmporteerd van ${siteUrl}` : "WordPress-import",
      source: "wordpress",
    }).returning();
    logger.info({ projectId: project.id, userId: user.id, siteUrl }, "[wp-import] project created");
    res.status(201).json({ projectId: project.id });
  } catch (err) {
    logger.error({ err }, "[wp-import] init failed");
    res.status(500).json({ error: "Aanmaken van project mislukt." });
  }
});

// 2) Push a batch of files. Idempotent per path: a first part (append falsy) replaces any existing
//    row for that path; append:true concatenates onto it (for files streamed in chunks).
router.post("/import/wordpress/files", bigJson, async (req, res) => {
  const projectId = Number(req.body?.projectId);
  if (!Number.isInteger(projectId)) { res.status(400).json({ error: "projectId ontbreekt." }); return; }
  const owned = await ownedProject(req, projectId);
  if (!owned.ok) { denied(res, owned.code); return; }

  const parts = Array.isArray(req.body?.files) ? req.body.files : [];
  if (parts.length === 0) { res.status(400).json({ error: "Geen bestanden meegestuurd." }); return; }
  if (parts.length > MAX_FILES_PER_BATCH) { res.status(400).json({ error: "Te veel bestanden in één batch." }); return; }

  let written = 0;
  const skipped: string[] = [];
  try {
    for (const part of parts) {
      const path = safePath(part?.path);
      if (!path) { skipped.push(String(part?.path ?? "?")); continue; }
      const append = part?.append === true;
      const content = String(part?.content ?? "");

      // Binary parts → bytes on the persistent disk + a project_assets pointer. Text parts stay
      // inline in project_files so the code is browsable/editable in the console.
      if (part?.encoding === "base64") {
        const bytes = Buffer.from(content, "base64");
        const { storageKey, size } = await writeAsset(projectId, path, bytes, append);
        await db.insert(projectAssets)
          .values({ projectId, path, contentType: contentTypeFor(path), size, storageKey })
          .onConflictDoUpdate({
            target: [projectAssets.projectId, projectAssets.path],
            set: { contentType: contentTypeFor(path), size, storageKey, updatedAt: new Date() },
          });
        written++;
        continue;
      }

      const language = inferLanguage(path);
      const [existing] = await db.select({ id: projectFiles.id, content: projectFiles.content })
        .from(projectFiles)
        .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)));

      if (existing && append) {
        await db.update(projectFiles)
          .set({ content: existing.content + content, language, updatedAt: new Date() })
          .where(eq(projectFiles.id, existing.id));
      } else if (existing) {
        await db.update(projectFiles)
          .set({ content, language, updatedAt: new Date() })
          .where(eq(projectFiles.id, existing.id));
      } else {
        await db.insert(projectFiles).values({ projectId, path, content, language });
      }
      written++;
    }
    res.json({ written, skipped });
  } catch (err) {
    logger.error({ err, projectId }, "[wp-import] file batch failed");
    res.status(500).json({ error: "Opslaan van bestanden mislukt." });
  }
});

// 3) Mark the import done — just reports the total so the plugin can confirm.
router.post("/import/wordpress/finalize", bigJson, async (req, res) => {
  const projectId = Number(req.body?.projectId);
  if (!Number.isInteger(projectId)) { res.status(400).json({ error: "projectId ontbreekt." }); return; }
  const owned = await ownedProject(req, projectId);
  if (!owned.ok) { denied(res, owned.code); return; }
  try {
    const rows = await db.select({ id: projectFiles.id }).from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const assets = await db.select({ id: projectAssets.id }).from(projectAssets).where(eq(projectAssets.projectId, projectId));
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    const fileCount = rows.length + assets.length;
    logger.info({ projectId, textFiles: rows.length, mediaAssets: assets.length }, "[wp-import] finalized");
    res.json({ ok: true, projectId, fileCount, textFiles: rows.length, mediaAssets: assets.length });
  } catch (err) {
    logger.error({ err, projectId }, "[wp-import] finalize failed");
    res.status(500).json({ error: "Afronden mislukt." });
  }
});

export default router;
