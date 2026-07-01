/**
 * Media storage on the Render persistent disk. Binary project assets (images, fonts, video, the WP
 * uploads folder, …) are too heavy to keep as base64 inside project_files, so their BYTES live here
 * on disk and a `project_assets` row points at them. Keyed by projectId + site-relative path.
 *
 * MEDIA_DIR is the mount point (Render disk, e.g. /data). In local dev it falls back to a folder in
 * the repo so imports still work without a disk attached.
 */
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";

const MEDIA_DIR = process.env.MEDIA_DIR
  || (process.env.NODE_ENV === "production" ? "/data" : path.join(process.cwd(), ".media-data"));

// path (as stored on disk, under MEDIA_DIR) → we mirror the site tree: projects/<id>/<sitePath>.
// Reject any ".." segment so a crafted path can't climb out of its project folder (defence in depth
// on top of the endpoint's own safePath()).
export function storageKeyFor(projectId: number, sitePath: string): string {
  const clean = sitePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (clean.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new Error("Ongeldig media-pad.");
  }
  return path.posix.join("projects", String(projectId), clean);
}

function absPathFor(storageKey: string): string {
  const abs = path.resolve(MEDIA_DIR, storageKey);
  const root = path.resolve(MEDIA_DIR);
  // Never let a crafted key escape the media root.
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Ongeldige storage key (path escape).");
  }
  return abs;
}

/** Write (or append) bytes for one asset. Returns the on-disk size afterwards. */
export async function writeAsset(
  projectId: number,
  sitePath: string,
  bytes: Buffer,
  append: boolean,
): Promise<{ storageKey: string; size: number }> {
  const storageKey = storageKeyFor(projectId, sitePath);
  const abs = absPathFor(storageKey);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (append) await fs.appendFile(abs, bytes);
  else await fs.writeFile(abs, bytes);
  const stat = await fs.stat(abs);
  return { storageKey, size: stat.size };
}

/** Absolute path for streaming, or null if the file is missing. */
export async function assetFilePath(storageKey: string): Promise<string | null> {
  const abs = absPathFor(storageKey);
  try {
    await fs.access(abs);
    return abs;
  } catch {
    return null;
  }
}

export function streamAsset(res: import("express").Response, abs: string): void {
  createReadStream(abs).pipe(res);
}

/** Remove every stored byte for a project (called on project delete). Builds the project dir key
 *  directly — storageKeyFor() rejects "." segments, so we can't route through it here. */
export async function deleteProjectMedia(projectId: number): Promise<void> {
  const abs = absPathFor(path.posix.join("projects", String(projectId)));
  await fs.rm(abs, { recursive: true, force: true });
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp", tiff: "image/tiff",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogg: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf", zip: "application/zip", gz: "application/gzip",
};

export function contentTypeFor(sitePath: string): string {
  const ext = sitePath.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] || "application/octet-stream";
}
