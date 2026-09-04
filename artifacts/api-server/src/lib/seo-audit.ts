/**
 * Native site-health audits — analyse a project's OWN HTML (from project_files) with cheerio and
 * return an actionable report: an overall score, per-category scores, and a flat list of findings.
 * Three audit kinds share one engine: "seo" (on-page SEO), "a11y" (accessibility / WCAG) and
 * "speed" (page weight & Core Web Vitals heuristics). Every fixable finding carries a `fixPrompt`
 * the editor drops straight into the Claude terminal. Plus a competitor comparison (own homepage vs
 * a rival URL). No external/paid API — 100% self-contained (the competitor check does one plain GET).
 */
import { load as cheerioLoad, type CheerioAPI } from "cheerio";
import { db, projectFiles, importAssets } from "@workspace/db";
import { eq } from "drizzle-orm";

export type Severity = "error" | "warn" | "good" | "info";
export type AuditKind = "seo" | "a11y" | "speed";
export type Finding = {
  id: string;
  page: string;          // "" = site-wide
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  fix?: string;          // human "how to fix"
  fixPrompt?: string;    // ready-to-send instruction for Claude Code
};
export type SeoReport = {
  kind: AuditKind;
  score: number;         // 0..100
  grade: string;         // A..F
  counts: { error: number; warn: number; good: number };
  categories: { key: string; label: string; score: number }[];
  pages: string[];       // audited page paths
  findings: Finding[];
  generatedAt: string;
};

const CAT_LABEL: Record<string, string> = {
  // seo
  meta: "Titel & meta", content: "Inhoud", afbeeldingen: "Afbeeldingen", links: "Links",
  mobiel: "Mobiel", structured: "Structured data", sociaal: "Social media", techniek: "Techniek",
  // a11y
  tekstalt: "Afbeeldingen", formulieren: "Formulieren", koppen: "Koppen", taal: "Taal",
  navigatie: "Navigatie", contrast: "Contrast", aria: "ARIA",
  // speed
  gewicht: "Paginagewicht", scripts: "Scripts", stijlen: "Stijlen", laden: "Laadgedrag",
};

const words = (s: string) => s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;

function auditablePages(rows: { path: string; content: string }[]): { path: string; content: string }[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!/\.html$/i.test(r.path) || r.path === "booking-app.html") return false;
    if (/^(_backup-|makeover-)/i.test(r.path) || /(^|\/)\.nebula/i.test(r.path)) return false;
    if (!/<html|<body|<!doctype/i.test(r.content)) return false;
    const key = r.path.toLowerCase();
    if (seen.has(key)) return false;      // never audit the same path twice
    seen.add(key);
    return true;
  }).slice(0, 500); // generous ceiling (all pages of any normal site) — only a guard against runaways
}

async function loadPages(projectId: number) {
  const rows = (await db.select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles).where(eq(projectFiles.projectId, projectId)))
    .map((r) => ({ path: r.path, content: r.content ?? "" }));
  return { rows, pages: auditablePages(rows) };
}

/** Compute score, grade, per-category scores and sort findings — shared by every audit kind. */
function finalize(kind: AuditKind, findings: Finding[], pages: string[]): SeoReport {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const goods = findings.filter((f) => f.severity === "good").length;
  let score = Math.max(0, Math.min(100, 100 - errors * 9 - warns * 4));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

  const present = [...new Set(findings.map((f) => f.category))];
  const categories = present.map((key) => {
    const fs = findings.filter((f) => f.category === key);
    const e = fs.filter((f) => f.severity === "error").length, w = fs.filter((f) => f.severity === "warn").length;
    return { key, label: CAT_LABEL[key] || key, score: Math.max(0, 100 - e * 25 - w * 12) };
  });

  const sevRank: Record<Severity, number> = { error: 0, warn: 1, info: 2, good: 3 };
  findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || (a.page ? 1 : 0) - (b.page ? 1 : 0));

  return {
    kind, score, grade,
    counts: { error: errors, warn: warns, good: goods },
    categories, pages, findings, generatedAt: new Date().toISOString(),
  };
}

/** Dispatch to the requested audit. */
export async function runAudit(projectId: number, kind: AuditKind): Promise<SeoReport> {
  if (kind === "a11y") return runAccessibilityAudit(projectId);
  if (kind === "speed") return runSpeedAudit(projectId);
  return runSeoAudit(projectId);
}

// ── SEO audit ────────────────────────────────────────────────────────────────────────────────────
export async function runSeoAudit(projectId: number): Promise<SeoReport> {
  const { rows, pages } = await loadPages(projectId);
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  const titles = new Map<string, string[]>();
  const descs = new Map<string, string[]>();
  const pagePaths = new Set(rows.map((r) => r.path.toLowerCase()));
  let anyStructuredBusiness = false;

  for (const pg of pages) {
    const $ = cheerioLoad(pg.content);
    const P = pg.path;

    const title = ($("head title").first().text() || "").trim();
    if (!title) add({ id: `title-missing-${P}`, page: P, severity: "error", category: "meta", title: "Geen paginatitel", detail: "Deze pagina heeft geen <title>. De titel is het belangrijkste dat Google toont in de zoekresultaten.", fix: "Voeg een beschrijvende <title> van 30–60 tekens toe.", fixPrompt: `Voeg aan ${P} een goede SEO-<title> toe (30–60 tekens, met het belangrijkste zoekwoord van deze pagina en de bedrijfsnaam).` });
    else {
      (titles.get(title) || titles.set(title, []).get(title)!).push(P);
      if (title.length < 30) add({ id: `title-short-${P}`, page: P, severity: "warn", category: "meta", title: "Titel is kort", detail: `De titel is ${title.length} tekens. Tussen 30 en 60 tekens benut je de ruimte in Google het best.`, fix: "Maak de titel wat langer en beschrijvender.", fixPrompt: `Maak de <title> van ${P} beschrijvender en 30–60 tekens lang, met het belangrijkste zoekwoord en de plaats/bedrijfsnaam.` });
      if (title.length > 65) add({ id: `title-long-${P}`, page: P, severity: "warn", category: "meta", title: "Titel is te lang", detail: `De titel is ${title.length} tekens; Google kapt titels boven ~60 tekens af.`, fix: "Kort de titel in tot maximaal 60 tekens.", fixPrompt: `Kort de <title> van ${P} in tot maximaal 60 tekens zonder het belangrijkste zoekwoord te verliezen.` });
    }
    const desc = ($('head meta[name="description"]').attr("content") || "").trim();
    if (!desc) add({ id: `desc-missing-${P}`, page: P, severity: "error", category: "meta", title: "Geen meta-omschrijving", detail: "Zonder meta description kiest Google zelf een (vaak rommelig) fragment onder je titel.", fix: "Voeg een wervende meta description van 70–155 tekens toe.", fixPrompt: `Voeg aan ${P} een wervende meta description toe (70–155 tekens) die uitnodigt om te klikken, met het belangrijkste zoekwoord.` });
    else {
      (descs.get(desc) || descs.set(desc, []).get(desc)!).push(P);
      if (desc.length < 70) add({ id: `desc-short-${P}`, page: P, severity: "warn", category: "meta", title: "Meta-omschrijving is kort", detail: `De omschrijving is ${desc.length} tekens. 70–155 tekens werkt het best.`, fix: "Breid de omschrijving uit.", fixPrompt: `Breid de meta description van ${P} uit naar 70–155 tekens, activerend en met het zoekwoord.` });
      if (desc.length > 160) add({ id: `desc-long-${P}`, page: P, severity: "warn", category: "meta", title: "Meta-omschrijving te lang", detail: `De omschrijving is ${desc.length} tekens en wordt afgekapt.`, fix: "Kort in tot 155 tekens.", fixPrompt: `Kort de meta description van ${P} in tot maximaal 155 tekens.` });
    }
    if (!$('head link[rel="canonical"]').length) add({ id: `canonical-${P}`, page: P, severity: "info", category: "techniek", title: "Geen canonical-link", detail: "Een canonical vertelt Google wat de 'officiële' URL van deze pagina is en voorkomt duplicate-content.", fix: "Voeg <link rel=\"canonical\" href=\"…\"> toe.", fixPrompt: `Voeg aan ${P} een correcte <link rel="canonical"> toe die naar de eigen URL van deze pagina wijst.` });

    const h1 = $("h1");
    if (h1.length === 0) add({ id: `h1-missing-${P}`, page: P, severity: "error", category: "content", title: "Geen H1-kop", detail: "Elke pagina hoort precies één <h1> te hebben — de hoofdkop die het onderwerp benoemt.", fix: "Voeg één duidelijke <h1> toe.", fixPrompt: `Voeg aan ${P} precies één <h1>-hoofdkop toe met het belangrijkste zoekwoord van de pagina.` });
    else if (h1.length > 1) add({ id: `h1-many-${P}`, page: P, severity: "warn", category: "content", title: `Meerdere H1's (${h1.length})`, detail: "Meerdere <h1>-koppen verwarren zoekmachines over het hoofdonderwerp.", fix: "Houd één <h1>; maak de rest <h2>/<h3>.", fixPrompt: `Zorg dat ${P} maar één <h1> heeft; zet de overige H1's om naar <h2>/<h3> in een logische volgorde.` });
    const wc = words($("body").text() || "");
    if (wc < 250) add({ id: `thin-${P}`, page: P, severity: "warn", category: "content", title: "Weinig tekst", detail: `Deze pagina heeft ±${wc} woorden. Pagina's met te weinig inhoud ranken moeilijk; mik op 300+ woorden echte tekst.`, fix: "Voeg waardevolle, unieke tekst toe.", fixPrompt: `Breid de tekst op ${P} uit naar minstens 300 woorden nuttige, unieke inhoud (geen opvultekst), passend bij het onderwerp.` });
    if (!$("h2").length && wc > 300) add({ id: `no-h2-${P}`, page: P, severity: "info", category: "content", title: "Geen tussenkoppen", detail: "Langere teksten zonder <h2>-tussenkoppen zijn slechter leesbaar en scoren minder.", fix: "Deel de tekst op met <h2>-tussenkoppen.", fixPrompt: `Voeg logische <h2>-tussenkoppen toe aan ${P} om de tekst leesbaar op te delen.` });

    const imgs = $("img").toArray();
    const noAlt = imgs.filter((im) => !($(im).attr("alt") || "").trim()).length;
    if (noAlt > 0) add({ id: `alt-${P}`, page: P, severity: noAlt > 2 ? "error" : "warn", category: "afbeeldingen", title: `${noAlt} afbeelding${noAlt > 1 ? "en" : ""} zonder alt-tekst`, detail: "Alt-teksten beschrijven afbeeldingen voor Google én slechtzienden. Ze helpen je scoren in Google Afbeeldingen.", fix: "Geef elke <img> een beschrijvende alt.", fixPrompt: `Geef elke <img> op ${P} een beschrijvende, natuurlijke alt-tekst (geen keyword-stuffing) die vertelt wat op de afbeelding staat.` });
    const noDim = imgs.filter((im) => !$(im).attr("width") || !$(im).attr("height")).length;
    if (noDim > 0) add({ id: `dim-${P}`, page: P, severity: "info", category: "afbeeldingen", title: `${noDim} afbeelding${noDim > 1 ? "en" : ""} zonder afmetingen`, detail: "Zonder width/height 'springt' de pagina tijdens het laden (slechte Core Web Vitals).", fix: "Zet width en height op de afbeeldingen.", fixPrompt: `Voeg width- en height-attributen toe aan de <img>'s op ${P} zodat de pagina niet verspringt tijdens het laden.` });

    const internalBroken: string[] = [];
    $("a[href]").each((_i, a) => {
      const href = String($(a).attr("href") || "");
      if (/^(https?:|mailto:|tel:|#|javascript:)/i.test(href) || !href) return;
      const clean = href.split("#")[0].split("?")[0].replace(/^\//, "").replace(/\/$/, "");
      if (!clean) return;
      const candidates = [clean, clean + ".html", clean + "/index.html"];
      if (!candidates.some((c) => pagePaths.has(c.toLowerCase()))) internalBroken.push(href);
    });
    if (internalBroken.length) add({ id: `broken-${P}`, page: P, severity: "error", category: "links", title: `${internalBroken.length} mogelijk kapotte interne link${internalBroken.length > 1 ? "s" : ""}`, detail: `Links naar pagina's die niet bestaan: ${[...new Set(internalBroken)].slice(0, 5).join(", ")}. Kapotte links frustreren bezoekers en Google.`, fix: "Corrigeer of verwijder deze links.", fixPrompt: `Op ${P} wijzen interne links naar niet-bestaande pagina's (${[...new Set(internalBroken)].slice(0, 8).join(", ")}). Corrigeer ze naar bestaande pagina's of verwijder ze.` });
    const vagueLinks = $("a").toArray().filter((a) => /^(klik hier|lees meer|hier|meer|click here|read more)$/i.test(($(a).text() || "").trim())).length;
    if (vagueLinks > 2) add({ id: `vague-${P}`, page: P, severity: "info", category: "links", title: `${vagueLinks} vage linkteksten`, detail: "Linkteksten als 'klik hier' zeggen Google (en bezoekers) niets over de bestemming.", fix: "Gebruik beschrijvende linktekst.", fixPrompt: `Vervang op ${P} vage linkteksten ('klik hier', 'lees meer') door beschrijvende tekst die vertelt waar de link heen gaat.` });

    if (!$('head meta[name="viewport"]').length) add({ id: `viewport-${P}`, page: P, severity: "error", category: "mobiel", title: "Geen viewport-meta", detail: "Zonder viewport-meta is de site niet mobielvriendelijk — een directe ranking-factor bij Google.", fix: "Voeg de viewport-meta toe.", fixPrompt: `Voeg aan ${P} <meta name="viewport" content="width=device-width, initial-scale=1"> toe en zorg dat de layout mobielvriendelijk is.` });
    if (!$("html[lang]").length) add({ id: `lang-${P}`, page: P, severity: "warn", category: "techniek", title: "Geen taal ingesteld", detail: "Zonder lang-attribuut op <html> weet Google (en de voorleessoftware) niet in welke taal de pagina is.", fix: 'Zet lang="nl" (of de juiste taal) op <html>.', fixPrompt: `Zet het juiste lang-attribuut op de <html> van ${P} (bijv. lang="nl").` });
    if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(pg.content)) add({ id: `noindex-${P}`, page: P, severity: "error", category: "techniek", title: "Pagina staat op noindex", detail: "Deze pagina bevat een noindex — Google mag 'm NIET tonen. Bedoeld?", fix: "Verwijder de noindex als de pagina wél gevonden moet worden.", fixPrompt: `Verwijder de robots-noindex van ${P} zodat Google de pagina wél mag indexeren (tenzij die bewust verborgen moet blijven).` });
    if (!$('head link[rel*="icon"]').length) add({ id: `favicon-${P}`, page: P, severity: "info", category: "techniek", title: "Geen favicon", detail: "Een favicon maakt je site herkenbaar in browser-tabs en zoekresultaten.", fix: "Koppel een favicon.", fixPrompt: `Voeg een favicon toe aan ${P} (<link rel="icon" …>).` });

    if (!$('head meta[property="og:title"]').length || !$('head meta[property="og:image"]').length) add({ id: `og-${P}`, page: P, severity: "warn", category: "sociaal", title: "Geen social-preview", detail: "Zonder Open Graph-tags ziet een gedeelde link op WhatsApp/Facebook/LinkedIn er kaal uit (geen titel/afbeelding).", fix: "Voeg og:title, og:description en og:image toe.", fixPrompt: `Voeg aan ${P} Open Graph-tags toe (og:title, og:description, og:image, og:url) plus een twitter:card, zodat gedeelde links een nette preview met afbeelding tonen.` });
    const ld = $('script[type="application/ld+json"]').text() || "";
    if (/"@type"\s*:\s*"(LocalBusiness|Organization|[A-Za-z]*Business|ProfessionalService|HealthAndBeautyBusiness)"/i.test(ld)) anyStructuredBusiness = true;
    if (!$('script[type="application/ld+json"]').length) add({ id: `ld-${P}`, page: P, severity: "info", category: "structured", title: "Geen structured data", detail: "Met JSON-LD structured data begrijpt Google je bedrijf/pagina beter en kun je 'rich results' (sterren, openingstijden) krijgen.", fix: "Voeg passende JSON-LD toe.", fixPrompt: `Voeg aan ${P} passende JSON-LD structured data toe — voor de homepage een LocalBusiness met naam, adres, telefoon, openingstijden; voor artikelen een Article-schema.` });
  }

  for (const [t, ps] of titles) if (ps.length > 1) add({ id: `dup-title-${t.slice(0, 20)}`, page: "", severity: "warn", category: "meta", title: "Dubbele paginatitels", detail: `De titel "${t.slice(0, 60)}" komt op ${ps.length} pagina's voor (${ps.join(", ")}). Elke pagina hoort een unieke titel te hebben.`, fix: "Geef elke pagina een unieke titel.", fixPrompt: `Geef deze pagina's elk een UNIEKE <title> (nu allemaal "${t.slice(0, 60)}"): ${ps.join(", ")}.` });
  for (const [d, ps] of descs) if (ps.length > 1) add({ id: `dup-desc-${d.slice(0, 16)}`, page: "", severity: "warn", category: "meta", title: "Dubbele meta-omschrijvingen", detail: `Dezelfde meta description staat op ${ps.length} pagina's (${ps.join(", ")}).`, fix: "Maak elke omschrijving uniek.", fixPrompt: `Geef deze pagina's elk een UNIEKE meta description: ${ps.join(", ")}.` });
  if (pages.length && !anyStructuredBusiness) add({ id: "no-localbusiness", page: "", severity: "info", category: "structured", title: "Geen bedrijfsgegevens (LocalBusiness)", detail: "Voor lokaal gevonden worden ('… in [plaats]') helpt LocalBusiness-structured data met naam, adres, telefoon en openingstijden enorm.", fix: "Voeg LocalBusiness JSON-LD toe op de homepage.", fixPrompt: "Voeg op de homepage LocalBusiness JSON-LD toe met de echte bedrijfsnaam, adres, telefoonnummer, openingstijden en (indien bekend) geo-coördinaten, zodat we lokaal beter gevonden worden." });
  // Multilingual reach — an opportunity, fixable with Claude. Only suggested when the site isn't
  // already multilingual (no hreflang alternates present).
  const home = pages.find((p) => /(^|\/)index\.html$/i.test(p.path)) || pages[0];
  const hasHreflang = /<link[^>]+hreflang=/i.test(home?.content || "");
  if (pages.length && !hasHreflang) {
    const lm = (home?.content || "").match(/<html[^>]*\blang=["']?([a-z]{2})/i);
    const code = (lm?.[1] || "").toLowerCase();
    const langName = code === "en" ? "Engels" : code === "de" ? "Duits" : code === "es" ? "Spaans" : code === "fr" ? "Frans" : code === "nl" ? "Nederlands" : "één taal";
    add({ id: "multilang", page: "", severity: "info", category: "content", title: "Alleen in één taal", detail: `Je site is nu in ${langName}. Een meertalige site (bijvoorbeeld Engels, en eventueel Spaans, Duits of Frans) vergroot je bereik en laat je in meer landen in Google verschijnen.`, fix: "Voeg vertaalde versies toe met een taalwisselaar en hreflang-tags.", fixPrompt: "Maak de website meertalig: voeg een Engelse versie toe (en indien passend Spaans, Duits en Frans), met een taalwisselaar in het menu en correcte hreflang-tags en lang-attributen per taal, met behoud van de vormgeving en inhoud." });
  }
  add({ id: "sitemap", page: "", severity: "good", category: "techniek", title: "Sitemap aanwezig", detail: "Je site levert automatisch een sitemap.xml — Google vindt zo al je pagina's." });
  add({ id: "https", page: "", severity: "good", category: "techniek", title: "Beveiligd met HTTPS", detail: "Je site draait op https met een geldig SSL-certificaat — een ranking-factor bij Google." });

  return finalize("seo", findings, pages.map((p) => p.path));
}

// ── Accessibility (WCAG) audit ──────────────────────────────────────────────────────────────────
export async function runAccessibilityAudit(projectId: number): Promise<SeoReport> {
  const { pages } = await loadPages(projectId);
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  for (const pg of pages) {
    const $ = cheerioLoad(pg.content);
    const P = pg.path;

    // Images without alt (decorative ones need alt="" explicitly).
    const noAlt = $("img").toArray().filter((im) => $(im).attr("alt") === undefined).length;
    if (noAlt > 0) add({ id: `a11y-alt-${P}`, page: P, severity: noAlt > 2 ? "error" : "warn", category: "tekstalt", title: `${noAlt} afbeelding${noAlt > 1 ? "en" : ""} zonder alt`, detail: "Schermlezers kunnen afbeeldingen zonder alt-tekst niet voorlezen. Decoratieve afbeeldingen krijgen alt=\"\".", fix: "Geef elke afbeelding een alt (of alt=\"\" als puur decoratief).", fixPrompt: `Geef elke <img> op ${P} een passende alt-tekst voor schermlezers; puur decoratieve afbeeldingen krijgen alt="".` });

    // Form fields without an associated label.
    const unlabeled = $("input, select, textarea").toArray().filter((el) => {
      const $el = $(el);
      const type = ($el.attr("type") || "").toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button") return false;
      if ($el.attr("aria-label") || $el.attr("aria-labelledby") || $el.attr("title")) return false;
      const id = $el.attr("id");
      if (id && $(`label[for="${id}"]`).length) return false;
      if ($el.closest("label").length) return false;
      return true;
    }).length;
    if (unlabeled > 0) add({ id: `a11y-label-${P}`, page: P, severity: "error", category: "formulieren", title: `${unlabeled} invoerveld${unlabeled > 1 ? "en" : ""} zonder label`, detail: "Formuliervelden zonder gekoppeld <label> zijn onbruikbaar met een schermlezer en verwarrend voor iedereen.", fix: "Koppel elk veld aan een <label for> of geef een aria-label.", fixPrompt: `Koppel elk formulierveld op ${P} aan een zichtbaar <label for="…"> (of geef een aria-label als er geen zichtbaar label kan zijn).` });

    // Buttons / links with no discernible text.
    const emptyBtns = $("button, a").toArray().filter((el) => {
      const $el = $(el);
      if (($el.text() || "").trim()) return false;
      if ($el.attr("aria-label") || $el.attr("title")) return false;
      if ($el.find("img[alt]").toArray().some((im) => ($(im).attr("alt") || "").trim())) return false;
      // an icon-only control with no accessible name
      return $el.find("svg, i, img").length > 0 || true;
    }).filter((el) => !($(el).text() || "").trim() && !$(el).attr("aria-label")).length;
    if (emptyBtns > 0) add({ id: `a11y-emptybtn-${P}`, page: P, severity: "warn", category: "navigatie", title: `${emptyBtns} knop/link zonder toegankelijke naam`, detail: "Knoppen of links met alleen een icoon en geen tekst worden door schermlezers als 'knop' voorgelezen — zonder wat ze doen.", fix: "Geef icoon-knoppen een aria-label.", fixPrompt: `Geef elke icoon-only knop/link op ${P} een aria-label die vertelt wat hij doet (bijv. aria-label="Menu openen").` });

    // Language.
    if (!$("html[lang]").length) add({ id: `a11y-lang-${P}`, page: P, severity: "error", category: "taal", title: "Geen taal ingesteld", detail: "Zonder lang-attribuut leest een schermlezer de pagina met de verkeerde stem/uitspraak voor.", fix: 'Zet lang="nl" op <html>.', fixPrompt: `Zet het juiste lang-attribuut op de <html> van ${P} (bijv. lang="nl").` });

    // Heading order (no H1, or a jump like H1→H3).
    const heads = $("h1,h2,h3,h4,h5,h6").toArray().map((h) => Number((h as { tagName?: string }).tagName?.[1] || (h as { name?: string }).name?.[1] || 0));
    if (!heads.includes(1)) add({ id: `a11y-h1-${P}`, page: P, severity: "warn", category: "koppen", title: "Geen H1", detail: "Een pagina zonder <h1> mist een duidelijk startpunt voor schermlezer-navigatie.", fix: "Voeg één H1 toe.", fixPrompt: `Voeg aan ${P} één duidelijke <h1> toe als hoofdkop.` });
    let jump = false;
    for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) jump = true;
    if (jump) add({ id: `a11y-hjump-${P}`, page: P, severity: "info", category: "koppen", title: "Koppen slaan niveaus over", detail: "De koppenstructuur springt (bijv. van H2 naar H4). Schermlezers gebruiken die niveaus om te navigeren.", fix: "Gebruik koppen in oplopende volgorde.", fixPrompt: `Herstel de koppenvolgorde op ${P} zodat niveaus niet worden overgeslagen (H1→H2→H3, niet H2→H4).` });

    // Positive tab-order / autoplay checks.
    if ($("[tabindex]").toArray().some((el) => Number($(el).attr("tabindex")) > 0)) add({ id: `a11y-tabindex-${P}`, page: P, severity: "info", category: "navigatie", title: "Positieve tabindex", detail: "tabindex groter dan 0 breekt de logische toetsenbord-volgorde van de pagina.", fix: "Gebruik tabindex=\"0\" of \"-1\", nooit hoger.", fixPrompt: `Vervang op ${P} elke tabindex groter dan 0 door 0 of -1 en laat de DOM-volgorde de tab-volgorde bepalen.` });
    if ($("video[autoplay]:not([muted]), audio[autoplay]").length) add({ id: `a11y-autoplay-${P}`, page: P, severity: "warn", category: "navigatie", title: "Automatisch geluid", detail: "Media die automatisch met geluid afspeelt is hinderlijk en een toegankelijkheidsprobleem.", fix: "Zet media op muted of laat de bezoeker zelf starten.", fixPrompt: `Zorg dat automatisch afspelende media op ${P} gedempt start (muted) of pas start na een klik.` });
  }
  if (pages.length) {
    add({ id: "a11y-tip-contrast", page: "", severity: "info", category: "contrast", title: "Controleer kleurcontrast", detail: "Tekst moet genoeg contrast met de achtergrond hebben (WCAG AA: 4.5:1 voor gewone tekst). Lichte grijstinten op wit vallen vaak net buiten de norm.", fix: "Laat Claude de contrastverhoudingen nalopen.", fixPrompt: "Loop de tekstkleuren op de site na en verhoog waar nodig het contrast met de achtergrond naar minstens WCAG AA (4.5:1 voor gewone tekst, 3:1 voor grote tekst)." });
  }
  return finalize("a11y", findings, pages.map((p) => p.path));
}

// ── Speed / Core Web Vitals heuristics ──────────────────────────────────────────────────────────
export async function runSpeedAudit(projectId: number): Promise<SeoReport> {
  const { pages } = await loadPages(projectId);
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  // Byte sizes of the project's own uploaded assets (base64 → ~0.75×). Indexed by full path AND by
  // bare filename, so we still match whether the <img src> is absolute (/assets/x.png), relative
  // (assets/x.png, ../wp-content/…/x.png) or just differs in leading slash.
  const assetRows = await db.select({ path: importAssets.path, data: importAssets.data })
    .from(importAssets).where(eq(importAssets.projectId, projectId));
  const byPath = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const a of assetRows) {
    const bytes = Math.round((a.data?.length || 0) * 0.75);
    const clean = a.path.replace(/^\//, "");
    byPath.set(clean, bytes); byPath.set("/" + clean, bytes);
    byName.set((clean.split("/").pop() || "").toLowerCase(), bytes);
  }
  const kb = (b: number) => Math.round(b / 1024);
  // Resolve an <img src> to its byte size: data-URI (measured inline), or an uploaded asset by path/name.
  const imgBytes = (src: string): number => {
    const s = src.split("?")[0].split("#")[0];
    if (/^data:/i.test(s)) { const c = s.indexOf(","); return c >= 0 ? Math.round((s.length - c - 1) * 0.75) : 0; }
    const bare = s.replace(/^\//, "");
    return byPath.get(s) ?? byPath.get(bare) ?? byName.get((s.split("/").pop() || "").toLowerCase()) ?? 0;
  };

  for (const pg of pages) {
    const $ = cheerioLoad(pg.content);
    const P = pg.path;

    // Render-blocking: external stylesheets + synchronous scripts in <head>.
    const cssLinks = $('link[rel="stylesheet"]').length;
    const headScripts = $("head script[src]").toArray().filter((s) => !$(s).attr("async") && !$(s).attr("defer")).length;
    if (headScripts > 0) add({ id: `spd-headjs-${P}`, page: P, severity: "warn", category: "scripts", title: `${headScripts} blokkerend script in <head>`, detail: "Scripts in de <head> zonder async/defer houden het tekenen van de pagina tegen — de bezoeker staart naar wit.", fix: "Geef ze defer/async of verplaats naar het einde van <body>.", fixPrompt: `Geef de <script src>-tags in de <head> van ${P} een defer- (of async-)attribuut, of verplaats ze naar vlak vóór </body>, zodat ze het laden niet blokkeren.` });
    if (cssLinks > 4) add({ id: `spd-css-${P}`, page: P, severity: "info", category: "stijlen", title: `${cssLinks} losse stylesheets`, detail: "Veel losse CSS-bestanden betekenen veel aparte downloads die het eerste tekenen vertragen.", fix: "Voeg stylesheets samen.", fixPrompt: `Voeg de losse stylesheets op ${P} samen tot minder bestanden om het aantal downloads te beperken.` });

    // Image sizes: measure every <img>, list the biggest, and flag the heavy ones.
    const imgs = $("img").toArray();
    let pageImgBytes = 0; let measured = 0;
    const sized: { name: string; bytes: number }[] = [];
    for (const im of imgs) {
      const src = String($(im).attr("src") || "");
      if (!src) continue;
      const b = imgBytes(src);
      if (b > 0) { pageImgBytes += b; measured++; sized.push({ name: (/^data:/i.test(src) ? "(inline afbeelding)" : src.split("/").pop() || src), bytes: b }); }
    }
    sized.sort((a, b) => b.bytes - a.bytes);
    const bigImgs = sized.filter((s) => s.bytes > 300 * 1024);
    const heavyish = sized.filter((s) => s.bytes > 150 * 1024 && s.bytes <= 300 * 1024);
    const fmtList = (arr: { name: string; bytes: number }[]) => arr.map((s) => `${s.name} (${kb(s.bytes)} KB)`);
    // NB: no fixPrompt on the size findings — the images live as binary assets (served as /assets/…),
    // not as files Claude Code can open, so a "Fix met Claude" would fail. These stay informational.
    if (bigImgs.length) add({ id: `spd-bigimg-${P}`, page: P, severity: "error", category: "gewicht", title: `${bigImgs.length} zware afbeelding${bigImgs.length > 1 ? "en" : ""} (>300 KB)`, detail: `Grote afbeeldingen vertragen het laden fors, vooral op mobiel: ${fmtList(bigImgs).slice(0, 5).join(", ")}. Vervang ze door een lichtere versie (kleiner formaat / WebP).`, fix: "Upload een lichtere/kleinere versie (WebP) van deze afbeeldingen." });
    else if (heavyish.length) add({ id: `spd-heavyimg-${P}`, page: P, severity: "warn", category: "gewicht", title: `${heavyish.length} vrij grote afbeelding${heavyish.length > 1 ? "en" : ""} (>150 KB)`, detail: `Deze kunnen lichter: ${fmtList(heavyish).slice(0, 5).join(", ")}. Mik op < ~150 KB per afbeelding (kleiner formaat / WebP).`, fix: "Upload lichtere versies (WebP)." });
    // Always show the image-weight breakdown so you can see exactly how big your images are.
    if (measured > 0) add({ id: `spd-imgsize-${P}`, page: P, severity: bigImgs.length ? "warn" : "info", category: "gewicht", title: `Afbeeldingen: ±${kb(pageImgBytes)} KB (${measured} stuks)`, detail: `Grootste op deze pagina: ${fmtList(sized).slice(0, 6).join(", ")}${sized.length > 6 ? ", …" : ""}. Gemiddeld ${kb(Math.round(pageImgBytes / measured))} KB per afbeelding.`, fix: "Vervang de zwaarste afbeeldingen door een lichtere/kleinere versie." });
    const lazyable = imgs.filter((im, idx) => idx > 1 && !$(im).attr("loading")).length;
    if (lazyable > 2) add({ id: `spd-lazy-${P}`, page: P, severity: "info", category: "laden", title: `${lazyable} afbeeldingen zonder lazy-loading`, detail: "Afbeeldingen onder de vouw kun je pas laden wanneer de bezoeker er bijna is (loading=\"lazy\"). Dat versnelt het eerste beeld.", fix: 'Zet loading="lazy" op afbeeldingen onder de vouw.', fixPrompt: `Voeg loading="lazy" toe aan de afbeeldingen onder de vouw op ${P} (laat de eerste 1–2 hero-afbeeldingen zonder lazy).` });

    // Inline weight: huge inline <style>/<script> or data: URIs.
    const inlineStyle = $("style").text().length;
    if (inlineStyle > 60 * 1024) add({ id: `spd-inlinecss-${P}`, page: P, severity: "info", category: "stijlen", title: `Veel inline CSS (${kb(inlineStyle)} KB)`, detail: "Een grote hoeveelheid inline CSS wordt bij elke pagina opnieuw meegestuurd in plaats van gecached.", fix: "Verplaats gedeelde CSS naar een apart bestand.", fixPrompt: `Verplaats de grote inline <style> van ${P} naar een gedeeld .css-bestand dat gecached kan worden.` });

    // Total rough page weight.
    const htmlBytes = Buffer.byteLength(pg.content, "utf8");
    const total = htmlBytes + pageImgBytes;
    if (total > 3 * 1024 * 1024) add({ id: `spd-weight-${P}`, page: P, severity: "warn", category: "gewicht", title: `Zware pagina (±${kb(total)} KB)`, detail: "Deze pagina is fors; op een mobiele verbinding duurt dat merkbaar lang. Onder ~1,5 MB is prettig.", fix: "Comprimeer afbeeldingen en verwijder ongebruikte code.", fixPrompt: `Maak ${P} lichter: comprimeer afbeeldingen, verwijder ongebruikte CSS/JS en gebruik WebP, met als doel onder ~1,5 MB totaal.` });
  }
  if (pages.length) add({ id: "spd-good-cdn", page: "", severity: "good", category: "laden", title: "Snelle hosting met HTTPS", detail: "Je site wordt via ons met HTTP-compressie en HTTPS geserveerd — een goede basis voor snelheid." });

  return finalize("speed", findings, pages.map((p) => p.path));
}

// ── Competitor comparison (own homepage vs a rival URL) ────────────────────────────────────────
export type CompetitorItem = { label: string; you: boolean; them: boolean };
export type CompetitorResult = {
  ok: boolean; error?: string;
  competitorUrl: string;
  yourScore: number; theirScore: number;
  items: CompetitorItem[];
  wins: string[];   // where the competitor beats you (things to fix)
};

/** A compact on-page scorecard used for both sides of a competitor comparison. */
function scorecard(html: string): { score: number; checks: Record<string, boolean> } {
  let $: CheerioAPI;
  try { $ = cheerioLoad(html); } catch { return { score: 0, checks: {} }; }
  const title = ($("head title").first().text() || "").trim();
  const desc = ($('head meta[name="description"]').attr("content") || "").trim();
  const bodyWords = words($("body").text() || "");
  const imgs = $("img").toArray();
  const checks: Record<string, boolean> = {
    "Goede paginatitel": title.length >= 30 && title.length <= 65,
    "Meta-omschrijving": desc.length >= 70 && desc.length <= 160,
    "Eén H1-kop": $("h1").length === 1,
    "Voldoende tekst (300+ woorden)": bodyWords >= 300,
    "Tussenkoppen (H2)": $("h2").length > 0,
    "Alle afbeeldingen met alt": imgs.length > 0 && imgs.every((im) => ($(im).attr("alt") || "").trim().length > 0),
    "Mobiel (viewport)": $('head meta[name="viewport"]').length > 0,
    "Social-preview (Open Graph)": $('head meta[property="og:title"]').length > 0 && $('head meta[property="og:image"]').length > 0,
    "Structured data (JSON-LD)": $('script[type="application/ld+json"]').length > 0,
    "Canonical-link": $('head link[rel="canonical"]').length > 0,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return { score: Math.round((passed / Object.keys(checks).length) * 100), checks };
}

export async function compareCompetitor(projectId: number, rawUrl: string): Promise<CompetitorResult> {
  let url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  let host = "";
  try { host = new URL(url).hostname; } catch { return { ok: false, error: "Ongeldige URL.", competitorUrl: rawUrl, yourScore: 0, theirScore: 0, items: [], wins: [] }; }

  // Your homepage (index.html) as the comparison baseline.
  const { rows } = await loadPages(projectId);
  const home = rows.find((r) => /(^|\/)index\.html$/i.test(r.path)) || rows.find((r) => /\.html$/i.test(r.path));
  const yours = scorecard(home?.content || "");

  // Fetch the competitor homepage (best-effort, short timeout, normal browser UA).
  let theirHtml = "";
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    const resp = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; NebulaSEO/1.0)", "Accept": "text/html" } });
    clearTimeout(timer);
    if (!resp.ok) return { ok: false, error: `De site gaf status ${resp.status}.`, competitorUrl: url, yourScore: yours.score, theirScore: 0, items: [], wins: [] };
    theirHtml = (await resp.text()).slice(0, 3_000_000);
  } catch {
    return { ok: false, error: "Kon de site niet ophalen (bereikbaar? blokkeert die bots?).", competitorUrl: url, yourScore: yours.score, theirScore: 0, items: [], wins: [] };
  }
  const theirs = scorecard(theirHtml);

  const labels = Object.keys(yours.checks);
  const items: CompetitorItem[] = labels.map((label) => ({ label, you: !!yours.checks[label], them: !!theirs.checks[label] }));
  const wins = items.filter((i) => i.them && !i.you).map((i) => i.label);
  return { ok: true, competitorUrl: url, yourScore: yours.score, theirScore: theirs.score, items, wins };
}
