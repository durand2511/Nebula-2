/* Standalone SEO-engine test harness. Exercises the DETERMINISTIC render/scoring functions of the SEO
 * pipeline (no AI, no DB queries) and asserts the on-page/technical SEO that Google & AI crawlers read.
 * Bundled by build-seo-test.mjs and run with `node --env-file`. Exits non-zero on any failed assertion. */
import { articleHtml, scoreArticle, sitemapXml, robotsTxt, llmsTxt, deriveContext } from "./lib/seo.js";
import type { ProjectFile } from "./lib/actions.js";

let passed = 0;
const failures: string[] = [];
function ok(cond: boolean, msg: string) { if (cond) passed++; else failures.push(msg); }
function section(name: string) { console.log(`\n── ${name} ──`); }

// ── Fixtures (senszenjoy-like) ─────────────────────────────────────────────
const files: ProjectFile[] = [
  { path: "index.html", content: `<!DOCTYPE html><html><head><meta name="description" content="Yin yoga & mindfulness in een rustige studio."></head><body><a href="https://senszenjoy.nl/">Home</a><a href="https://senszenjoy.nl/blog.html">Blog</a></body></html>` } as ProjectFile,
  { path: ".nebula-author", content: "Joyce Berwald" } as ProjectFile,
];
const ctx = deriveContext(files, "nl", "senszenjoy.nl");
// Give the ctx a real https logo so image/og:image paths get exercised.
(ctx as { logo: string }).logo = "https://senszenjoy.nl/assets/logo.png";

const brief = {
  keyword: "yin yoga voor beginners", searchIntent: "informatief",
  secondaryKeywords: ["yin yoga oefeningen", "yin yoga thuis"], audience: "beginners",
  title: "Wat is yin yoga en hoe begin je ermee?", metaTitle: "Wat is yin yoga? — Sens Zen Joy",
  metaDescription: "Ontdek wat yin yoga is, voor wie het geschikt is en hoe je thuis of in onze studio veilig begint.",
  outline: [{ h2: "Wat is yin yoga?" }, { h2: "Voor wie is het?" }],
  faqQuestions: [], faq: [
    { q: "Is yin yoga geschikt voor beginners?", a: "Ja, yin yoga is juist heel toegankelijk voor beginners." },
    { q: "Hoe vaak moet ik yin yoga doen?", a: "Eén tot drie keer per week geeft al merkbaar resultaat." },
    { q: "Heb ik speciale spullen nodig?", a: "Een mat en eventueel een bolster; meer niet." },
  ],
  internalLinkIdeas: [{ anchor: "mindfulness", targetKeyword: "mindfulness" }, { anchor: "lessen", targetKeyword: "yoga lessen" }],
  externalSources: [{ title: "Gezondheidsbron", url: "https://example.org/yin" }],
  schemaType: "Article", needsDisclaimer: false, disclaimerText: "", authorName: "Joyce Berwald", authorBio: "Yin-docent bij Sens Zen Joy.",
};
const body = `<h2>Wat is yin yoga?</h2><p>Yin yoga is een rustige, meditatieve vorm van yoga waarbij je houdingen langer vasthoudt. ${"Zo geef je je bindweefsel de tijd om te ontspannen en te herstellen. ".repeat(40)}</p><h2>Voor wie is het?</h2><p>Iedereen kan meedoen, ongeacht ervaring of leeftijd.</p>`;
const related = [{ title: "Mindfulness voor drukke hoofden", slug: "mindfulness-voor-drukke-hoofden" }];

// Extract & parse every JSON-LD block — catches escaping/serialisation bugs.
function jsonLdBlocks(html: string): any[] {
  const out: any[] = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) { try { out.push(JSON.parse(m[1])); } catch { out.push({ __parseError: true, raw: m[1].slice(0, 80) }); } }
  return out;
}

// ── 1. Article render with DISTINCT published/modified dates ────────────────
section("Article render (distinct dates)");
const html = articleHtml(ctx, brief as any, body, brief.faq, related, { published: "2026-06-01", modified: "2026-07-14" });

ok(/<link rel="canonical" href="https:\/\/senszenjoy\.nl\/blog\/wat-is-yin-yoga-en-hoe-begin-je-ermee\.html">/.test(html), "canonical points to the article URL on the right domain");
ok((html.match(/<h1\b/g) || []).length === 1, "exactly one <h1>");
ok(/<meta name="robots" content="index, follow, max-image-preview:large/.test(html), "robots meta with max-image-preview:large");
ok(/<meta property="og:url" content="https:\/\/senszenjoy\.nl\/blog\//.test(html), "og:url present");
ok(/<meta property="og:image" content="https:\/\/senszenjoy\.nl\/assets\/logo\.png">/.test(html), "og:image present (logo)");
ok(/<meta name="twitter:card" content="summary_large_image">/.test(html), "twitter summary_large_image (image present)");
ok(/<meta property="article:published_time" content="2026-06-01">/.test(html), "article:published_time = published date");
ok(/<meta property="article:modified_time" content="2026-07-14">/.test(html), "article:modified_time = modified date");
ok(/class="crumbs"/.test(html) && /Blog/.test(html) && /aria-current="page"/.test(html), "visible breadcrumb nav present");
ok(/min lezen<\/span>/.test(html), "reading time in byline");
ok(/14 juli 2026/.test(html), "byline shows the Dutch-formatted MODIFIED date");

const lds = jsonLdBlocks(html);
ok(lds.every((l) => !l.__parseError), "all JSON-LD blocks parse as valid JSON");
const article = lds.find((l) => l["@type"] === "Article");
ok(!!article, "Article JSON-LD present");
ok(article?.datePublished === "2026-06-01" && article?.dateModified === "2026-07-14", "Article JSON-LD datePublished != dateModified (stable publish date)");
ok(typeof article?.wordCount === "number" && article.wordCount > 200, "Article JSON-LD has a real wordCount");
ok(article?.mainEntityOfPage?.["@id"]?.endsWith(".html"), "mainEntityOfPage is a WebPage @id");
ok(Array.isArray(article?.image) && article.image[0].startsWith("https://"), "Article JSON-LD has an image");
const faqLd = lds.find((l) => l["@type"] === "FAQPage");
ok(faqLd?.mainEntity?.length === 3, "FAQPage JSON-LD has 3 questions");
const crumbLd = lds.find((l) => l["@type"] === "BreadcrumbList");
ok(crumbLd?.itemListElement?.length === 3, "BreadcrumbList JSON-LD has 3 items");

// ── 2. Single-string date path (new post: published == modified) ────────────
section("Article render (single date, back-compat)");
const html2 = articleHtml(ctx, brief as any, body, brief.faq, related, "2026-07-14T10:00:00.000Z");
const a2 = jsonLdBlocks(html2).find((l) => l["@type"] === "Article");
ok(a2?.datePublished === a2?.dateModified, "single-string date → datePublished == dateModified");
ok(jsonLdBlocks(html2).every((l) => !l.__parseError), "JSON-LD still valid with single-string date");

// ── 3. Meta-description fallback when brief has none ────────────────────────
section("Meta-description fallback");
const briefNoDesc = { ...brief, metaDescription: "" };
const html3 = articleHtml(ctx, briefNoDesc as any, body, [], [], "2026-07-14");
const descM = html3.match(/<meta name="description" content="([^"]*)"/);
ok(!!descM && descM[1].length > 20, "empty metaDescription falls back to article opening text");

// ── 4. Quality scoring & decision ───────────────────────────────────────────
section("Quality scoring");
const judged = scoreArticle(brief as any, body, brief.faq, 0.1);
ok(judged.score >= 0 && judged.score <= 100, "score within 0..100");
ok(["publish", "draft", "reject"].includes(judged.publishRecommendation), "valid publish recommendation");
const dupJudged = scoreArticle(brief as any, body, brief.faq, 0.9);
ok(dupJudged.publishRecommendation === "reject", "near-duplicate (overlap .9) is rejected");

// ── 5. Sitemap / robots / llms ──────────────────────────────────────────────
section("Sitemap / robots / llms");
const sm = sitemapXml("senszenjoy.nl", ["/index.html", "/blog.html", "/blog/wat-is-yin-yoga.html"]);
ok(sm.includes("http://www.sitemaps.org/schemas/sitemap/0.9"), "sitemap uses the VALID sitemaps.org namespace");
ok(sm.includes("<loc>https://senszenjoy.nl/blog/wat-is-yin-yoga.html</loc>"), "sitemap contains article URL");
const rob = robotsTxt("senszenjoy.nl");
ok(/User-agent: GPTBot/.test(rob) && /User-agent: ClaudeBot/.test(rob), "robots.txt allows AI crawlers");
ok(/Sitemap: https:\/\/senszenjoy\.nl\/sitemap\.xml/.test(rob), "robots.txt references the sitemap");
const llms = llmsTxt(ctx, [{ title: "Wat is yin yoga", slug: "wat-is-yin-yoga" }]);
ok(/senszenjoy\.nl\/blog\/wat-is-yin-yoga\.html/.test(llms), "llms.txt lists the article");

// ── 6. Author byline uses the fixed .nebula-author name ─────────────────────
section("Byline author");
ok(/Door Joyce Berwald/.test(html), "byline uses the fixed .nebula-author name");
ok(ctx.author === "Joyce Berwald", "deriveContext picked up .nebula-author");

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(48)}`);
console.log(`PASSED: ${passed}   FAILED: ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
console.log("✓ all SEO assertions passed");
