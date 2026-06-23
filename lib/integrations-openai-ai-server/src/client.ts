import Anthropic from "@anthropic-ai/sdk";
import { fetch as undiciFetch, Agent } from "undici";

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "ANTHROPIC_API_KEY must be set. Did you forget to configure the Anthropic AI integration?",
  );
}

// A rich app build/rebuild can legitimately stream for many minutes. undici's
// default 5-minute headers/body timeouts would abort such a long generation
// mid-stream ("terminated: Body Timeout Error"). We raise that budget to 20 min.
//
// The dispatcher MUST come from the same undici package as the fetch we hand the
// SDK — mixing a dispatcher with a different fetch implementation throws
// "invalid onRequestStart method". So we pass undici's own fetch here too.
const AI_REQUEST_TIMEOUT_MS = 20 * 60 * 1000;
const aiDispatcher = new Agent({
  headersTimeout: AI_REQUEST_TIMEOUT_MS,
  bodyTimeout: AI_REQUEST_TIMEOUT_MS,
});

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: AI_REQUEST_TIMEOUT_MS,
  fetch: (url, init) =>
    undiciFetch(url as string, {
      ...(init as Record<string, unknown>),
      dispatcher: aiDispatcher,
    }) as Promise<Response>,
});
