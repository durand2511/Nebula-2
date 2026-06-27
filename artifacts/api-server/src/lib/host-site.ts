/**
 * Serve a project's website on a connected custom domain: map the request path to a file in
 * project_files (/ → index.html, /booking-app.html → that file, /blog/x.html → that file) and
 * return it. Simple MVP renderer — serves the stored files as-is.
 */
import { db, projectFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { getPublishedFiles } from "./site-publish.js";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml", ics: "text/calendar; charset=utf-8",
};

export async function serveProjectSite(projectId: number, req: Request, res: Response): Promise<void> {
  // Serve the PUBLISHED snapshot when present (draft → publish). Fall back to live files for
  // projects that haven't used publish yet (back-compat — they stay live as before).
  const published = await getPublishedFiles(projectId);
  const rows = published
    ? Object.entries(published).map(([path, f]) => ({ path, content: f.content, language: f.language }))
    : await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  if (!rows.length) { res.status(404).send("Site niet gevonden."); return; }
  let p = decodeURIComponent((req.path || "/").replace(/^\/+/, ""));
  if (p === "" || p.endsWith("/")) p += "index.html";
  let file = rows.find((f) => f.path === p);
  if (!file && !/\.[a-z0-9]+$/i.test(p)) file = rows.find((f) => f.path === p + ".html"); // extensionless → .html
  if (!file) file = rows.find((f) => f.path === "index.html");                            // fallback: homepage
  if (!file) { res.status(404).send("Pagina niet gevonden."); return; }
  const ext = (file.path.split(".").pop() || "html").toLowerCase();
  res.setHeader("Content-Type", TYPES[ext] || "text/plain; charset=utf-8");
  let content = file.content;
  // On a published custom domain / subdomain the URL has no `/projects/<id>/` segment, so the
  // booking app can't read its project id from the path. Inject it as a global so the server-backed
  // features (booking, login, payments) work. The booking app's projId() prefers window.__BA_PID__.
  if (ext === "html") {
    const tag = `<script>window.__BA_PID__=${projectId};</script>`;
    if (/<head[^>]*>/i.test(content)) content = content.replace(/<head[^>]*>/i, (m) => m + tag);
    else if (/<body[^>]*>/i.test(content)) content = content.replace(/<body[^>]*>/i, (m) => m + tag);
    else content = tag + content;
  }
  res.send(content);
}
