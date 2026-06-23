/**
 * Tiny dependency-free PDF generator: lays out positioned text lines on a single A4 page using the
 * built-in Helvetica fonts (no font embedding needed). Enough for a clean invoice. PDF is a text
 * format, so we assemble objects + an xref table by hand and return the bytes as a Buffer.
 */
export type PdfLine = { text: string; x: number; y: number; size?: number; bold?: boolean; color?: [number, number, number] };
export type PdfRule = { rule: true; x1: number; x2: number; y: number };
export type PdfItem = PdfLine | PdfRule;

const A4_W = 595, A4_H = 842;

// Escape a string to a PDF literal using WinAnsi bytes (handles €, accents, and (){\}).
function pdfStr(s: string): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    let code = ch.codePointAt(0) ?? 63;
    if (ch === "€") code = 0x80;
    else if (ch === "–" || ch === "—") code = 0x2d, (out += "-"), (code = -1); // dash → hyphen
    if (code === -1) continue;
    if (code > 0xff) { out += "?"; continue; }
    if (ch === "(") out += "\\(";
    else if (ch === ")") out += "\\)";
    else if (ch === "\\") out += "\\\\";
    else if (code < 32 || code > 126) out += "\\" + code.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out;
}

export function buildPdf(items: PdfItem[]): Buffer {
  const parts: string[] = [];
  for (const it of items) {
    if ((it as PdfRule).rule) {
      const r = it as PdfRule;
      parts.push(`0.85 0.85 0.87 RG 0.7 w ${r.x1} ${A4_H - r.y} m ${r.x2} ${A4_H - r.y} l S`);
    } else {
      const l = it as PdfLine;
      const f = l.bold ? "/F2" : "/F1";
      const size = l.size || 11;
      const c = l.color ? `${l.color[0]} ${l.color[1]} ${l.color[2]} rg` : "0 0 0 rg";
      parts.push(`${c} BT ${f} ${size} Tf ${l.x} ${A4_H - l.y} Td (${pdfStr(l.text)}) Tj ET`);
    }
  }
  const content = parts.join("\n");
  const objs: string[] = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`);
  objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, "latin1")); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += String(off).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
