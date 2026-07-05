/**
 * Google Search Console OAuth routes. The studio clicks "Koppel Google Search Console" once; on the
 * callback we exchange the code, then auto-verify the site + submit the sitemap (see setupSearchConsole).
 *
 * The redirect URI must be ONE fixed host (Google requires it pre-registered), pinned to PUBLIC_API_URL
 * when set — otherwise the request host. Register <that host>/api/gsc/callback in the Google Cloud console.
 */
import { Router } from "express";
import { logger } from "../lib/logger";
import { reqBaseUrl } from "../lib/req-url.js";
import { startConnect, verifyNonce, exchangeCode, setupSearchConsole, gscStatus, disconnectGsc, gscConfigured } from "../lib/gsc.js";

const router = Router();
const gscBase = (req: { headers: Record<string, unknown> }) => process.env.PUBLIC_API_URL || reqBaseUrl(req as any);

router.get("/projects/:id/gsc/status", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try { res.json(await gscStatus(projectId)); }
  catch (err) { logger.error({ err, projectId }, "[gsc] status failed"); res.status(500).json({ error: "Status mislukt." }); }
});

// Start the OAuth flow: hand back the Google consent URL (the UI opens it).
router.post("/projects/:id/gsc/connect", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (!gscConfigured()) { res.status(503).json({ error: "Google Search Console is nog niet ingesteld door het platform." }); return; }
  try { res.json({ url: await startConnect(projectId, gscBase(req)) }); }
  catch (err) { logger.error({ err, projectId }, "[gsc] connect failed"); res.status(500).json({ error: "Koppelen mislukt." }); }
});

// OAuth callback: Google redirects here with ?code & ?state="<projectId>.<nonce>".
router.get("/gsc/callback", async (req, res) => {
  const page = (title: string, msg: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc"><div style="max-width:440px;text-align:center;padding:28px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.12)"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#6b7280;margin:0 0 16px">${msg}</p><button onclick="window.close()" style="background:#7a00df;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:700;cursor:pointer">Sluiten</button></div>`;
  try {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const err = String(req.query.error || "");
    if (err) { res.status(400).send(page("Koppeling geannuleerd", "Je hebt de Google-toegang geweigerd. Sluit dit venster en probeer opnieuw.")); return; }
    const [pidStr, nonce] = state.split(".");
    const projectId = Number(pidStr);
    if (!code || isNaN(projectId) || !nonce) { res.status(400).send(page("Ongeldig", "De koppeling kon niet worden voltooid.")); return; }
    if (!(await verifyNonce(projectId, nonce))) { res.status(403).send(page("Niet toegestaan", "De koppeling kon niet worden geverifieerd.")); return; }
    await exchangeCode(projectId, code, gscBase(req));
    const result = await setupSearchConsole(projectId);
    if (result.ok) res.send(page("Google Search Console gekoppeld ✓", "Je site is geverifieerd en je sitemap is ingediend. Google gaat je pagina's nu vanzelf indexeren. Je kunt dit venster sluiten."));
    else res.send(page("Gekoppeld — verificatie nog niet gelukt", (result.detail || "Probeer het opnieuw.") + " (Je account is wel gekoppeld; zodra je site live staat lukt de verificatie.)"));
  } catch (e) { logger.error({ err: e }, "[gsc] callback failed"); res.status(500).send(page("Er ging iets mis", "Probeer de koppeling opnieuw.")); }
});

// Re-run verification + sitemap submit (e.g. after publishing) without re-doing OAuth.
router.post("/projects/:id/gsc/sync", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try { res.json(await setupSearchConsole(projectId)); }
  catch (err) { logger.error({ err, projectId }, "[gsc] sync failed"); res.status(500).json({ error: "Synchroniseren mislukt." }); }
});

router.post("/projects/:id/gsc/disconnect", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try { await disconnectGsc(projectId); res.json({ ok: true }); }
  catch (err) { logger.error({ err, projectId }, "[gsc] disconnect failed"); res.status(500).json({ error: "Ontkoppelen mislukt." }); }
});

export default router;
