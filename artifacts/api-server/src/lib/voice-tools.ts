/**
 * Voice-assistant tools — the "do everything in the app" capability.
 *
 * These are in-process Claude Agent SDK tools bound to one project, so the conversational assistant can
 * actually operate the platform by voice: read statistics, read the SEO analysis, turn automatic SEO on
 * or off, make a backup, and publish (deploy) the site. Each returns a short plain-language result that
 * Claude can read aloud.
 */
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { db, projects, platformUsers, projectSeo } from "@workspace/db";
import { eq } from "drizzle-orm";
import { summary, liveVisitors } from "./analytics.js";
import { runAudit, compareCompetitor } from "./seo-audit.js";
import { getSearchPositions, gscStatus } from "./gsc.js";
import { createBackup } from "./project-backups.js";
import { publishSubdomain, getSubdomain, listDomains, PLATFORM_HOST } from "./domains.js";
import { publishSite } from "./site-publish.js";
import { hasPlatformAccess } from "./billing.js";
import { logger } from "./logger";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

async function liveDomain(projectId: number): Promise<string | null> {
  try {
    const customs = (await listDomains(projectId)).filter((d) => !d.domain.endsWith("." + PLATFORM_HOST) && !d.redirectTo);
    if (customs.length) return customs[0].domain;
    const sub = await getSubdomain(projectId);
    return sub?.domain || null;
  } catch { return null; }
}

async function ownerSubscribed(projectId: number): Promise<boolean> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p?.ownerId) return false;
  const [u] = await db.select().from(platformUsers).where(eq(platformUsers.id, p.ownerId));
  return hasPlatformAccess(u);
}

export function buildVoiceTools(projectId: number): { mcpServers: Record<string, unknown>; allowedTools: string[] } {
  const stats = tool(
    "bekijk_statistieken",
    "Bekijk de bezoekersstatistieken van deze website (bezoekers, paginaweergaven, hoeveel mensen nu online zijn, populairste pagina, verkeersbronnen, conversies). Gebruik dit als de gebruiker vraagt hoeveel bezoekers/mensen/verkeer de site heeft.",
    { dagen: z.number().min(1).max(365).optional().describe("Aantal dagen terug (standaard 30)") },
    async (args) => {
      try {
        const days = args.dagen || 30;
        const s = await summary(projectId, days);
        const online = await liveVisitors(projectId);
        if (!s.hasData && online === 0) return text(`Er zijn nog geen bezoekersgegevens voor deze site over de afgelopen ${days} dagen.`);
        const top = s.topPages[0]?.path ? ` De populairste pagina is ${s.topPages[0].path}.` : "";
        const ref = s.referrers[0]?.host ? ` Meeste verkeer komt via ${s.referrers[0].host}.` : "";
        const conv = s.conversions.total > 0 ? ` ${s.conversions.total} conversies (${s.conversions.rate}%).` : "";
        return text(`De afgelopen ${days} dagen: ${s.totals.visitors} bezoekers, ${s.totals.views} paginaweergaven, gemiddeld ${s.totals.avgSeconds} seconden per bezoek. Nu online: ${online}.${top}${ref}${conv}`);
      } catch (err) { logger.error({ err, projectId }, "[voice-tool] stats failed"); return text("Ik kon de statistieken even niet ophalen."); }
    },
  );

  const analyse = tool(
    "bekijk_analyse",
    "Voer een analyse van de site uit en geef de score + belangrijkste verbeterpunten. soort='seo' (vindbaarheid), 'toegankelijkheid' (accessibility) of 'snelheid' (speed). Gebruik dit als de gebruiker naar SEO, toegankelijkheid, snelheid of verbeterpunten vraagt. Daarna kun je de punten desgevraagd zelf oplossen door de bestanden aan te passen.",
    { soort: z.enum(["seo", "toegankelijkheid", "snelheid"]).describe("Welke analyse") },
    async (args) => {
      try {
        const kind = args.soort === "toegankelijkheid" ? "a11y" : args.soort === "snelheid" ? "speed" : "seo";
        const label = args.soort === "toegankelijkheid" ? "toegankelijkheid" : args.soort === "snelheid" ? "snelheid" : "SEO";
        const r = await runAudit(projectId, kind as never);
        const issues = (r.findings || []).filter((f: { severity: string }) => f.severity === "error" || f.severity === "warn").slice(0, 3).map((f: { title: string }) => f.title);
        const list = issues.length ? ` Belangrijkste punten: ${issues.join("; ")}.` : " Er zijn geen grote aandachtspunten.";
        return text(`De ${label}-score is ${r.score} van de 100 (${r.grade}). ${r.counts.error} fouten en ${r.counts.warn} aandachtspunten.${list}`);
      } catch (err) { logger.error({ err, projectId }, "[voice-tool] analyse failed"); return text("Ik kon die analyse even niet uitvoeren."); }
    },
  );

  const competitor = tool(
    "vergelijk_concurrent",
    "Vergelijk deze site met een concurrent-website op SEO. Gebruik dit als de gebruiker een concurrent noemt of wil weten hoe de site scoort t.o.v. iemand anders.",
    { url: z.string().describe("De website van de concurrent, bijv. voorbeeld.nl") },
    async (args) => {
      try {
        const r = await compareCompetitor(projectId, args.url);
        if (!r.ok) return text(r.error || "Ik kon die concurrent niet ophalen.");
        const wins = (r.wins || []).slice(0, 2).join("; ");
        return text(`Jij scoort ${r.yourScore} en ${new URL(/^https?:/.test(args.url) ? args.url : "https://" + args.url).hostname} scoort ${r.theirScore}.${wins ? " Waar jij wint: " + wins + "." : ""}`);
      } catch (err) { logger.error({ err, projectId }, "[voice-tool] competitor failed"); return text("De vergelijking lukte even niet."); }
    },
  );

  const google = tool(
    "bekijk_google_posities",
    "Bekijk de Google-posities van de site (waar je op rankt in Google, clicks, vertoningen). Gebruik dit als de gebruiker naar Google-posities, ranking of vindbaarheid in Google vraagt.",
    {},
    async () => {
      try {
        const st = await gscStatus(projectId);
        if (!st.connected) return text("De site is nog niet gekoppeld aan Google Search Console, dus er zijn nog geen Google-posities. Dat koppel je in de SEO-tab op de website.");
        const p = await getSearchPositions(projectId, 28);
        if (!p.ok || !p.rows.length) return text("Er zijn nog geen Google-posities beschikbaar — dat kan een paar dagen duren nadat Google de site heeft geïndexeerd.");
        const top = p.rows.slice(0, 3).map((r: { query: string; position: number }) => `${r.query} (plek ${Math.round(r.position)})`).join(", ");
        return text(`De afgelopen 28 dagen: ${p.totals.clicks} clicks, ${p.totals.impressions} vertoningen, gemiddelde positie ${Math.round(p.totals.position)}. Top zoektermen: ${top}.`);
      } catch (err) { logger.error({ err, projectId }, "[voice-tool] gsc failed"); return text("De Google-posities lukten even niet."); }
    },
  );

  const autoSeo = tool(
    "zet_auto_seo",
    "Zet automatische SEO (dagelijks een AI-artikel schrijven en publiceren) aan of uit voor deze site. Gebruik dit als de gebruiker vraagt automatische SEO / de SEO-motor / auto-artikelen aan of uit te zetten.",
    { aan: z.boolean().describe("true = aanzetten, false = uitzetten") },
    async (args) => {
      try {
        if (args.aan && !(await ownerSubscribed(projectId))) return text("Automatische SEO zit in het abonnement. Zet het eerst aan in je profiel, dan kan ik het inschakelen.");
        const set = { autoEnabled: args.aan ? "true" : "false", updatedAt: new Date() };
        await db.insert(projectSeo).values({ projectId, ...set }).onConflictDoUpdate({ target: projectSeo.projectId, set });
        return text(args.aan ? "Automatische SEO staat nu aan — ik schrijf en publiceer voortaan dagelijks een SEO-artikel." : "Automatische SEO staat nu uit.");
      } catch (err) { logger.error({ err, projectId }, "[voice-tool] auto-seo failed"); return text("Het aanpassen van automatische SEO lukte even niet."); }
    },
  );

  const backup = tool(
    "maak_backup",
    "Maak nu een back-up (herstelpunt) van de hele site, zodat je later kunt terugzetten. Gebruik dit als de gebruiker om een back-up of herstelpunt vraagt.",
    {},
    async () => {
      try {
        const id = await createBackup(projectId, "manual");
        return text(id ? "Ik heb een back-up gemaakt. Die kun je later altijd terugzetten." : "Er was niets nieuws om te back-uppen — de laatste back-up is nog actueel.");
      } catch (err) { logger.error({ err, projectId }, "[voice-tool] backup failed"); return text("De back-up lukte even niet."); }
    },
  );

  const publish = tool(
    "publiceer_site",
    "Publiceer (deploy) de site: zet de huidige versie LIVE op het web. Gebruik dit ALLEEN als de gebruiker duidelijk vraagt om te publiceren / live te zetten / te deployen. Doe het NIET als de gebruiker zegt 'nog niet' of 'straks'.",
    {},
    async () => {
      try {
        await publishSubdomain(projectId);
        await publishSite(projectId);
        const domain = await liveDomain(projectId);
        return text(domain ? `De site staat nu live op ${domain}.` : "De site is gepubliceerd.");
      } catch (err) { logger.error({ err, projectId }, "[voice-tool] publish failed"); return text("Publiceren lukte even niet."); }
    },
  );

  const server = createSdkMcpServer({ name: "nebula", version: "1.0.0", tools: [stats, analyse, competitor, google, autoSeo, backup, publish] });
  const allowedTools = ["bekijk_statistieken", "bekijk_analyse", "vergelijk_concurrent", "bekijk_google_posities", "zet_auto_seo", "maak_backup", "publiceer_site"].map((t) => `mcp__nebula__${t}`);
  return { mcpServers: { nebula: server }, allowedTools };
}
