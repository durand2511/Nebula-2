/** Sends campaigns whose scheduled time has passed. Runs every few minutes. */
import { db, studioCampaigns } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { sendCampaign } from "./campaigns.js";
import { logger } from "./logger.js";

let started = false;

async function tick(): Promise<void> {
  try {
    const due = await db.select().from(studioCampaigns).where(and(eq(studioCampaigns.status, "scheduled"), lte(studioCampaigns.scheduledAt, new Date())));
    for (const c of due) {
      try { await sendCampaign(c.projectId, c.id); }
      catch (err) { logger.error({ err, campaignId: c.id }, "[campaign-scheduler] send failed"); }
    }
  } catch (err) { logger.error({ err }, "[campaign-scheduler] tick failed"); }
}

export function startCampaignScheduler(): void {
  if (started) return;
  started = true;
  setInterval(() => void tick(), 3 * 60 * 1000); // every 3 minutes
  setTimeout(() => void tick(), 25 * 1000);       // shortly after boot
}
