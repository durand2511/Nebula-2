/**
 * Mindbody migration API: upload CSVs (clients/class_packs/memberships), see a summary, send
 * activation e-mails, and let the booking app consume a token + pull a customer's entitlements.
 * Open per project (like the rest of the API for now).
 */
import { Router, json } from "express";
import { db, importCustomers, importEntitlements } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { importCsv, type ImportType } from "../lib/mindbody-import.js";
import { createActivationToken, consumeActivationToken } from "../lib/activation.js";
import { sendActivationEmail } from "../lib/email.js";

const router = Router();
const APP_URL = process.env.PUBLIC_APP_URL || "http://localhost:5173";

// Upload + import one CSV. Bigger body limit for large client lists (opted out of the global parser in app.ts).
router.post("/projects/:id/import/mindbody", json({ limit: "20mb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const type = String(req.body?.type ?? "") as ImportType;
  const csv = String(req.body?.csv ?? "");
  if (!["clients", "class_packs", "memberships", "combined"].includes(type)) { res.status(400).json({ error: "Onbekend type (clients|class_packs|memberships|combined)." }); return; }
  if (!csv.trim()) { res.status(400).json({ error: "Leeg CSV-bestand." }); return; }
  try { res.json(await importCsv(projectId, type, csv)); }
  catch (err) { logger.error({ err, projectId }, "[import] failed"); res.status(500).json({ error: "Import mislukt." }); }
});

// Aggregate overview for the admin.
router.get("/projects/:id/import/summary", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const customers = await db.select().from(importCustomers).where(eq(importCustomers.projectId, projectId));
    const ents = await db.select().from(importEntitlements).where(eq(importEntitlements.projectId, projectId));
    res.json({
      customers: customers.length,
      activated: customers.filter((c) => c.activated === "true").length,
      packsActive: ents.filter((e) => e.kind === "class_pack" && e.status === "active").length,
      membershipsActive: ents.filter((e) => e.kind === "membership" && e.status === "active").length,
      expiredOrDepleted: ents.filter((e) => e.status === "expired" || e.status === "depleted").length,
    });
  } catch (err) { logger.error({ err, projectId }, "[import] summary failed"); res.status(500).json({ error: "Overzicht mislukt." }); }
});

router.get("/projects/:id/import/customers", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const customers = await db.select().from(importCustomers).where(eq(importCustomers.projectId, projectId));
    res.json(customers.map((c) => ({ email: c.email, firstName: c.firstName, lastName: c.lastName, phone: c.phone, activated: c.activated === "true" })).reverse());
  } catch (err) { logger.error({ err, projectId }, "[import] customers failed"); res.status(500).json({ error: "Ophalen mislukt." }); }
});

// Send activation e-mails to all imported, not-yet-activated customers.
router.post("/projects/:id/import/send-activations", json({ limit: "64kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    const customers = await db.select().from(importCustomers).where(and(eq(importCustomers.projectId, projectId), eq(importCustomers.activated, "false")));
    let sent = 0; const errors: { email: string; message: string }[] = [];
    for (const c of customers) {
      try {
        const raw = await createActivationToken(projectId, c.email);
        const url = `${APP_URL}/projects/${projectId}/preview-page?page=booking-app.html&activate=${encodeURIComponent(raw)}`;
        const ok = await sendActivationEmail(projectId, c.email, c.firstName, url);
        if (ok) sent++; else errors.push({ email: c.email, message: "geen e-mail verstuurd (SMTP niet ingesteld?)" });
      } catch (err) { errors.push({ email: c.email, message: (err as Error)?.message || "fout" }); }
    }
    res.json({ ok: true, sent, total: customers.length, errors });
  } catch (err) { logger.error({ err, projectId }, "[import] send-activations failed"); res.status(500).json({ error: "Versturen mislukt." }); }
});

// Booking-app bridge: consume a token → mark activated → return the customer + their entitlements.
router.post("/projects/:id/import/activate", json({ limit: "16kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const token = String(req.body?.token ?? "");
  try {
    const email = await consumeActivationToken(projectId, token);
    if (!email) { res.status(400).json({ ok: false, error: "Ongeldige of verlopen activatielink." }); return; }
    await db.update(importCustomers).set({ activated: "true", updatedAt: new Date() }).where(and(eq(importCustomers.projectId, projectId), eq(importCustomers.email, email)));
    const [cust] = await db.select().from(importCustomers).where(and(eq(importCustomers.projectId, projectId), eq(importCustomers.email, email)));
    const ents = await db.select().from(importEntitlements).where(and(eq(importEntitlements.projectId, projectId), eq(importEntitlements.email, email)));
    res.json({
      ok: true, email, firstName: cust?.firstName || "", lastName: cust?.lastName || "", phone: cust?.phone || "",
      entitlements: ents.filter((e) => e.status === "active").map((e) => ({
        kind: e.kind, name: e.name, status: e.status, remaining: e.remaining, total: e.total,
        unlimited: e.unlimited === "true", perMonth: e.perMonth, expiresAt: e.expiresAt, needsPayment: e.needsPayment === "true",
      })),
    });
  } catch (err) { logger.error({ err, projectId }, "[import] activate failed"); res.status(500).json({ error: "Activatie mislukt." }); }
});

export default router;
