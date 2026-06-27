import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import router from "./routes";
import { logger } from "./lib/logger";
import { isReserved, findActiveByHost, PLATFORM_HOST } from "./lib/domains";
import { serveProjectSite } from "./lib/host-site";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Modest default body limit for the general API surface. The chat stream route
// needs a much larger ceiling for base64 reference images, so it opts in to its
// own parser (see routes/projects.ts) and is skipped here — keeping the larger
// payload surface scoped to a single endpoint rather than the whole API.
const standardJson = express.json({ limit: "1mb" });
app.use((req, res, next) => {
  // /messages/stream uses its own large parser; /stripe/webhook needs the RAW body for
  // Stripe signature verification — both opt out of the standard JSON parser here.
  if (req.path.endsWith("/messages/stream") || req.path.endsWith("/stripe/webhook") || req.path.endsWith("/import/mindbody")) return next();
  return standardJson(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Password lock for the platform (the builder console) ──
// When SITE_PASSWORD is set, the platform host (nebulabookings.com + www) requires HTTP Basic Auth.
// Left open: /api/healthz (Render healthcheck) and connected customer booking sites (their own
// domains aren't "reserved"), so studios' customers can still book. No password set → no lock.
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";
function passwordOk(authHeader: string): boolean {
  if (!authHeader.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const given = Buffer.from(decoded.slice(decoded.indexOf(":") + 1)); // user:pass → take pass
    const want = Buffer.from(SITE_PASSWORD);
    return given.length === want.length && timingSafeEqual(given, want);
  } catch {
    return false;
  }
}
app.use((req, res, next) => {
  if (!SITE_PASSWORD) return next();                 // lock disabled when no password configured
  // Only gate the human-facing console HTML. /api must stay open so the in-app PREVIEW iframe
  // (/api/projects/:id/preview-page) and the booking app's own /api calls work without a separate
  // Basic-Auth prompt — browsers don't reliably send stored Basic creds to (sandboxed) iframes.
  if (req.path.startsWith("/api/") || req.path === "/api") return next();
  if (!isReserved(req.headers.host || "")) return next(); // customer booking sites stay public
  if (passwordOk(String(req.headers.authorization || ""))) return next();
  res.setHeader("WWW-Authenticate", 'Basic realm="Nebula", charset="UTF-8"');
  res.status(401).send("Wachtwoord vereist.");
});

// Custom-domain host routing (runs before the API). For a request on a CONNECTED customer domain
// we serve that project's site; an UNKNOWN custom domain redirects to the platform. Platform hosts
// (nebulabookings.com, localhost, …) and all /api calls pass straight through to the normal app.
app.use((req, res, next) => {
  const host = req.headers.host || "";
  if (isReserved(host) || req.path === "/api" || req.path.startsWith("/api/")) return next();
  findActiveByHost(host)
    .then((match) => {
      if (match) return serveProjectSite(match.projectId, req, res);
      res.redirect(302, "https://" + PLATFORM_HOST);
    })
    .catch(next);
});

app.use("/api", router);

// Serve the builder frontend (the app-builder SPA) for platform hosts, so visiting the platform
// domain opens the app instead of "Cannot GET /". Customer domains are already served above; every
// /api path stays the API. If the frontend wasn't built (e.g. local API-only dev), this is skipped
// so behaviour is unchanged.
const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app-builder", "dist", "public");
if (fs.existsSync(path.join(FRONTEND_DIR, "index.html"))) {
  app.use(express.static(FRONTEND_DIR));
  // SPA fallback (Express 5-safe: a path-less middleware, not app.get("*")). Any non-/api GET that
  // wasn't a real static file returns index.html so client-side routing (wouter) takes over.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
  });
  logger.info({ dir: FRONTEND_DIR }, "[frontend] serving builder SPA at /");
} else {
  logger.warn({ dir: FRONTEND_DIR }, "[frontend] build not found — serving API only");
}

export default app;
