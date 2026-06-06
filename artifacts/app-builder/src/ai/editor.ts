/**
 * Editor module — Handles editing/modifying existing apps.
 * Takes the old app state and a new user request, produces an updated app.
 */

import type { ChatMessage } from "@/api/ai";
import type { AppPlan } from "./componentMap";
import type { AgentState } from "./state";
import { buildDirect } from "./builder";
import { CONSTRAINT_BLOCK } from "./constraints";

export interface EditRequest {
  /** The user's edit request */
  prompt: string;
  /** Current app HTML */
  currentHtml: string;
  /** Current app plan (if available) */
  currentPlan?: AppPlan | null;
  /** Full conversation history */
  conversationHistory: ChatMessage[];
}

export interface EditResult {
  html: string;
  changeDescription: string;
}

/** Classify the type of edit to determine the best approach */
export function classifyEdit(prompt: string): "quick" | "structural" | "feature" | "redesign" {
  const lower = prompt.toLowerCase();

  // Quick: color, font, text changes
  if (
    /(?:kleur|color|achtergrond|background|tekst|text|font|letter|grootte|size)/.test(lower) &&
    !/(?:voeg|maak|bouw|verander.*structuur|nieuw.*scherm|nieuw.*pagina)/.test(lower)
  ) {
    return "quick";
  }

  // Redesign: complete visual overhaul
  if (
    /(?:herontwerp|redesign|compleet.*anders|helemaal.*nieuw|opnieuw.*maken)/.test(lower)
  ) {
    return "redesign";
  }

  // Feature: adding new functionality
  if (
    /(?:voeg.*toe|add|nieuw.*functie|nieuw.*feature|maak.*werkend|implementeer)/.test(lower)
  ) {
    return "feature";
  }

  // Default: structural change
  return "structural";
}

/** Generate an optimized edit prompt based on the edit type */
export function createEditPrompt(
  request: EditRequest,
  editType: "quick" | "structural" | "feature" | "redesign",
): string {
  const base = (() => {
    switch (editType) {
      case "quick":
        return `Pas ALLEEN deze simpele wijziging toe, verander NIETS anders: ${request.prompt}`;
      case "structural":
        return `Pas de structuur aan zoals gevraagd. Behoud alle bestaande functionaliteit: ${request.prompt}`;
      case "feature":
        return `Voeg deze nieuwe feature toe aan de bestaande app. Behoud alle bestaande code en styling: ${request.prompt}`;
      case "redesign":
        return `Herontwerp de hele app met behoud van alle functionaliteit: ${request.prompt}`;
    }
  })();

  return `${base}\n\n${CONSTRAINT_BLOCK}`;
}

/** Execute an edit on an existing app */
export async function editApp(
  request: EditRequest,
  callbacks: {
    onDelta: (chunk: string) => void;
    onDone: (html: string) => void;
    onError: (error: string) => void;
  },
): Promise<void> {
  const editType = classifyEdit(request.prompt);
  const editPrompt = createEditPrompt(request, editType);

  const messages: ChatMessage[] = [
    ...request.conversationHistory
      .filter((m) => m.role === "user")
      .slice(-3), // Keep only last 3 user messages for context
    { role: "user", content: editPrompt },
  ];

  await buildDirect(messages, request.currentHtml, callbacks);
}

/** Merge plan updates into an existing plan */
export function mergePlanEdit(
  existingPlan: AppPlan,
  editPrompt: string,
): AppPlan {
  const lower = editPrompt.toLowerCase();
  const updated = { ...existingPlan };

  // If adding a new screen
  if (lower.includes("nieuw scherm") || lower.includes("nieuwe pagina")) {
    const screenName = editPrompt.replace(/.*(?:scherm|pagina)\s*/i, "").trim();
    updated.screens = [
      ...updated.screens,
      {
        name: screenName || `Scherm ${updated.screens.length + 1}`,
        purpose: editPrompt,
        components: [],
      },
    ].slice(0, 5);
  }

  // If adding a new feature
  if (lower.includes("voeg") && lower.includes("toe")) {
    updated.logic = [
      ...updated.logic,
      { feature: editPrompt, description: editPrompt },
    ];
  }

  return updated;
}
