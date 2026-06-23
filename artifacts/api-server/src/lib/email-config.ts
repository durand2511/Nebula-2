/**
 * Per-studio SMTP configuration: provider auto-detection (Gmail / Outlook family), encrypted
 * password storage (AES-256-GCM), and resolving the effective SmtpConfig for a project
 * (per-project DB config first, env as fallback).
 */
import crypto from "node:crypto";
import { db, projectEmail } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type SmtpConfig, smtpConfigFromEnv } from "./smtp.js";

// Supported providers. We only support Gmail and the Outlook family for now; both use STARTTLS
// on 587 (secure:false here means "not implicit TLS" — STARTTLS is still used).
export type Provider = { name: string; host: string; port: number; secure: boolean };
const GMAIL: Provider = { name: "Gmail", host: "smtp.gmail.com", port: 587, secure: false };
const OUTLOOK: Provider = { name: "Outlook", host: "smtp-mail.outlook.com", port: 587, secure: false };

export const UNSUPPORTED_DOMAIN_MSG =
  "Momenteel ondersteunt de app alleen Gmail, Outlook, Hotmail en Live e-mailaccounts.";

/** Turn a raw SMTP error into a clear, actionable Dutch message. */
export function explainSmtpError(raw: string): string {
  const m = String(raw || "");
  if (/534|5\.7\.9|application-specific password|invalidsecondfa/i.test(m))
    return "Gmail accepteert je gewone wachtwoord niet. Zet 2-stapsverificatie aan en maak een app-wachtwoord aan op myaccount.google.com/apppasswords — gebruik die 16 tekens hier.";
  if (/5\.7\.139|basic authentication is disabled|authentication unsuccessful/i.test(m))
    return "Outlook accepteert je gewone wachtwoord niet. Maak een app-wachtwoord aan op account.live.com/proofs/AppPassword en gebruik die hier.";
  if (/535|username and password not accepted|badcredentials|authentication failed/i.test(m))
    return "Onjuiste inloggegevens. Controleer je e-mailadres en (app-)wachtwoord.";
  if (/getaddrinfo|enotfound|econnrefused|etimedout|timeout/i.test(m))
    return "Kon geen verbinding maken met de mailserver. Controleer je internet en probeer opnieuw.";
  return "Verbinding mislukt: " + m.slice(0, 160);
}

/** Detect SMTP settings from an e-mail address, or null if the domain isn't supported. */
export function detectProvider(email: string): Provider | null {
  const e = String(email || "").toLowerCase().trim();
  if (/@gmail\.com$/.test(e)) return GMAIL;
  if (/@(outlook|hotmail|live)\.com$/.test(e)) return OUTLOOK;
  return null;
}

// --- password encryption (AES-256-GCM) ---
function key(): Buffer {
  const material = process.env.EMAIL_SECRET_KEY || process.env.STRIPE_WEBHOOK_SECRET || "nebula-dev-email-key";
  return crypto.createHash("sha256").update(material).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB, tagB, dataB] = String(payload || "").split(":");
  if (!ivB || !tagB || !dataB) throw new Error("Malformed encrypted secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}

/** Save (upsert) a project's e-mail config. Throws on an unsupported domain. */
export async function saveProjectEmail(projectId: number, email: string, password: string): Promise<Provider> {
  const p = detectProvider(email);
  if (!p) throw new Error(UNSUPPORTED_DOMAIN_MSG);
  const row = {
    email: email.trim(),
    smtpHost: p.host,
    smtpPort: p.port,
    smtpSecure: p.secure ? "true" : "false",
    passEncrypted: encryptSecret(password),
    updatedAt: new Date(),
  };
  await db
    .insert(projectEmail)
    .values({ projectId, ...row })
    .onConflictDoUpdate({ target: projectEmail.projectId, set: row });
  return p;
}

/** Public status (NEVER includes the password). */
export async function getProjectEmailStatus(projectId: number): Promise<{ configured: boolean; email?: string; smtpHost?: string; smtpPort?: number; smtpSecure?: boolean }> {
  const [r] = await db.select().from(projectEmail).where(eq(projectEmail.projectId, projectId));
  if (!r) return { configured: false };
  return { configured: true, email: r.email, smtpHost: r.smtpHost, smtpPort: r.smtpPort, smtpSecure: r.smtpSecure === "true" };
}

/** Resolve the SmtpConfig used to actually send: per-project DB config first, else env. */
export async function resolveSmtpConfig(projectId: number): Promise<SmtpConfig | null> {
  const [r] = await db.select().from(projectEmail).where(eq(projectEmail.projectId, projectId));
  if (r) {
    try {
      return {
        host: r.smtpHost,
        port: r.smtpPort,
        user: r.email,
        pass: decryptSecret(r.passEncrypted),
        from: r.email,
        secure: r.smtpSecure === "true",
      };
    } catch {
      /* fall through to env if decryption fails */
    }
  }
  return smtpConfigFromEnv();
}

/** Build a transient config for "test connection" before saving (uses the typed-in password). */
export function transientConfig(email: string, password: string): SmtpConfig | null {
  const p = detectProvider(email);
  if (!p || !password) return null;
  return { host: p.host, port: p.port, user: email.trim(), pass: password, from: email.trim(), secure: p.secure };
}
