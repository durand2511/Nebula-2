/**
 * Scorer — Gives a 1-10 score to a generated app based on multiple criteria.
 * Pure client-side scoring (no API calls needed).
 */

import type { AgentState, TestResult } from "./state";
import type { CriticIssue } from "./critic";

export interface ScoreBreakdown {
  structure: number;
  completeness: number;
  functionality: number;
  ux: number;
  overall: number;
  issues: string[];
}

/** Score an app on a 1-10 scale */
export function scoreApp(state: AgentState): ScoreBreakdown {
  const html = state.html || "";
  const issues: string[] = [];

  const structure = scoreStructure(html, issues);
  const completeness = scoreCompleteness(state, issues);
  const functionality = scoreFunctionality(html, issues);
  const ux = scoreUX(html, issues);

  // Weighted average
  const overall = Math.round(
    (structure * 0.2 + completeness * 0.3 + functionality * 0.25 + ux * 0.25) * 10,
  ) / 10;

  return { structure, completeness, functionality, ux, overall, issues };
}

/** Check if score meets the passing threshold */
export function scorePassesThreshold(score: ScoreBreakdown, threshold = 8): boolean {
  return score.overall >= threshold;
}

/** Convert score to critic-compatible issues */
export function scoreToCriticIssues(score: ScoreBreakdown): CriticIssue[] {
  return score.issues.map((issue) => ({
    severity: score.overall < 5 ? "critical" as const : "warning" as const,
    description: issue,
    fix: `Verbeter: ${issue}`,
  }));
}

// ── Scoring Functions ──

function scoreStructure(html: string, issues: string[]): number {
  let score = 10;

  if (!html.includes("<!DOCTYPE html") && !html.includes("<!doctype html")) {
    score -= 3;
    issues.push("DOCTYPE ontbreekt");
  }
  if (!html.includes("<head")) { score -= 2; issues.push("HEAD ontbreekt"); }
  if (!html.includes("<body")) { score -= 3; issues.push("BODY ontbreekt"); }
  if (!html.includes("<title")) { score -= 1; issues.push("TITLE ontbreekt"); }
  if (!html.includes("viewport")) { score -= 1; issues.push("Viewport meta ontbreekt"); }

  // Check tag balance
  const tags = ["script", "style", "div"];
  for (const tag of tags) {
    const open = (html.match(new RegExp(`<${tag}`, "gi")) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    if (open !== close) {
      score -= 1;
      issues.push(`${tag} tags niet in balans (${open} open, ${close} close)`);
    }
  }

  return Math.max(1, score);
}

function scoreCompleteness(state: AgentState, issues: string[]): number {
  let score = 10;
  const html = (state.html || "").toLowerCase();
  const plan = state.plan;

  if (!plan) return 5;

  // Check each planned screen
  let missingScreens = 0;
  for (const screen of plan.screens) {
    const name = screen.name.toLowerCase();
    if (!html.includes(name) && plan.screens.length > 1) {
      missingScreens++;
    }
  }
  if (missingScreens > 0) {
    score -= missingScreens * 1.5;
    issues.push(`${missingScreens} scherm(en) niet gevonden in output`);
  }

  // Check navigation for multi-screen apps
  if (plan.screens.length > 1 && !html.includes("<nav") && !html.includes("menu")) {
    score -= 1;
    issues.push("Navigatie ontbreekt voor multi-screen app");
  }

  // Check features
  let missingFeatures = 0;
  for (const feature of plan.logic) {
    const keywords = feature.feature.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (!keywords.some((kw) => html.includes(kw))) {
      missingFeatures++;
    }
  }
  if (missingFeatures > 0) {
    score -= missingFeatures;
    issues.push(`${missingFeatures} feature(s) niet gevonden`);
  }

  return Math.max(1, score);
}

function scoreFunctionality(html: string, issues: string[]): number {
  let score = 10;

  // Check for JavaScript
  if (!html.includes("<script")) {
    score -= 3;
    issues.push("Geen JavaScript code");
  }

  // Check buttons have handlers
  const buttons = (html.match(/<button/gi) || []).length;
  const handlers = (html.match(/onclick|addEventListener/gi) || []).length;
  if (buttons > 0 && handlers === 0) {
    score -= 2;
    issues.push("Knoppen zonder event handlers");
  }

  // Check forms have submit handlers
  const forms = (html.match(/<form/gi) || []).length;
  const submits = (html.match(/onsubmit|submit.*addEventListener/gi) || []).length;
  if (forms > 0 && submits === 0) {
    score -= 2;
    issues.push("Formulieren zonder submit handlers");
  }

  // Check for init handler
  if (!html.includes("DOMContentLoaded") && !html.includes("window.onload")) {
    score -= 1;
    issues.push("Geen DOMContentLoaded handler");
  }

  // Check for error handling
  if (html.includes("try") && html.includes("catch")) {
    // Bonus: has error handling
  } else if (html.includes("fetch") || html.includes("mellowAI") || html.includes("mellowData")) {
    score -= 1;
    issues.push("API calls zonder error handling");
  }

  return Math.max(1, score);
}

function scoreUX(html: string, issues: string[]): number {
  let score = 10;

  // Check for Tailwind
  if (!html.includes("tailwindcss") && !html.includes("tailwind")) {
    score -= 2;
    issues.push("Tailwind CSS niet gevonden");
  }

  // Check responsive design
  if (!html.includes("md:") && !html.includes("lg:") && !html.includes("sm:")) {
    score -= 2;
    issues.push("Geen responsive breakpoints");
  }

  // Check hover/transitions
  if (!html.includes("hover:") && !html.includes("transition")) {
    score -= 1;
    issues.push("Geen hover effecten of transitions");
  }

  // Check for proper spacing
  if (!html.includes("p-") && !html.includes("px-") && !html.includes("py-")) {
    score -= 1;
    issues.push("Mogelijk slechte spacing");
  }

  // Check mobile menu
  if (html.includes("<nav") && !html.includes("mobile") && !html.includes("hamburger") && !html.includes("menu-btn")) {
    score -= 1;
    issues.push("Mobiel menu ontbreekt");
  }

  // Check color usage
  const hasColors = html.includes("bg-") && html.includes("text-");
  if (!hasColors) {
    score -= 1;
    issues.push("Beperkt kleurgebruik");
  }

  // Check for icons
  if (!html.includes("font-awesome") && !html.includes("lucide") && !html.includes("heroicon") && !html.includes("fa-")) {
    score -= 0.5;
    issues.push("Geen iconen gevonden");
  }

  return Math.max(1, score);
}
