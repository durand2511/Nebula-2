/**
 * Server-functies — echte serverkant voor klantsites, ZONDER externe server.
 *
 * Elke `api/<naam>.js` in een project wordt automatisch een endpoint op de gepubliceerde site:
 * `https://klantdomein.nl/fn/<naam>`. Het bestand exporteert één (async) functie:
 *
 *   module.exports = async (req) => ({ status: 200, body: { ok: true } });
 *
 * met req = { method, path, query, headers, body } en als antwoord { status?, headers?, body }.
 *
 * Uitvoering per aanroep in een kort, streng afgeschermd node-proces:
 *   • zelfde OS-isolatie als de Claude-terminal (eigen unix-uid per klant, geen root)
 *   • ALLEEN een kale env (PATH) — geen enkel platform-secret
 *   • 10s harde timeout, 1MB output-cap, max 4 gelijktijdige uitvoeringen (kleine instance)
 *   • alleen Node-standaardbibliotheek (incl. global fetch) — geen node_modules
 */
import { execFile, execFileSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { db, projects } from "@workspace/db";
import { eq } from "drizzle-orm";
import { unixUser } from "./claude-terminal.js";
import { logger } from "./logger";

const FN_ROOT = process.env.NEBULA_FN_ROOT || (fsSync.existsSync("/nebula") ? "/nebula/fn" : path.join(process.cwd(), ".nebula-fn"));
const MAX_CONCURRENT = 4;
const TIMEOUT_MS = 10_000;
const MAX_BODY = 256 * 1024;

let running = 0;

// One-shot runner: reads the request JSON from stdin, requires the handler, prints the response
// JSON to stdout. Any throw becomes a clean 500. Kept dependency-free on purpose.
const RUNNER = `
const fs = require("fs");
(async () => {
  let out = { status: 500, body: { error: "Serverfunctie gaf geen antwoord." } };
  try {
    const req = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    let h = require(process.argv[2]);
    if (h && typeof h !== "function") h = h.default || h.handler;
    if (typeof h !== "function") throw new Error("api-bestand exporteert geen functie (module.exports = async (req) => ...)");
    const r = await h(req);
    out = (r && typeof r === "object" && ("body" in r || "status" in r || "headers" in r)) ? r : { status: 200, body: r };
  } catch (e) {
    out = { status: 500, body: { error: String((e && e.message) || e) } };
  }
  process.stdout.write(JSON.stringify(out));
})();
`;

function safeName(name: string): string | null {
  return /^[a-z0-9][a-z0-9_-]{0,60}$/i.test(name) ? name : null;
}

/** Handle a /fn/<name> request on a served project site. Returns true when handled. */
export async function handleSiteFunction(projectId: number, name: string, files: Array<{ path: string; content: string }>, req: Request, res: Response): Promise<void> {
  const fn = safeName(name);
  const file = fn ? files.find((f) => f.path === `api/${fn}.js`) : undefined;
  if (!fn || !file) { res.status(404).json({ error: "Serverfunctie niet gevonden." }); return; }
  if (running >= MAX_CONCURRENT) { res.status(503).json({ error: "Even druk — probeer het zo opnieuw." }); return; }
  running++;
  try {
    // Materialise runner + handler (content-addressed, so unchanged code is written once).
    const [p] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
    const u = p?.ownerId ? unixUser(p.ownerId) : null;
    const hash = createHash("sha256").update(file.content).digest("hex").slice(0, 16);
    const dir = path.join(FN_ROOT, `p${projectId}`);
    const handlerPath = path.join(dir, `${fn}.${hash}.cjs`);
    const runnerPath = path.join(FN_ROOT, "runner.cjs");
    await fs.mkdir(dir, { recursive: true });
    if (!fsSync.existsSync(runnerPath)) await fs.writeFile(runnerPath, RUNNER, "utf8");
    if (!fsSync.existsSync(handlerPath)) await fs.writeFile(handlerPath, file.content, "utf8");
    // De runner en de root zijn generiek (geen geheimen) en mogen wereld-leesbaar zijn; de
    // per-project-map met de handler-code van de klant (kan eigen API-keys bevatten) is privé
    // voor de uid van die klant — een andere klant met een shell kan er niet in.
    try { fsSync.chmodSync(FN_ROOT, 0o755); fsSync.chmodSync(runnerPath, 0o644); } catch { /* best effort */ }
    try {
      if (u) execFileSync("chown", ["-R", `${u.uid}:${u.gid}`, dir], { stdio: "ignore" });
      fsSync.chmodSync(dir, 0o700);
      fsSync.chmodSync(handlerPath, 0o600);
    } catch { /* best effort */ }

    // Raw body (no body-parser runs on customer-domain requests).
    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolve) => {
      req.on("data", (c: Buffer) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
      req.on("end", () => resolve());
      req.on("error", () => resolve());
    });
    if (size > MAX_BODY) { res.status(413).json({ error: "Bericht te groot (max 256KB)." }); return; }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let body: unknown = rawBody;
    if (/application\/json/i.test(String(req.headers["content-type"] || ""))) { try { body = JSON.parse(rawBody || "null"); } catch { /* leave as string */ } }

    const payload = JSON.stringify({
      method: req.method,
      path: req.path,
      query: req.query,
      headers: { "content-type": req.headers["content-type"] || "", "user-agent": req.headers["user-agent"] || "" },
      body,
    });

    const out = await new Promise<string>((resolve, reject) => {
      const child = execFile("node", [runnerPath, handlerPath], {
        timeout: TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        cwd: dir,
        env: { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" }, // NO platform secrets
        ...(u ? { uid: u.uid, gid: u.gid } : {}),
      }, (err, stdout) => { if (err && !stdout) reject(err); else resolve(String(stdout || "")); });
      child.stdin?.end(payload);
    });

    let r: { status?: number; headers?: Record<string, string>; body?: unknown } = {};
    try { r = JSON.parse(out); } catch { r = { status: 500, body: { error: "Serverfunctie gaf ongeldig antwoord." } }; }
    const status = Number(r.status) >= 100 && Number(r.status) <= 599 ? Number(r.status) : 200;
    for (const [k, v] of Object.entries(r.headers || {})) { if (/^[a-z0-9-]+$/i.test(k)) res.setHeader(k, String(v).slice(0, 500)); }
    if (typeof r.body === "string") { if (!res.getHeader("Content-Type")) res.type("text/plain"); res.status(status).send(r.body); }
    else res.status(status).json(r.body ?? null);
  } catch (err) {
    logger.warn({ err: (err as Error)?.message, projectId, name }, "[site-fn] failed");
    res.status(500).json({ error: "Serverfunctie mislukt of duurde te lang (max 10s)." });
  } finally {
    running--;
  }
}
