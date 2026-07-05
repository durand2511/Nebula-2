/**
 * Daily guard for the custom-domain assumption. Domain verification (verifyDomain) and the DNS
 * instructions we show customers both assume Render serves every custom domain from its dedicated
 * 216.24.57.x anycast block. That's an *external* fact owned by Render — if they ever move off that
 * block, correctly-configured customer domains would silently stop verifying (exactly the regression
 * we just fixed). This job resolves CUSTOMERS_TARGET once a day and logs loudly the moment its IPs
 * leave the 216.24.57.x block, so we catch it before a customer does. It only logs — never blocks.
 */
import { resolve4 } from "node:dns/promises";
import { CUSTOMERS_TARGET } from "./domains.js";
import { logger } from "./logger";

const RENDER_BLOCK = "216.24.57.";
let started = false;

async function tick(): Promise<void> {
  try {
    const ips = await resolve4(CUSTOMERS_TARGET).catch(() => [] as string[]);
    if (!ips.length) {
      logger.warn({ target: CUSTOMERS_TARGET }, "[domain-healthcheck] CUSTOMERS_TARGET has no A-records right now");
      return;
    }
    const inBlock = ips.filter((ip) => ip.startsWith(RENDER_BLOCK));
    if (inBlock.length === 0) {
      logger.error(
        { target: CUSTOMERS_TARGET, ips, expectedBlock: RENDER_BLOCK + "x" },
        "[domain-healthcheck] CUSTOMERS_TARGET no longer resolves into Render's 216.24.57.x block — " +
          "custom-domain verification and the DNS instructions shown to customers need to be updated",
      );
    } else {
      logger.info({ target: CUSTOMERS_TARGET, ips }, "[domain-healthcheck] ok — target still in Render's 216.24.57.x block");
    }
  } catch (err) {
    logger.warn({ err }, "[domain-healthcheck] tick failed");
  }
}

export function startDomainHealthcheck(): void {
  if (started) return;
  started = true;
  setInterval(() => void tick(), 24 * 60 * 60 * 1000); // once a day
  void tick(); // run once at boot too
}
