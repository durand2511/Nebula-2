import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Diagnose: is de import-proxy (IMPORT_PROXY_URL) door Render opgepikt? Toont GEEN wachtwoord.
router.get("/healthz/import-proxy", (_req, res) => {
  const url = process.env.IMPORT_PROXY_URL || "";
  let host = "";
  try { if (url) host = new URL(url).host; } catch { host = "ongeldige-url"; }
  res.json({ proxySet: !!url, host });
});

export default router;
