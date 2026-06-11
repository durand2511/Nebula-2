import OpenAI from "openai";
import { fetch as undiciFetch, Agent } from "undici";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
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

type OpenAIClientOptions = NonNullable<ConstructorParameters<typeof OpenAI>[0]>;

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  timeout: AI_REQUEST_TIMEOUT_MS,
  fetch: undiciFetch as unknown as OpenAIClientOptions["fetch"],
  fetchOptions: { dispatcher: aiDispatcher } as unknown as OpenAIClientOptions["fetchOptions"],
});
