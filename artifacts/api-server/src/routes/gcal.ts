/**
 * Google Calendar OAuth + instant-sync routes. The studio connects once (consent screen) and the
 * server then writes lesson events straight to their Google Calendar on every change.
 *
 * The OAuth redirect URI must be ONE fixed host (Google requires it pre-registered), so we pin it to
 * PUBLIC_API_URL when set — otherwise the request host. Register <that host>/api/gcal/callback in
 * the Google Cloud console.
 */
import { Router, json } from "express";
import { logger } from "../lib/logger";
import { reqBaseUrl } from "../lib/req-url.js";
import { ensureCalendar, getLessons } from "../lib/calendar.js";
import { authUrl, exchangeCode, pushLessons, gcalStatus, disconnectGcal, gcalConfigured, decodeUserState, exchangeCodeUser, pushLessonsUser, getTeacherLessons } from "../lib/gcal.js";
import { db, projectCalendar } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();
const gcalBase = (req: { headers: Record<string, unknown> }) => process.env.PUBLIC_API_URL || reqBaseUrl(req as any);

router.get("/projects/:id/gcal/status", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try { res.json(await gcalStatus(projectId)); }
  catch (err) { logger.error({ err, projectId }, "[gcal] status failed"); res.status(500).json({ error: "Status mislukt." }); }
});

// Start the OAuth flow: hand back the Google consent URL (the booking app opens it).
router.post("/projects/:id/gcal/connect", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (!gcalConfigured()) { res.status(503).json({ error: "Google Agenda is nog niet ingesteld door het platform." }); return; }
  try {
    const { token } = await ensureCalendar(projectId, gcalBase(req));
    res.json({ url: authUrl(projectId, token, gcalBase(req)) });
  } catch (err) { logger.error({ err, projectId }, "[gcal] connect failed"); res.status(500).json({ error: "Koppelen mislukt." }); }
});

// OAuth callback (top-level): Google redirects here with ?code & ?state="<projectId>.<feedToken>".
router.get("/gcal/callback", async (req, res) => {
  const page = (title: string, msg: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc"><div style="max-width:420px;text-align:center;padding:28px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.12)"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#6b7280;margin:0 0 16px">${msg}</p><button onclick="window.close()" style="background:#7a00df;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:700;cursor:pointer">Sluiten</button></div>`;
  try {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const err = String(req.query.error || "");
    if (err) { res.status(400).send(page("Koppeling geannuleerd", "Je hebt de Google-toegang geweigerd. Sluit dit venster en probeer opnieuw.")); return; }
    const parts = state.split(".");
    const projectId = Number(parts[0]);
    const feedToken = parts[1];
    const userPart = parts[2] || "";
    if (!code || isNaN(projectId) || !feedToken) { res.status(400).send(page("Ongeldig", "De koppeling kon niet worden voltooid.")); return; }
    const [cal] = await db.select().from(projectCalendar).where(eq(projectCalendar.projectId, projectId));
    if (!cal || cal.token !== feedToken) { res.status(403).send(page("Niet toegestaan", "De koppeling kon niet worden geverifieerd.")); return; }
    // Per-staff connection: state carries "u_<b64url(email)>" → connect only that person's own calendar.
    const userEmail = decodeUserState(userPart);
    if (userEmail) {
      await exchangeCodeUser(projectId, userEmail, code, gcalBase(req));
      void pushLessonsUser(projectId, userEmail, await getTeacherLessons(projectId, userEmail));
      res.send(page("Google Agenda gekoppeld ✓", "Jouw eigen afspraken worden nu automatisch gesynchroniseerd. Je kunt dit venster sluiten."));
      return;
    }
    await exchangeCode(projectId, code, gcalBase(req));
    // Immediately push the current lessons so the calendar fills right away.
    const lessons = await getLessons(projectId, feedToken);
    if (lessons) void pushLessons(projectId, lessons);
    res.send(page("Google Agenda gekoppeld ✓", "Je lessen worden nu automatisch direct gesynchroniseerd. Je kunt dit venster sluiten."));
  } catch (e) { logger.error({ err: e }, "[gcal] callback failed"); res.status(500).send(page("Er ging iets mis", "Probeer de koppeling opnieuw.")); }
});

router.post("/projects/:id/gcal/disconnect", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try { await disconnectGcal(projectId); res.json({ ok: true }); }
  catch (err) { logger.error({ err, projectId }, "[gcal] disconnect failed"); res.status(500).json({ error: "Ontkoppelen mislukt." }); }
});

export default router;
