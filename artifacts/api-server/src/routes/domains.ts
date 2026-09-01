/** Custom-domain management API (per project; open like the rest of the API for now). */
import { Router, json } from "express";
import { db, projectFiles, projects, platformUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { addDomain, listDomains, deleteDomain, verifyDomain, publishSubdomain, getSubdomain, CUSTOMERS_TARGET, PLATFORM_HOST } from "../lib/domains.js";
import { publishSite, isPublished, hasUnpublishedChanges } from "../lib/site-publish.js";
import { rebuildBookingApp } from "../lib/actions.js";
import { hasPlatformAccess } from "../lib/billing.js";

const router = Router();

// Rebuild booking-app.html from the LATEST template (keeps accounts/branding) so every publish ships
// the newest booking app — incl. the window.__BA_PID__ fix that makes server features work on a
// custom domain/subdomain. No-op if the project has no booking app.
// Own-domain connecting is a paid feature: the project's owner must have an active subscription.
async function ownerSubscribed(projectId: number): Promise<boolean> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p?.ownerId) return false;
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, p.ownerId));
  return hasPlatformAccess(u);
}

async function refreshBookingApp(projectId: number): Promise<void> {
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const rebuilt = rebuildBookingApp(files.map((f) => ({ path: f.path, content: f.content })));
  if (!rebuilt) return;
  const ex = files.find((f) => f.path === rebuilt.path);
  if (ex) await db.update(projectFiles).set({ content: rebuilt.content, updatedAt: new Date() }).where(eq(projectFiles.id, ex.id));
}

// Publish status: the free Nebula subdomain (if any) + custom domains + draft/publish state.
router.get("/projects/:id/publish", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const sub = await getSubdomain(projectId);
    const all = await listDomains(projectId);
    res.json({
      platformHost: PLATFORM_HOST, target: CUSTOMERS_TARGET, subdomain: sub,
      domains: all.filter((d) => !d.domain.endsWith("." + PLATFORM_HOST)),
      published: await isPublished(projectId), hasChanges: await hasUnpublishedChanges(projectId),
    });
  } catch (err) { logger.error({ err, projectId }, "[publish] status failed"); res.status(500).json({ error: "Ophalen mislukt." }); }
});

// Publish: snapshot the current site live AND ensure a free Nebula subdomain. Optional custom slug.
router.post("/projects/:id/publish", json({ limit: "16kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const row = await publishSubdomain(projectId, req.body?.slug ? String(req.body.slug) : undefined);
    await refreshBookingApp(projectId);  // upgrade the booking app to the latest template first
    await publishSite(projectId);        // then snapshot current files as the live published site
    res.json({ ok: true, subdomain: row, url: "https://" + row.domain });
  } catch (err) { res.status(400).json({ error: (err as Error)?.message || "Publiceren mislukt." }); }
});

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
    if (!(await ownerSubscribed(projectId))) { res.status(402).json({ error: "Een eigen domein koppelen zit in het abonnement (€50/maand). Gratis publiceer je op een Nebula-adres (met watermerk). Abonneer je in je profiel." }); return; }
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
