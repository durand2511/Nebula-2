/** Custom-domain management API (per project; open like the rest of the API for now). */
import { Router, json } from "express";
import { db, projectFiles, projects, platformUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { addDomain, listDomains, deleteDomain, verifyDomain, publishSubdomain, getSubdomain, CUSTOMERS_TARGET, PLATFORM_HOST } from "../lib/domains.js";
import { publishSite, isPublished, hasUnpublishedChanges } from "../lib/site-publish.js";
import { rebuildBookingApp } from "../lib/actions.js";
import { hasPlatformAccess } from "../lib/billing.js";
import { sendMail, smtpConfigFromEnv } from "../lib/smtp.js";

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
  try { res.json({ target: CUSTOMERS_TARGET, redirectSupported: true, domains: await listDomains(projectId) }); }
  catch (err) { logger.error({ err, projectId }, "[domains] list failed"); res.status(500).json({ error: "Ophalen mislukt." }); }
});

router.post("/projects/:id/domains", json({ limit: "16kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    if (!(await ownerSubscribed(projectId))) { res.status(402).json({ error: "Een eigen domein koppelen zit in het abonnement (€50/maand). Gratis publiceer je op een Nebula-adres (met watermerk). Abonneer je in je profiel." }); return; }
    const row = await addDomain(projectId, String(req.body?.domain ?? ""), req.body?.redirectTo ? String(req.body.redirectTo) : undefined);
    // The customer never sees DNS records: connecting a domain needs a provider-specific approach, so
    // the PLATFORM OWNER does the DNS work. Notify them by e-mail with the exact records to set
    // (full runbook: docs/DOMEIN-KOPPELEN.md). Best-effort — the request itself never fails on mail.
    void (async () => {
      try {
        const cfg = smtpConfigFromEnv();
        if (!cfg) { logger.warn("[domains] no SMTP config — owner not e-mailed about new domain"); return; }
        const to = process.env.CONTACT_EMAIL || "durand2511@gmail.com";
        const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
        const owner = p?.ownerId ? (await db.select().from(platformUsers).where(eq(platformUsers.id, p.ownerId)))[0] : null;
        const text = [
          `Nieuw domein aangemeld: ${row.domain}`,
          `Project: #${projectId} (${p?.name || "?"}) — klant: ${owner?.name || "?"} <${owner?.email || "?"}>`,
          "",
          "In te stellen bij de DNS-provider van de klant:",
          `  www.${row.domain.replace(/^www\./, "")}  CNAME → ${CUSTOMERS_TARGET}`,
          `  ${row.domain.replace(/^www\./, "")}  A → 216.24.57.1 en A → 216.24.57.9`,
          "",
          "Daarna in Nebula bij het project op 'Verifiëren' klikken (of de klant doet dat) — Render-domein + SSL gaan dan automatisch.",
          "Volledige runbook: docs/DOMEIN-KOPPELEN.md in de repo.",
        ].join("\n");
        await sendMail(cfg, { to, subject: `🌐 Domein koppelen: ${row.domain}`, text, html: `<pre style="font:14px/1.5 monospace">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))}</pre>`, fromName: "Nebula" });
      } catch (err) { logger.warn({ err }, "[domains] owner notify failed"); }
    })();
    res.json({ ok: true, domain: row, instruction: "Je domein is aangemeld. De koppeling vergt een specifieke aanpak, dus de eigenaar van Nebula regelt dit voor je — je hoeft zelf niets in te stellen.", target: CUSTOMERS_TARGET });
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

// ── Lead capture from a published customer site ────────────────────────────────────────────────
// Public endpoint the floating lead widget POSTs to. Mails the submission to the project's leadEmail
// via the platform SMTP. Lightly rate-limited per IP so it can't be abused as a mail relay.
const leadHits = new Map<string, number[]>();
function leadRateOk(ip: string): boolean {
  const now = Date.now(), win = 10 * 60 * 1000, max = 5;
  const arr = (leadHits.get(ip) || []).filter((t) => now - t < win);
  if (arr.length >= max) { leadHits.set(ip, arr); return false; }
  arr.push(now); leadHits.set(ip, arr); return true;
}
const escLead = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

router.post("/projects/:id/lead", json({ limit: "16kb" }), async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
  if (!leadRateOk(ip)) { res.status(429).json({ error: "Te veel aanvragen. Probeer het straks opnieuw." }); return; }
  const name = String(req.body?.name ?? "").trim().slice(0, 120);
  const phone = String(req.body?.phone ?? "").trim().slice(0, 40);
  const email = String(req.body?.email ?? "").trim().slice(0, 160);
  const message = String(req.body?.message ?? "").trim().slice(0, 2000);
  const page = String(req.body?.page ?? "").trim().slice(0, 300);
  const okPhone = phone.replace(/\D/g, "").length >= 6;
  const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!okPhone && !okEmail) { res.status(400).json({ error: "Vul een telefoonnummer of e-mailadres in." }); return; }
  try {
    const [prj] = await db.select({ leadEmail: projects.leadEmail, name: projects.name }).from(projects).where(eq(projects.id, projectId));
    if (!prj?.leadEmail) { res.status(404).json({ error: "Contactformulier niet actief." }); return; }
    const cfg = smtpConfigFromEnv();
    if (!cfg) { logger.warn({ projectId }, "[lead] no platform SMTP configured"); res.status(500).json({ error: "Versturen kon niet. Probeer het later opnieuw." }); return; }
    const rows = [
      name && `Naam: ${name}`,
      phone && `Telefoon: ${phone}`,
      email && `E-mail: ${email}`,
      message && `Bericht: ${message}`,
      page && `Pagina: ${page}`,
    ].filter(Boolean) as string[];
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px">`
      + `<h2 style="margin:0 0 12px">📩 Nieuwe aanvraag via ${escLead(prj.name || "je website")}</h2>`
      + rows.map((r) => `<p style="margin:4px 0">${escLead(r)}</p>`).join("")
      + `</div>`;
    const text = `Nieuwe aanvraag via ${prj.name}\n\n${rows.join("\n")}`;
    await sendMail(cfg, { to: prj.leadEmail, subject: `📩 Nieuwe aanvraag via ${prj.name}`, html, text, fromName: prj.name || "Nebula" });
    logger.info({ projectId, to: prj.leadEmail }, "[lead] submission mailed");
    res.json({ ok: true });
  } catch (err) { logger.error({ err, projectId }, "[lead] send failed"); res.status(500).json({ error: "Versturen kon niet. Probeer het later opnieuw." }); }
});

export default router;
