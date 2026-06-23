/**
 * Booking-app transactional e-mails — warm, branded HTML (studio logo + name + accent + friendly
 * copy). The branding/copy is generated ONCE at booking-app creation (lib/email-brand.ts) and
 * loaded here per send; no AI per e-mail.
 */
import { sendMail, type SmtpConfig } from "./smtp.js";
import { resolveSmtpConfig } from "./email-config.js";
import { defaultBrand, type EmailBrand } from "./email-brand-copy.js";

// Loaded lazily so the (pure) template code doesn't drag in the DB/AI/logger import graph.
async function loadBrand(projectId: number): Promise<EmailBrand | undefined> {
  try { return (await import("./email-brand.js")).loadEmailBrand(projectId).then((b) => b || undefined); }
  catch { return undefined; }
}

const esc = (s: string) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

// "2026-06-23" → "23 juni 2026"
function fmtNL(dateStr?: string): string {
  const p = String(dateStr || "").split("-");
  if (p.length !== 3) return dateStr || "";
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}

const FONT = "font-family:'Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif";

// Branded outer shell: accent header with logo + studio name, big friendly body, soft footer.
function shell(brand: EmailBrand, heading: string, bodyHtml: string): string {
  const accent = brand.accent || "#7a00df";
  const logo = brand.logo
    ? `<img src="${brand.logo}" alt="${esc(brand.studio)}" style="max-height:60px;max-width:220px;object-fit:contain;display:block;margin:0 auto 12px">`
    : "";
  return `<div style="background:#f3f4f6;padding:32px 14px;${FONT}">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 22px rgba(17,24,39,.08)">
    <div style="background:${accent};padding:30px 24px;text-align:center">
      ${logo}<div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:.2px">${esc(brand.studio)}</div>
    </div>
    <div style="padding:34px 30px;color:#1f2937">
      <h1 style="margin:0 0 16px;font-size:27px;line-height:1.25;color:#111827">${esc(heading)}</h1>
      <div style="font-size:17px;line-height:1.65;color:#374151">${bodyHtml}</div>
    </div>
    <div style="padding:20px 30px;background:#fafafa;border-top:1px solid #eef0f2;color:#9ca3af;font-size:13px;text-align:center">
      Met liefde verstuurd door ${esc(brand.studio)} 💜
    </div>
  </div>
</div>`;
}

export type EmailKind = "booking" | "cancel" | "welcome" | "reminder" | "reset" | "test" | "promoted";
export type EmailData = { studio?: string; name?: string; classTitle?: string; date?: string; time?: string; password?: string; mode?: string; onlineLink?: string; onlineInfo?: string };

export type BuiltEmail = { subject: string; html: string; text: string; fromName: string };

export function buildEmail(kind: EmailKind, d: EmailData, brand?: EmailBrand): BuiltEmail {
  const b = brand || defaultBrand(d.studio || "onze studio");
  const studio = b.studio;
  const hi = d.name ? `<p style="margin:0 0 14px">Hoi ${esc(d.name)},</p>` : "";
  const when = [fmtNL(d.date), d.time].filter(Boolean).join(" om ");
  const detail = (label: string) =>
    `<div style="margin:20px 0;padding:18px 20px;background:#f9fafb;border:1px solid #eef0f2;border-radius:14px">
      <div style="font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em">${esc(label)}</div>
      <div style="font-size:19px;font-weight:700;margin-top:5px">${esc(d.classTitle || "Les")}</div>
      ${when ? `<div style="color:#6b7280;margin-top:3px;font-size:16px">${esc(when)}</div>` : ""}
    </div>`;
  // Assemble a matching plain-text body (a real multipart e-mail inboxes far better than HTML-only).
  const txt = (heading: string, lines: (string | false)[]) => [heading, ...lines.filter(Boolean), `— ${studio}`].join("\n\n");

  if (kind === "test") {
    return {
      subject: `Test e-mail van ${studio}`, fromName: studio,
      html: shell(b, "Test geslaagd ✓", `<p style="margin:0 0 14px">Dit is een testmail van <b>${esc(studio)}</b>. De e-mailkoppeling werkt — automatische e-mails worden vanaf dit adres verstuurd. 🎉</p>`),
      text: txt("Test geslaagd", [`Dit is een testmail van ${studio}. De e-mailkoppeling werkt.`]),
    };
  }

  const c = (b.copy && b.copy[kind]) || defaultBrand(studio).copy[kind];
  const greet = d.name ? `Hoi ${d.name},` : "";
  const detailTxt = (label: string) => `${label}: ${d.classTitle || "Les"}${when ? " — " + when : ""}`;
  let body = hi + `<p style="margin:0 0 14px">${esc(c.intro)}</p>`;
  let subject: string;
  const tlines: (string | false)[] = [!!greet && greet, c.intro];
  if (kind === "promoted") { subject = `Je hebt een plek: ${d.classTitle || "les"}`; body += detail("Jouw les"); tlines.push(detailTxt("Jouw les")); }
  else if (kind === "booking") { subject = `Boeking bevestigd: ${d.classTitle || "les"}`; body += detail("Jouw les"); tlines.push(detailTxt("Jouw les")); }
  else if (kind === "cancel") { subject = `Boeking geannuleerd: ${d.classTitle || "les"}`; body += detail("Geannuleerd"); tlines.push(detailTxt("Geannuleerd")); }
  else if (kind === "welcome") { subject = `Welkom bij ${studio} 💜`; }
  else if (kind === "reset") {
    subject = `Nieuw wachtwoord voor ${studio}`;
    body += `<div style="margin:20px 0;padding:18px 20px;background:#f9fafb;border:1px solid #eef0f2;border-radius:14px;text-align:center"><div style="font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em">Je nieuwe wachtwoord</div><div style="font-size:26px;font-weight:800;letter-spacing:2px;margin-top:6px;color:${b.accent || "#7a00df"}">${esc(d.password || "")}</div></div>`;
    tlines.push(`Je nieuwe wachtwoord: ${d.password || ""}`);
  }
  else { subject = `Herinnering: ${d.classTitle || "je les"} morgen`; body += detail("Jouw les — morgen"); tlines.push(detailTxt("Jouw les — morgen")); }
  // Online / hybride: include the meeting link + extra info in booking / promotion / reminder mails.
  const isOnline = d.mode === "online" || d.mode === "hybride" || !!d.onlineLink;
  if ((kind === "booking" || kind === "promoted" || kind === "reminder") && isOnline && d.onlineLink) {
    const ac = b.accent || "#7a00df";
    body += `<div style="margin:18px 0;padding:18px 20px;background:color-mix(in srgb,${ac} 8%,#fff);border:1px solid ${ac};border-radius:14px">` +
      `<div style="font-size:12px;color:${ac};text-transform:uppercase;letter-spacing:.06em;font-weight:700">Online deelnemen${d.mode === "hybride" ? " (hybride)" : ""}</div>` +
      `<a href="${esc(d.onlineLink)}" style="display:inline-block;margin:10px 0 4px;background:${ac};color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:10px">▶ Open de online les</a>` +
      `<div style="font-size:13px;color:#6b7280;word-break:break-all">${esc(d.onlineLink)}</div>` +
      (d.onlineInfo ? `<div style="margin-top:8px;font-size:14px;color:#374151">${esc(d.onlineInfo).replace(/\r?\n/g, "<br>")}</div>` : "") + `</div>`;
    tlines.push(`Online deelnemen: ${d.onlineLink}${d.onlineInfo ? " — " + d.onlineInfo : ""}`);
  }
  if (c.outro) { body += `<p style="margin:18px 0 0">${esc(c.outro)}</p>`; tlines.push(c.outro); }
  return { subject, fromName: studio, html: shell(b, c.heading, body), text: txt(c.heading, tlines) };
}

/** Send one e-mail for a project (loads the studio's branding). No-op if no SMTP configured. */
export async function sendBookingEmail(projectId: number, to: string, kind: EmailKind, d: EmailData): Promise<boolean> {
  const cfg = await resolveSmtpConfig(projectId);
  if (!cfg || !to) return false;
  const brand = await loadBrand(projectId);
  const { subject, html, text, fromName } = buildEmail(kind, d, brand);
  await sendMail(cfg, { to, subject, html, text, fromName });
  return true;
}

/** Send with an explicit config + optional brand (used by the "test connection" flow). */
export async function sendWithConfig(cfg: SmtpConfig, to: string, kind: EmailKind, d: EmailData, brand?: EmailBrand): Promise<void> {
  const { subject, html, text, fromName } = buildEmail(kind, d, brand);
  await sendMail(cfg, { to, subject, html, text, fromName });
}

/** Payment confirmation + invoice (separate from the booking confirmation). */
export async function sendPaymentEmail(projectId: number, to: string, invoiceHtml: string, invoiceNumber: string, pdfBase64?: string): Promise<boolean> {
  const cfg = await resolveSmtpConfig(projectId);
  if (!cfg || !to) return false;
  const brand = (await loadBrand(projectId)) || defaultBrand("onze studio");
  const note = pdfBase64 ? `<p style="margin:14px 0 0;color:#374151;font-size:14px">📎 Je factuur (PDF) zit als bijlage bij deze e-mail.</p>` : "";
  const body = `<p style="margin:0 0 14px">Bedankt voor je betaling! Hieronder vind je je betaalbevestiging en factuur.</p>${invoiceHtml}${note}<p style="margin:16px 0 0;color:#6b7280;font-size:14px">Bewaar deze e-mail als bewijs van betaling.</p>`;
  const html = shell(brand, "Betaalbevestiging ✅", body);
  await sendMail(cfg, {
    to, subject: `Betaalbevestiging & factuur ${invoiceNumber} — ${brand.studio}`, html,
    text: `Betaalbevestiging — factuur ${invoiceNumber} van ${brand.studio}. De factuur zit als PDF in de bijlage.`,
    fromName: brand.studio,
    attachments: pdfBase64 ? [{ filename: `factuur-${invoiceNumber}.pdf`, content: pdfBase64, contentType: "application/pdf" }] : undefined,
  });
  return true;
}

/** Account-activation e-mail for the Mindbody migration (studio is switching booking systems). */
export async function sendActivationEmail(projectId: number, to: string, firstName: string, activationUrl: string): Promise<boolean> {
  const cfg = await resolveSmtpConfig(projectId);
  if (!cfg || !to) return false;
  const brand = (await loadBrand(projectId)) || defaultBrand("onze studio");
  const ac = brand.accent || "#7a00df";
  const hi = firstName ? `Hi ${esc(firstName)},` : "Hi,";
  const body =
    `<p style="margin:0 0 14px">${hi}</p>` +
    `<p style="margin:0 0 14px"><b>${esc(brand.studio)}</b> stapt over naar een nieuw boekingssysteem.</p>` +
    `<p style="margin:0 0 14px">Maak je account aan met <b>exact dit e-mailadres</b>: ${esc(to)}.<br>Na activatie staat je huidige strippenkaart of abonnement meteen in je account.</p>` +
    `<p style="margin:18px 0"><a href="${esc(activationUrl)}" style="display:inline-block;background:${ac};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">Activeer je account</a></p>` +
    `<p style="margin:0;color:#6b7280;font-size:13px">Werkt de knop niet? Open deze link: ${esc(activationUrl)}</p>`;
  await sendMail(cfg, { to, subject: `Activeer je account bij ${brand.studio}`, html: shell(brand, `Welkom bij ${brand.studio}`, body), text: `${hi}\n\n${brand.studio} stapt over naar een nieuw boekingssysteem. Activeer je account (e-mail: ${to}): ${activationUrl}`, fromName: brand.studio });
  return true;
}

/** "Bericht naar leden": an admin-written subject + body, sent branded to many recipients. */
export async function sendBroadcast(projectId: number, recipients: string[], subject: string, body: string): Promise<{ configured: boolean; sent: number; total: number }> {
  const cfg = await resolveSmtpConfig(projectId);
  if (!cfg) return { configured: false, sent: 0, total: recipients.length };
  const brand = (await loadBrand(projectId)) || defaultBrand("onze studio");
  const safe = esc(body).replace(/\r?\n/g, "<br>");
  const html = shell(brand, subject, `<div>${safe}</div>`);
  const text = `${subject}\n\n${body}\n\n— ${brand.studio}`;
  let sent = 0;
  for (const to of recipients) {
    try { await sendMail(cfg, { to, subject, html, text, fromName: brand.studio }); sent++; } catch { /* skip a bad address, keep going */ }
  }
  return { configured: true, sent, total: recipients.length };
}
