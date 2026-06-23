import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
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

export default app;
