/** Periodically auto-reconciles product sales (stock deduction + low-stock supplier mail) for every
 * project that has products, so it happens even when no admin has the Kassa open. */
import { db, studioProducts } from "@workspace/db";
import { reconcileProducts } from "../routes/stripe.js";
import { logger } from "./logger.js";

let started = false;

async function tick(): Promise<void> {
  try {
    const rows = await db.selectDistinct({ projectId: studioProducts.projectId }).from(studioProducts);
    for (const r of rows) {
      try { await reconcileProducts(r.projectId); }
      catch (err) { logger.warn({ err, projectId: r.projectId }, "[product-scheduler] reconcile failed"); }
    }
  } catch (err) { logger.error({ err }, "[product-scheduler] tick failed"); }
}

export function startProductScheduler(): void {
  if (started) return;
  started = true;
  setInterval(() => void tick(), 5 * 60 * 1000); // every 5 minutes
  setTimeout(() => void tick(), 40 * 1000);        // shortly after boot
}
