/**
 * Builder module — Takes a plan and generates the actual HTML app.
 * Streams HTML from the generate-app edge function.
 */

import type { ChatMessage } from "@/api/ai";
import { streamGenerateApp } from "@/lib/aiStream";
import type { AppPlan } from "./componentMap";
import { componentHints } from "./componentMap";
import { BUILDER_SYSTEM_PROMPT, CONSTRAINT_BLOCK } from "./constraints";

export interface BuildCallbacks {
  onDelta: (chunk: string) => void;
  onDone: (fullHtml: string) => void;
  onError: (error: string) => void;
}

/** Convert an AppPlan into enriched build instructions */
function planToBuildPrompt(plan: AppPlan, userPrompt: string): string {
  const screenDescriptions = plan.screens
    .map((s, i) => {
      const comps = s.components
        .map((c) => `- ${c.type}: "${c.label}" (${componentHints[c.type] || c.type})`)
        .join("\n");
      return `Scherm ${i + 1}: ${s.name}\nDoel: ${s.purpose}${comps ? "\nComponenten:\n" + comps : ""}`;
    })
    .join("\n\n");

  const dbDescription = plan.database.tables.length > 0
    ? plan.database.tables
        .map((t) => `Tabel: ${t.name} (${t.fields.map((f) => `${f.name}: ${f.type}`).join(", ")})`)
        .join("\n")
    : "Geen database nodig";

  const logicDescription = plan.logic
    .map((l) => `- ${l.feature}: ${l.description}`)
    .join("\n");

  return `${userPrompt}

${CONSTRAINT_BLOCK}

=== APP STRUCTUUR ===
App naam: ${plan.app_name}
Beschrijving: ${plan.description}

=== SCHERMEN ===
${screenDescriptions}

=== DATABASE ===
${dbDescription}

=== LOGICA & FEATURES ===
${logicDescription}`;
}

/** Build an app from a plan by streaming HTML generation */
export async function buildFromPlan(
  plan: AppPlan,
  userPrompt: string,
  currentHtml: string | null,
  conversationHistory: ChatMessage[],
  callbacks: BuildCallbacks,
): Promise<void> {
  const enrichedPrompt = planToBuildPrompt(plan, userPrompt);

  const messages: ChatMessage[] = [
    ...conversationHistory.filter((m) => m.role === "user"),
    { role: "user", content: enrichedPrompt },
  ];

  let fullResponse = "";

  await streamGenerateApp({
    messages,
    currentHtml,
    onDelta: (chunk) => {
      fullResponse += chunk;
      callbacks.onDelta(chunk);
    },
    onDone: () => {
      let html = fullResponse;
      if (html.includes("```html")) {
        html = html.replace(/```html\n?/g, "").replace(/```\n?/g, "");
      }
      html = html.trim();
      callbacks.onDone(html);
    },
    onError: callbacks.onError,
  });
}

/** Direct build without a plan (for simple requests) */
export async function buildDirect(
  messages: ChatMessage[],
  currentHtml: string | null,
  callbacks: BuildCallbacks,
): Promise<void> {
  let fullResponse = "";

  await streamGenerateApp({
    messages,
    currentHtml,
    onDelta: (chunk) => {
      fullResponse += chunk;
      callbacks.onDelta(chunk);
    },
    onDone: () => {
      let html = fullResponse;
      if (html.includes("```html")) {
        html = html.replace(/```html\n?/g, "").replace(/```\n?/g, "");
      }
      html = html.trim();
      callbacks.onDone(html);
    },
    onError: callbacks.onError,
  });
}
