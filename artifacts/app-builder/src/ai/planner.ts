/**
 * Planner module — Takes user input and creates a structured app plan.
 * Wraps the plan-ai edge function with typed output.
 */

import { callPlanAI } from "@/api/ai";
import type { AppPlan, AIScreen } from "./componentMap";

export interface PlanResult {
  plan: AppPlan;
  summary: string;
  steps: { title: string; description: string }[];
}

/** Generate a structured plan from user input */
export async function createPlan(
  userPrompt: string,
  hasExistingApp: boolean,
  currentHtml?: string | null,
): Promise<PlanResult> {
  const result = await callPlanAI(userPrompt, hasExistingApp, currentHtml);

  // Parse the plan steps into a structured AppPlan
  const plan = inferPlanFromSteps(userPrompt, result.steps);

  return {
    plan,
    summary: result.summary,
    steps: result.steps,
  };
}

/** Infer an AppPlan structure from the AI's step-by-step plan */
function inferPlanFromSteps(
  prompt: string,
  steps: { title: string; description: string }[],
): AppPlan {
  const screens: AIScreen[] = [];
  const features: { feature: string; description: string }[] = [];

  for (const step of steps) {
    const lowerTitle = step.title.toLowerCase();
    const lowerDesc = step.description.toLowerCase();

    // Detect screens from step descriptions
    if (
      lowerTitle.includes("scherm") ||
      lowerTitle.includes("pagina") ||
      lowerTitle.includes("screen") ||
      lowerTitle.includes("page")
    ) {
      screens.push({
        name: step.title,
        purpose: step.description,
        components: [],
      });
    } else {
      features.push({
        feature: step.title,
        description: step.description,
      });
    }
  }

  // Ensure at least a main screen exists
  if (screens.length === 0) {
    screens.push({
      name: "Hoofdpagina",
      purpose: "Hoofdscherm van de applicatie",
      components: [],
    });
  }

  return {
    app_name: extractAppName(prompt),
    description: prompt,
    screens: screens.slice(0, 5),
    database: { tables: [] },
    logic: features,
  };
}

function extractAppName(prompt: string): string {
  // Try to extract a meaningful name from the prompt
  const match = prompt.match(
    /(?:maak|bouw|create|build)\s+(?:een|a|an)?\s*(.+?)(?:\s+(?:met|with|voor|for|app|website))/i,
  );
  if (match) return match[1].trim();

  const words = prompt.split(/\s+/).slice(0, 3).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
