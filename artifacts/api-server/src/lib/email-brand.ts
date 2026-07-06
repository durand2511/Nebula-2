/**
 * Per-studio e-mail branding: logo + studio name + accent colour + warm, AI-written Dutch copy
 * for each e-mail type. Generated ONCE when the booking app is created (generateEmailBrand) and
 * stored as a project file; every e-mail afterwards just reuses it (loadEmailBrand) — no AI per send.
 */
import { db, projectFiles } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-openai-ai-server";
import { emailBrandSeed, type ProjectFile } from "./actions.js";
import { resolvePublishedDomain } from "./seo.js";
import { logger } from "./logger";
import { BRAND_KINDS as KINDS, fallbackCopy, type BrandCopy, type EmailBrand } from "./email-brand-copy.js";

export const BRAND_PATH = "assets/email-brand.json";
export type { BrandCopy, EmailBrand };

async function aiCopy(studio: string): Promise<Record<string, BrandCopy> | null> {
  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 900,
      messages: [{
        role: "user",
        content:
          `Je schrijft warme, persoonlijke e-mailteksten (in het Nederlands) voor de studio "${studio}". ` +
          `Geef PURE JSON terug (geen uitleg, geen markdown) met exact deze sleutels: booking, cancel, welcome, reset, reminder. ` +
          `Elke sleutel is een object met "heading" (korte titel, mag 1 emoji), "intro" (1-2 warme zinnen, verwerk de studionaam natuurlijk), "outro" (1 hartelijke afsluitzin). ` +
          `Toon: lief, persoonlijk, uitnodigend. booking=boeking bevestigd, cancel=annulering, welcome=welkom nieuw account, reset=nieuw wachtwoord, reminder=herinnering 24u voor de les.`,
      }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as Record<string, BrandCopy>;
    // Keep only well-formed entries; fill any gaps from the fallback.
    const fb = fallbackCopy(studio), out: Record<string, BrandCopy> = {};
    for (const k of KINDS) {
      const c = parsed[k];
      out[k] = c && c.heading && c.intro ? { heading: String(c.heading), intro: String(c.intro), outro: String(c.outro || fb[k].outro) } : fb[k];
    }
    return out;
  } catch (err) {
    logger.warn({ err, studio }, "[email-brand] AI copy failed, using fallback");
    return null;
  }
}

/** Generate the brand ONCE (skips if it already exists). Best-effort; never throws. */
export async function generateEmailBrand(projectId: number, files: ProjectFile[]): Promise<void> {
  try {
    const [existing] = await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, BRAND_PATH)));
    if (existing) return; // already done — "een keer en daarna niet meer"
    const seed = emailBrandSeed(files);
    const copy = (await aiCopy(seed.studio)) ?? fallbackCopy(seed.studio);
    const brand: EmailBrand = { ...seed, copy };
    await db.insert(projectFiles).values({ projectId, path: BRAND_PATH, content: JSON.stringify(brand), language: "json" });
    logger.info({ projectId, studio: seed.studio }, "[email-brand] generated");
  } catch (err) {
    logger.warn({ err, projectId }, "[email-brand] generate failed");
  }
}

/** Load the stored brand for a project, or null if none. */
export async function loadEmailBrand(projectId: number): Promise<EmailBrand | null> {
  try {
    const [row] = await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, BRAND_PATH)));
    if (!row) return null;
    const brand = JSON.parse(row.content) as EmailBrand;
    // E-mail clients (Gmail etc.) can't resolve a ROOT-RELATIVE logo like /assets/x.png — that shows a
    // broken-image icon. Make it absolute using the studio's live domain; drop it if there's no domain.
    if (brand.logo && brand.logo.startsWith("/") && !brand.logo.startsWith("//")) {
      const domain = await resolvePublishedDomain(projectId).catch(() => "");
      brand.logo = domain && !/localhost|127\.0\.0\.1/.test(domain) ? `https://${domain}${brand.logo}` : "";
    }
    return brand;
  } catch { return null; }
}
