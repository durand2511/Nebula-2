/**
 * Nebula kennisbank — the platform's own content engine on nebulabookings.com/kennisbank.
 *
 * Every day ONE Dutch article is generated (Anthropic, same model as the customer SEO engine) about
 * topics that people searching for a webdesign bureau / website / boekingssysteem actually google.
 * Articles are stored in platform_blog and SERVER-RENDERED (real HTML + canonical + JSON-LD +
 * sitemap + IndexNow ping), so Google indexes them properly — the SPA is never involved.
 */
import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, platformBlog } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { generateOnSubscription, platformOwnerEnv, type SubEnv } from "./subscription-ai.js";
import { INDEXNOW_KEY, submitToIndexNow } from "./indexnow.js";
import { PLATFORM_HOST } from "./domains.js";

// The apex 301-redirects to www (Render config), so www is the CANONICAL host: every canonical,
// sitemap-URL, OG-tag and IndexNow ping must use it, or Google chases redirects ("Kan niet ophalen").
const CANON_HOST = `www.${PLATFORM_HOST}`;
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

// The Kennisbank is the platform's OWN blog, so it generates on the PLATFORM OWNER's Claude
// subscription — no API key. kbEnv is set for the duration of one generation run.
let kbEnv: SubEnv | null = null;
async function ai(prompt: string, _maxTokens: number): Promise<string> {
  if (!kbEnv) return "";
  return generateOnSubscription(kbEnv, prompt, 180000);
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
  const env = await platformOwnerEnv();
  if (!env) return { status: "failed", reason: "platform owner has no coupled Claude subscription" };
  kbEnv = env;
  try { return await generateKennisbankArticleImpl(); } finally { kbEnv = null; }
}
async function generateKennisbankArticleImpl(): Promise<{ status: "published" | "failed"; slug?: string; reason?: string }> {
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
  void submitToIndexNow(CANON_HOST, [`https://${CANON_HOST}/kennisbank/${slug}`, `https://${CANON_HOST}/kennisbank`]);
  logger.info({ slug, words }, "[kennisbank] article published");
  await translatePending().catch(() => {}); // translate the fresh article to English right away
  return { status: "published", slug };
}

// Translate ONE untranslated article to English (newest first) — called right after publishing and
// as a backfill from the scheduler, so older articles get their /en/ version too.
export async function translatePending(): Promise<boolean> {
  const [row] = await db.select().from(platformBlog).where(eq(platformBlog.htmlEn, "")).orderBy(desc(platformBlog.createdAt)).limit(1);
  if (!row) return false;
  const prompt = [
    "Translate this Dutch knowledge-base article about websites/web design to natural, idiomatic English for an international audience of small business owners. Keep ALL HTML tags and structure exactly as-is; translate only the text. Keep the link to nebulabookings.com intact.",
    "",
    "Answer with ONLY valid JSON, exactly this shape:",
    '{"title":"...","metaTitle":"max 60 chars","metaDescription":"max 155 chars","html":"<p>...translated article..."}',
    "",
    `TITLE: ${row.title}`,
    `META TITLE: ${row.metaTitle}`,
    `META DESCRIPTION: ${row.metaDescription}`,
    "HTML:",
    row.html,
  ].join("\n");
  const raw = await ai(prompt, 8000);
  const tr = parseJson<{ title: string; metaTitle: string; metaDescription: string; html: string }>(raw);
  if (!tr?.title || !tr?.html) { logger.warn({ slug: row.slug }, "[kennisbank] translation failed"); return false; }
  await db.update(platformBlog).set({
    titleEn: tr.title.slice(0, 200), metaTitleEn: (tr.metaTitle || tr.title).slice(0, 70),
    metaDescriptionEn: (tr.metaDescription || "").slice(0, 170), htmlEn: tr.html,
  }).where(eq(platformBlog.id, row.id));
  void submitToIndexNow(CANON_HOST, [`https://${CANON_HOST}/en/kennisbank/${row.slug}`, `https://${CANON_HOST}/en/kennisbank`]);
  logger.info({ slug: row.slug }, "[kennisbank] translated to English");
  return true;
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

// Cornerstone articles: hand-written, SEO-optimised pieces we always want live (idempotent — inserted
// once by slug). Used to target key local terms like "webdesign bureau Capelle aan den IJssel".
const CORNERSTONE: { slug: string; title: string; metaTitle: string; metaDescription: string; topic: string; html: string }[] = [
  {
    slug: "webdesign-bureau-capelle-aan-den-ijssel",
    title: "Webdesign bureau in Capelle aan den IJssel: zo kies je de juiste partner",
    metaTitle: "Webdesign bureau Capelle aan den IJssel | Nebula",
    metaDescription: "Op zoek naar een webdesign bureau in Capelle aan den IJssel? Ontdek waar je op let, wat een professionele website kost en hoe je 'm daarna zelf beheert.",
    topic: "webdesign capelle aan den ijssel",
    html: `<p>Zoek je een <strong>webdesign bureau in Capelle aan den IJssel</strong>? Een goede website is voor veel ondernemers in Capelle en de regio Rotterdam dé plek waar nieuwe klanten je voor het eerst tegenkomen. In dit artikel lees je waar je op let bij het kiezen van een webdesign bureau, wat een professionele website ongeveer kost, en waarom het slim is om een site te kiezen die je daarna zélf kunt beheren.</p>
<p>Nebula is het webdesign bureau uit Capelle aan den IJssel dat websites, webshops en boekingssystemen bouwt — en je daarna de controle teruggeeft. Geen dure meerwerk-facturen voor elke kleine wijziging: je past je site zelf aan door simpelweg te typen wat er anders moet.</p>
<h2>Waarom kiezen voor een lokaal webdesign bureau in Capelle?</h2>
<p>Een lokaal webdesign bureau kent de regio en denkt mee met ondernemers uit Capelle aan den IJssel, Rotterdam, Nieuwerkerk aan den IJssel en Krimpen aan den IJssel. Korte lijnen, persoonlijk contact en iemand die snapt wie jouw klanten zijn. Bovendien helpt lokale aanwezigheid je vindbaarheid: mensen zoeken vaak op "webdesign + plaatsnaam", en met de juiste opzet verschijn je daar bovenaan.</p>
<h2>Waar let je op bij het kiezen van een webdesign bureau?</h2>
<ul>
<li><strong>Mobielvriendelijk ontwerp</strong> — meer dan de helft van je bezoekers komt via de telefoon.</li>
<li><strong>Snelheid en SEO</strong> — een snelle, goed opgebouwde site scoort beter in Google.</li>
<li><strong>Eigen domein en e-mail</strong> — professioneel en van jou.</li>
<li><strong>Zelf kunnen aanpassen</strong> — zodat je niet voor elke tekstwijziging hoeft te betalen.</li>
<li><strong>Uitbreidbaar</strong> — een webshop of online boekingssysteem toevoegen wanneer je dat wilt.</li>
</ul>
<h2>Wat kost een professionele website in Capelle aan den IJssel?</h2>
<p>Bij traditionele bureaus betaal je al snel honderden tot duizenden euro's voor het bouwen, plus een uurtarief voor elke aanpassing daarna. Nebula werkt anders: je krijgt een complete, professionele website én je beheert 'm daarna zelf voor een vast bedrag per maand, zonder verrassingen. Zo houd je grip op je kosten én op je site.</p>
<h2>Zelf je website beheren, zonder technische kennis</h2>
<p>Het grootste voordeel: na oplevering ben je niet afhankelijk. Je typt gewoon wat je wilt veranderen — een nieuwe tekst, een extra pagina, andere foto's — en het wordt voor je aangepast. Ideaal voor ondernemers die snel willen schakelen zonder telkens een factuur voor meerwerk.</p>
<h2>Beter gevonden worden in Google</h2>
<p>Een mooie website is niets waard als niemand 'm vindt. Daarom zit goede <a href="https://nebulabookings.com/kennisbank">SEO</a> ingebouwd: nette titels en meta-teksten, snelle pagina's, structured data en automatische sitemaps. Wil je specifiek lokaal gevonden worden, dan richten we je site in op zoektermen als "webdesign bureau Capelle aan den IJssel" en jouw diensten in de regio.</p>
<h2>Veelgestelde vragen</h2>
<h3>Bouwen jullie ook webshops?</h3>
<p>Ja. Naast websites bouwen we webshops met winkelwagen en veilige betaling, en boekingssystemen voor bedrijven die afspraken of lessen online willen laten reserveren.</p>
<h3>Kan ik mijn bestaande website laten overzetten?</h3>
<p>Vaak wel. We kunnen een bestaande site importeren als basis en die vervolgens verbeteren en overzetten naar je eigen beheer.</p>
<h3>Werken jullie alleen in Capelle aan den IJssel?</h3>
<p>Nee, we werken voor ondernemers in heel de regio: Capelle aan den IJssel, Rotterdam, Nieuwerkerk aan den IJssel, Krimpen aan den IJssel en daarbuiten.</p>
<h2>Conclusie</h2>
<p>Een goed webdesign bureau in Capelle aan den IJssel levert niet alleen een mooie website, maar ook eentje die snel is, goed vindbaar en die je daarna zélf kunt beheren. Wil je weten wat we voor jouw bedrijf kunnen betekenen? <a href="https://nebulabookings.com/">Bekijk hier hoe Nebula werkt</a> of vraag vrijblijvend een gesprek aan.</p>`,
  },
];

async function seedCornerstoneArticles(): Promise<void> {
  for (const c of CORNERSTONE) {
    try {
      const [existing] = await db.select({ id: platformBlog.id }).from(platformBlog).where(eq(platformBlog.slug, c.slug));
      if (existing) continue;
      await db.insert(platformBlog).values({ slug: c.slug, title: c.title, metaTitle: c.metaTitle, metaDescription: c.metaDescription, topic: c.topic, html: c.html });
      void submitToIndexNow(CANON_HOST, [`https://${CANON_HOST}/kennisbank/${c.slug}`, `https://${CANON_HOST}/kennisbank`]);
      logger.info({ slug: c.slug }, "[kennisbank] cornerstone article seeded");
    } catch (err) { logger.warn({ err, slug: c.slug }, "[kennisbank] cornerstone seed failed"); }
  }
}

export function startKennisbankScheduler(): void {
  if (started) return;
  started = true;
  void seedCornerstoneArticles(); // idempotent — ensures the cornerstone articles are always live
  // Daily articles now run on the platform owner's OWN Claude subscription (no API key); if the owner
  // hasn't coupled a login, generateKennisbankArticle() simply reports "failed" and we retry later.
  const tick = async () => {
    try { await translatePending(); } catch { /* backfill EN for older articles, best-effort */ }
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
type PageLang = "nl" | "en";
function shell(opts: { title: string; description: string; canonical: string; jsonLd: object[]; body: string; ogType?: string; lang?: PageLang; altPath?: string }): string {
  const lang: PageLang = opts.lang || "nl";
  // hreflang pair: altPath is THIS page's path in the other language (e.g. /en/kennisbank ↔ /kennisbank).
  const here = opts.canonical;
  const other = opts.altPath ? `https://${CANON_HOST}${opts.altPath}` : "";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">
${other ? `<link rel="alternate" hreflang="${lang === "nl" ? "en" : "nl"}" href="${esc(other)}">
<link rel="alternate" hreflang="${lang}" href="${esc(here)}">
<link rel="alternate" hreflang="x-default" href="${esc(lang === "nl" ? here : other)}">` : ""}
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=3">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=3">
<link rel="icon" type="image/png" sizes="256x256" href="/favicon.png?v=3">
<link rel="shortcut icon" type="image/png" href="/favicon-32.png?v=3">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=3">
<meta property="og:type" content="${opts.ogType || "website"}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(opts.canonical)}">
<meta property="og:image" content="https://${CANON_HOST}/opengraph.jpg">
${opts.jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n")}
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f4f1;color:#171717;line-height:1.7;-webkit-font-smoothing:antialiased}
  /* Same look as the rest of the platform: the rotating nature photo behind a white haze, with the
     content floating as white "islands" on top. */
  .bg,.haze{position:fixed;inset:0;z-index:-1}
  .bg{background:url("/kennisbank-bg.jpeg") center/cover no-repeat}
  .haze{background:rgba(255,255,255,.55)}
  a{color:inherit}
  .nav-wrap{position:sticky;top:0;z-index:50;display:flex;justify-content:center;padding:16px 12px 8px}
  /* Pixel-identical to the SPA pill nav: gap-0.5, px-1.5 py-1 container; text-xs font-medium, px-3.5 py-1 items. */
  .nav{display:flex;align-items:center;gap:2px;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border:1px solid #e5e7eb;border-radius:999px;padding:4px 6px;box-shadow:0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -2px rgba(0,0,0,.1)}
  .nav a{font-size:12px;line-height:16px;font-weight:500;padding:4px 14px;border-radius:999px;text-decoration:none;color:rgba(23,23,23,.6);transition:.15s}
  .nav a:hover{color:#171717;background:rgba(23,23,23,.05)}
  .nav a.on{background:#171717;color:#fff}
  main{max-width:760px;margin:0 auto;padding:36px 20px 60px}
  .crumb{font-size:12.5px;color:#8a8578;margin-bottom:18px}
  .crumb a{color:#8a8578;text-decoration:none}
  .crumb a:hover{text-decoration:underline}
  .hero h1{font-size:clamp(30px,5vw,42px);line-height:1.12;letter-spacing:-.02em;font-weight:800}
  .hero p.sub{margin-top:12px;font-size:17px;color:#6f6a5e;max-width:56ch}
  .cards{display:grid;gap:14px;margin-top:30px}
  .card{display:block;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.7);border-radius:20px;padding:22px 24px;text-decoration:none;box-shadow:0 6px 24px rgba(0,0,0,.10);transition:.15s}
  .card:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.09)}
  .card .date{font-size:12px;color:#a09a8c;font-weight:550;text-transform:uppercase;letter-spacing:.06em}
  .card h2{font-size:19px;line-height:1.3;margin:6px 0 6px;letter-spacing:-.01em}
  .card p{font-size:14.5px;color:#6f6a5e}
  .card .more{display:inline-block;margin-top:10px;font-size:13px;font-weight:600;color:#171717}
  /* Small, subtle CTA INSIDE the white island (replaces the old big dark block): a quiet divider +
     pill button at the end of each article. */
  .kb-cta{margin-top:30px;padding-top:20px;border-top:1px solid #eceae5}
  .btn-sub{display:inline-block;font-size:13px;font-weight:600;padding:8px 18px;border-radius:999px;border:1px solid #dedbd4;background:#fff;color:#171717 !important;text-decoration:none !important;transition:.15s}
  .btn-sub:hover{background:#171717;color:#fff !important;border-color:#171717}
  article{background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.7);border-radius:24px;padding:clamp(26px,5vw,48px);box-shadow:0 8px 30px rgba(0,0,0,.12)}
  article .meta{font-size:13px;color:#a09a8c;margin-bottom:14px}
  article h1{font-size:clamp(26px,4.5vw,36px);line-height:1.15;letter-spacing:-.02em;font-weight:800;margin-bottom:18px}
  article h2{font-size:22px;letter-spacing:-.01em;margin:34px 0 10px}
  article h3{font-size:17px;margin:22px 0 6px}
  article p{margin:0 0 14px;font-size:16.5px}
  article ul,article ol{margin:0 0 14px 22px;font-size:16.5px}
  article li{margin-bottom:6px}
  article a{color:#0f62d6;text-decoration:none}
  article a:hover{text-decoration:underline}
  .pager{display:flex;justify-content:center;align-items:center;gap:6px;margin-top:26px}
  .pager a,.pager .on{min-width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;font-size:13.5px;font-weight:600;text-decoration:none;background:rgba(255,255,255,.9);border:1px solid rgba(255,255,255,.7);box-shadow:0 2px 8px rgba(0,0,0,.08);color:rgba(23,23,23,.65)}
  .pager a:hover{color:#171717;transform:translateY(-1px)}
  .pager .on{background:#171717;color:#fff;border-color:#171717}
  footer{padding:26px 16px 40px;text-align:center;font-size:12px;color:rgba(23,23,23,.6);line-height:1.9}
  footer .links{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 16px}
  footer a{color:rgba(23,23,23,.6);text-decoration:none}
  footer a:hover{color:#171717;text-decoration:underline}
</style>
</head>
<body>
<script>try{localStorage.setItem("nebula_lang","${lang}")}catch(e){}</script>
<div class="bg" aria-hidden="true"></div><div class="haze" aria-hidden="true"></div>
<div class="nav-wrap"><nav class="nav">
  <a href="/">Home</a><a href="/ai-editor">Nebula</a><a href="/app">Nebula app</a><a href="/help">${lang === "en" ? "Guide" : "Uitleg"}</a><a class="on" href="${lang === "en" ? "/en/kennisbank" : "/kennisbank"}">${lang === "en" ? "Knowledge base" : "Kennisbank"}</a>${opts.altPath ? `<a href="${esc(opts.altPath)}" title="${lang === "en" ? "Nederlands" : "English"}">${lang === "en" ? "🇳🇱" : "🇬🇧"}</a>` : ""}
</nav></div>
<main>${opts.body}</main>
<footer>
  <div class="links"><a href="/privacy">${lang === "en" ? "Privacy policy" : "Privacybeleid"}</a><a href="/voorwaarden">${lang === "en" ? "Terms & conditions" : "Algemene voorwaarden"}</a><a href="mailto:durand2511@gmail.com">Contact</a></div>
  <div>© ${new Date().getFullYear()} Nebula · Durand van Konijnenburg · KVK 70776857</div>
</footer>
</body>
</html>`;
}


const PER_PAGE = 5;

async function renderIndex(req: Request, res: Response, lang: PageLang = "nl"): Promise<void> {
  const en = lang === "en";
  const all = await db.select().from(platformBlog).orderBy(desc(platformBlog.createdAt)).limit(1000);
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number(req.query.p) || 1));
  const posts = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const base = `https://${CANON_HOST}`;
  const root = en ? "/en/kennisbank" : "/kennisbank";
  const pageUrl = (n: number) => (n <= 1 ? root : `${root}?p=${n}`);
  // Numbered pager (1 2 3 …) once there is more than one page of articles.
  const pager = pages > 1 ? `<nav class="pager" aria-label="${en ? "Pagination" : "Paginering"}">
${page > 1 ? `<a href="${pageUrl(page - 1)}">←</a>` : ""}
${Array.from({ length: pages }, (_, i) => i + 1).map((n) => n === page ? `<span class="on">${n}</span>` : `<a href="${pageUrl(n)}">${n}</a>`).join("\n")}
${page < pages ? `<a href="${pageUrl(page + 1)}">→</a>` : ""}
</nav>` : "";
  const body = `
<div class="hero">
  <h1>${en ? "Knowledge base" : "Kennisbank"}</h1>
  <p class="sub">${en ? "Practical guides about websites, web design, online bookings and getting found on Google — for business owners who just want it done right. A new article every day." : "Praktische gidsen over websites, webdesign, online boekingen en gevonden worden in Google — voor ondernemers die het gewoon goed geregeld willen hebben. Elke dag een nieuw artikel."}</p>
</div>
<div class="cards">
${posts.map((p) => `<a class="card" href="${root}/${esc(p.slug)}"><span class="date">${fmtDate(p.createdAt)}</span><h2>${esc(en && p.titleEn ? p.titleEn : p.title)}</h2><p>${esc(en && p.metaDescriptionEn ? p.metaDescriptionEn : p.metaDescription)}</p><span class="more">${en ? "Read more →" : "Lees verder →"}</span></a>`).join("\n")}
${posts.length === 0 ? `<div class="card"><h2>${en ? "The first articles are coming soon" : "De eerste artikelen verschijnen binnenkort"}</h2><p>${en ? "We publish a new article here every day." : "Elke dag publiceren we hier een nieuw artikel."}</p></div>` : ""}
</div>
${pager}`;
  res.type("html").send(shell({
    lang,
    altPath: en ? "/kennisbank" : "/en/kennisbank",
    title: en
      ? (page > 1 ? `Knowledge base — page ${page} | Nebula` : "Knowledge base — websites, web design & online bookings | Nebula")
      : (page > 1 ? `Kennisbank — pagina ${page} | Nebula` : "Kennisbank — websites, webdesign & online boekingen | Nebula"),
    description: en
      ? "Practical articles about getting a website, web design, booking systems and local SEO for business owners. New every day."
      : "Praktische artikelen over website laten maken, webdesign, boekingssystemen en lokale SEO voor ondernemers. Elke dag nieuw.",
    canonical: `${base}${pageUrl(page)}`,
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

async function renderArticle(req: Request, res: Response, lang: PageLang = "nl"): Promise<void> {
  const en = lang === "en";
  const root = en ? "/en/kennisbank" : "/kennisbank";
  const slug = String(req.params.slug || "");
  const [p] = await db.select().from(platformBlog).where(eq(platformBlog.slug, slug));
  if (!p) { res.status(404).type("html").send(shell({ title: "Niet gevonden — Nebula Kennisbank", description: "Dit artikel bestaat niet (meer).", canonical: `https://${CANON_HOST}/kennisbank`, jsonLd: [], body: `<div class="hero"><h1>Artikel niet gevonden</h1><p class="sub">Dit artikel bestaat niet (meer). <a href="/kennisbank">Terug naar de kennisbank</a>.</p></div>` })); return; }
  const base = `https://${CANON_HOST}`;
  const url = `${base}${root}/${p.slug}`;
  const title = en && p.titleEn ? p.titleEn : p.title;
  const descr = en && p.metaDescriptionEn ? p.metaDescriptionEn : p.metaDescription;
  const html = en && p.htmlEn ? p.htmlEn : p.html;
  const body = `
<div class="crumb"><a href="/">Home</a> › <a href="${root}">${en ? "Knowledge base" : "Kennisbank"}</a> › ${esc(title)}</div>
<article>
  <div class="meta">${fmtDate(p.createdAt)} · ${en ? "Nebula Knowledge base" : "Nebula Kennisbank"}</div>
  <h1>${esc(title)}</h1>
  ${html}
  <div class="kb-cta"><a class="btn-sub" href="https://${CANON_HOST}/">${en ? "Want a website like this? See Nebula →" : "Zelf zo'n website? Bekijk Nebula →"}</a></div>
</article>`;
  res.type("html").send(shell({
    lang,
    altPath: en ? `/kennisbank/${p.slug}` : `/en/kennisbank/${p.slug}`,
    title: `${(en && p.metaTitleEn) || (!en && p.metaTitle) || title} | Nebula`,
    description: descr,
    canonical: url,
    ogType: "article",
    jsonLd: [
      { "@context": "https://schema.org", "@type": "Article", headline: title, description: descr, datePublished: p.createdAt.toISOString(), inLanguage: lang, mainEntityOfPage: url, author: { "@type": "Organization", name: "Nebula" }, publisher: { "@type": "Organization", name: "Nebula", url: base } },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: base },
        { "@type": "ListItem", position: 2, name: en ? "Knowledge base" : "Kennisbank", item: `${base}${root}` },
        { "@type": "ListItem", position: 3, name: title, item: url },
      ] },
    ],
    body,
  }));
}

async function renderSitemap(_req: Request, res: Response): Promise<void> {
  const posts = await db.select({ slug: platformBlog.slug, createdAt: platformBlog.createdAt, htmlEn: platformBlog.htmlEn }).from(platformBlog).orderBy(desc(platformBlog.createdAt)).limit(1000);
  const base = `https://${CANON_HOST}`;
  const urls = [
    `<url><loc>${base}/</loc></url>`,
    `<url><loc>${base}/kennisbank</loc>${posts[0] ? `<lastmod>${posts[0].createdAt.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`,
    `<url><loc>${base}/en/kennisbank</loc></url>`,
    ...posts.map((p) => `<url><loc>${base}/kennisbank/${esc(p.slug)}</loc><lastmod>${p.createdAt.toISOString().slice(0, 10)}</lastmod></url>`),
    ...posts.filter((p) => p.htmlEn).map((p) => `<url><loc>${base}/en/kennisbank/${esc(p.slug)}</loc><lastmod>${p.createdAt.toISOString().slice(0, 10)}</lastmod></url>`),
  ];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
}

// The same rotating background photo as the SPA (attached_assets/nebula-bg-1..6.jpeg, switching
// every 3h) — served under a stable URL because these pages don't go through the Vite bundle.
const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "attached_assets");
function bgFile(): string {
  const n = (Math.floor(Date.now() / (3 * 60 * 60 * 1000)) % 6) + 1;
  return path.join(ASSETS_DIR, `nebula-bg-${n}.jpeg`);
}

export function kennisbankRouter(): express.Router {
  const r = express.Router();
  r.get("/kennisbank-bg.jpeg", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(bgFile(), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });
  r.get("/kennisbank", (req, res) => { renderIndex(req, res, "nl").catch(() => res.status(500).send("Er ging iets mis.")); });
  r.get("/kennisbank/:slug", (req, res) => { renderArticle(req, res, "nl").catch(() => res.status(500).send("Er ging iets mis.")); });
  r.get("/en/kennisbank", (req, res) => { renderIndex(req, res, "en").catch(() => res.status(500).send("Something went wrong.")); });
  r.get("/en/kennisbank/:slug", (req, res) => { renderArticle(req, res, "en").catch(() => res.status(500).send("Something went wrong.")); });
  r.get("/sitemap.xml", (req, res) => { renderSitemap(req, res).catch(() => res.status(500).send("")); });
  r.get(`/${INDEXNOW_KEY}.txt`, (_req, res) => { res.type("text/plain").send(INDEXNOW_KEY); });
  return r;
}
