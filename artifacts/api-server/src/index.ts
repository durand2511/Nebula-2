import app from "./app";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./lib/reminders";
import { startNudgeScheduler } from "./lib/nudges";
import { startSeoScheduler } from "./lib/seo-scheduler";
import { startCampaignScheduler } from "./lib/campaign-scheduler";
import { startProductScheduler } from "./lib/product-scheduler";
import { startDomainHealthcheck } from "./lib/domain-healthcheck";
import { startKennisbankScheduler } from "./lib/kennisbank";
import { anthropic } from "@workspace/integrations-openai-ai-server";
import { instrumentAnthropic } from "./lib/ai-usage";
import { attachClaudeTerminal } from "./lib/claude-terminal";

// Meter every AI call's token usage (per-request) so chat edits can be billed against AI credit.
instrumentAnthropic(anthropic as any);

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startReminderScheduler();
  startNudgeScheduler();
  startSeoScheduler();
  startCampaignScheduler();
  startProductScheduler();
  startDomainHealthcheck();
  startKennisbankScheduler();
});

// Claude Code terminal (WebSocket upgrade on the same port/server as the HTTP API).
attachClaudeTerminal(server);
