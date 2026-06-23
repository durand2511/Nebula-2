/** Custom-domain management API (per project; open like the rest of the API for now). */
import { Router, json } from "express";
import { logger } from "../lib/logger";
import { addDomain, listDomains, deleteDomain, verifyDomain, CUSTOMERS_TARGET } from "../lib/domains.js";

const router = Router();

router.get("/projects/:id/domains", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try { res.json({ target: CUSTOMERS_TARGET, domains: await listDomains(projectId) }); }
  catch (err) { logger.error({ err, projectId }, "[domains] list failed"); res.status(500).json({ error: "Ophalen mislukt." }); }
});

router.post("/projects/:id/domains", json({ limit: "16kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const row = await addDomain(projectId, String(req.body?.domain ?? ""));
    res.json({ ok: true, domain: row, instruction: `Voeg bij je DNS-provider een CNAME-record toe: ${row.domain} → ${CUSTOMERS_TARGET}`, target: CUSTOMERS_TARGET });
  } catch (err) { res.status(400).json({ error: (err as Error)?.message || "Toevoegen mislukt." }); }
});

router.post("/projects/:id/domains/:domainId/verify", async (req, res) => {
  const projectId = Number(req.params.id), domainId = Number(req.params.domainId);
  if (isNaN(projectId) || isNaN(domainId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try { res.json(await verifyDomain(projectId, domainId)); }
  catch (err) { logger.error({ err, projectId }, "[domains] verify failed"); res.status(500).json({ error: "Verifiëren mislukt." }); }
});

router.delete("/projects/:id/domains/:domainId", async (req, res) => {
  const projectId = Number(req.params.id), domainId = Number(req.params.domainId);
  if (isNaN(projectId) || isNaN(domainId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try { res.json({ ok: await deleteDomain(projectId, domainId) }); }
  catch (err) { logger.error({ err, projectId }, "[domains] delete failed"); res.status(500).json({ error: "Verwijderen mislukt." }); }
});

export default router;
