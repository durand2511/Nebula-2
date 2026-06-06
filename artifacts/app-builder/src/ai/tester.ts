/**
 * Tester module — Runs automated checks on the generated app.
 * Validates completeness, structure, and functionality.
 */

import type { AgentState, TestResult } from "./state";

/** Run all tests against the current state */
export function runTests(state: AgentState): TestResult[] {
  const results: TestResult[] = [];

  // Structure tests
  results.push(...testStructure(state));

  // Completeness tests
  results.push(...testCompleteness(state));

  // Functionality tests
  results.push(...testFunctionality(state));

  // UX tests
  results.push(...testUX(state));

  return results;
}

/** Test HTML structure validity */
function testStructure(state: AgentState): TestResult[] {
  const results: TestResult[] = [];
  const html = state.html || "";

  results.push({
    passed: html.includes("<!DOCTYPE html") || html.includes("<!doctype html"),
    category: "structure",
    description: "DOCTYPE declaratie aanwezig",
  });

  results.push({
    passed: html.includes("<html") && html.includes("</html>"),
    category: "structure",
    description: "HTML tags compleet",
  });

  results.push({
    passed: html.includes("<head") && html.includes("</head>"),
    category: "structure",
    description: "HEAD sectie aanwezig",
  });

  results.push({
    passed: html.includes("<body") && html.includes("</body>"),
    category: "structure",
    description: "BODY sectie aanwezig",
  });

  results.push({
    passed: html.includes("<title"),
    category: "structure",
    description: "Title tag aanwezig",
  });

  results.push({
    passed: html.includes("viewport"),
    category: "structure",
    description: "Viewport meta tag (responsive)",
  });

  // Check script tag balance
  const openScripts = (html.match(/<script/g) || []).length;
  const closeScripts = (html.match(/<\/script>/g) || []).length;
  results.push({
    passed: openScripts === closeScripts,
    category: "structure",
    description: "Script tags correct gesloten",
  });

  // Check style tag balance
  const openStyles = (html.match(/<style/g) || []).length;
  const closeStyles = (html.match(/<\/style>/g) || []).length;
  results.push({
    passed: openStyles === closeStyles,
    category: "structure",
    description: "Style tags correct gesloten",
  });

  return results;
}

/** Test if all planned features are present */
function testCompleteness(state: AgentState): TestResult[] {
  const results: TestResult[] = [];
  const html = (state.html || "").toLowerCase();
  const plan = state.plan;

  if (!plan) return results;

  // Check if each screen has representation in the HTML
  for (const screen of plan.screens) {
    const screenName = screen.name.toLowerCase();
    const hasMention =
      html.includes(screenName) ||
      html.includes(`id="${screenName.replace(/\s+/g, "-")}"`);
    results.push({
      passed: hasMention || plan.screens.length <= 1,
      category: "completeness",
      description: `Scherm "${screen.name}" is aanwezig`,
    });
  }

  // Check for navigation if multiple screens
  if (plan.screens.length > 1) {
    results.push({
      passed: html.includes("<nav") || html.includes("navigation") || html.includes("menu"),
      category: "completeness",
      description: "Navigatie aanwezig voor meerdere schermen",
    });
  }

  // Check for required features
  for (const feature of plan.logic) {
    const keywords = feature.feature
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const hasFeature = keywords.some((kw) => html.includes(kw));
    results.push({
      passed: hasFeature,
      category: "completeness",
      description: `Feature "${feature.feature}" is geïmplementeerd`,
    });
  }

  return results;
}

/** Test interactive functionality */
function testFunctionality(state: AgentState): TestResult[] {
  const results: TestResult[] = [];
  const html = state.html || "";

  // Check that buttons have handlers
  const buttonCount = (html.match(/<button/gi) || []).length;
  const handlerCount =
    (html.match(/onclick/gi) || []).length +
    (html.match(/addEventListener/gi) || []).length;

  results.push({
    passed: buttonCount === 0 || handlerCount > 0,
    category: "functionality",
    description: "Knoppen hebben event handlers",
  });

  // Check that forms have submit handlers
  const formCount = (html.match(/<form/gi) || []).length;
  const submitHandlers =
    (html.match(/onsubmit/gi) || []).length +
    (html.match(/submit.*addEventListener/gi) || []).length +
    (html.match(/addEventListener.*submit/gi) || []).length;

  results.push({
    passed: formCount === 0 || submitHandlers > 0,
    category: "functionality",
    description: "Formulieren hebben submit handlers",
  });

  // Check for JavaScript presence
  results.push({
    passed: html.includes("<script") && html.includes("</script>"),
    category: "functionality",
    description: "JavaScript code aanwezig",
  });

  // Check for DOMContentLoaded or similar init
  results.push({
    passed:
      html.includes("DOMContentLoaded") ||
      html.includes("window.onload") ||
      html.includes("addEventListener('load"),
    category: "functionality",
    description: "Initialisatie event handler aanwezig",
  });

  return results;
}

/** Test UX quality */
function testUX(state: AgentState): TestResult[] {
  const results: TestResult[] = [];
  const html = state.html || "";

  // Check for Tailwind CSS
  results.push({
    passed: html.includes("tailwindcss") || html.includes("tailwind"),
    category: "ux",
    description: "Tailwind CSS gebruikt voor styling",
  });

  // Check for responsive classes
  results.push({
    passed:
      html.includes("md:") || html.includes("lg:") || html.includes("sm:"),
    category: "ux",
    description: "Responsive breakpoints gebruikt",
  });

  // Check for transitions/animations
  results.push({
    passed:
      html.includes("transition") ||
      html.includes("animate") ||
      html.includes("hover:"),
    category: "ux",
    description: "Transitions en hover effecten aanwezig",
  });

  // Check for proper color usage
  results.push({
    passed:
      html.includes("bg-") && html.includes("text-"),
    category: "ux",
    description: "Kleurklassen gebruikt",
  });

  // Check for mobile menu
  results.push({
    passed:
      html.includes("hamburger") ||
      html.includes("mobile-menu") ||
      html.includes("menu-btn"),
    category: "ux",
    description: "Mobiel menu aanwezig",
  });

  return results;
}

/** Get a summary of test results */
export function getTestSummary(results: TestResult[]): {
  total: number;
  passed: number;
  failed: number;
  categories: Record<string, { passed: number; total: number }>;
} {
  const categories: Record<string, { passed: number; total: number }> = {};

  for (const r of results) {
    if (!categories[r.category]) {
      categories[r.category] = { passed: 0, total: 0 };
    }
    categories[r.category].total++;
    if (r.passed) categories[r.category].passed++;
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    categories,
  };
}
