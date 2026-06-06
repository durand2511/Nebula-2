/**
 * Centralized API layer for all AI calls.
 * All communication with edge functions goes through here.
 */

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY as SUPABASE_KEY } from "@/integrations/supabase/config";

const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${SUPABASE_KEY}`,
});

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}

/** Chat AI — determines intent and quick edits */
export async function callChatAI(messages: ChatMessage[], hasExistingApp: boolean) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/chat-ai`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ messages, hasExistingApp }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: "Chat failed" }));
    throw new Error(data.error || `Error ${resp.status}`);
  }
  return resp.json() as Promise<{
    message: string;
    title: string;
    shouldBuild: boolean;
    quickEdits?: { type: string; target: string; value: string; scope: string }[];
  }>;
}

/** Plan AI — generates structured build/fix plan */
export async function callPlanAI(prompt: string, hasExistingApp: boolean, currentHtml?: string | null) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/plan-ai`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ prompt, hasExistingApp, currentHtml: currentHtml || null }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: "Plan failed" }));
    throw new Error(data.error || `Error ${resp.status}`);
  }
  return resp.json() as Promise<{
    summary: string;
    steps: { title: string; description: string }[];
  }>;
}

/** Generate App — streams HTML generation */
export async function callGenerateApp(
  messages: ChatMessage[],
  currentHtml: string | null,
): Promise<Response> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/generate-app`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ messages, currentHtml }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: "Generation failed" }));
    throw new Error(data.error || `Error ${resp.status}`);
  }
  return resp;
}

/** Critic AI — analyzes generated HTML and returns improvement suggestions */
export async function callCriticAI(html: string, originalPrompt: string) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/critic-ai`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ html, prompt: originalPrompt }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: "Critic failed" }));
    throw new Error(data.error || `Error ${resp.status}`);
  }
  return resp.json() as Promise<{
    score: number;
    issues: { severity: "critical" | "warning" | "suggestion"; description: string; fix: string }[];
    shouldFix: boolean;
  }>;
}
