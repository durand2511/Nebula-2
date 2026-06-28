/**
 * Platform (builder) account auth: register / login / sessions / password reset for Nebula users.
 * Each user owns their own projects (multi-tenant). Mirrors the studio booking-app auth pattern:
 * scrypt-hashed passwords, opaque session tokens in platform_sessions (the client stores only the
 * token in localStorage). Password reset e-mails go out via the SMTP the user configured in their
 * booking app; if none is set, a temporary password is returned to show on screen instead.
 */
import { db, platformUsers, platformSessions, projects, type PlatformUser } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { hashPassword, verifyPassword, newSessionToken } from "./password.js";
import { resolveSmtpConfig } from "./email-config.js";
import { sendMail } from "./smtp.js";
import { logger } from "./logger";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export function publicUser(u: PlatformUser) {
  return { id: u.id, email: u.email, name: u.name, birthdate: u.birthdate, phone: u.phone };
}

export async function createSession(userId: number): Promise<string> {
  const token = newSessionToken();
  await db.insert(platformSessions).values({ token, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  return token;
}

export async function getSessionUser(token: string): Promise<PlatformUser | null> {
  if (!token) return null;
  const [s] = await db.select().from(platformSessions).where(eq(platformSessions.token, token));
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now()) { await db.delete(platformSessions).where(eq(platformSessions.token, token)); return null; }
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, s.userId));
  return u || null;
}

export async function deleteSession(token: string): Promise<void> {
  if (token) await db.delete(platformSessions).where(eq(platformSessions.token, token));
}

export function tokenFrom(req: { headers: Record<string, unknown>; query?: Record<string, unknown> }): string {
  const auth = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  return auth || String(req.query?.["token"] || "");
}

export async function registerUser(p: { email: string; password: string; name: string; birthdate?: string; phone?: string }): Promise<{ user: PlatformUser } | { error: string }> {
  const email = String(p.email || "").trim().toLowerCase();
  if (!isEmail(email)) return { error: "Vul een geldig e-mailadres in." };
  if (!p.password || p.password.length < 6) return { error: "Wachtwoord moet minstens 6 tekens zijn." };
  if (!String(p.name || "").trim()) return { error: "Vul je naam in." };
  const [exists] = await db.select().from(platformUsers).where(eq(platformUsers.email, email));
  if (exists) return { error: "Er bestaat al een account met dit e-mailadres." };
  const [user] = await db.insert(platformUsers).values({
    email, passwordHash: hashPassword(p.password), name: String(p.name).trim(),
    birthdate: /^\d{4}-\d{2}-\d{2}$/.test(p.birthdate || "") ? p.birthdate! : "", phone: String(p.phone || "").trim(),
  }).returning();
  return { user };
}

export async function loginUser(email: string, password: string): Promise<PlatformUser | null> {
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.email, String(email || "").trim().toLowerCase()));
  if (!u || !verifyPassword(password, u.passwordHash)) return null;
  return u;
}

export async function updateProfile(userId: number, p: { name?: string; birthdate?: string; phone?: string }): Promise<void> {
  const set: Record<string, unknown> = {};
  if (p.name !== undefined) set.name = String(p.name).trim();
  if (p.birthdate !== undefined) set.birthdate = /^\d{4}-\d{2}-\d{2}$/.test(p.birthdate) ? p.birthdate : "";
  if (p.phone !== undefined) set.phone = String(p.phone).trim();
  if (Object.keys(set).length) await db.update(platformUsers).set(set).where(eq(platformUsers.id, userId));
}

export async function changePassword(userId: number, current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, userId));
  if (!u) return { ok: false, error: "Account niet gevonden." };
  if (!verifyPassword(current, u.passwordHash)) return { ok: false, error: "Huidig wachtwoord klopt niet." };
  if (!next || next.length < 6) return { ok: false, error: "Nieuw wachtwoord moet minstens 6 tekens zijn." };
  await db.update(platformUsers).set({ passwordHash: hashPassword(next) }).where(eq(platformUsers.id, userId));
  return { ok: true };
}

/** Permanently delete the account + EVERYTHING it owns (projects cascade to files, bookings, etc.,
 *  sessions cascade too). Requires the current password to confirm. */
export async function deleteAccount(userId: number, password: string): Promise<{ ok: boolean; error?: string }> {
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, userId));
  if (!u) return { ok: false, error: "Account niet gevonden." };
  if (!verifyPassword(password, u.passwordHash)) return { ok: false, error: "Wachtwoord klopt niet." };
  await db.delete(platformUsers).where(eq(platformUsers.id, userId)); // cascades: projects + sessions + all child data
  return { ok: true };
}

function tempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * Reset a forgotten password: set a new temporary password, e-mail it via the SMTP the user has in
 * one of their booking apps. If no SMTP is configured, return the temp password so the UI can show
 * it on screen instead. Returns { emailed, tempPassword? } — tempPassword only when NOT e-mailed.
 */
export async function resetPassword(email: string): Promise<{ ok: boolean; emailed: boolean; tempPassword?: string; error?: string }> {
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.email, String(email || "").trim().toLowerCase()));
  if (!u) return { ok: false, emailed: false, error: "Geen account met dit e-mailadres." };
  const pw = tempPassword();
  await db.update(platformUsers).set({ passwordHash: hashPassword(pw) }).where(eq(platformUsers.id, u.id));
  // Find an SMTP config among the user's projects (the e-mail set up in their booking app).
  const mine = await db.select().from(projects).where(eq(projects.ownerId, u.id));
  for (const proj of mine) {
    const cfg = await resolveSmtpConfig(proj.id);
    if (!cfg) continue;
    try {
      await sendMail(cfg, {
        to: u.email, fromName: "Nebula",
        subject: "Je nieuwe Nebula-wachtwoord",
        html: `<p>Hoi ${u.name || ""},</p><p>Je hebt een wachtwoord-reset aangevraagd voor Nebula. Je tijdelijke wachtwoord is:</p><p style="font-size:22px;font-weight:800;letter-spacing:2px">${pw}</p><p>Log ermee in en stel daarna een nieuw wachtwoord in via je profiel.</p>`,
        text: `Je tijdelijke Nebula-wachtwoord: ${pw}. Log ermee in en wijzig het via je profiel.`,
      });
      return { ok: true, emailed: true };
    } catch (err) { logger.warn({ err, projectId: proj.id }, "[platform-auth] reset mail failed"); }
  }
  // No SMTP available → show the temp password on screen (fallback).
  return { ok: true, emailed: false, tempPassword: pw };
}
