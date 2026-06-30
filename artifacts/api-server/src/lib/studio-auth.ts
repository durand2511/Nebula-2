/**
 * Server-side session handling for the booking app. Opaque tokens stored in studio_sessions; the
 * client keeps only the token (in localStorage), never the password or account data. 30-day TTL.
 */
import { db, studioUsers, studioSessions, type StudioUser } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { newSessionToken, hashPassword, verifyPassword } from "./password.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(projectId: number, userId: number): Promise<string> {
  const token = newSessionToken();
  await db.insert(studioSessions).values({ token, projectId, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  return token;
}

export async function getSessionUser(projectId: number, token: string): Promise<StudioUser | null> {
  if (!token) return null;
  const [s] = await db.select().from(studioSessions).where(and(eq(studioSessions.token, token), eq(studioSessions.projectId, projectId)));
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now()) { await db.delete(studioSessions).where(eq(studioSessions.token, token)); return null; }
  const [u] = await db.select().from(studioUsers).where(eq(studioUsers.id, s.userId));
  return u ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  if (token) await db.delete(studioSessions).where(eq(studioSessions.token, token));
}

/** Token from the Authorization: Bearer header or a ?token= query param. */
export function tokenFrom(req: { headers: Record<string, unknown>; query: Record<string, unknown> }): string {
  const auth = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  return auth || String(req.query["token"] || "");
}

/** Account fields safe to send to the client (no password hash). */
export function publicUser(u: StudioUser) {
  return { id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone };
}

/**
 * Sync the chat-configured admin/teacher logins in studio_users (scrypt-hashed) with the baked
 * accounts the booking app sends on load. New accounts are created; for an EXISTING admin/teacher
 * whose baked password no longer matches, the password (and name) are RE-SYNCED so the configured
 * credentials are always authoritative — otherwise re-setting the admin login leaves the studio
 * permanently locked out (the old password keeps applying). Self-registered clients are never
 * touched (they're not in the baked list). Returns how many new accounts were created.
 */
// Seed/sync the studio's admin/teacher logins. `allowOverwrite` (true only for trusted server-side
// calls — the owner configuring logins) permits updating an existing account's password; the open
// booking-app endpoint passes false so it can NEVER reset an existing staff password.
export async function seedStaffAccounts(projectId: number, accounts: { role?: string; name?: string; email?: string; password?: string }[], allowOverwrite = true): Promise<number> {
  let created = 0;
  for (const a of accounts || []) {
    const role = a.role === "admin" ? "admin" : "teacher";
    const email = String(a.email || "").trim().toLowerCase();
    const password = String(a.password || "");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !password) continue;
    const name = String(a.name || "").trim() || email;
    const [exists] = await db.select().from(studioUsers).where(and(eq(studioUsers.projectId, projectId), eq(studioUsers.email, email)));
    if (exists) {
      // Only re-sync when explicitly allowed (trusted caller) and the password actually changed.
      if (allowOverwrite && (exists.role === "admin" || exists.role === "teacher") && !verifyPassword(password, exists.passwordHash)) {
        await db.update(studioUsers).set({ passwordHash: hashPassword(password), name, role }).where(eq(studioUsers.id, exists.id));
      }
      continue;
    }
    await db.insert(studioUsers).values({ projectId, role, name, email, passwordHash: hashPassword(password) });
    created++;
  }
  return created;
}
