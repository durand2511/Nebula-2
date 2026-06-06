/**
 * Critic module — Analyzes generated HTML and identifies issues.
 * Can trigger automatic fixes for critical problems.
 */

import { callCriticAI } from "@/api/ai";

export interface CriticIssue {
  severity: "critical" | "warning" | "suggestion";
  description: string;
  fix: string;
}

export interface CriticResult {
  score: number;
  issues: CriticIssue[];
  shouldFix: boolean;
  passed: boolean;
}

/** Analyze generated HTML for quality issues */
export async function analyzeApp(
  html: string,
  originalPrompt: string,
): Promise<CriticResult> {
  // Quick client-side checks first (fast, no API call needed)
  const quickIssues = runQuickChecks(html);

  // If there are critical quick-check issues, return immediately
  const hasCriticalQuickIssues = quickIssues.some((i) => i.severity === "critical");
  if (hasCriticalQuickIssues) {
    return {
      score: 30,
      issues: quickIssues,
      shouldFix: true,
      passed: false,
    };
  }

  try {
    // Call the AI critic for deeper analysis
    const aiResult = await callCriticAI(html, originalPrompt);
    const allIssues = [...quickIssues, ...aiResult.issues];

    return {
      score: aiResult.score,
      issues: allIssues,
      shouldFix: aiResult.shouldFix || hasCriticalQuickIssues,
      passed: aiResult.score >= 70 && !hasCriticalQuickIssues,
    };
  } catch {
    // If critic API fails, use only quick checks
    return {
      score: quickIssues.length === 0 ? 80 : 60,
      issues: quickIssues,
      shouldFix: hasCriticalQuickIssues,
      passed: !hasCriticalQuickIssues,
    };
  }
}

/** Fast client-side HTML quality checks */
function runQuickChecks(html: string): CriticIssue[] {
  const issues: CriticIssue[] = [];

  // Check for valid HTML structure
  if (!html.includes("<!DOCTYPE html") && !html.includes("<!doctype html")) {
    issues.push({
      severity: "critical",
      description: "Geen geldig HTML document (<!DOCTYPE html> ontbreekt)",
      fix: "Voeg <!DOCTYPE html> toe aan het begin van het document",
    });
  }

  if (!html.includes("<body")) {
    issues.push({
      severity: "critical",
      description: "Geen <body> tag gevonden",
      fix: "Voeg een <body> tag toe",
    });
  }

  // Check for mobile responsiveness
  if (!html.includes("viewport")) {
    issues.push({
      severity: "warning",
      description: "Geen viewport meta tag — niet mobiel-vriendelijk",
      fix: "Voeg <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> toe",
    });
  }

  // Check for Tailwind CDN (our standard styling approach)
  if (!html.includes("tailwindcss") && !html.includes("tailwind")) {
    issues.push({
      severity: "suggestion",
      description: "Tailwind CSS CDN niet gevonden",
      fix: "Voeg <script src=\"https://cdn.tailwindcss.com\"></script> toe",
    });
  }

  // Check for empty body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1].trim().length < 50) {
    issues.push({
      severity: "critical",
      description: "De body is vrijwel leeg",
      fix: "Genereer de volledige app-inhoud",
    });
  }

  // Check for broken script tags
  const scriptCount = (html.match(/<script/g) || []).length;
  const scriptCloseCount = (html.match(/<\/script>/g) || []).length;
  if (scriptCount !== scriptCloseCount) {
    issues.push({
      severity: "critical",
      description: "Script tags zijn niet correct gesloten",
      fix: "Sluit alle <script> tags correct af met </script>",
    });
  }

  return issues;
}
