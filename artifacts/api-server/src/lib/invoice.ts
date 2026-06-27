/**
 * Invoicing: per-studio invoice details (company, KvK, BTW…), a unique sequential invoice number
 * (year-NNNN), and a legally-compliant invoice rendered as HTML (BTW breakdown, customer, status).
 */
import { db, projectInvoice, invoices } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { buildPdf, type PdfItem } from "./pdf.js";

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Per-country invoice config: currency + the local name for the tax, registration number and tax-ID.
// KvK is Netherlands-only; the UK uses a Companies-House company number + VAT reg. no.; the US has no
// VAT at all — an EIN identifies the business and sales tax (if any) varies by state.
type CountryCfg = {
  currency: string; symbol: string; decimal: "," | "."; docTitle: string;
  taxLabel: string; regLabel: string; taxIdLabel: string; defaultTax: number; paidLabel: string;
  t: { from: string; to: string; desc: string; amount: string; subtotal: string; totalDue: string; method: string; status: string; number: string; date: string; invoiceTo: string; customer: string; fillIn: string };
};
const EN_T = { from: "From", to: "To", desc: "Description", amount: "Amount", subtotal: "Subtotal excl. tax", totalDue: "Total due", method: "Payment method", status: "Status", number: "No.", date: "Date", invoiceTo: "Invoice to:", customer: "Customer", fillIn: "Add your business details" };
export const COUNTRIES: Record<string, CountryCfg> = {
  NL: { currency: "EUR", symbol: "€", decimal: ",", docTitle: "Factuur", taxLabel: "BTW", regLabel: "KvK", taxIdLabel: "BTW-nummer", defaultTax: 21, paidLabel: "Betaald",
    t: { from: "Van", to: "Aan", desc: "Omschrijving", amount: "Bedrag", subtotal: "Subtotaal excl. BTW", totalDue: "Totaal te betalen", method: "Betaalmethode", status: "Status", number: "Nr.", date: "Datum", invoiceTo: "Factuur aan:", customer: "Klant", fillIn: "Vul je bedrijfsgegevens in" } },
  UK: { currency: "GBP", symbol: "£", decimal: ".", docTitle: "Invoice", taxLabel: "VAT", regLabel: "Company no.", taxIdLabel: "VAT reg. no.", defaultTax: 20, paidLabel: "Paid",
    t: { ...EN_T, subtotal: "Subtotal excl. VAT" } },
  US: { currency: "USD", symbol: "$", decimal: ".", docTitle: "Invoice", taxLabel: "Sales tax", regLabel: "EIN", taxIdLabel: "Tax ID", defaultTax: 0, paidLabel: "Paid",
    t: { ...EN_T } },
};
export function countryCfg(country?: string): CountryCfg { return COUNTRIES[String(country || "NL").toUpperCase()] || COUNTRIES.NL; }
const money = (n: number, c: CountryCfg) => { const s = (Math.round(n * 100) / 100).toFixed(2); return c.symbol + (c.decimal === "," ? s.replace(".", ",") : s); };

export type InvoiceSettings = {
  company: string; address: string; postcode: string; city: string;
  country: string; currency: string;
  kvk: string; vat: string; vatPercent: number; email: string; phone: string;
};
const EMPTY: InvoiceSettings = { company: "", address: "", postcode: "", city: "", country: "NL", currency: "EUR", kvk: "", vat: "", vatPercent: 21, email: "", phone: "" };

export async function getInvoiceSettings(projectId: number): Promise<InvoiceSettings & { configured: boolean }> {
  const [r] = await db.select().from(projectInvoice).where(eq(projectInvoice.projectId, projectId));
  if (!r) return { ...EMPTY, configured: false };
  return { company: r.company, address: r.address, postcode: r.postcode, city: r.city, country: r.country || "NL", currency: r.currency || "EUR", kvk: r.kvk, vat: r.vat, vatPercent: r.vatPercent, email: r.email, phone: r.phone, configured: !!r.company };
}

export async function saveInvoiceSettings(projectId: number, s: Partial<InvoiceSettings>): Promise<void> {
  const country = (COUNTRIES[String(s.country || "NL").toUpperCase()] ? String(s.country).toUpperCase() : "NL");
  const c = COUNTRIES[country];
  // Allow a 0% rate (US services are often untaxed) — only fall back to the country default when unset/NaN.
  const vpNum = Number(s.vatPercent);
  const vatPercent = Number.isFinite(vpNum) ? Math.max(0, Math.min(99, Math.round(vpNum))) : c.defaultTax;
  const set = {
    company: String(s.company ?? "").trim(), address: String(s.address ?? "").trim(),
    postcode: String(s.postcode ?? "").trim(), city: String(s.city ?? "").trim(),
    country, currency: c.currency,
    kvk: String(s.kvk ?? "").trim(), vat: String(s.vat ?? "").trim(), vatPercent,
    email: String(s.email ?? "").trim(), phone: String(s.phone ?? "").trim(), updatedAt: new Date(),
  };
  await db.insert(projectInvoice).values({ projectId, ...set }).onConflictDoUpdate({ target: projectInvoice.projectId, set });
}

/** Next unique invoice number for this studio: <year>-<NNNN>, no duplicates. */
async function nextNumber(projectId: number): Promise<string> {
  const year = new Date().getFullYear();
  const all = await db.select().from(invoices).where(eq(invoices.projectId, projectId));
  const seq = all.filter((i) => i.number.startsWith(year + "-")).length + 1;
  let num = `${year}-${String(seq).padStart(4, "0")}`;
  // Guard against a rare collision.
  while (all.some((i) => i.number === num)) num = `${year}-${String(parseInt(num.split("-")[1], 10) + 1).padStart(4, "0")}`;
  return num;
}

export type InvoiceRow = typeof invoices.$inferSelect;

/** Create + store an invoice for a payment. Returns the stored row. */
export async function createInvoice(projectId: number, p: { customerName: string; customerEmail: string; description: string; total: number; method?: string; status?: string }): Promise<InvoiceRow> {
  const s = await getInvoiceSettings(projectId);
  const number = await nextNumber(projectId);
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  const c = countryCfg(s.country);
  const [row] = await db.insert(invoices).values({
    projectId, number, date, customerName: p.customerName || "", customerEmail: p.customerEmail || "",
    description: p.description || "Aankoop", total: Math.round((p.total || 0) * 100) / 100, vatPercent: s.vatPercent,
    country: s.country || "NL", currency: c.currency, method: p.method || "Stripe", status: p.status || c.paidLabel,
  }).returning();
  return row;
}

/** Legally-compliant invoice as HTML (studio + KvK/BTW, number, customer, BTW breakdown, total). */
export function renderInvoiceHtml(s: InvoiceSettings, inv: InvoiceRow): string {
  const c = countryCfg(inv.country || s.country);
  const eur = (n: number) => money(n, c);
  const vp = inv.vatPercent || 0;
  const excl = vp > 0 ? inv.total / (1 + vp / 100) : inv.total;
  const vat = inv.total - excl;
  const studioLine = [s.company, s.address, [s.postcode, s.city].filter(Boolean).join(" ")].filter(Boolean).map(esc).join("<br>");
  const ids = [s.kvk ? c.regLabel + ": " + esc(s.kvk) : "", (s.vat && c.taxIdLabel) ? c.taxIdLabel + ": " + esc(s.vat) : ""].filter(Boolean).join(" &nbsp;·&nbsp; ");
  const taxRows = vp > 0
    ? `<tr><td style="padding:4px 0;color:#6b7280">${c.t.subtotal}</td><td style="padding:4px 0;text-align:right">${eur(excl)}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">${c.taxLabel} ${vp}%</td><td style="padding:4px 0;text-align:right">${eur(vat)}</td></tr>`
    : "";
  return `<table role="presentation" width="100%" style="border-collapse:collapse;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937;font-size:14px;border:1px solid #e6e8ec;border-radius:12px;overflow:hidden">
  <tr><td style="padding:20px 22px;background:#f9fafb;border-bottom:1px solid #eef0f2">
    <div style="font-size:18px;font-weight:800">${esc(c.docTitle)}</div>
    <div style="color:#6b7280;margin-top:2px">${c.t.number} <b>${esc(inv.number)}</b> · ${esc(inv.date)}</div>
  </td></tr>
  <tr><td style="padding:18px 22px">
    <table role="presentation" width="100%"><tr>
      <td style="vertical-align:top;width:50%">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af">${c.t.from}</div>
        <div style="margin-top:4px">${studioLine || `<i>${c.t.fillIn}</i>`}</div>
        ${ids ? `<div style="color:#6b7280;margin-top:4px">${ids}</div>` : ""}
      </td>
      <td style="vertical-align:top;width:50%">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af">${c.t.to}</div>
        <div style="margin-top:4px">${esc(inv.customerName || c.t.customer)}<br>${esc(inv.customerEmail || "")}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 22px 8px">
    <table role="presentation" width="100%" style="border-collapse:collapse">
      <tr style="border-bottom:1px solid #eef0f2"><td style="padding:8px 0;color:#6b7280">${c.t.desc}</td><td style="padding:8px 0;text-align:right;color:#6b7280">${c.t.amount}</td></tr>
      <tr><td style="padding:10px 0">${esc(inv.description)}</td><td style="padding:10px 0;text-align:right">${eur(excl)}</td></tr>
      ${taxRows}
      <tr style="border-top:2px solid #1f2937"><td style="padding:10px 0;font-weight:800">${c.t.totalDue}</td><td style="padding:10px 0;text-align:right;font-weight:800">${eur(inv.total)}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:6px 22px 20px;color:#6b7280">
    ${c.t.method}: <b>${esc(inv.method)}</b> &nbsp;·&nbsp; ${c.t.status}: <b style="color:#047857">${esc(inv.status)}</b>
  </td></tr>
</table>`;
}

/** Full standalone, print-optimised invoice page with a "Download als PDF" button (browser print). */
export function renderInvoiceDocument(s: InvoiceSettings, inv: InvoiceRow, autoPrint = false): string {
  const c = countryCfg(inv.country || s.country);
  return `<!DOCTYPE html><html lang="${c.currency === "EUR" ? "nl" : "en"}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.docTitle)} ${esc(inv.number)}</title>
<style>
body{margin:0;background:#f3f4f6;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;padding:24px;color:#1f2937}
.bar{max-width:720px;margin:0 auto 14px;display:flex;justify-content:space-between;align-items:center}
.bar .btn{background:#111827;color:#fff;border:0;border-radius:10px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer}
.sheet{max-width:720px;margin:0 auto}
@media print{body{background:#fff;padding:0}.bar{display:none}}
</style></head>
<body>
<div class="bar"><div style="font-weight:700">${esc(c.docTitle)} ${esc(inv.number)}</div><button class="btn" onclick="window.print()">⬇ ${c.currency === "EUR" ? "Download als PDF" : "Download as PDF"}</button></div>
<div class="sheet">${renderInvoiceHtml(s, inv)}</div>
${autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},400);});<\/script>' : ""}
</body></html>`;
}

export async function listInvoices(projectId: number): Promise<InvoiceRow[]> {
  const rows = await db.select().from(invoices).where(eq(invoices.projectId, projectId));
  return rows.reverse();
}

/** The invoice as a real downloadable PDF (Buffer). */
export function renderInvoicePdf(s: InvoiceSettings, inv: InvoiceRow): Buffer {
  const c = countryCfg(inv.country || s.country);
  const eur = (n: number) => c.symbol + " " + ((Math.round(n * 100) / 100).toFixed(2).replace(".", c.decimal === "," ? "," : "."));
  const vp = inv.vatPercent || 0;
  const excl = vp > 0 ? inv.total / (1 + vp / 100) : inv.total;
  const vat = inv.total - excl;
  const L: PdfItem[] = [];
  const text = (t: string, x: number, y: number, size = 11, bold = false, color?: [number, number, number]) => L.push({ text: t, x, y, size, bold, color });
  const grey: [number, number, number] = [0.42, 0.45, 0.5];
  text(c.docTitle.toUpperCase(), 50, 70, 24, true);
  text(c.t.number + " " + inv.number, 50, 92, 11, false, grey);
  text(c.t.date + ": " + inv.date, 50, 108, 11, false, grey);
  // Studio (right column)
  let y = 70;
  [s.company, s.address, [s.postcode, s.city].filter(Boolean).join(" "), s.kvk ? c.regLabel + ": " + s.kvk : "", (s.vat && c.taxIdLabel) ? c.taxIdLabel + ": " + s.vat : ""]
    .filter(Boolean).forEach((line) => { text(line, 330, y, 11, line === s.company); y += 16; });
  // Klant
  text(c.t.invoiceTo, 50, 150, 10, false, grey);
  text(inv.customerName || c.t.customer, 50, 167, 12, true);
  if (inv.customerEmail) text(inv.customerEmail, 50, 183, 11, false, grey);
  // Tabel
  L.push({ rule: true, x1: 50, x2: 545, y: 210 });
  text(c.t.desc, 50, 226, 10, false, grey);
  text(c.t.amount, 470, 226, 10, false, grey);
  text(inv.description, 50, 250, 12);
  text(eur(excl), 470, 250, 12);
  L.push({ rule: true, x1: 50, x2: 545, y: 268 });
  let ty = 290;
  if (vp > 0) { text(c.t.subtotal, 330, ty); text(eur(excl), 470, ty); ty += 20; text(c.taxLabel + " " + vp + "%", 330, ty); text(eur(vat), 470, ty); ty += 12; }
  L.push({ rule: true, x1: 330, x2: 545, y: ty });
  text(c.t.totalDue, 330, ty + 22, 13, true); text(eur(inv.total), 470, ty + 22, 13, true);
  text(c.t.method + ": " + inv.method, 50, ty + 70, 11, false, grey);
  text(c.t.status + ": " + inv.status, 50, ty + 88, 11, false, [0.02, 0.47, 0.34]);
  return buildPdf(L);
}

export async function getInvoice(projectId: number, id: number): Promise<InvoiceRow | null> {
  const [r] = await db.select().from(invoices).where(and(eq(invoices.projectId, projectId), eq(invoices.id, id)));
  return r ?? null;
}

// All invoices created within the last `months` months (1–12), newest first.
export async function listInvoicesSince(projectId: number, months: number): Promise<InvoiceRow[]> {
  const m = Math.min(12, Math.max(1, Math.floor(months) || 12));
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - m); cutoff.setHours(0, 0, 0, 0);
  const rows = await db.select().from(invoices).where(eq(invoices.projectId, projectId));
  return rows.filter((r) => r.createdAt && new Date(r.createdAt) >= cutoff).reverse();
}

const xmlEsc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/**
 * Export invoices as a real Excel file using SpreadsheetML 2003 (a single .xls XML document that
 * Excel/Numbers/LibreOffice open natively as a spreadsheet) — no third-party dependency needed.
 */
export function renderInvoicesXls(s: InvoiceSettings, rows: InvoiceRow[]): string {
  const headers = ["Nummer", "Datum", "Klant", "E-mail", "Omschrijving", "Bedrag incl.", "BTW %", "BTW-bedrag", "Bedrag excl.", "Valuta", "Methode", "Status"];
  const cellS = (v: unknown) => `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
  const cellN = (v: number, style?: string) => `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="Number">${Math.round((Number(v) || 0) * 100) / 100}</Data></Cell>`;
  let total = 0;
  const dataRows = rows.map((inv) => {
    const vp = inv.vatPercent || 0;
    const excl = vp > 0 ? inv.total / (1 + vp / 100) : inv.total;
    const vat = inv.total - excl;
    total += inv.total || 0;
    return "<Row>" + cellS(inv.number) + cellS(inv.date) + cellS(inv.customerName) + cellS(inv.customerEmail) + cellS(inv.description)
      + cellN(inv.total, "money") + cellN(vp) + cellN(vat, "money") + cellN(excl, "money") + cellS(inv.currency || s.currency || "EUR") + cellS(inv.method) + cellS(inv.status) + "</Row>";
  }).join("");
  const headerRow = "<Row>" + headers.map((h) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join("") + "</Row>";
  const totalRow = "<Row>" + cellS("") + cellS("") + cellS("") + cellS("") + `<Cell ss:StyleID="hdr"><Data ss:Type="String">Totaal</Data></Cell>` + cellN(total, "moneyB") + "</Row>";
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EFEFEF" ss:Pattern="Solid"/></Style>
  <Style ss:ID="money"><NumberFormat ss:Format="#,##0.00"/></Style>
  <Style ss:ID="moneyB"><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0.00"/></Style>
 </Styles>
 <Worksheet ss:Name="Facturen">
  <Table>${headerRow}${dataRows}${totalRow}</Table>
 </Worksheet>
</Workbook>`;
}

/**
 * BTW/VAT report: invoices grouped per VAT rate with taxable base (excl.), VAT amount and total
 * (incl.) — what a studio needs to prepare a VAT return. Real Excel (.xls SpreadsheetML).
 */
export function renderVatReportXls(s: InvoiceSettings, rows: InvoiceRow[], periodLabel: string): string {
  const byRate: Record<number, { count: number; incl: number; excl: number; vat: number }> = {};
  for (const inv of rows) {
    const vp = inv.vatPercent || 0;
    const excl = vp > 0 ? inv.total / (1 + vp / 100) : inv.total;
    const g = (byRate[vp] ||= { count: 0, incl: 0, excl: 0, vat: 0 });
    g.count++; g.incl += inv.total; g.excl += excl; g.vat += inv.total - excl;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const headers = ["BTW-tarief", "Aantal facturen", "Grondslag (excl. btw)", "BTW-bedrag", "Totaal (incl. btw)"];
  const headerRow = "<Row>" + headers.map((h) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join("") + "</Row>";
  const sN = (v: number, st?: string) => `<Cell${st ? ` ss:StyleID="${st}"` : ""}><Data ss:Type="Number">${r2(v)}</Data></Cell>`;
  const sStr = (v: string, st?: string) => `<Cell${st ? ` ss:StyleID="${st}"` : ""}><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
  let tc = 0, ti = 0, te = 0, tv = 0;
  const dataRows = Object.keys(byRate).map(Number).sort((a, b) => a - b).map((vp) => {
    const g = byRate[vp]; tc += g.count; ti += g.incl; te += g.excl; tv += g.vat;
    return "<Row>" + sStr(vp + "%") + sN(g.count) + sN(g.excl, "money") + sN(g.vat, "money") + sN(g.incl, "money") + "</Row>";
  }).join("");
  const totalRow = "<Row>" + `<Cell ss:StyleID="hdr"><Data ss:Type="String">Totaal</Data></Cell>` + sN(tc, "hdr") + sN(te, "moneyB") + sN(tv, "moneyB") + sN(ti, "moneyB") + "</Row>";
  const title = "<Row>" + sStr("BTW-overzicht — " + periodLabel, "hdr") + "</Row><Row></Row>";
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EFEFEF" ss:Pattern="Solid"/></Style>
  <Style ss:ID="money"><NumberFormat ss:Format="#,##0.00"/></Style>
  <Style ss:ID="moneyB"><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0.00"/></Style>
 </Styles>
 <Worksheet ss:Name="BTW-overzicht">
  <Table>${title}${headerRow}${dataRows}${totalRow}</Table>
 </Worksheet>
</Workbook>`;
}

/** Teacher payout overview: classes given + bookings + attendance per teacher, optional payout. */
export function renderTeacherPayoutXls(rows: { teacher: string; email: string; classes: number; bookings: number; present: number }[], periodLabel: string, rate: number): string {
  const withRate = rate > 0;
  const headers = ["Docent", "E-mail", "Aantal lessen", "Boekingen", "Aanwezig"].concat(withRate ? ["Tarief/les", "Uitbetaling"] : []);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const headerRow = "<Row>" + headers.map((h) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join("") + "</Row>";
  const sN = (v: number, st?: string) => `<Cell${st ? ` ss:StyleID="${st}"` : ""}><Data ss:Type="Number">${r2(v)}</Data></Cell>`;
  const sStr = (v: string, st?: string) => `<Cell${st ? ` ss:StyleID="${st}"` : ""}><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
  let tc = 0, tb = 0, tp = 0, tpay = 0;
  const dataRows = rows.map((r) => {
    tc += r.classes; tb += r.bookings; tp += r.present; const pay = r.classes * rate; tpay += pay;
    return "<Row>" + sStr(r.teacher || r.email) + sStr(r.email) + sN(r.classes) + sN(r.bookings) + sN(r.present) + (withRate ? sN(rate, "money") + sN(pay, "money") : "") + "</Row>";
  }).join("");
  const totalRow = "<Row>" + `<Cell ss:StyleID="hdr"><Data ss:Type="String">Totaal</Data></Cell>` + sStr("") + sN(tc, "hdr") + sN(tb, "hdr") + sN(tp, "hdr") + (withRate ? sStr("") + sN(tpay, "moneyB") : "") + "</Row>";
  const title = "<Row>" + sStr("Docenten-uitbetaling — " + periodLabel, "hdr") + "</Row><Row></Row>";
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EFEFEF" ss:Pattern="Solid"/></Style>
  <Style ss:ID="money"><NumberFormat ss:Format="#,##0.00"/></Style>
  <Style ss:ID="moneyB"><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0.00"/></Style>
 </Styles>
 <Worksheet ss:Name="Docenten">
  <Table>${title}${headerRow}${dataRows}${totalRow}</Table>
 </Worksheet>
</Workbook>`;
}
