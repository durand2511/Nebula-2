/**
 * SEO/AEO content PIPELINE — quality over quantity. Per article it runs:
 *   1. topic + keyword + search intent (+ overlap check vs existing)
 *   2. content brief (keywords, audience, outline, FAQ, internal links, schema type, E-E-A-T)
 *   3. article (1500+ words, local/niche, examples, short paragraphs, FAQ, conclusion + CTA)
 *   4. quality score (LLM judge across 9 criteria) + heuristics
 *   5. publish decision: publish (score ≥ threshold) | draft (new site / mid) | reject (generic/dup)
 * Published articles get full technical SEO (canonical, Article+FAQ+Breadcrumb JSON-LD, breadcrumbs,
 * internal links, sitemap) and interlink with siblings (content cluster via the blog hub).
 * Generation uses AI; publishing is deterministic (writes project files).
 */
import { db, projectFiles, seoArticles, projectSeo } from "@workspace/db";
import { republishMatching, isPublished } from "./site-publish.js";
import { submitToIndexNow } from "./indexnow.js";
import { listDomains, PLATFORM_HOST } from "./domains.js";
import { eq, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-openai-ai-server";
import { addNavItem, emailBrandSeed, type ProjectFile } from "./actions.js";
import { logger } from "./logger";

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const slugify = (s: string) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "artikel";
const stripTags = (h: string) => String(h || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const wordCount = (h: string) => stripTags(h).split(/\s+/).filter(Boolean).length;
const tokens = (s: string) => new Set(String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 3));
function jaccard(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b); if (!ta.size || !tb.size) return 0;
  let inter = 0; ta.forEach((t) => { if (tb.has(t)) inter++; });
  return inter / (ta.size + tb.size - inter);
}

type Ctx = { studio: string; logo: string; accent: string; domain: string; description: string; language: string };
type Brief = {
  keyword: string; searchIntent: string; secondaryKeywords: string[]; audience: string;
  title: string; metaTitle: string; metaDescription: string;
  outline: { h2: string; h3?: string[] }[]; faqQuestions: string[]; faq: { q: string; a: string }[];
  internalLinkIdeas: { anchor: string; targetKeyword: string }[]; externalSources: { title: string; url: string }[];
  schemaType: string; needsDisclaimer: boolean; disclaimerText: string; authorName: string; authorBio: string;
};
type Judged = { score: number; criteria: Record<string, number>; publishRecommendation: string; improvementNotes: string[] };

function refHtml(files: ProjectFile[]): string {
  const f = files.find((x) => /index\.html$/i.test(x.path) && !/booking/i.test(x.path))
    ?? files.find((x) => x.path.endsWith(".html") && !/booking/i.test(x.path));
  return f?.content ?? "";
}

// Hosts that are NEVER the site's own domain — so the link-guess can't pick a social/analytics/booking
// link as the canonical domain (which would point Google at the wrong site).
const SEO_THIRD_PARTY = /(google|gstatic|googleapis|googletagmanager|doubleclick|youtube|youtu\.be|vimeo|facebook|fbcdn|instagram|twitter|x\.com|linkedin|tiktok|pinterest|wa\.me|whatsapp|t\.me|telegram|paypal|stripe|gravatar|wp\.com|jsdelivr|unpkg|cloudflare|bsport|momoyoga|eversport|mindbody|gmpg\.org|w3\.org|schema\.org)/i;
function guessDomainFromLinks(html: string): string {
  const counts: Record<string, number> = {};
  const re = /<a\b[^>]*\bhref=["']https?:\/\/([^/"'?#\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const h = m[1].toLowerCase().replace(/^www\./, "");
    if (SEO_THIRD_PARTY.test(h) || !h.includes(".")) continue;
    counts[h] = (counts[h] ?? 0) + 1;
  }
  let best = "", n = 0;
  for (const h of Object.keys(counts)) if (counts[h] > n) { n = counts[h]; best = h; }
  return best;
}

/** The project's real published domain for canonical/sitemap: a connected CUSTOM domain first (best
 * for SEO), else the free Nebula subdomain, else "" (caller falls back to the link-guess). */
export async function resolvePublishedDomain(projectId: number): Promise<string> {
  try {
    const all = await listDomains(projectId);
    const isNebula = (d: string) => d.endsWith("." + PLATFORM_HOST);
    const custom = all.find((d) => d.status === "active" && !isNebula(d.domain)) ?? all.find((d) => !isNebula(d.domain));
    if (custom) return custom.domain.replace(/^www\./, "");
    const sub = all.find((d) => isNebula(d.domain));
    if (sub) return sub.domain;
  } catch { /* fall through to the link-guess */ }
  return "";
}

export function deriveContext(files: ProjectFile[], language = "nl", domainOverride?: string): Ctx {
  const seed = emailBrandSeed(files);
  const html = refHtml(files);
  const domain = (domainOverride && domainOverride.trim()) || guessDomainFromLinks(html);
  const description = (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)/i) ?? [])[1] ?? "";
  return { studio: seed.studio, logo: seed.logo, accent: seed.accent, domain, description, language };
}

async function ai(prompt: string, maxTokens: number, timeoutMs = 120000): Promise<string> {
  // Per-call timeout + no SDK retries; catch errors so one slow/failed step degrades gracefully
  // (returns "") instead of throwing and 500-ing the whole request.
  try {
    const resp = await anthropic.messages.create(
      { model: "claude-sonnet-4-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] },
      { timeout: timeoutMs, maxRetries: 0 },
    );
    return resp.content[0]?.type === "text" ? resp.content[0].text : "";
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "[seo] ai call failed");
    return "";
  }
}
function parseJson<T>(text: string, fallback: T): T {
  try {
    const o = text.indexOf("{"), c = text.lastIndexOf("}");
    const a = text.indexOf("["), z = text.lastIndexOf("]");
    const useArr = a !== -1 && (o === -1 || a < o);
    const start = useArr ? a : o, end = useArr ? z : c;
    if (start === -1) return fallback;
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch { return fallback; }
}
async function aiJson<T>(prompt: string, maxTokens: number, fallback: T, timeoutMs = 70000): Promise<T> {
  let out = parseJson<T>(await ai(prompt, maxTokens, timeoutMs), null as unknown as T);
  if (out == null) out = parseJson<T>(await ai(prompt + "\n\nAntwoord met UITSLUITEND geldige JSON.", maxTokens, timeoutMs), fallback);
  return out ?? fallback;
}

// ── Pipeline step 1: topics (cluster-aware) ──
export async function suggestTopics(ctx: Ctx, used: string[], n = 6): Promise<{ title: string; keyword: string }[]> {
  const text = await ai(
    `Je bent SEO-strateeg voor "${ctx.studio}" (${ctx.description || ctx.studio}). Taal: ${ctx.language}.\n` +
    `Stel ${n} artikelonderwerpen voor die samen een CONTENTCLUSTER vormen rond de kernpropositie (long-tail, lage concurrentie, lokaal waar mogelijk). ` +
    `BELANGRIJK: kies onderwerpen die duidelijk VERSCHILLEN van wat al bestaat — geen herhaling, varieer de invalshoek/subniche.\n` +
    `Al gebruikt (titels + zoekwoorden), vermijd deze en alles wat er sterk op lijkt: ${used.slice(0, 80).join(" | ") || "(geen)"}.\n` +
    `PURE JSON-array: [{"title":"...","keyword":"hoofdzoekwoord"}]. Geen uitleg.`, 700);
  return parseJson<{ title: string; keyword: string }[]>(text, []).filter((t) => t && t.title).slice(0, n);
}

// Pick a topic that does NOT overlap meaningfully with anything already written.
function pickFreshTopic(candidates: { title: string; keyword: string }[], past: { title: string; query: string }[]): { title: string; keyword: string } | null {
  const overlapOf = (t: { title: string; keyword: string }) =>
    Math.max(0, ...past.map((p) => Math.max(jaccard(t.title, p.title), jaccard(t.keyword || t.title, p.query || p.title))), 0);
  const ranked = candidates.map((t) => ({ t, o: overlapOf(t) })).sort((a, b) => a.o - b.o);
  const fresh = ranked.find((r) => r.o < 0.4);
  return (fresh || ranked[0])?.t ?? null;
}
// Same ranking, but return ALL candidates freshest-first (for the AUTO retry loop).
function pickFreshTopics(candidates: { title: string; keyword: string }[], past: { title: string; query: string }[]): { title: string; keyword: string }[] {
  const overlapOf = (t: { title: string; keyword: string }) =>
    Math.max(0, ...past.map((p) => Math.max(jaccard(t.title, p.title), jaccard(t.keyword || t.title, p.query || p.title))), 0);
  return candidates
    .map((t) => ({ t, o: overlapOf(t) }))
    .sort((a, b) => a.o - b.o)
    .filter((r) => r.o < 0.6) // drop near-duplicates of existing articles
    .map((r) => r.t);
}

// ── Pipeline step 2: content brief (SMALL JSON — reliable, includes FAQ with answers) ──
async function buildBrief(ctx: Ctx, topic: { title: string; keyword: string }): Promise<Brief> {
  const fb: Brief = {
    keyword: topic.keyword || topic.title, searchIntent: "informatief", secondaryKeywords: [], audience: ctx.studio,
    title: topic.title, metaTitle: topic.title.slice(0, 60), metaDescription: "", outline: [], faqQuestions: [], faq: [],
    internalLinkIdeas: [], externalSources: [], schemaType: "Article", needsDisclaimer: false, disclaimerText: "", authorName: ctx.studio, authorBio: "",
  };
  const b = await aiJson<Brief>(
    `Maak een SEO-contentbrief (taal: ${ctx.language}) voor "${ctx.studio}" (${ctx.description || ctx.studio}) over "${topic.title}" (zoekwoord: ${topic.keyword || topic.title}). Lokaal/niche-specifiek waar passend.\n` +
    `PURE JSON met sleutels: keyword, searchIntent ("informatief"|"lokaal"|"commercieel"|"transactioneel"), secondaryKeywords (3-6), audience, ` +
    `title, metaTitle (max 60), metaDescription (max 155), outline (4-7 items: {"h2","h3":[...]}), ` +
    `faq (3-5 items: {"q","a"} — korte, concrete antwoorden), internalLinkIdeas ([{"anchor","targetKeyword"}]), ` +
    `externalSources ([{"title","url"}] gezaghebbend), schemaType, needsDisclaimer (true bij medisch/financieel/juridisch), disclaimerText, authorName, authorBio (1 zin). Geen uitleg.`,
    2000, fb, 70000);
  b.faq = Array.isArray(b.faq) ? b.faq : [];
  b.secondaryKeywords = Array.isArray(b.secondaryKeywords) ? b.secondaryKeywords : [];
  b.outline = Array.isArray(b.outline) ? b.outline : [];
  b.internalLinkIdeas = Array.isArray(b.internalLinkIdeas) ? b.internalLinkIdeas : [];
  b.keyword = b.keyword || topic.keyword || topic.title;
  b.title = b.title || topic.title;
  b.searchIntent = b.searchIntent || "informatief";
  b.schemaType = b.schemaType || "Article";
  b.authorName = b.authorName || ctx.studio;
  return b;
}

// ── Pipeline step 3: the article body as RAW HTML (NOT inside JSON → no escaping/truncation bugs) ──
async function writeBodyHtml(ctx: Ctx, brief: Brief): Promise<string> {
  const raw = await ai(
    `Schrijf het volledige artikel-LICHAAM (alleen HTML) voor "${ctx.studio}" (taal: ${ctx.language}).\n` +
    `Titel: ${brief.title}\nZoekwoord: ${brief.keyword}\nSecundair: ${(brief.secondaryKeywords || []).join(", ")}\nDoelgroep: ${brief.audience}\nIntentie: ${brief.searchIntent}\n` +
    `Outline: ${JSON.stringify(brief.outline)}\n` +
    `Eisen: minimaal 1500 woorden (tenzij het onderwerp klein is), concrete voorbeelden, lokaal/niche waar kan, korte alinea's, duidelijke koppen, natuurlijke zoekwoorden (geen stuffing), eindig met een korte conclusie + duidelijke call-to-action.\n` +
    `Geef ALLEEN de HTML terug (geen JSON, geen markdown-fences, geen uitleg). Toegestane tags: <h2>,<h3>,<p>,<ul>,<ol>,<li>,<strong>,<blockquote>,<a>. Geen <html>/<head>/<h1>/<img>.`,
    8000, 240000);
  // Clean any stray fences/prose; keep from the first real tag onward.
  let html = raw.replace(/```html?/gi, "").replace(/```/g, "").trim();
  const first = html.search(/<(h2|h3|p|ul|ol|blockquote)\b/i);
  if (first > 0) html = html.slice(first);
  return html.trim();
}

// ── Pipeline step 4: deterministic qualityScore across the 9 criteria (no extra AI call) ──
function scoreArticle(brief: Brief, bodyHtml: string, faq: { q: string; a: string }[], overlap: number): Judged {
  const wc = wordCount(bodyHtml);
  const paras = (bodyHtml.match(/<p\b/gi) || []).length;
  const headings = (bodyHtml.match(/<h[23]\b/gi) || []).length;
  const studioMentions = (stripTags(bodyHtml).toLowerCase().match(/\b(rotterdam|amsterdam|utrecht|den haag|lokale?|in de buurt|bij ons)\b/g) || []).length;
  const intentOk = ["informatief", "lokaal", "commercieel", "transactioneel"].includes((brief.searchIntent || "").toLowerCase());
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const criteria: Record<string, number> = {
    searchIntentMatch: intentOk ? 88 : 60,
    originality: clamp(100 - overlap * 120),
    localRelevance: clamp(60 + Math.min(40, studioMentions * 12)),
    completeness: clamp(wc >= 1500 ? 95 : wc >= 1100 ? 82 : wc >= 700 ? 68 : 45),
    readability: clamp(paras >= 6 && wc / Math.max(1, paras) < 110 ? 88 : 72),
    internalLinks: clamp((brief.internalLinkIdeas?.length || 0) >= 2 ? 85 : (brief.internalLinkIdeas?.length || 0) === 1 ? 70 : 55),
    faqQuality: clamp((faq?.length || 0) >= 3 ? 90 : (faq?.length || 0) >= 1 ? 70 : 40),
    structuredDataValidity: faq.length && headings >= 3 ? 95 : 80,
    duplicateRisk: clamp(overlap * 100),
  };
  const positive = ["searchIntentMatch", "originality", "localRelevance", "completeness", "readability", "internalLinks", "faqQuality", "structuredDataValidity"];
  let score = Math.round(positive.reduce((a, k) => a + criteria[k], 0) / positive.length);
  score = Math.round(score * (1 - Math.min(0.5, criteria.duplicateRisk / 200)));
  score = clamp(score);
  const notes: string[] = [];
  if (wc < 1500) notes.push("Breid het artikel uit naar minimaal 1500 woorden.");
  if ((faq?.length || 0) < 3) notes.push("Voeg meer FAQ-vragen toe (minstens 3).");
  if ((brief.internalLinkIdeas?.length || 0) < 2) notes.push("Voeg meer interne links toe.");
  if (studioMentions === 0) notes.push("Maak het lokaler/specifieker (plaats, buurt, concrete voorbeelden).");
  if (criteria.duplicateRisk >= 50) notes.push("Onderwerp lijkt te veel op bestaande content — kies een unieker invalshoek.");
  const publishRecommendation = score < 70 || overlap >= 0.6 || wc < 600 ? "reject" : score >= 85 ? "publish" : "draft";
  return { score, criteria, publishRecommendation, improvementNotes: notes };
}

// ── publish decision ──
function decide(score: number, overlap: number, wc: number, _newWebsite: boolean, _mode: string, threshold: number): "publish" | "draft" | "reject" {
  if (overlap >= 0.5 || score < 70 || wc < 600) return "reject";   // never publish a near-duplicate or weak article
  return score >= threshold ? "publish" : "draft";
}

// ── technical SEO files ──
const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "Google-Extended", "ClaudeBot", "anthropic-ai", "PerplexityBot", "CCBot", "Applebot-Extended"];
export function robotsTxt(domain: string): string {
  const sm = domain ? `\nSitemap: https://${domain}/sitemap.xml` : "";
  return `User-agent: *\nAllow: /\n\n` + AI_CRAWLERS.map((ua) => `User-agent: ${ua}\nAllow: /`).join("\n\n") + sm + "\n";
}
export function llmsTxt(ctx: Ctx, articles: { title: string; slug: string }[]): string {
  const base = ctx.domain ? `https://${ctx.domain}` : "";
  return `# ${ctx.studio}\n\n> ${ctx.description || ctx.studio}\n\n## Blog\n${articles.map((a) => `- [${a.title}](${base}/blog/${a.slug}.html)`).join("\n") || "- (nog geen artikelen)"}\n`;
}
export function sitemapXml(domain: string, paths: string[]): string {
  const base = domain ? `https://${domain}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url><loc>${esc(base + p)}</loc></url>`).join("\n")}\n</urlset>\n`;
}

// Insert a NATIVE-looking "Blog" item INTO the site's existing menu (clones a real menu item so
// it matches the styling). Tries the tested nav inserter first, then menu-ish <ul>s / <header>
// menus. No top bar — if no menu is found we leave the page unchanged.
function cloneLastItemInto(block: string): string | null {
  const lis = (block.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || []).filter((li) => /<a\b/i.test(li));
  if (lis.length) {
    const tmpl = lis[lis.length - 1];
    const item = tmpl
      .replace(/\sid=("|')[^"']*\1/i, "")
      .replace(/\s(?:aria-current|class)=("|')[^"']*(?:active|current)[^"']*\1/gi, "")
      .replace(/\bhref=("|')[^"']*\1/i, 'href="blog.html"')
      .replace(/(<a\b[^>]*>)[\s\S]*?(<\/a>)/i, "$1Blog$2");
    return block.replace(tmpl, tmpl + "\n" + item);
  }
  // No <li>: a flex/inline menu of bare <a>s — clone the last anchor.
  const as = block.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi);
  if (as && as.length) {
    const tmpl = as[as.length - 1];
    const item = tmpl.replace(/\sid=("|')[^"']*\1/i, "").replace(/\bhref=("|')[^"']*\1/i, 'href="blog.html"').replace(/>([\s\S]*?)<\/a>/i, ">Blog</a>");
    return block.replace(tmpl, tmpl + "\n" + item);
  }
  return null;
}
function ensureBlogLink(html: string): string {
  if (/href=["']blog\.html["']/i.test(html)) return html; // already in the menu
  // 1. The tested inserter (handles <nav> + <ul>/<li> + flex navs, clones a styled item).
  const native = addNavItem(html, "Blog", "blog.html");
  if (native !== html) return native;
  // 2. A menu-ish <ul> not inside <nav> (class/id hints at a menu).
  const ulM = html.match(/<ul\b[^>]*\b(?:class|id)=["'][^"']*(?:menu|nav|primary|main|header)[^"']*["'][^>]*>[\s\S]*?<\/ul>/i);
  if (ulM) { const rep = cloneLastItemInto(ulM[0]); if (rep) return html.replace(ulM[0], rep); }
  // 3. The first <ul> inside <header>.
  const headerM = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/i);
  if (headerM) {
    const ulIn = headerM[0].match(/<ul\b[^>]*>[\s\S]*?<\/ul>/i);
    if (ulIn) { const rep = cloneLastItemInto(ulIn[0]); if (rep) return html.replace(headerM[0], headerM[0].replace(ulIn[0], rep)); }
  }
  return html; // no menu found → leave unchanged (no top bar)
}

function blogIndexHtml(ctx: Ctx, items: { title: string; slug: string }[]): string {
  const accent = ctx.accent || "#7a00df", base = ctx.domain ? `https://${ctx.domain}` : "";
  const cards = items.map((a) => `<a class="card" href="${esc(base)}/blog/${esc(a.slug)}.html"><h3>${esc(a.title)}</h3></a>`).join("\n");
  return `<!DOCTYPE html><html lang="${esc(ctx.language)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blog — ${esc(ctx.studio)}</title><meta name="description" content="Artikelen en tips van ${esc(ctx.studio)}.">
<style>:root{--ac:${accent}}body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;background:#f7f8fa}.wrap{max-width:760px;margin:0 auto;padding:28px 20px 64px}h1{font-size:32px;margin:0 0 20px}.card{display:block;background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:16px 18px;margin:0 0 12px;text-decoration:none;color:#1f2937}.card:hover{border-color:var(--ac)}.card h3{margin:0;font-size:18px;color:var(--ac)}a.home{color:var(--ac);font-weight:700;text-decoration:none}</style>
</head><body><div class="wrap"><p><a class="home" href="${esc(base)}/index.html">← ${esc(ctx.studio)}</a></p><h1>Blog</h1>${cards || "<p>Nog geen artikelen.</p>"}</div></body></html>`;
}

// Full article page with technical SEO + E-E-A-T + internal links (cluster).
function articleHtml(ctx: Ctx, brief: Brief, bodyHtml: string, faq: { q: string; a: string }[], related: { title: string; slug: string }[], isoDate: string): string {
  const accent = ctx.accent || "#7a00df", base = ctx.domain ? `https://${ctx.domain}` : "";
  const url = `${base}/blog/${slugify(brief.title)}.html`;
  const logo = ctx.logo ? `<img src="${esc(ctx.logo)}" alt="Logo van ${esc(ctx.studio)}" style="max-height:46px;max-width:180px;object-fit:contain">` : `<b>${esc(ctx.studio)}</b>`;
  const updated = new Date(isoDate).toLocaleDateString(ctx.language === "nl" ? "nl-NL" : "en-US", { year: "numeric", month: "long", day: "numeric" });
  const faqHtml = faq.length ? `<section class="faq"><h2>Veelgestelde vragen</h2>${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>` : "";
  const relatedHtml = related.length ? `<section class="related"><h2>Lees ook</h2><ul>${related.map((r) => `<li><a href="${esc(base)}/blog/${esc(r.slug)}.html">${esc(r.title)}</a></li>`).join("")}</ul></section>` : "";
  const disclaimer = brief.needsDisclaimer && brief.disclaimerText ? `<p class="disclaimer"><strong>Let op:</strong> ${esc(brief.disclaimerText)}</p>` : "";
  const sources = (brief.externalSources || []).filter((s) => s.url).slice(0, 5);
  const sourcesHtml = sources.length ? `<section class="sources"><h2>Bronnen</h2><ul>${sources.map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.title || s.url)}</a></li>`).join("")}</ul></section>` : "";
  const ld = { "@context": "https://schema.org", "@type": brief.schemaType || "Article", headline: brief.title, description: brief.metaDescription, datePublished: isoDate, dateModified: isoDate, inLanguage: ctx.language, author: { "@type": "Organization", name: brief.authorName || ctx.studio }, publisher: { "@type": "Organization", name: ctx.studio }, mainEntityOfPage: url };
  const faqLd = faq.length ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) } : null;
  const crumbLd = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: ctx.studio, item: `${base}/index.html` }, { "@type": "ListItem", position: 2, name: "Blog", item: `${base}/blog.html` }, { "@type": "ListItem", position: 3, name: brief.title, item: url }] };
  return `<!DOCTYPE html>
<html lang="${esc(ctx.language)}">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(brief.metaTitle || brief.title)}</title>
<meta name="description" content="${esc(brief.metaDescription)}">
<meta name="keywords" content="${esc([brief.keyword, ...(brief.secondaryKeywords || [])].join(", "))}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(brief.title)}"><meta property="og:description" content="${esc(brief.metaDescription)}"><meta property="og:type" content="article">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
${faqLd ? `<script type="application/ld+json">${JSON.stringify(faqLd)}</script>` : ""}
<script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
<style>
:root{--ac:${accent}}
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;background:#f7f8fa;line-height:1.7}
.wrap{max-width:760px;margin:0 auto;padding:20px 20px 64px}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #e6e8ec;margin-bottom:18px}
header a{color:var(--ac);font-weight:700;text-decoration:none;font-size:14px}
.crumbs{font-size:13px;color:#9ca3af;margin:0 0 14px}.crumbs a{color:#9ca3af;text-decoration:none}
h1{font-size:34px;line-height:1.2;margin:0 0 10px}
.byline{color:#6b7280;font-size:14px;margin:0 0 20px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tldr{background:#fff;border:1px solid #e6e8ec;border-left:4px solid var(--ac);border-radius:12px;padding:16px 18px;margin:0 0 26px;font-size:17px}
.tldr b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ac);margin-bottom:4px}
h2{font-size:23px;margin:30px 0 10px}h3{font-size:19px;margin:22px 0 8px}p,li{font-size:17px}
.faq details{background:#fff;border:1px solid #e6e8ec;border-radius:10px;padding:12px 16px;margin:10px 0}.faq summary{font-weight:600;cursor:pointer}
.cta{background:var(--ac);color:#fff;border-radius:14px;padding:22px;margin:30px 0;text-align:center}.cta a{display:inline-block;margin-top:10px;background:#fff;color:var(--ac);font-weight:700;text-decoration:none;padding:10px 20px;border-radius:10px}
.related ul,.sources ul{padding-left:18px}.disclaimer{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:12px 14px;font-size:14px}
.author{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:14px 16px;margin:28px 0}
.author .av{width:42px;height:42px;border-radius:50%;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}
footer{margin-top:36px;padding-top:18px;border-top:1px solid #e6e8ec;color:#9ca3af;font-size:13px}
</style>
</head>
<body><div class="wrap">
<header>${logo}<a href="${esc(base)}/index.html">← ${esc(ctx.studio)}</a></header>
<nav class="crumbs"><a href="${esc(base)}/index.html">Home</a> › <a href="${esc(base)}/blog.html">Blog</a> › ${esc(brief.title)}</nav>
<article>
<h1>${esc(brief.title)}</h1>
<p class="byline"><span>Door <strong>${esc(brief.authorName || ctx.studio)}</strong></span> · <span>Bijgewerkt op ${esc(updated)}</span></p>
<div class="tldr"><b>Kort antwoord</b>${esc(brief.metaDescription)}</div>
${disclaimer}
${bodyHtml}
${faqHtml}
<div class="cta"><strong>Klaar om te starten bij ${esc(ctx.studio)}?</strong><br><a href="${esc(base)}/index.html">Bekijk het aanbod →</a></div>
${relatedHtml}
${sourcesHtml}
<div class="author"><div class="av">${esc((ctx.studio[0] || "S").toUpperCase())}</div><div><strong>${esc(brief.authorName || ctx.studio)}</strong><div style="color:#6b7280;font-size:14px">${esc(brief.authorBio || `Het team van ${ctx.studio}.`)}</div></div></div>
<footer>Geschreven voor ${esc(ctx.studio)} · Laatst bijgewerkt ${esc(updated)}.</footer>
</article>
</div></body>
</html>`;
}

export type PipelineResult = {
  keyword: string; searchIntent: string; title: string; slug: string; metaTitle: string; metaDescription: string;
  outline: unknown[]; articleHtml: string; faq: { q: string; a: string }[]; schemaJsonLd: unknown;
  internalLinks: { anchor: string; targetKeyword: string }[]; qualityScore: number;
  publishRecommendation: "draft" | "publish" | "reject"; improvementNotes: string[];
  status: "draft" | "published" | "reject"; wordCount: number;
};

async function writeFileFor(projectId: number, byPath: Map<string, { id: number }>, path: string, content: string, language = "html") {
  const ex = byPath.get(path);
  if (ex) await db.update(projectFiles).set({ content, updatedAt: new Date() }).where(eq(projectFiles.id, ex.id));
  else await db.insert(projectFiles).values({ projectId, path, content, language });
}

// Find the site's OWN blog page from the nav (an <a> labelled "Blog" pointing to a real page, e.g.
// /blog-vlog) so we can publish articles INTO it instead of a separate blog.html. Null if none.
function findBlogHostPath(rows: { path: string; content: string }[]): string | null {
  const htmlPaths = new Set(rows.filter((r) => /\.html$/i.test(r.path)).map((r) => r.path));
  const ok = (p: string) => htmlPaths.has(p) && p !== "blog.html" && p !== "index.html" && !/^blog\//i.test(p) && !/booking/i.test(p);
  for (const r of rows) {
    if (!/\.html$/i.test(r.path)) continue;
    const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(r.content))) {
      const label = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      if (label !== "blog" && !/^blog\b/.test(label)) continue;
      const slug = m[1].trim().replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/^\//, "").replace(/\/$/, "");
      if (!slug || /^blog\.html$/i.test(slug)) continue;
      const cand = slug.endsWith(".html") ? slug : slug + ".html";
      if (ok(cand)) return cand;
      if (ok(slug)) return slug;
    }
  }
  return null;
}

// A clean, self-contained article-list section injected into the studio's own blog page (marker so it
// gets REPLACED, not duplicated, on each run).
function blogListSection(ctx: Ctx, items: { title: string; slug: string }[]): string {
  const accent = ctx.accent || "#7a00df", base = ctx.domain ? `https://${ctx.domain}` : "";
  const cards = items.map((a) => `<a href="${esc(base)}/blog/${esc(a.slug)}.html" style="display:block;background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:16px 18px;margin:0 0 12px;text-decoration:none;color:#1f2937"><span style="display:block;font-size:18px;font-weight:600;color:${accent}">${esc(a.title)}</span></a>`).join("");
  return `<section data-nebula-blog-list style="max-width:760px;margin:40px auto;padding:0 20px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"><h2 style="font-size:26px;margin:0 0 16px;color:#1f2937">Blog</h2>${cards || "<p>Nog geen artikelen.</p>"}</section>`;
}

// Insert/replace the article list inside the host page — before the footer (safe: appends at the end of
// the content, never touches the existing layout above it).
function injectBlogList(html: string, section: string): string {
  if (/data-nebula-blog-list/i.test(html)) return html.replace(/<section\b[^>]*data-nebula-blog-list[\s\S]*?<\/section>/i, section);
  if (/<footer\b/i.test(html)) return html.replace(/<footer\b/i, section + "\n<footer");
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, section + "</body>");
  return html + section;
}

// Turn the old separate hub into a redirect to the studio's real blog page (avoids a duplicate hub).
function blogRedirectHtml(hostPath: string): string {
  const url = "/" + hostPath.replace(/\.html$/i, "");
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=${esc(url)}"><link rel="canonical" href="${esc(url)}"><title>Blog</title></head><body><p>De blog staat op <a href="${esc(url)}">${esc(url)}</a>.</p></body></html>`;
}

// Remove a duplicate "Blog" nav item that points to blog.html (precise: one <li>, or a bare <a>).
function stripDupBlogNav(html: string): string {
  let out = html.replace(/<li\b(?:(?!<\/li>)[\s\S])*?\bhref=["']blog\.html["'](?:(?!<\/li>)[\s\S])*?<\/li>/gi, "");
  out = out.replace(/<a\b[^>]*\bhref=["']blog\.html["'][\s\S]*?<\/a>/gi, "");
  return out;
}

// Recompute the blog hub + robots/llms/sitemap. If the site already has its OWN blog page (from the
// nav), publish the article list INTO that page and redirect blog.html to it; otherwise fall back to
// generating a standalone blog.html + a Blog nav link (original behaviour — nothing breaks).
async function syncPublishedAux(projectId: number, ctx: Ctx, rows: { path: string; id: number; content: string }[]) {
  const pub = await db.select().from(seoArticles).where(and(eq(seoArticles.projectId, projectId), eq(seoArticles.status, "published")));
  const pubList = pub.map((p) => ({ title: p.title, slug: p.slug }));
  const byPath = new Map(rows.map((f) => [f.path, { id: f.id }]));
  const hostPath = findBlogHostPath(rows);
  const hubUrl = hostPath ? "/" + hostPath.replace(/\.html$/i, "") : "/blog.html";
  await writeFileFor(projectId, byPath, "robots.txt", robotsTxt(ctx.domain), "plaintext");
  await writeFileFor(projectId, byPath, "llms.txt", llmsTxt(ctx, pubList), "plaintext");
  await writeFileFor(projectId, byPath, "sitemap.xml", sitemapXml(ctx.domain, ["/index.html", hubUrl, ...pubList.map((a) => `/blog/${a.slug}.html`)]), "xml");

  const changed = new Set<string>();
  if (hostPath) {
    await writeFileFor(projectId, byPath, "blog.html", blogRedirectHtml(hostPath));
    const section = blogListSection(ctx, pubList);
    for (const f of rows) {
      if (!f.path.toLowerCase().endsWith(".html")) continue;
      if (/^blog\//i.test(f.path) || f.path === "blog.html" || /booking/i.test(f.path)) continue;
      let c = stripDupBlogNav(f.content);
      if (f.path === hostPath) c = injectBlogList(c, section);
      if (c !== f.content) { await db.update(projectFiles).set({ content: c, updatedAt: new Date() }).where(eq(projectFiles.id, f.id)); changed.add(f.path); }
    }
  } else {
    await writeFileFor(projectId, byPath, "blog.html", blogIndexHtml(ctx, pubList));
    for (const f of rows) {
      if (!f.path.toLowerCase().endsWith(".html")) continue;
      if (/^blog\//i.test(f.path) || f.path === "blog.html" || /booking/i.test(f.path)) continue;
      const updated = ensureBlogLink(f.content);
      if (updated !== f.content) await db.update(projectFiles).set({ content: updated, updatedAt: new Date() }).where(eq(projectFiles.id, f.id));
    }
  }
  // Auto re-publish ONLY the blog/SEO files + the specific pages we deliberately edited (host branch),
  // so an unrelated draft edit elsewhere isn't pushed live by accident.
  try {
    await republishMatching(projectId, (p) => p === "blog.html" || /^blog\//i.test(p) || p === "robots.txt" || p === "llms.txt" || p === "sitemap.xml" || changed.has(p));
  } catch { /* best-effort */ }
  // Ping IndexNow (Bing/Yandex) so the new/updated blog URLs get picked up instantly.
  try {
    const host = ctx.domain;
    if (host && !/localhost|127\.0\.0\.1|^$/.test(host)) {
      const urls = [hubUrl, ...pubList.map((a) => `/blog/${a.slug}.html`)].map((u) => `https://${host}${u}`);
      await submitToIndexNow(host, urls);
    }
  } catch { /* best-effort */ }
  // Also re-submit the sitemap to GOOGLE (if the studio connected Search Console) so new articles get
  // picked up fast. Dynamic import avoids a static seo↔gsc import cycle.
  try { const { submitSitemapToGoogle } = await import("./gsc.js"); await submitSitemapToGoogle(projectId); } catch { /* best-effort */ }
}

/**
 * Self-heal already-published sites whose auto-generated blog articles landed in the draft but never
 * reached the LIVE snapshot — so /blog/<slug>.html fell back to the homepage and Google couldn't index
 * it. For every project with published articles that was fully published at least once, make sure each
 * article page file exists (re-rendering from its stored payload if the draft file is gone), then push
 * the blog/SEO files into the live snapshot. Blog-scoped and best-effort: never touches non-blog files,
 * never throws. Safe to run on every boot (idempotent).
 */
export async function reconcileBlogPublishing(): Promise<void> {
  try {
    const projs = await db.selectDistinct({ projectId: seoArticles.projectId })
      .from(seoArticles).where(eq(seoArticles.status, "published"));
    let fixed = 0;
    for (const { projectId } of projs) {
      try {
        if (!(await isPublished(projectId))) continue; // never fully published → don't push a partial site live
        const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
        if (!rows.some((f) => f.path.endsWith(".html"))) continue;
        const ctx = deriveContext(rows.map((f) => ({ path: f.path, content: f.content })), "nl", await resolvePublishedDomain(projectId));
        const arts = await db.select().from(seoArticles).where(and(eq(seoArticles.projectId, projectId), eq(seoArticles.status, "published")));
        const byPath = new Map(rows.map((f) => [f.path, { id: f.id }]));
        // Re-render any published article whose page file went missing from the draft.
        for (const art of arts) {
          const path = `blog/${art.slug}.html`;
          if (byPath.has(path)) continue;
          const payload = parseJson<PipelineResult>(art.payload, null as unknown as PipelineResult);
          if (!payload?.articleHtml) continue;
          const brief = briefFromPayload(payload, ctx);
          const related = arts.filter((a) => a.id !== art.id).slice(-5).map((p) => ({ title: p.title, slug: p.slug }));
          const iso = new Date(art.updatedAt || Date.now()).toISOString().slice(0, 10);
          await writeFileFor(projectId, byPath, path, articleHtml(ctx, brief, payload.articleHtml, payload.faq || [], related, iso));
        }
        const fresh = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
        await syncPublishedAux(projectId, ctx, fresh.map((f) => ({ path: f.path, id: f.id, content: f.content })));
        fixed++;
      } catch (err) { logger.warn({ err, projectId }, "[seo] reconcile project failed"); }
    }
    logger.info({ projects: projs.length, fixed }, "[seo] blog reconcile done");
  } catch (err) { logger.warn({ err }, "[seo] blog reconcile failed"); }
}

// Reconstruct a Brief from a stored pipeline payload (for re-rendering drafts/updates).
function briefFromPayload(p: PipelineResult, ctx: Ctx): Brief {
  return {
    keyword: p.keyword, searchIntent: p.searchIntent, secondaryKeywords: [], audience: ctx.studio,
    title: p.title, metaTitle: p.metaTitle, metaDescription: p.metaDescription,
    outline: (p.outline as { h2: string; h3?: string[] }[]) || [], faqQuestions: (p.faq || []).map((f) => f.q), faq: p.faq || [],
    internalLinkIdeas: p.internalLinks || [], externalSources: [], schemaType: "Article",
    needsDisclaimer: false, disclaimerText: "", authorName: ctx.studio, authorBio: "",
  };
}

/**
 * Run the full pipeline and (conditionally) publish ONE article. Returns the pipeline JSON +
 * decision, or null if there's no site content. `mode` = 'manual' | 'auto'.
 */
export async function publishArticle(projectId: number, isoDate: string, opts?: { topic?: { title: string; keyword: string }; mode?: "manual" | "auto" }): Promise<(PipelineResult & { skipped?: string }) | null> {
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const files = rows.map((f) => ({ path: f.path, content: f.content }));
  if (!files.some((f) => f.path.endsWith(".html"))) return null;
  const mode = opts?.mode ?? "manual";
  const ctx = deriveContext(files, "nl", await resolvePublishedDomain(projectId));

  const past = await db.select().from(seoArticles).where(eq(seoArticles.projectId, projectId));
  const publishedPast = past.filter((p) => p.status === "published");
  const pastTopics = past.map((p) => ({ title: p.title, query: p.query }));
  const used = past.map((p) => p.title).concat(past.map((p) => p.query).filter(Boolean));
  const newWebsite = publishedPast.length < 3;
  const threshold = (await getSettings(projectId)).autoPublishMin;

  // Candidate topics. In AUTO mode we try several (freshest first) so we can keep going until one
  // article clears the publish threshold; MANUAL uses a single topic.
  let topicQueue: { title: string; keyword: string }[] = [];
  if (opts?.topic) topicQueue = [opts.topic];
  else {
    let ts = await suggestTopics(ctx, used);
    if (!ts.length) ts = await suggestTopics(ctx, used);
    topicQueue = pickFreshTopics(ts, pastTopics).map((t) => ({ title: t.title, keyword: t.keyword }));
  }
  if (!topicQueue.length) topicQueue = [{ title: `Tips en informatie van ${ctx.studio}`, keyword: ctx.studio }];

  // AUTO retries up to a cap to LAND a publishable (>= threshold) article — "keep making one each run
  // until it hits the bar". The score<70 reject floor still protects against weak/duplicate content.
  const MAX_AUTO_ATTEMPTS = 5;
  const maxAttempts = opts?.topic || mode === "manual" ? 1 : Math.min(MAX_AUTO_ATTEMPTS, topicQueue.length);

  let chosen: { brief: Brief; body: { bodyHtml: string; faq: { q: string; a: string }[] }; wc: number; j: Judged; decision: "publish" | "draft" | "reject" } | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const topic = topicQueue[attempt];
    // 2. brief (small JSON)  3. body (raw HTML)
    const brief = await buildBrief(ctx, topic);
    const bodyHtml = await writeBodyHtml(ctx, brief);
    if (!bodyHtml || wordCount(bodyHtml) < 120) { logger.warn({ projectId, topic: topic.title }, "[seo] body generation failed"); continue; }
    const body = { bodyHtml, faq: brief.faq || [] };
    const wc = wordCount(body.bodyHtml);
    const overlap = Math.max(0, ...past.map((p) => Math.max(jaccard(brief.keyword, p.query), jaccard(brief.title, p.title))), 0);
    // 4. quality score (deterministic, no extra AI call)
    const j = scoreArticle(brief, body.bodyHtml, body.faq, overlap);
    // 5. decision. AUTO is quality-gated; MANUAL always publishes.
    let decision = decide(j.score, overlap, wc, newWebsite, mode, threshold);
    if (mode === "manual") decision = "publish";
    if (decision === "publish") { chosen = { brief, body, wc, j, decision }; break; }
    if (decision !== "reject" && (!chosen || j.score > chosen.j.score)) chosen = { brief, body, wc, j, decision }; // best draft as fallback
    logger.info({ projectId, attempt: attempt + 1, score: j.score, decision, threshold }, "[seo] attempt below bar, retrying");
  }
  if (!chosen) return null; // every attempt failed/rejected this run
  const { brief, body, wc, j, decision } = chosen;

  // slug (unique)
  let slug = slugify(brief.title);
  if (past.some((p) => p.slug === slug)) slug = `${slug}-${past.length + 1}`;
  brief.title = brief.title; // keep

  const related = publishedPast.slice(-5).map((p) => ({ title: p.title, slug: p.slug }));
  const ld = { "@type": brief.schemaType || "Article", headline: brief.title };
  const result: PipelineResult = {
    keyword: brief.keyword, searchIntent: brief.searchIntent, title: brief.title, slug,
    metaTitle: brief.metaTitle, metaDescription: brief.metaDescription, outline: brief.outline || [],
    articleHtml: body.bodyHtml, faq: body.faq, schemaJsonLd: ld, internalLinks: brief.internalLinkIdeas || [],
    qualityScore: j.score, publishRecommendation: decision, improvementNotes: j.improvementNotes || [],
    status: decision === "publish" ? "published" : decision === "reject" ? "reject" : "draft", wordCount: wc,
  };

  // record (always — drafts/rejects are reviewable, not lost)
  await db.insert(seoArticles).values({
    projectId, title: brief.title, slug, query: brief.keyword, source: "ai",
    status: result.status, score: j.score, intent: brief.searchIntent, payload: JSON.stringify(result),
  });

  // publish only when the gate says so (drafts/rejects are stored but not written as pages)
  if (decision === "publish") {
    const byPath = new Map(rows.map((f) => [f.path, { id: f.id }]));
    await writeFileFor(projectId, byPath, `blog/${slug}.html`, articleHtml(ctx, brief, body.bodyHtml, body.faq, related, isoDate));
    await syncPublishedAux(projectId, ctx, rows);
  }
  logger.info({ projectId, slug, score: j.score, decision }, "[seo] pipeline done");
  return result;
}

/** Publish a stored draft (human override after review). */
export async function publishDraft(projectId: number, articleId: number, isoDate: string): Promise<boolean> {
  const [row] = await db.select().from(seoArticles).where(and(eq(seoArticles.id, articleId), eq(seoArticles.projectId, projectId)));
  if (!row || row.status !== "draft") return false;
  const payload = parseJson<PipelineResult>(row.payload, null as unknown as PipelineResult);
  if (!payload) return false;
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const ctx = deriveContext(rows.map((f) => ({ path: f.path, content: f.content })), "nl", await resolvePublishedDomain(projectId));
  const brief = briefFromPayload(payload, ctx);
  const related = (await db.select().from(seoArticles).where(and(eq(seoArticles.projectId, projectId), eq(seoArticles.status, "published")))).slice(-5).map((p) => ({ title: p.title, slug: p.slug }));
  await db.update(seoArticles).set({ status: "published", updatedAt: new Date() }).where(eq(seoArticles.id, articleId));
  const byPath = new Map(rows.map((f) => [f.path, { id: f.id }]));
  await writeFileFor(projectId, byPath, `blog/${row.slug}.html`, articleHtml(ctx, brief, payload.articleHtml, payload.faq || [], related, isoDate));
  await syncPublishedAux(projectId, ctx, rows.map((f) => ({ path: f.path, id: f.id, content: f.content })));
  return true;
}

/** Publish a MANUAL blog post (no AI): the user provides a title + body text (+ optional image). */
export async function publishManualArticle(projectId: number, input: { title: string; body: string; image?: string }, isoDate: string): Promise<{ slug: string }> {
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const ctx = deriveContext(rows.map((f) => ({ path: f.path, content: f.content })), "nl", await resolvePublishedDomain(projectId));
  const title = String(input.title || "").trim() || "Nieuw artikel";
  const slug = slugify(title);
  const plain = String(input.body || "").trim();
  // Plain text → paragraphs (blank line separates paragraphs; single newline → <br>).
  const paras = plain.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");
  const img = input.image && /^https?:\/\//i.test(input.image)
    ? `<img src="${esc(input.image)}" alt="${esc(title)}" style="width:100%;border-radius:14px;margin:0 0 22px;object-fit:cover;max-height:380px">` : "";
  const bodyHtml = img + (paras || "<p></p>");
  const metaDescription = plain.replace(/\s+/g, " ").slice(0, 155).trim() || title;
  const brief: Brief = {
    keyword: title, searchIntent: "informational", secondaryKeywords: [], audience: "",
    title, metaTitle: title, metaDescription,
    outline: [], faqQuestions: [], faq: [], internalLinkIdeas: [], externalSources: [],
    schemaType: "Article", needsDisclaimer: false, disclaimerText: "", authorName: ctx.studio, authorBio: "",
  };
  const related = (await db.select().from(seoArticles).where(and(eq(seoArticles.projectId, projectId), eq(seoArticles.status, "published")))).slice(-5).map((p) => ({ title: p.title, slug: p.slug }));
  const payload = JSON.stringify({ manual: true, title, slug, metaDescription, articleHtml: bodyHtml });
  // Update an existing post with the same slug, else insert a new one (avoids duplicate index entries).
  const [existing] = await db.select().from(seoArticles).where(and(eq(seoArticles.projectId, projectId), eq(seoArticles.slug, slug)));
  if (existing) await db.update(seoArticles).set({ title, status: "published", source: "manual", score: 100, payload, updatedAt: new Date() }).where(eq(seoArticles.id, existing.id));
  else await db.insert(seoArticles).values({ projectId, title, slug, query: title, source: "manual", status: "published", score: 100, intent: "informational", payload });
  const byPath = new Map(rows.map((f) => [f.path, { id: f.id }]));
  await writeFileFor(projectId, byPath, `blog/${slug}.html`, articleHtml(ctx, brief, bodyHtml, [], related, isoDate));
  await syncPublishedAux(projectId, ctx, rows.map((f) => ({ path: f.path, id: f.id, content: f.content })));
  logger.info({ projectId, slug }, "[seo] manual blog published");
  return { slug };
}

/** Update/refresh an existing published article (re-writes the body, bumps the date). */
export async function improveArticle(projectId: number, isoDate: string, articleId?: number): Promise<{ title: string; slug: string } | null> {
  const pub = await db.select().from(seoArticles).where(and(eq(seoArticles.projectId, projectId), eq(seoArticles.status, "published")));
  if (!pub.length) return null;
  const target = articleId ? pub.find((a) => a.id === articleId) : pub.slice().sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())[0];
  if (!target) return null;
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  const ctx = deriveContext(rows.map((f) => ({ path: f.path, content: f.content })), "nl", await resolvePublishedDomain(projectId));
  const payload = parseJson<PipelineResult>(target.payload, null as unknown as PipelineResult);
  const brief = payload ? briefFromPayload(payload, ctx) : briefFromPayload({ keyword: target.query, searchIntent: target.intent || "informatief", title: target.title, slug: target.slug, metaTitle: target.title, metaDescription: "", outline: [], articleHtml: "", faq: [], schemaJsonLd: {}, internalLinks: [], qualityScore: target.score, publishRecommendation: "publish", improvementNotes: [], status: "published", wordCount: 0 }, ctx);
  let body = await writeBody(ctx, brief);
  if (!body) body = await writeBody(ctx, brief);
  if (!body) return null;
  const related = pub.filter((a) => a.id !== target.id).slice(-5).map((p) => ({ title: p.title, slug: p.slug }));
  const byPath = new Map(rows.map((f) => [f.path, { id: f.id }]));
  await writeFileFor(projectId, byPath, `blog/${target.slug}.html`, articleHtml(ctx, brief, body.bodyHtml, body.faq, related, isoDate));
  const newPayload = payload ? { ...payload, articleHtml: body.bodyHtml, faq: body.faq } : null;
  await db.update(seoArticles).set({ updatedAt: new Date(), ...(newPayload ? { payload: JSON.stringify(newPayload) } : {}) }).where(eq(seoArticles.id, target.id));
  await syncPublishedAux(projectId, ctx, rows.map((f) => ({ path: f.path, id: f.id, content: f.content })));
  return { title: target.title, slug: target.slug };
}

async function getSettings(projectId: number): Promise<{ maxPerDay: number; autoPublishMin: number }> {
  const [row] = await db.select().from(projectSeo).where(eq(projectSeo.projectId, projectId));
  return { maxPerDay: row?.maxPerDay ?? 2, autoPublishMin: row?.autoPublishMin ?? 70 };
}

/** Articles published today (for the per-day rate limit). */
export async function publishedToday(projectId: number): Promise<number> {
  const all = await db.select().from(seoArticles).where(and(eq(seoArticles.projectId, projectId), eq(seoArticles.status, "published")));
  const today = new Date().toISOString().slice(0, 10);
  return all.filter((a) => new Date(a.createdAt).toISOString().slice(0, 10) === today).length;
}
export { getSettings };
