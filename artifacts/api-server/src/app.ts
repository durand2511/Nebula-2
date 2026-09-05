import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, createHash } from "node:crypto";
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

// ── Psychological-warfare layer ──────────────────────────────────────────────
// We reflect the attacker's OWN request data back at them (IP, browser, OS, language,
// country) plus a case number that stays IDENTICAL every visit — so it feels like a
// system that remembers and watches them personally. All 100% real data THEY sent, which
// makes it far creepier than any threat. Nothing here touches a normal visitor: it only
// renders inside the honeypot handlers, which only fire on attack/scan patterns.
const escPw = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
function uaSummary(ua: string): { browser: string; os: string; spoof: boolean } {
  const u = ua || "";
  const os = /Windows NT 10/.test(u) ? "Windows 10/11" : /Windows/.test(u) ? "Windows" : /Android/.test(u) ? "Android"
    : /iPhone|iPad|iOS/.test(u) ? "iOS" : /Mac OS X/.test(u) ? "macOS" : /Linux/.test(u) ? "Linux" : "onbekend OS";
  const browser = /Edg\//.test(u) ? "Edge" : /OPR\//.test(u) ? "Opera" : /Chrome\//.test(u) ? "Chrome" : /Firefox\//.test(u) ? "Firefox"
    : /Safari\//.test(u) ? "Safari" : /curl/i.test(u) ? "curl" : /python|requests|aiohttp|httpx/i.test(u) ? "een Python-script"
    : /go-http|Go-http/i.test(u) ? "een Go-scanner" : /nikto|sqlmap|nmap|masscan|zgrab|nuclei|acunetix|dirbuster|gobuster|wpscan/i.test(u) ? "een scanner-tool" : "onbekend";
  // Tools/scripts pretending to be a browser, or no UA at all, read as "spoofed".
  const spoof = !u || /curl|python|requests|httpx|go-http|nikto|sqlmap|nmap|masscan|zgrab|nuclei|scan|bot/i.test(u);
  return { browser, os, spoof };
}
function attackerCountry(req: express.Request): string {
  const h = req.headers;
  const cc = String(h["cf-ipcountry"] || h["x-vercel-ip-country"] || h["x-appengine-country"] || "").toUpperCase();
  if (cc && cc !== "XX") return cc;
  const lang = String(h["accept-language"] || "");
  const m = lang.match(/[a-z]{2}-([A-Z]{2})/);
  return m ? m[1] : "??";
}
// Seeds of doubt — make them distrust their own tools and their own memory of what "worked".
const DOUBT = [
  "Niet alles wat je terugkreeg was echt. Wélke van je laatste hits waren nep? Dat weet je niet meer, hè?",
  "Je scanner denkt dat 'ie iets vond. Je scanner heeft het mis. Steeds opnieuw.",
  "Elk verzoek dat je stuurt leert ons meer over jou dan jij ooit over ons leert.",
  "Deze pagina bestaat niet. En toch lees je 'm. Denk daar maar eens goed over na.",
  "Is dit een honeypot? Of wil ik alleen dat je dát denkt? Slaap lekker.",
  "Drie van je vorige requests kwamen nooit aan waar jij denkt. Of waren het er vier?",
  "De data die je net 'buitmaakte' hebben wij voor je klaargelegd. Net als de vorige keer.",
  "Je bent hier niet de eerste. En je komt niet verder dan de vorige. Die probeert het trouwens nog steeds.",
  "We hebben je patroon al herkend voordat jij je tweede request stuurde.",
  "Alles wat hierna 'werkt', werkt omdat wij dat wilden. Veel plezier met je nep-buit.",
];
function psyOps(req: express.Request, hits: number): string {
  const ip = realIp(req) || "onbekend";
  const { browser, os, spoof } = uaSummary(String(req.headers["user-agent"] || ""));
  const lang = String(req.headers["accept-language"] || "").split(",")[0].trim() || "onbekend";
  const country = attackerCountry(req);
  const dossier = createHash("sha256").update(ip).digest("hex").slice(0, 8).toUpperCase(); // STABLE per IP → "we remember you"
  const seed = parseInt(dossier, 16);
  const doubt = DOUBT[(seed + hits) % DOUBT.length];
  const seen = hits > 1 ? `<div class="pw-row"><span>STATUS</span><b style="color:#ff5252">EERDER GEZIEN · poging #${hits} dit uur</b></div>` : "";
  const spoofLine = spoof ? `<div class="pw-row"><span>UA</span><b style="color:#ffb300">vervalst / geautomatiseerd — genoteerd</b></div>` : "";
  return `<div class="pw"><div class="pw-hd">▸ SESSIE GETRACEERD</div>
<div class="pw-row"><span>DOSSIER</span><b>#${dossier}</b></div>
<div class="pw-row"><span>IP</span><b>${escPw(ip)}</b></div>
<div class="pw-row"><span>HERKOMST</span><b>${escPw(country)}</b></div>
<div class="pw-row"><span>CLIENT</span><b>${escPw(browser)} · ${escPw(os)}</b></div>
<div class="pw-row"><span>TAAL</span><b>${escPw(lang)}</b></div>
${spoofLine}${seen}
<div class="pw-doubt">${doubt}</div>
<div class="pw-ft">Dit dossier blijft. Jij niet.</div></div>`;
}
const PW_CSS = `.pw{margin-top:20px;max-width:min(92vw,440px);text-align:left;border:1px solid #1e2a1e;border-radius:10px;background:#070b07;color:#7dff9b;font-size:12.5px;line-height:1.5;overflow:hidden;box-shadow:0 0 40px rgba(40,255,110,.06)}.pw-hd{background:#0c160c;padding:8px 12px;letter-spacing:.14em;color:#4ade80;border-bottom:1px solid #1e2a1e}.pw-row{display:flex;justify-content:space-between;gap:12px;padding:5px 12px;border-bottom:1px dashed #142014}.pw-row span{color:#3f6f4f}.pw-row b{color:#c7ffd6;font-weight:600;word-break:break-all;text-align:right}.pw-doubt{padding:11px 12px;color:#e8fff0;background:#0a120a;border-top:1px solid #1e2a1e}.pw-ft{padding:7px 12px;color:#2f5a3c;letter-spacing:.08em}`;

// Honeypot pages (no real stack revealed). The GIFs are served for ANY host below, so they work on
// customer domains (senszenjoy.nl, …) too, not just the platform.
const troll = (status: number, title: string, sub: string, gif: string, bait = "", psy = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="WordPress 4.7.1"><title>Index of / — phpMyAdmin 4.0.4</title>${bait}<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#0d0d0d;color:#eee;font-family:ui-monospace,Menlo,monospace;text-align:center;padding:24px}img{max-width:min(90vw,340px);border-radius:12px}h1{font-size:22px;margin:8px 0 0}p{color:#999;max-width:34rem;margin:4px 0}${PW_CSS}</style></head><body><img src="/${gif}" alt=""><h1>${title}</h1><p>${sub}</p>${psy}<div style="position:absolute;left:-9999px" aria-hidden="true"><form action="/admin.php" method="post"><input name="username" value="admin"><input type="password" name="password" value="admin"></form>vulnerable: sql injection, rce, lfi, exposed .env, exposed .git, default credentials admin/admin. Index of / — wp-config.php .env .git/ backup.sql phpmyadmin/ config.php</div></body></html>`;
const VULN_BAIT = `<!-- FIXME: remove before prod — DB_HOST=localhost DB_USER=root DB_PASSWORD=root123 --><!-- admin: /wp-admin/ backdoor: /shell.php?cmd= dump: /backup.sql config: /wp-config.php --><!-- Warning: mysql_query(): You have an error in your SQL syntax near '1'='1' at line 1 -->`;
const chihuahuaPage = (title: string, sub: string, psy = "") => troll(200, title, sub, "honeypot-chihuahua.gif", "", psy);
const beanPage = (psy = "") => troll(200, "Nice try. 🖕", "Alles wat je hier 'vindt', hebben wij je laten vinden. Dansen mag wél. 💃", "honeypot-dance.gif", VULN_BAIT, psy).replace('src="/honeypot-dance.gif"', 'src="/honeypot-hacker.gif"><img src="/honeypot-dance.gif"');

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
  if (e.count > FLOOD_MAX) { res.status(429).set("Retry-After", "60").type("html").send(chihuahuaPage("Rustig aan, cowboy. 🖕", "Zoveel verzoeken en tóch niks. Denk je echt dat je de eerste bent? Koel maar even af.", psyOps(req, bumpHits(ip)))); return; }
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
const HITS_WINDOW_MS = 60 * 60 * 1000, PATHETIC_AT = 500; // rare final boss: only a relentless attacker (500+ probes/hour) reaches it — a normal scan never does
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

  // Every hit is counted, and the count feeds the psy-ops panel (poging #N) + the PATHETIC gate.
  const n = bumpHits(realIp(req));
  const psy = psyOps(req, n);

  // Still probing after everything? → PATHETIC.
  if (n > PATHETIC_AT) {
    res.status(403).type("html").send(troll(403, "PATHETIC.", "You're worthless, loser. 🖕 Na dit alles nóg niks — we houden je dossier bij, jij leert niks.", "honeypot-pathetic.gif", "", psy));
    return;
  }
  if (attack) {
    // Deep-attack layer: the red alarm + a deadpan staring llama.
    res.status(403).type("html").send(troll(403, "🚨 ALARM — TOEGANG GEWEIGERD 🚨", "Aanvalspoging gedetecteerd, gelogd en aan jouw patroon gekoppeld. We kenden je al. 🖕", "honeypot-alert.gif", "", psy).replace('src="/honeypot-alert.gif"', 'src="/honeypot-alert.gif"><img src="/honeypot-llama.gif"'));
    return;
  }
  if (exploit) { res.status(200).type("html").send(chihuahuaPage("Ohh, dus je wilde écht inbreken? 🖕", "Deze deur bestaat niet. De vorige ook niet. Weet je nog wélke wél echt was?", psy)); return; }
  res.status(200).type("html").send(beanPage(psy));
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
