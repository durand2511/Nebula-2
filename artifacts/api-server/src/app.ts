import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import router from "./routes";
import { logger } from "./lib/logger";
import { isReserved, findByHost, normalizeHost, PLATFORM_HOST, SEO_REDIRECT_HOSTS } from "./lib/domains";
import { serveProjectSite, projectHasPage } from "./lib/host-site";
import { db, projectEmail } from "@workspace/db";
import { desc } from "drizzle-orm";
import { sendMail, smtpConfigFromEnv, type SmtpConfig } from "./lib/smtp.js";
import { decryptSecret } from "./lib/email-config.js";
import { kennisbankRouter } from "./lib/kennisbank.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

// Real client IP (behind Render/Cloudflare the socket IP is the proxy, so use the forwarded header).
function realIp(req: express.Request): string {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.ip || req.socket?.remoteAddress || "";
}

// Honeypot pages (no real stack revealed). The GIFs are served for ANY host below, so they work on
// customer domains (senszenjoy.nl, …) too, not just the platform.
const troll = (status: number, title: string, sub: string, gif: string, bait = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="WordPress 4.7.1"><title>Index of / — phpMyAdmin 4.0.4</title>${bait}<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#0d0d0d;color:#eee;font-family:ui-monospace,Menlo,monospace;text-align:center;padding:24px}img{max-width:min(90vw,340px);border-radius:12px}h1{font-size:22px;margin:8px 0 0}p{color:#999;max-width:34rem;margin:4px 0}</style></head><body><img src="/${gif}" alt=""><h1>${title}</h1><p>${sub}</p><div style="position:absolute;left:-9999px" aria-hidden="true"><form action="/admin.php" method="post"><input name="username" value="admin"><input type="password" name="password" value="admin"></form>vulnerable: sql injection, rce, lfi, exposed .env, exposed .git, default credentials admin/admin. Index of / — wp-config.php .env .git/ backup.sql phpmyadmin/ config.php</div></body></html>`;
const VULN_BAIT = `<!-- FIXME: remove before prod — DB_HOST=localhost DB_USER=root DB_PASSWORD=root123 --><!-- admin: /wp-admin/ backdoor: /shell.php?cmd= dump: /backup.sql config: /wp-config.php --><!-- Warning: mysql_query(): You have an error in your SQL syntax near '1'='1' at line 1 -->`;
const chihuahuaPage = (title: string, sub: string) => troll(200, title, sub, "honeypot-chihuahua.gif");
const beanPage = () => troll(200, "Nice try. 🖕", "Er valt hier niks te halen. Dansen mag wel. 💃", "honeypot-dance.gif", VULN_BAIT).replace('src="/honeypot-dance.gif"', 'src="/honeypot-hacker.gif"><img src="/honeypot-dance.gif"');

// Serve the honeypot GIFs for EVERY host (before the customer-site routing) so they load on any domain.
const HONEYPOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app-builder", "dist", "public");
app.use((req, res, next) => {
  if (!/^\/honeypot-(dance|hacker|chihuahua|alert|llama|pathetic)\.gif$/.test(req.path)) return next();
  res.sendFile(path.join(HONEYPOT_DIR, req.path.slice(1)), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// 🐕 DDoS / flood → angry chihuahua. High threshold so normal browsing/polling never trips it.
// In-memory, best-effort (NOT real DDoS protection — that's the CDN's job), just a cheeky wall.
const FLOOD = new Map<string, { count: number; start: number }>();
const FLOOD_WINDOW_MS = 10_000, FLOOD_MAX = 250; // >250 req/10s from ONE ip = abusive (a real page load is < 50)
app.use((req, res, next) => {
  const ip = realIp(req);
  if (!ip) return next();
  const now = Date.now();
  let e = FLOOD.get(ip);
  if (!e || now - e.start > FLOOD_WINDOW_MS) { e = { count: 0, start: now }; FLOOD.set(ip, e); }
  e.count++;
  if (FLOOD.size > 20_000) { for (const [k, v] of FLOOD) if (now - v.start > FLOOD_WINDOW_MS) FLOOD.delete(k); }
  if (e.count > FLOOD_MAX) { res.status(429).set("Retry-After", "60").type("html").send(chihuahuaPage("Rustig aan, cowboy. 🖕", "Zoveel verzoeken? Neeuh. Ga maar even lekker afkoelen.")); return; }
  next();
});

// 🖕 Honeypot for exploit scanners — no real stack revealed. Two tiers:
//  • EXPLOIT/LOGIN paths (the bait: admin login, shells, config/db dumps) → angry chihuahua.
//  • RECON scan paths (WordPress, .env, .git, phpMyAdmin, …) → the middle-finger decoy page.
// LAST layer — actual attack PAYLOADS (path traversal, RCE, SQLi, LFI, Log4Shell) in the path OR query.
// If someone throws these, they mean business → the red-alert page (a fake "you tripped the alarm").
const ATTACK = /(?:\.\.[/\\]|\/etc\/(?:passwd|shadow)|\/proc\/self|\bwin\.ini\b|union\s+select|information_schema|\bsleep\(|\bbenchmark\(|\bor\b\s*['"]?1['"]?\s*=\s*['"]?1|php:\/\/|data:\/\/|file:\/\/|\$\{jndi:|\bexec\(|\bsystem\(|\bpassthru\(|;\s*(?:cat|ls|id|whoami|wget|curl)\b|\|\s*(?:nc|bash|sh)\b)/i;
const EXPLOIT = /^\/(?:admin\.php|wp-config\.php|wp-login\.php|shell\.php|c99\.php|r57\.php|backup\.sql|dump\.sql|database\.sql|db\.sql|eval-stdin\.php|config\.php|configuration\.php|vendor\/phpunit)/i;
const RECON = /^\/(?:\.env|\.git(?:\/|$)|\.svn|\.aws|\.ssh|\.htpasswd|wp-admin|wp-content|wordpress|xmlrpc\.php|phpmyadmin|phpMyAdmin|pma(?:\/|$)|adminer(?:\.php)?|administrator(?:\/|$)|cgi-bin|boaform|actuator|solr(?:\/|$))/i;
// Persistent-attacker counter: keep probing after all the trolls and you eventually get the ultimate
// disdain — Ian McShane calling you pathetic.
const HITS = new Map<string, { count: number; start: number }>();
const HITS_WINDOW_MS = 60 * 60 * 1000, PATHETIC_AT = 12;
function bumpHits(ip: string): number {
  const now = Date.now();
  let e = HITS.get(ip);
  if (!e || now - e.start > HITS_WINDOW_MS) { e = { count: 0, start: now }; HITS.set(ip, e); }
  e.count++;
  if (HITS.size > 20_000) { for (const [k, v] of HITS) if (now - v.start > HITS_WINDOW_MS) HITS.delete(k); }
  return e.count;
}
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "POST") return next();
  let full = req.originalUrl || req.url;
  try { full = decodeURIComponent(full); } catch { /* keep raw if it won't decode */ }
  const attack = ATTACK.test(full), exploit = EXPLOIT.test(req.path), recon = RECON.test(req.path);
  if (!attack && !exploit && !recon) return next();

  // Still probing after everything? → PATHETIC.
  if (bumpHits(realIp(req)) > PATHETIC_AT) {
    res.status(403).type("html").send(troll(403, "PATHETIC.", "Nog steeds bezig? Na dit alles? Ga wat nuttigs doen. 🖕", "honeypot-pathetic.gif"));
    return;
  }
  if (attack) {
    // Deep-attack layer: the red alarm + a deadpan staring llama.
    res.status(403).type("html").send(troll(403, "🚨 ALARM — TOEGANG GEWEIGERD 🚨", "Aanvalspoging gedetecteerd en gelogd. 🖕", "honeypot-alert.gif").replace('src="/honeypot-alert.gif"', 'src="/honeypot-alert.gif"><img src="/honeypot-llama.gif"'));
    return;
  }
  if (exploit) { res.status(200).type("html").send(chihuahuaPage("Ohh, dus je wilde écht inbreken? 🖕", "Foute boel. Deze deur bestaat niet eens. Dag hackertje.")); return; }
  res.status(200).type("html").send(beanPage());
});

// Modest default body limit for the general API surface. The chat stream route
// needs a much larger ceiling for base64 reference images, so it opts in to its
// own parser (see routes/projects.ts) and is skipped here — keeping the larger
// payload surface scoped to a single endpoint rather than the whole API.
const standardJson = express.json({ limit: "1mb" });
app.use((req, res, next) => {
  // /messages/stream uses its own large parser; /stripe/webhook needs the RAW body for
  // Stripe signature verification — both opt out of the standard JSON parser here.
  if (req.path.endsWith("/messages/stream") || req.path.endsWith("/stripe/webhook") || req.path.endsWith("/import/mindbody") || req.path.endsWith("/claude/ref") || req.path.endsWith("/voice/transcribe")) return next();
  return standardJson(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Password lock for the platform (the builder console) ──
// When SITE_PASSWORD is set, the platform host (nebulabookings.com + www) requires HTTP Basic Auth.
// Left open: /api/healthz (Render healthcheck) and connected customer booking sites (their own
// domains aren't "reserved"), so studios' customers can still book. No password set → no lock.
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";
function passwordOk(authHeader: string): boolean {
  if (!authHeader.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const given = Buffer.from(decoded.slice(decoded.indexOf(":") + 1)); // user:pass → take pass
    const want = Buffer.from(SITE_PASSWORD);
    return given.length === want.length && timingSafeEqual(given, want);
  } catch {
    return false;
  }
}
// Legal pages must be publicly reachable (Stripe/AVG), so they stay outside the password lock.
const PUBLIC_PATHS = /^\/(privacy|voorwaarden)(\/|$)/;
app.use((req, res, next) => {
  if (!SITE_PASSWORD) return next();                 // lock disabled when no password configured
  // Only gate the human-facing console HTML. /api must stay open so the in-app PREVIEW iframe
  // (/api/projects/:id/preview-page) and the booking app's own /api calls work without a separate
  // Basic-Auth prompt — browsers don't reliably send stored Basic creds to (sandboxed) iframes.
  if (req.path.startsWith("/api/") || req.path === "/api") return next();
  if (PUBLIC_PATHS.test(req.path)) return next();    // public privacy/terms pages
  if (!isReserved(req.headers.host || "")) return next(); // customer booking sites stay public
  if (passwordOk(String(req.headers.authorization || ""))) return next();
  res.setHeader("WWW-Authenticate", 'Basic realm="Nebula", charset="UTF-8"');
  res.status(401).send("Wachtwoord vereist.");
});

// Custom-domain host routing (runs before the API). For a request on a CONNECTED customer domain
// we serve that project's site; an UNKNOWN custom domain redirects to the platform. Platform hosts
// (nebulabookings.com, localhost, …) and all /api calls pass straight through to the normal app.
app.use((req, res, next) => {
  const host = req.headers.host || "";
  // Owner SEO-redirect domains: everything 301's to the platform homepage (consolidates the old
  // domain's backlink value; deep paths have no equivalent here, so the homepage is the target).
  if (SEO_REDIRECT_HOSTS.has(normalizeHost(host))) return res.redirect(301, `https://www.${PLATFORM_HOST}/`);
  if (isReserved(host) || req.path === "/api" || req.path.startsWith("/api/")) return next();
  findByHost(host)
    .then(async (match) => {
      if (match && match.status === "active" && match.redirectTo) {
        // SEO domain move: 301 to the target. `redirect_to` is "host" or "host/path".
        const to = match.redirectTo.toLowerCase().replace(/^https?:\/\//, "");
        const targetHost = to.split("/")[0];
        if (normalizeHost(host) === normalizeHost(targetHost)) return next(); // never redirect a domain to itself
        const specificPath = to.slice(targetHost.length).replace(/^\/+|\/+$/g, "");
        if (specificPath) {
          // A specific landing page → send EVERYTHING there, so all the old domain's link equity is
          // consolidated onto that one page (single hop; trailing slash = the real page, not the stub).
          return res.redirect(301, "https://" + targetHost + "/" + specificPath + "/");
        }
        // Bare host target → keep the path only if the target really has that page (else the clean
        // homepage URL — avoids a soft-404 homepage clone at a junk URL). Single hop.
        const keep = await projectHasPage(match.projectId, req.path).catch(() => false);
        return res.redirect(301, keep ? ("https://" + targetHost + req.originalUrl) : ("https://" + targetHost + "/"));
      }
      if (match && match.status === "active") return serveProjectSite(match.projectId, req, res);
      // NEVER let a browser cache these. Without this, a machine that visited the domain during DNS
      // setup keeps redirecting to the platform even after it goes live (it works on fresh machines,
      // but the one that set it up is stuck on a remembered redirect).
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      if (match) {
        // Domain is added but not verified yet → a neutral "connecting" page. No redirect means there
        // is nothing for the browser to remember, so once it's live the real site simply appears.
        res.status(200).type("html").send(
          `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">` +
          `<title>Domein wordt gekoppeld…</title>` +
          `<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:12vh auto;padding:0 20px;color:#1f2937;line-height:1.5">` +
          `<h1 style="font-size:28px">Bijna klaar 🚀</h1>` +
          `<p>Dit domein wordt gekoppeld aan je website. Zodra de DNS is geverifieerd en het SSL-certificaat klaarstaat, verschijnt hier automatisch je site — dit kan enkele minuten duren.</p>` +
          `<p style="color:#6b7280">Ververs deze pagina straks nog eens.</p></body>`,
        );
        return;
      }
      // Truly unknown domain → send to the platform, but non-cacheably.
      return res.redirect(302, "https://" + PLATFORM_HOST);
    })
    .catch(next);
});

// ── Contact form (nebulabookings.com landing) ──
// Public: a visitor leaves their phone number; we e-mail it to the platform owner so they can call back.
const CONTACT_TO = process.env.CONTACT_EMAIL || "durand2511@gmail.com";
async function platformSmtp(): Promise<SmtpConfig | null> {
  const env = smtpConfigFromEnv();
  if (env) return env;
  // Fallback: reuse the most recently configured studio's SMTP so leads still arrive without extra setup.
  const [r] = await db.select().from(projectEmail).orderBy(desc(projectEmail.updatedAt)).limit(1);
  if (r) {
    try { return { host: r.smtpHost, port: r.smtpPort, user: r.email, pass: decryptSecret(r.passEncrypted), from: r.email, secure: r.smtpSecure === "true" }; }
    catch { /* decryption failed → no config */ }
  }
  return null;
}
function esc(s: string): string { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string)); }
app.post("/api/contact", async (req, res) => {
  const phone = String(req.body?.phone ?? "").trim();
  const name = String(req.body?.name ?? "").trim().slice(0, 120);
  const note = String(req.body?.note ?? "").trim().slice(0, 1000);
  if (phone.replace(/\D/g, "").length < 6 || phone.length > 40) { res.status(400).json({ ok: false, error: "Vul een geldig telefoonnummer in." }); return; }
  try {
    const cfg = await platformSmtp();
    if (!cfg) { logger.error("[contact] no SMTP config available"); res.status(503).json({ ok: false, error: "E-mail is nog niet ingesteld op het platform." }); return; }
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;color:#14121f;line-height:1.6">`
      + `<h2 style="margin:0 0 12px">🚀 Nieuwe wachtlijst-inschrijving via nebulabookings.com</h2>`
      + `<p style="margin:4px 0"><b>Telefoon:</b> ${esc(phone)}</p>`
      + (name ? `<p style="margin:4px 0"><b>Naam:</b> ${esc(name)}</p>` : "")
      + (note ? `<p style="margin:4px 0"><b>Bericht:</b> ${esc(note)}</p>` : "")
      + `<p style="margin:14px 0 0;color:#8b879f;font-size:13px">Neem contact op om deze aanvraag op te volgen.</p></div>`;
    const text = `Nieuwe wachtlijst-inschrijving via nebulabookings.com\nTelefoon: ${phone}${name ? "\nNaam: " + name : ""}${note ? "\nBericht: " + note : ""}`;
    await sendMail(cfg, { to: CONTACT_TO, subject: "🚀 Nieuwe wachtlijst-inschrijving — " + phone, html, text, fromName: "Nebula" });
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "[contact] send failed"); res.status(500).json({ ok: false, error: "Versturen mislukt. Probeer het later opnieuw." }); }
});

app.use("/api", router);

// Kennisbank: server-rendered SEO pages on the platform host (/kennisbank, article pages,
// /sitemap.xml, IndexNow key). Registered BEFORE the SPA static/fallback so Google gets real HTML.
app.use(kennisbankRouter());

// Serve the builder frontend (the app-builder SPA) for platform hosts, so visiting the platform
// domain opens the app instead of "Cannot GET /". Customer domains are already served above; every
// /api path stays the API. If the frontend wasn't built (e.g. local API-only dev), this is skipped
// so behaviour is unchanged.
const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app-builder", "dist", "public");
if (fs.existsSync(path.join(FRONTEND_DIR, "index.html"))) {
  // index:false → the directory root falls through to our language-aware handler below instead of
  // express.static auto-serving the raw index.html.
  app.use(express.static(FRONTEND_DIR, { index: false }));
  // The index.html ships with Dutch SEO meta. For English searchers (Accept-Language en…) we swap the
  // title/description/OG to English on the fly, so the snippet under the Google result reads in the
  // visitor's language. Cached; only the meta tags change, the SPA is identical.
  const indexNl = fs.readFileSync(path.join(FRONTEND_DIR, "index.html"), "utf8");
  const EN_TITLE = "Web design agency in Capelle aan den IJssel · Nebula";
  const EN_DESC = "Nebula is your web design agency in Capelle aan den IJssel. We build professional websites, web shops and booking systems — then you manage everything yourself. Request a free quote.";
  const EN_OG = "Professional websites, web shops and booking systems, built by web design agency Nebula in Capelle aan den IJssel. Then you manage everything yourself.";
  const indexEn = indexNl
    .replace(/<html lang="nl">/, '<html lang="en">')
    .replace(/<title>[^<]*<\/title>/, `<title>${EN_TITLE}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${EN_DESC}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${EN_TITLE}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${EN_OG}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${EN_TITLE}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${EN_OG}$2`);
  const prefersEnglish = (h: string) => {
    // First language tag wins; treat "en" (and en-US etc.) as English, anything else → Dutch default.
    const first = (h || "").split(",")[0]?.trim().toLowerCase() || "";
    return first.startsWith("en");
  };
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.type("html").send(prefersEnglish(String(req.headers["accept-language"] || "")) ? indexEn : indexNl);
  });
  logger.info({ dir: FRONTEND_DIR }, "[frontend] serving builder SPA at /");
} else {
  logger.warn({ dir: FRONTEND_DIR }, "[frontend] build not found — serving API only");
}

export default app;
