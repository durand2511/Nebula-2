/** Platform (builder) account auth: register / login / logout / me / forgot-password / profile. */
import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import {
  registerUser, loginUser, createSession, getSessionUser, deleteSession, tokenFrom,
  publicUser, resetPassword, updateProfile, changePassword, deleteAccount, grantLifetimeAccess,
} from "../lib/platform-auth.js";
import { loginBlocked, loginFailure, loginSuccess, clientIp } from "../lib/login-guard.js";
import { timingSafeEqual } from "node:crypto";

const router: IRouter = Router();

// Owner admin-code → unlocks lifetime free full access. Set ADMIN_UNLOCK_CODE in Render to override
// (the fallback below lives in the repo, so treat it as public and rotate via the env var).
const ADMIN_UNLOCK_CODE = process.env.ADMIN_UNLOCK_CODE || "2511Durand8!";
router.post("/auth/admin-unlock", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const guardKeys = [`adminunlock:${u.id}`, `adminunlock-ip:${clientIp(req as any)}`];
  if (loginBlocked(guardKeys)) { res.status(429).json({ error: "Te veel pogingen. Probeer het later opnieuw." }); return; }
  const code = String(req.body?.code || "");
  const a = Buffer.from(code), b = Buffer.from(ADMIN_UNLOCK_CODE);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) { loginFailure(guardKeys); res.status(403).json({ error: "Onjuiste code." }); return; }
  loginSuccess(guardKeys);
  await grantLifetimeAccess(u.id);
  res.json({ ok: true });
});

router.post("/auth/register", async (req, res) => {
  try {
    const b = req.body || {};
    const r = await registerUser({ email: b.email, password: b.password, name: b.name, birthdate: b.birthdate, phone: b.phone });
    if ("error" in r) { res.status(400).json({ error: r.error }); return; }
    const token = await createSession(r.user.id);
    res.json({ ok: true, token, user: publicUser(r.user) });
  } catch (err) { logger.error({ err }, "[auth] register failed"); res.status(500).json({ error: "Registreren mislukt." }); }
});

router.post("/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const guardKeys = [`platform:${email}`, `ip:${clientIp(req as any)}`];
  const wait = loginBlocked(guardKeys);
  if (wait) { res.status(429).json({ error: `Te veel inlogpogingen. Probeer over ${Math.ceil(wait / 60)} minuten opnieuw.` }); return; }
  try {
    const u = await loginUser(email, String(req.body?.password || ""));
    if (!u) { loginFailure(guardKeys); res.status(401).json({ error: "Onjuist e-mailadres of wachtwoord." }); return; }
    loginSuccess(guardKeys);
    const token = await createSession(u.id);
    res.json({ ok: true, token, user: publicUser(u) });
  } catch (err) { logger.error({ err }, "[auth] login failed"); res.status(500).json({ error: "Inloggen mislukt." }); }
});

router.post("/auth/logout", async (req, res) => {
  try { await deleteSession(tokenFrom(req as any)); res.json({ ok: true }); }
  catch { res.json({ ok: true }); }
});

router.get("/auth/me", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  res.json({ user: publicUser(u) });
});

router.post("/auth/forgot", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const guardKeys = [`forgot:${email}`, `forgot-ip:${clientIp(req as any)}`];
  if (loginBlocked(guardKeys)) { res.status(429).json({ error: "Te veel verzoeken. Probeer het later opnieuw." }); return; }
  loginFailure(guardKeys); // every reset request counts toward the limit (anti-spam / anti-lockout)
  try {
    const r = await resetPassword(email);
    // Always generic: never reveal whether the account exists, never return a password.
    res.json({ ok: true, emailed: r.emailed });
  } catch (err) { logger.error({ err }, "[auth] forgot failed"); res.json({ ok: true, emailed: false }); }
});

router.post("/auth/profile", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  try { await updateProfile(u.id, req.body || {}); const fresh = await getSessionUser(tokenFrom(req as any)); res.json({ ok: true, user: fresh ? publicUser(fresh) : undefined }); }
  catch (err) { logger.error({ err }, "[auth] profile failed"); res.status(500).json({ error: "Opslaan mislukt." }); }
});

router.post("/auth/password", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const r = await changePassword(u.id, String(req.body?.current || ""), String(req.body?.next || ""));
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }
  res.json({ ok: true });
});

// Delete the account + EVERYTHING it owns. Requires the current password.
router.post("/auth/delete-account", async (req, res) => {
  const u = await getSessionUser(tokenFrom(req as any));
  if (!u) { res.status(401).json({ error: "Niet ingelogd." }); return; }
  const r = await deleteAccount(u.id, String(req.body?.password || ""));
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }
  res.json({ ok: true });
});

export default router;
