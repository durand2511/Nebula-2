/**
 * Minimal SMTP client (no dependency) for sending transactional e-mail over the studio's own
 * SMTP server. Supports implicit TLS (port 465) and STARTTLS (587/25) with AUTH LOGIN.
 * Good enough for booking confirmations/reminders; not a full mail library.
 */
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

export type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string; secure?: boolean };
export type Attachment = { filename: string; content: string /* base64 */; contentType: string };
export type Mail = { to: string; subject: string; html: string; text?: string; fromName?: string; attachments?: Attachment[] };

function b64(s: string) { return Buffer.from(s, "utf8").toString("base64"); }
// RFC 2047 encoded-word for headers with non-ASCII (e.g. accented studio names).
function encodeHeader(s: string): string { return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64(s) + "?="; }

// Wrap a socket so we can write a command and await its (possibly multi-line) SMTP reply.
function conn(sock: net.Socket | tls.TLSSocket) {
  let buf = "";
  let waiter: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void } | null = null;
  const complete = () => {
    const m = buf.match(/^(?:\d{3}-[^\r\n]*\r\n)*(\d{3}) [^\r\n]*\r\n/);
    if (m && waiter) { const w = waiter; waiter = null; const out = { code: parseInt(m[1], 10), text: buf }; buf = ""; w.resolve(out); }
  };
  sock.on("data", (d) => { buf += d.toString("utf8"); complete(); });
  sock.on("error", (e) => { if (waiter) { waiter.reject(e); waiter = null; } });
  return {
    read(): Promise<{ code: number; text: string }> { return new Promise((resolve, reject) => { waiter = { resolve, reject }; complete(); }); },
    send(line: string) { sock.write(line + "\r\n"); return this.read(); },
    write(data: string) { sock.write(data); },
    raw: sock,
  };
}

function expect(r: { code: number; text: string }, ok: number | number[]) {
  const list = Array.isArray(ok) ? ok : [ok];
  if (!list.includes(r.code)) throw new Error("SMTP " + r.code + ": " + r.text.trim().slice(0, 140));
}

export async function sendMail(cfg: SmtpConfig, mail: Mail): Promise<void> {
  const secure = cfg.secure ?? cfg.port === 465;
  await new Promise<void>((resolve, reject) => {
    const fail = (e: Error) => reject(e);
    const onReady = async (c: ReturnType<typeof conn>) => {
      try {
        await c.send("AUTH LOGIN").then((r) => expect(r, 334));
        await c.send(b64(cfg.user)).then((r) => expect(r, 334));
        await c.send(b64(cfg.pass)).then((r) => expect(r, 235));
        const fromAddr = (cfg.from.match(/<([^>]+)>/) ?? [, cfg.from])[1];
        const fromHeader = mail.fromName ? encodeHeader(mail.fromName) + " <" + fromAddr + ">" : cfg.from;
        const domain = (fromAddr.split("@")[1] || "localhost");
        await c.send("MAIL FROM:<" + fromAddr + ">").then((r) => expect(r, 250));
        await c.send("RCPT TO:<" + mail.to + ">").then((r) => expect(r, [250, 251]));
        await c.send("DATA").then((r) => expect(r, 354));
        // Proper, non-spammy headers: real Message-ID, Reply-To, friendly From name, List-Unsubscribe.
        const stuff = (s: string) => s.replace(/\r?\n/g, "\r\n").replace(/\r\n\./g, "\r\n..");
        const hasAtt = !!(mail.attachments && mail.attachments.length);
        let headers =
          "From: " + fromHeader + "\r\n" +
          "To: " + mail.to + "\r\n" +
          "Reply-To: " + fromHeader + "\r\n" +
          "Subject: " + encodeHeader(mail.subject) + "\r\n" +
          "Message-ID: <" + crypto.randomBytes(16).toString("hex") + "@" + domain + ">\r\n" +
          "Date: " + new Date().toUTCString() + "\r\n" +
          "List-Unsubscribe: <mailto:" + fromAddr + "?subject=unsubscribe>\r\n" +
          "MIME-Version: 1.0\r\n";
        let bodyMsg: string;
        if (hasAtt) {
          // multipart/mixed: the HTML body + each attachment (base64, wrapped at 76 chars).
          const bnd = "mix_" + crypto.randomBytes(12).toString("hex");
          headers += `Content-Type: multipart/mixed; boundary="${bnd}"\r\n\r\n`;
          let m = `--${bnd}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${stuff(mail.html)}\r\n`;
          for (const att of mail.attachments!) {
            const b64 = (att.content.match(/.{1,76}/g) || []).join("\r\n");
            m += `--${bnd}\r\nContent-Type: ${att.contentType}; name="${att.filename}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${att.filename}"\r\n\r\n${b64}\r\n`;
          }
          m += `--${bnd}--`;
          bodyMsg = m;
        } else {
          headers += "Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n";
          bodyMsg = stuff(mail.html);
        }
        c.write(headers + bodyMsg + "\r\n.\r\n");
        await c.read().then((r) => expect(r, 250));
        c.send("QUIT").catch(() => {});
        try { c.raw.end(); } catch { /* ignore */ }
        resolve();
      } catch (e) { try { c.raw.end(); } catch { /* ignore */ } reject(e as Error); }
    };

    if (secure) {
      const sock = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, async () => {
        const c = conn(sock);
        try { expect(await c.read(), 220); expect(await c.send("EHLO booking"), 250); await onReady(c); } catch (e) { fail(e as Error); }
      });
      sock.setTimeout(15000, () => { sock.destroy(); fail(new Error("SMTP timeout")); });
      sock.on("error", fail);
    } else {
      const sock = net.connect({ host: cfg.host, port: cfg.port }, async () => {
        const c = conn(sock);
        try {
          expect(await c.read(), 220);
          expect(await c.send("EHLO booking"), 250);
          expect(await c.send("STARTTLS"), 220);
          const tsock = tls.connect({ socket: sock, servername: cfg.host }, async () => {
            const tc = conn(tsock);
            try { expect(await tc.send("EHLO booking"), 250); await onReady(tc); } catch (e) { fail(e as Error); }
          });
          tsock.on("error", fail);
        } catch (e) { fail(e as Error); }
      });
      sock.setTimeout(15000, () => { sock.destroy(); fail(new Error("SMTP timeout")); });
      sock.on("error", fail);
    }
  });
}

/** Read SMTP config from env; returns null if not (fully) configured. */
export function smtpConfigFromEnv(): SmtpConfig | null {
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !from) return null;
  return { host, port: Number(process.env.SMTP_PORT || 587), user, pass, from, secure: process.env.SMTP_SECURE === "true" };
}
