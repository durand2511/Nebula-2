/**
 * Retention-marketing campaigns for the booking studio. The customer AUDIENCE is derived (registered
 * clients ∪ everyone who booked/bought ∪ stored contacts); a studio_contacts row only holds the
 * non-derivable fields — birthday + explicit marketing opt-in (AVG). Campaigns ALWAYS filter to
 * opt-in recipients, every mail carries an unsubscribe link, and open/click are tracked per recipient.
 */
import crypto from "node:crypto";
import {
  db, studioUsers, studioBookings, studioClasses, studioPurchases,
  studioContacts, studioCampaigns, studioCampaignRecipients,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { resolveSmtpConfig } from "./email-config.js";
import { sendMail } from "./smtp.js";
import { defaultBrand } from "./email-brand-copy.js";
import { logger } from "./logger.js";

export type Segment = { treatment?: string; inactiveDays?: number; birthdayWithin?: number };
export type Contact = { email: string; name: string; birthdate: string; optIn: boolean; lastVisit: string; treatments: string[] };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const escHtml = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export async function loadBrand(projectId: number): Promise<{ studio: string; accent?: string; logo?: string }> {
  try { const b = await (await import("./email-brand.js")).loadEmailBrand(projectId); if (b) return b; } catch { /* fall through */ }
  return defaultBrand("onze salon");
}

/** The full customer universe with derived last-visit + treatments, enriched by the contact record. */
export async function buildAudience(projectId: number): Promise<Contact[]> {
  const [users, bookings, classes, purchases, contacts] = await Promise.all([
    db.select().from(studioUsers).where(eq(studioUsers.projectId, projectId)),
    db.select().from(studioBookings).where(eq(studioBookings.projectId, projectId)),
    db.select().from(studioClasses).where(eq(studioClasses.projectId, projectId)),
    db.select().from(studioPurchases).where(eq(studioPurchases.projectId, projectId)),
    db.select().from(studioContacts).where(eq(studioContacts.projectId, projectId)),
  ]);
  const titleById = new Map<number, string>(); classes.forEach((c) => titleById.set(c.id, c.title));
  const contactByEmail = new Map<string, (typeof contacts)[number]>();
  contacts.forEach((c) => contactByEmail.set(c.email.toLowerCase(), c));
  const map = new Map<string, Contact>();
  const today = ymd(new Date());
  const ensure = (rawEmail: string, name?: string): Contact | null => {
    const key = String(rawEmail || "").toLowerCase().trim();
    if (!key || key.indexOf("@") < 0) return null;
    let c = map.get(key);
    if (!c) {
      const row = contactByEmail.get(key);
      c = { email: key, name: (row?.name || name || "").trim(), birthdate: row?.birthdate || "", optIn: row?.marketingOptIn === "true", lastVisit: "", treatments: [] };
      map.set(key, c);
    }
    if (name && !c.name) c.name = name.trim();
    return c;
  };
  users.filter((u) => u.role === "client").forEach((u) => ensure(u.email, u.name));
  contacts.forEach((c) => ensure(c.email, c.name));
  bookings.forEach((b) => {
    if (b.status === "cancelled") return;
    const c = ensure(b.bookerEmail, b.name); if (!c) return;
    if (b.date && b.date <= today && b.date > c.lastVisit) c.lastVisit = b.date;
    const t = titleById.get(b.classId); if (t && c.treatments.indexOf(t) < 0) c.treatments.push(t);
  });
  purchases.forEach((p) => { const c = ensure(p.email); if (!c) return; const d = (p.date || "").slice(0, 10); if (d && d <= today && d > c.lastVisit) c.lastVisit = d; });
  return [...map.values()];
}

/** Days until this contact's next birthday, or null if unknown. */
function nextBirthdayInDays(birthdate: string, today: Date): number | null {
  const p = String(birthdate || "").split("-"); if (p.length !== 3) return null;
  const m = +p[1], d = +p[2]; if (!m || !d) return null;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < t0) next = new Date(today.getFullYear() + 1, m - 1, d);
  return Math.round((next.getTime() - t0.getTime()) / 86400000);
}

export function matchSegment(c: Contact, seg: Segment, today = new Date()): boolean {
  if (seg.treatment) { if (c.treatments.indexOf(seg.treatment) < 0) return false; }
  if (seg.inactiveDays && seg.inactiveDays > 0) {
    if (c.lastVisit) {
      const days = Math.round((today.getTime() - new Date(c.lastVisit + "T00:00:00").getTime()) / 86400000);
      if (days < seg.inactiveDays) return false;
    } // no visit at all ⇒ counts as inactive (matches)
  }
  if (seg.birthdayWithin && seg.birthdayWithin > 0) {
    const n = nextBirthdayInDays(c.birthdate, today); if (n === null || n > seg.birthdayWithin) return false;
  }
  return true;
}

export async function segmentCounts(projectId: number, seg: Segment): Promise<{ matched: number; eligible: number }> {
  const aud = await buildAudience(projectId);
  const m = aud.filter((c) => matchSegment(c, seg));
  return { matched: m.length, eligible: m.filter((c) => c.optIn).length };
}

const trackBaseUrl = (projectId: number) => `${(process.env.PUBLIC_API_URL || "").replace(/\/+$/, "")}/api/projects/${projectId}/studio/m`;

function personalize(text: string, vars: Record<string, string>): string {
  return String(text || "").replace(/\{(klant_naam|salon_naam)\}/g, (_m, k) => vars[k] ?? "");
}

function campaignShell(brand: { studio: string; accent?: string; logo?: string }, bodyHtml: string, unsubUrl: string): string {
  const accent = brand.accent || "#7a00df";
  const salon = brand.studio || "onze salon";
  const logo = brand.logo ? `<img src="${brand.logo}" alt="${escHtml(salon)}" style="max-height:56px;max-width:200px;object-fit:contain;display:block;margin:0 auto 10px">` : "";
  return `<div style="background:#f3f4f6;padding:30px 14px;font-family:'Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 22px rgba(17,24,39,.08)">
    <div style="background:${accent};padding:26px 24px;text-align:center">${logo}<div style="color:#ffffff;font-size:21px;font-weight:800">${escHtml(salon)}</div></div>
    <div style="padding:30px 28px;color:#1f2937"><div style="font-size:16px;line-height:1.65;color:#374151">${bodyHtml}</div></div>
    <div style="padding:18px 28px;background:#fafafa;border-top:1px solid #eef0f2;color:#9ca3af;font-size:12px;text-align:center">
      Je ontvangt deze e-mail van ${escHtml(salon)}.<br><a href="${unsubUrl}" style="color:#9ca3af">Uitschrijven voor deze e-mails</a>
    </div>
  </div>
</div>`;
}

/** Send (or scheduled-send) a campaign to its opt-in audience, one personalised + tracked mail each. */
export async function sendCampaign(projectId: number, campaignId: number): Promise<{ configured: boolean; sent: number; total: number }> {
  const [camp] = await db.select().from(studioCampaigns).where(and(eq(studioCampaigns.projectId, projectId), eq(studioCampaigns.id, campaignId)));
  if (!camp || camp.status === "sent" || camp.status === "sending") return { configured: true, sent: 0, total: 0 };
  const cfg = await resolveSmtpConfig(projectId);
  if (!cfg) { await db.update(studioCampaigns).set({ status: "failed" }).where(eq(studioCampaigns.id, campaignId)); return { configured: false, sent: 0, total: 0 }; }
  await db.update(studioCampaigns).set({ status: "sending" }).where(eq(studioCampaigns.id, campaignId));
  const brand = await loadBrand(projectId);
  const salon = brand.studio || "onze salon";
  let seg: Segment = {}; try { seg = JSON.parse(camp.filter || "{}"); } catch { /* {} */ }
  const aud = await buildAudience(projectId);
  const recips = aud.filter((c) => matchSegment(c, seg)).filter((c) => c.optIn);
  const track = trackBaseUrl(projectId);
  let sent = 0;
  for (const c of recips) {
    const token = crypto.randomBytes(16).toString("hex");
    const vars = { klant_naam: c.name || "klant", salon_naam: salon };
    const subject = personalize(camp.subject, vars) || salon;
    const bodyText = personalize(camp.body, vars);
    let html = escHtml(bodyText).replace(/\r?\n/g, "<br>");
    html = html.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${track}/c/${token}?u=${encodeURIComponent(u)}" style="color:${brand.accent || "#7a00df"}">${u}</a>`);
    const unsub = `${track}/u/${token}`;
    const pixel = `<img src="${track}/o/${token}" width="1" height="1" alt="" style="display:none">`;
    const finalHtml = campaignShell(brand, `<div>${html}</div>${pixel}`, unsub);
    const text = `${bodyText}\n\n— ${salon}\nUitschrijven: ${unsub}`;
    try {
      await db.insert(studioCampaignRecipients).values({ projectId, campaignId, email: c.email, token });
      await sendMail(cfg, { to: c.email, subject, html: finalHtml, text, fromName: salon });
      sent++;
    } catch (e) { logger.warn({ err: e, projectId, email: c.email }, "[campaign] recipient send failed"); }
  }
  await db.update(studioCampaigns).set({ status: "sent", sentAt: new Date(), totalRecipients: sent }).where(eq(studioCampaigns.id, campaignId));
  return { configured: true, sent, total: recips.length };
}
