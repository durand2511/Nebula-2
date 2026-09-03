/**
 * One-time, hashed account-activation tokens for the Mindbody migration. The raw token only ever
 * lives in the e-mail link; we store sha256(token + secret). A token is single-use and expires.
 */
import { db, activationTokens } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";

const TTL_DAYS = 30;
const secret = () => process.env.EMAIL_SECRET_KEY || "nebula-activation-secret";
const hash = (raw: string) => crypto.createHash("sha256").update(raw + secret()).digest("hex");

/** Create a fresh token for an e-mail. Returns the RAW token (goes in the link only). */
export async function createActivationToken(projectId: number, email: string): Promise<string> {
  const raw = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86400000);
  await db.insert(activationTokens).values({ projectId, email: email.toLowerCase(), tokenHash: hash(raw), expiresAt });
  return raw;
}

/** Check a token WITHOUT consuming it — the preview-page route validates the e-mailed link before
 *  serving booking-app.html; the booking app itself consumes the token pas bij het activeren. */
export async function peekActivationToken(projectId: number, raw: string): Promise<boolean> {
  if (!raw) return false;
  const [row] = await db.select().from(activationTokens).where(and(eq(activationTokens.projectId, projectId), eq(activationTokens.tokenHash, hash(raw))));
  return !!row && row.used !== "true" && new Date(row.expiresAt).getTime() >= Date.now();
}

/** Validate + consume a token (single-use, not expired). Returns the e-mail or null. */
export async function consumeActivationToken(projectId: number, raw: string): Promise<string | null> {
  if (!raw) return null;
  const [row] = await db.select().from(activationTokens).where(and(eq(activationTokens.projectId, projectId), eq(activationTokens.tokenHash, hash(raw))));
  if (!row || row.used === "true" || new Date(row.expiresAt).getTime() < Date.now()) return null;
  await db.update(activationTokens).set({ used: "true" }).where(eq(activationTokens.id, row.id));
  return row.email;
}
