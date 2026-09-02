/**
 * Nebula kennisbank — the platform's own content engine on nebulabookings.com/kennisbank.
 *
 * Every day ONE Dutch article is generated (Anthropic, same model as the customer SEO engine) about
 * topics that people searching for a webdesign bureau / website / boekingssysteem actually google.
 * Articles are stored in platform_blog and SERVER-RENDERED (real HTML + canonical + JSON-LD +
 * sitemap + IndexNow ping), so Google indexes them properly — the SPA is never involved.
 */
import express, { type Request, type Response } from "express";
import { db, platformBlog } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-openai-ai-server";
import { INDEXNOW_KEY, submitToIndexNow } from "./indexnow.js";
import { PLATFORM_HOST } from "./domains.js";
import { logger } from "./logger";

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const slugify = (s: string) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70) || "artikel";
const stripTags = (h: string) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const fmtDate = (d: Date) => d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

// ── Generation ─────────────────────────────────────────────────────────────────────────────────

// Pillar themes the daily topic rotates through — all mapped to what our audience (small business
// owners looking for a website/booking system) actually searches for.
const THEMES = [
  "webdesign bureau kiezen / uitbesteden vs. zelf doen",
  "website laten maken: kosten, valkuilen, wat je mag verwachten",
  "boekingssysteem voor yogastudio's, salons en coaches",
  "SEO voor kleine ondernemers (lokaal gevonden worden in Google)",
  "je website zelf bewerken met AI (Claude) — hoe werkt dat",
  "eigen domeinnaam, e-mail en SSL goed regelen",
  "conversie: van websitebezoeker naar klant of boeking",
  "website-onderhoud, snelheid en veiligheid",
  "online betalingen en abonnementen (iDEAL) voor kleine bedrijven",
  "teksten en foto's voor je website die verkopen",
];

async function ai(prompt: string, maxTokens: number): Promise<string> {
  try {
    const resp = await anthropic.messages.create(
      { model: "claude-sonnet-4-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] },
      { timeout: 180000, maxRetries: 0 },
    );
    return resp.content[0]?.type === "text" ? resp.content[0].text : "";
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "[kennisbank] ai call failed");
    return "";
  }
}

function parseJson<T>(text: string): T | null {
  try {
    const o = text.indexOf("{"), c = text.lastIndexOf("}");
    if (o < 0 || c <= o) return null;
    return JSON.parse(text.slice(o, c + 1)) as T;
  } catch { return null; }
}

type Article = { title: string; metaTitle: string; metaDescription: string; slug: string; html: string; topic: string };

export async function generateKennisbankArticle(): Promise<{ status: "published" | "failed"; slug?: string; reason?: string }> {
  const existing = await db.select({ title: platformBlog.title, topic: platformBlog.topic }).from(platformBlog).orderBy(desc(platformBlog.createdAt)).limit(40);
  const theme = THEMES[existing.length % THEMES.length];
  const prompt = [
    "Je schrijft voor de kennisbank van Nebula (nebulabookings.com): een Nederlands webdesign-platform waar ondernemers een professionele website laten maken en die daarna ZELF bewerken door gewoon te typen wat er anders moet (Claude Code als editor). Inclusief boekingssysteem (lessen/afspraken, iDEAL), eigen domein met SSL, automatische SEO. €50 per maand, maandelijks opzegbaar.",
    "",
    `Schrijf één volledig nieuw kennisbank-artikel binnen dit thema: "${theme}".`,
    "Doelgroep: Nederlandse ondernemers en ZZP'ers (yogastudio's, salons, kappers, coaches, restaurants, lokale bedrijven) die googelen op dingen als 'webdesign bureau', 'website laten maken', 'boekingssysteem' of 'website kosten'.",
    "",
    "Eisen aan het artikel:",
    "- Nederlands, joviaal-professioneel, je-vorm; concreet en praktisch (voorbeelden, bedragen, stappen), geen wollige marketingpraat.",
    "- 1100–1500 woorden.",
    "- Structuur in schone HTML (GEEN <html>/<head>/<body>): korte intro (2 alinea's, <p>), daarna 4–6 <h2>-secties met <p>/<ul>/<ol>, een <h2>Veelgestelde vragen</h2> met 3–4 <h3>-vragen + antwoord, en een korte conclusie.",
    "- Sluit af met één subtiele call-to-action-alinea die naar Nebula verwijst met deze link: <a href=\"https://nebulabookings.com\">nebulabookings.com</a>. Verder geen reclame door het artikel heen; hoogstens 1 natuurlijke verwijzing.",
    "- Verzin geen niet-bestaande statistieken of bronnen; gebruik algemene ervaringscijfers voorzichtig ('vaak', 'meestal', 'grofweg').",
    `- Jaartallen: alleen ${new Date().getFullYear()} of helemaal geen jaartal (het is nu ${new Date().getFullYear()}).`,
    existing.length ? `- Vermijd overlap met deze bestaande artikelen:\n${existing.map((e) => `  • ${e.title}`).join("\n")}` : "",
    "",
    "Antwoord met UITSLUITEND geldige JSON, exact dit formaat:",
    `{"title":"...","metaTitle":"max 60 tekens, met zoekwoord","metaDescription":"max 155 tekens, activerend","slug":"kebab-case-url-slug","html":"<p>...volledig artikel..."}`,
  ].filter(Boolean).join("\n");

  const raw = await ai(prompt, 8000);
  const a = parseJson<Article>(raw);
  if (!a?.title || !a?.html) return { status: "failed", reason: "no-json" };
  const words = stripTags(a.html).split(/\s+/).filter(Boolean).length;
  if (words < 600) return { status: "failed", reason: `too-short (${words}w)` };
  let slug = slugify(a.slug || a.title);
  const [dup] = await db.select({ id: platformBlog.id }).from(platformBlog).where(eq(platformBlog.slug, slug));
  if (dup) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  await db.insert(platformBlog).values({
    slug, title: a.title.slice(0, 200), metaTitle: (a.metaTitle || a.title).slice(0, 70),
    metaDescription: (a.metaDescription || "").slice(0, 170), topic: theme, html: a.html,
  });
  void submitToIndexNow(PLATFORM_HOST, [`https://${PLATFORM_HOST}/kennisbank/${slug}`, `https://${PLATFORM_HOST}/kennisbank`]);
  logger.info({ slug, words }, "[kennisbank] article published");
  return { status: "published", slug };
}

// ── Scheduler: one article per day, retried a few times on failure ─────────────────────────────
let started = false;
let failDay = "";
let failCount = 0;

async function publishedToday(): Promise<boolean> {
  const [latest] = await db.select({ createdAt: platformBlog.createdAt }).from(platformBlog).orderBy(desc(platformBlog.createdAt)).limit(1);
  if (!latest) return false;
  return latest.createdAt.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
}

export function startKennisbankScheduler(): void {
  if (started) return;
  started = true;
  if (!process.env.ANTHROPIC_API_KEY) { logger.warn("[kennisbank] ANTHROPIC_API_KEY not set — daily article generation disabled"); return; }
  const tick = async () => {
    try {
      if (await publishedToday()) return;
      const day = new Date().toISOString().slice(0, 10);
      if (failDay !== day) { failDay = day; failCount = 0; }
      if (failCount >= 4) return; // give up until tomorrow
      const r = await generateKennisbankArticle();
      if (r.status !== "published") { failCount++; logger.warn({ reason: r.reason, failCount }, "[kennisbank] generation failed"); }
    } catch (err) { failCount++; logger.warn({ err }, "[kennisbank] tick failed"); }
  };
  setTimeout(() => { void tick(); }, 90 * 1000);          // shortly after boot
  setInterval(() => { void tick(); }, 30 * 60 * 1000);    // then every 30 min (self-capped to 1/day)
  logger.info("[kennisbank] daily article scheduler started");
}

// ── Server-rendered pages ──────────────────────────────────────────────────────────────────────

// Shared shell in the platform's visual language: centered pill nav, warm light background, white
// rounded cards, system font. Self-contained CSS so these pages never depend on the SPA bundle.
function shell(opts: { title: string; description: string; canonical: string; jsonLd: object[]; body: string; ogType?: string }): string {
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="${opts.ogType || "website"}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(opts.canonical)}">
<meta property="og:image" content="https://${PLATFORM_HOST}/opengraph.jpg">
${opts.jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n")}
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f4f1;color:#171717;line-height:1.7;-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .nav-wrap{position:sticky;top:0;z-index:50;display:flex;justify-content:center;padding:16px 12px 8px}
  .nav{display:flex;gap:2px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border:1px solid #e5e2dd;border-radius:999px;padding:5px 6px;box-shadow:0 4px 14px rgba(0,0,0,.08)}
  .nav a{font-size:12.5px;font-weight:550;padding:5px 14px;border-radius:999px;text-decoration:none;color:rgba(23,23,23,.6);transition:.15s}
  .nav a:hover{color:#171717;background:rgba(23,23,23,.05)}
  .nav a.on{background:#171717;color:#fff}
  main{max-width:760px;margin:0 auto;padding:36px 20px 60px}
  .crumb{font-size:12.5px;color:#8a8578;margin-bottom:18px}
  .crumb a{color:#8a8578;text-decoration:none}
  .crumb a:hover{text-decoration:underline}
  .hero h1{font-size:clamp(30px,5vw,42px);line-height:1.12;letter-spacing:-.02em;font-weight:800}
  .hero p.sub{margin-top:12px;font-size:17px;color:#6f6a5e;max-width:56ch}
  .cards{display:grid;gap:14px;margin-top:30px}
  .card{display:block;background:#fff;border:1px solid #eceae5;border-radius:20px;padding:22px 24px;text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.04);transition:.15s}
  .card:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.09)}
  .card .date{font-size:12px;color:#a09a8c;font-weight:550;text-transform:uppercase;letter-spacing:.06em}
  .card h2{font-size:19px;line-height:1.3;margin:6px 0 6px;letter-spacing:-.01em}
  .card p{font-size:14.5px;color:#6f6a5e}
  .card .more{display:inline-block;margin-top:10px;font-size:13px;font-weight:600;color:#171717}
  article{background:#fff;border:1px solid #eceae5;border-radius:24px;padding:clamp(26px,5vw,48px);box-shadow:0 2px 12px rgba(0,0,0,.05)}
  article .meta{font-size:13px;color:#a09a8c;margin-bottom:14px}
  article h1{font-size:clamp(26px,4.5vw,36px);line-height:1.15;letter-spacing:-.02em;font-weight:800;margin-bottom:18px}
  article h2{font-size:22px;letter-spacing:-.01em;margin:34px 0 10px}
  article h3{font-size:17px;margin:22px 0 6px}
  article p{margin:0 0 14px;font-size:16.5px}
  article ul,article ol{margin:0 0 14px 22px;font-size:16.5px}
  article li{margin-bottom:6px}
  article a{color:#0f62d6;text-decoration:none}
  article a:hover{text-decoration:underline}
  .cta{margin-top:34px;background:#171717;color:#fff;border-radius:20px;padding:26px 28px}
  .cta h2{font-size:20px;margin:0 0 6px;letter-spacing:-.01em}
  .cta p{font-size:14.5px;color:rgba(255,255,255,.75);margin:0 0 16px}
  .cta a{display:inline-block;background:#fff;color:#171717;font-weight:650;font-size:14px;padding:10px 20px;border-radius:999px;text-decoration:none}
  footer{padding:26px 16px 40px;text-align:center;font-size:12px;color:#a09a8c}
  footer a{color:#a09a8c}
</style>
</head>
<body>
<div class="nav-wrap"><nav class="nav">
  <a href="/">Home</a><a href="/ai-editor">Nebula</a><a href="/help">Uitleg</a><a class="on" href="/kennisbank">Kennisbank</a>
</nav></div>
<main>${opts.body}</main>
<footer>© ${new Date().getFullYear()} Nebula · Durand van Konijnenburg · KVK 70776857 · <a href="/privacy">Privacybeleid</a> · <a href="/voorwaarden">Voorwaarden</a></footer>
</body>
</html>`;
}

const ctaBlock = `<div class="cta"><h2>Zelf een website die voor je werkt?</h2><p>Nebula bouwt 'm en daarna bewerk je alles zelf — gewoon door te typen wat er anders moet. Inclusief boekingssysteem, eigen domein en automatische SEO.</p><a href="/ai-editor">Bekijk Nebula →</a></div>`;

async function renderIndex(_req: Request, res: Response): Promise<void> {
  const posts = await db.select().from(platformBlog).orderBy(desc(platformBlog.createdAt)).limit(200);
  const base = `https://${PLATFORM_HOST}`;
  const body = `
<div class="hero">
  <h1>Kennisbank</h1>
  <p class="sub">Praktische gidsen over websites, webdesign, online boekingen en gevonden worden in Google — voor ondernemers die het gewoon goed geregeld willen hebben. Elke dag een nieuw artikel.</p>
</div>
<div class="cards">
${posts.map((p) => `<a class="card" href="/kennisbank/${esc(p.slug)}"><span class="date">${fmtDate(p.createdAt)}</span><h2>${esc(p.title)}</h2><p>${esc(p.metaDescription)}</p><span class="more">Lees verder →</span></a>`).join("\n")}
${posts.length === 0 ? `<div class="card"><h2>De eerste artikelen verschijnen binnenkort</h2><p>Elke dag publiceren we hier een nieuw artikel.</p></div>` : ""}
</div>
${ctaBlock}`;
  res.type("html").send(shell({
    title: "Kennisbank — websites, webdesign & online boekingen | Nebula",
    description: "Praktische artikelen over website laten maken, webdesign, boekingssystemen en lokale SEO voor ondernemers. Elke dag nieuw.",
    canonical: `${base}/kennisbank`,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "Blog", name: "Nebula Kennisbank", url: `${base}/kennisbank`, inLanguage: "nl" },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: base },
        { "@type": "ListItem", position: 2, name: "Kennisbank", item: `${base}/kennisbank` },
      ] },
    ],
    body,
  }));
}

async function renderArticle(req: Request, res: Response): Promise<void> {
  const slug = String(req.params.slug || "");
  const [p] = await db.select().from(platformBlog).where(eq(platformBlog.slug, slug));
  if (!p) { res.status(404).type("html").send(shell({ title: "Niet gevonden — Nebula Kennisbank", description: "Dit artikel bestaat niet (meer).", canonical: `https://${PLATFORM_HOST}/kennisbank`, jsonLd: [], body: `<div class="hero"><h1>Artikel niet gevonden</h1><p class="sub">Dit artikel bestaat niet (meer). <a href="/kennisbank">Terug naar de kennisbank</a>.</p></div>` })); return; }
  const base = `https://${PLATFORM_HOST}`;
  const url = `${base}/kennisbank/${p.slug}`;
  const body = `
<div class="crumb"><a href="/">Home</a> › <a href="/kennisbank">Kennisbank</a> › ${esc(p.title)}</div>
<article>
  <div class="meta">${fmtDate(p.createdAt)} · Nebula Kennisbank</div>
  <h1>${esc(p.title)}</h1>
  ${p.html}
</article>
${ctaBlock}`;
  res.type("html").send(shell({
    title: `${p.metaTitle || p.title} | Nebula`,
    description: p.metaDescription,
    canonical: url,
    ogType: "article",
    jsonLd: [
      { "@context": "https://schema.org", "@type": "Article", headline: p.title, description: p.metaDescription, datePublished: p.createdAt.toISOString(), inLanguage: "nl", mainEntityOfPage: url, author: { "@type": "Organization", name: "Nebula" }, publisher: { "@type": "Organization", name: "Nebula", url: base } },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: base },
        { "@type": "ListItem", position: 2, name: "Kennisbank", item: `${base}/kennisbank` },
        { "@type": "ListItem", position: 3, name: p.title, item: url },
      ] },
    ],
    body,
  }));
}

async function renderSitemap(_req: Request, res: Response): Promise<void> {
  const posts = await db.select({ slug: platformBlog.slug, createdAt: platformBlog.createdAt }).from(platformBlog).orderBy(desc(platformBlog.createdAt)).limit(1000);
  const base = `https://${PLATFORM_HOST}`;
  const urls = [
    `<url><loc>${base}/</loc></url>`,
    `<url><loc>${base}/kennisbank</loc>${posts[0] ? `<lastmod>${posts[0].createdAt.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`,
    ...posts.map((p) => `<url><loc>${base}/kennisbank/${esc(p.slug)}</loc><lastmod>${p.createdAt.toISOString().slice(0, 10)}</lastmod></url>`),
  ];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
}

export function kennisbankRouter(): express.Router {
  const r = express.Router();
  r.get("/kennisbank", (req, res) => { renderIndex(req, res).catch(() => res.status(500).send("Er ging iets mis.")); });
  r.get("/kennisbank/:slug", (req, res) => { renderArticle(req, res).catch(() => res.status(500).send("Er ging iets mis.")); });
  r.get("/sitemap.xml", (req, res) => { renderSitemap(req, res).catch(() => res.status(500).send("")); });
  r.get(`/${INDEXNOW_KEY}.txt`, (_req, res) => { res.type("text/plain").send(INDEXNOW_KEY); });
  return r;
}
