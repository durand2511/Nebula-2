import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { brightDataEnabled } from "../lib/brightdata.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Diagnostic (no secrets): is Bright Data wired up on this instance? Only booleans, so it's safe.
router.get("/healthz/brightdata", (_req, res) => {
  res.json({
    tokenSet: !!process.env.BRIGHTDATA_API_TOKEN,
    zoneSet: !!process.env.BRIGHTDATA_ZONE,
    enabled: brightDataEnabled(),
  });
});

export default router;
