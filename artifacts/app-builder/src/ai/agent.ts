/**
 * Agent — The main orchestrator that coordinates all modules.
 *
 * Flow: User input → Understand → Plan → UI Agent → Backend Agent → Build → Test → Score → Critic → Fix (loop until score >= 8) → Memory → Output
 *
 * Uses AgentState to track progress across all phases.
 */

import { callChatAI, type ChatMessage } from "@/api/ai";
import { createPlan } from "./planner";
import { buildDirect } from "./builder";
import { generateBackendSchema, schemaToPromptHint } from "./backendAgent";
import { generateUI, validateComponents } from "./uiAgent";
import { generateArchitecture, architectureToPrompt, type AppArchitecture } from "./architecture";
import { runTests, getTestSummary } from "./tester";
import { scoreApp, scorePassesThreshold, scoreToCriticIssues } from "./scorer";
import { analyzeApp, type CriticResult } from "./critic";
import { editApp, classifyEdit } from "./editor";
import { loadMemory, rememberApp, getMemoryContext } from "./memory";
import { executeTool, type ToolAction } from "./tools";
import { saveVersion } from "./versioning";
import { log, logPhase } from "./logger";
import { withRetry } from "./retry";
import { handleError, safeguard } from "./errorHandler";
import { validateJSON, extractJSON } from "./jsonValidator";
import {
  createAgentState,
  updatePlan,
  updateHtml,
  updateScore,
  addTests,
  addCriticResults,
  addError,
  addToolResult,
  hasImproved,
  getStateSummary,
  type AgentState,
} from "./state";
import type { AppPlan } from "./componentMap";
import type { QuickEdit } from "@/lib/aiStream";

export type AgentPhase =
  | "idle"
  | "understanding"
  | "planning"
  | "building"
  | "reviewing"
  | "testing"
  | "scoring"
  | "fixing"
  | "done"
  | "error";

export interface AgentCallbacks {
  onPhaseChange: (phase: AgentPhase, message?: string) => void;
  onHtmlDelta: (chunk: string) => void;
  onHtmlComplete: (html: string) => void;
  onChatResponse: (message: string, title: string) => void;
  onQuickEdits: (edits: QuickEdit[]) => void;
  onPlanReady: (plan: AppPlan) => void;
  onArchitectureReady: (arch: AppArchitecture) => void;
  onCriticResult: (result: CriticResult) => void;
  onStateUpdate: (state: AgentState) => void;
  onError: (error: string) => void;
}

export interface AgentConfig {
  maxFixCycles: number;
  skipCriticForUpdates: boolean;
  minScore: number;
  targetScore: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  maxFixCycles: 5,
  skipCriticForUpdates: true,
  minScore: 60,
  targetScore: 8,
};

/**
 * Run the full agent pipeline for a user request.
 */
export async function runAgent(
  input: string,
  messages: ChatMessage[],
  currentHtml: string | null,
  callbacks: AgentCallbacks,
  config: Partial<AgentConfig> = {},
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const hasExistingApp = !!currentHtml;
  let state = createAgentState(input, currentHtml);
  const memory = loadMemory();

  const emitState = () => callbacks.onStateUpdate?.(state);

  try {
    // ── Phase 1: Understand intent ──
    logPhase("understanding", input);
    callbacks.onPhaseChange("understanding", "Verzoek analyseren...");

    const chatResult = await withRetry(() => callChatAI(messages, hasExistingApp), "chat-ai");
    callbacks.onChatResponse(chatResult.message, chatResult.title);

    // Handle quick edits
    if (chatResult.quickEdits && chatResult.quickEdits.length > 0 && currentHtml) {
      callbacks.onQuickEdits(chatResult.quickEdits as QuickEdit[]);
      callbacks.onPhaseChange("done", "Direct toegepast!");
      return;
    }

    if (!chatResult.shouldBuild) {
      callbacks.onPhaseChange("done");
      return;
    }

    // ── Phase 2: Plan + UI Agent + Backend Agent ──
    if (!hasExistingApp) {
      callbacks.onPhaseChange("planning", "App structuur plannen...");

      try {
        // Planner
        const planResult = await createPlan(input, false);
        state = updatePlan(state, planResult.plan);
        callbacks.onPlanReady(planResult.plan);

        // UI Agent: generate components for each screen
        const enrichedScreens = generateUI(planResult.plan);
        const validation = validateComponents(enrichedScreens);
        if (!validation.valid) {
          for (const err of validation.errors) {
            state = addError(state, err);
          }
        }
        state = {
          ...state,
          ui: enrichedScreens,
          components: enrichedScreens.flatMap((s) => s.components),
        };

        // Backend Agent: generate database schema
        const backendSchema = generateBackendSchema(state);
        state = { ...state, database: backendSchema.database };

        // Architecture: generate structured blueprint
        const architecture = generateArchitecture(
          planResult.plan.app_name,
          planResult.plan.description,
          enrichedScreens,
          planResult.plan.database,
          planResult.plan.logic,
        );
        callbacks.onArchitectureReady(architecture);
        const archPrompt = architectureToPrompt(architecture);

        // Memory context
        const memoryHint = getMemoryContext(memory, input);
        const backendHint = schemaToPromptHint(backendSchema);

        emitState();

        // ── Phase 3: Build ──
        callbacks.onPhaseChange("building", "App genereren...");

        let generatedHtml = "";
        const enrichedMessages: ChatMessage[] = [
          ...messages.filter((m) => m.role === "user"),
          {
            role: "user",
            content: [
              input,
              archPrompt,
              backendHint ? `\n=== BACKEND ===\n${backendHint}` : "",
              memoryHint ? `\n=== CONTEXT ===\n${memoryHint}` : "",
            ].filter(Boolean).join("\n"),
          },
        ];

        await buildDirect(enrichedMessages, null, {
          onDelta: callbacks.onHtmlDelta,
          onDone: (html) => { generatedHtml = html; },
          onError: (err) => { state = addError(state, err); callbacks.onError(err); },
        });

        if (!isValidHtml(generatedHtml)) {
          callbacks.onError("Generatie mislukt: geen geldige HTML");
          callbacks.onPhaseChange("error");
          return;
        }

        state = updateHtml(state, generatedHtml);
        emitState();
      } catch {
        // Fallback: build without plan
        callbacks.onPhaseChange("building", "App genereren (fallback)...");
        let generatedHtml = "";
        await buildDirect(
          [...messages.filter((m) => m.role === "user"), { role: "user", content: input }],
          null,
          {
            onDelta: callbacks.onHtmlDelta,
            onDone: (html) => { generatedHtml = html; },
            onError: (err) => { state = addError(state, err); callbacks.onError(err); },
          },
        );

        if (!isValidHtml(generatedHtml)) {
          callbacks.onError("Generatie mislukt");
          callbacks.onPhaseChange("error");
          return;
        }

        state = updateHtml(state, generatedHtml);
        emitState();
      }
    } else {
      // ── Edit mode ──
      callbacks.onPhaseChange("building", "Wijziging toepassen...");

      let generatedHtml = "";
      await editApp(
        { prompt: input, currentHtml: currentHtml!, conversationHistory: messages },
        {
          onDelta: callbacks.onHtmlDelta,
          onDone: (html) => { generatedHtml = html; },
          onError: (err) => { state = addError(state, err); callbacks.onError(err); },
        },
      );

      if (!isValidHtml(generatedHtml)) {
        callbacks.onError("Wijziging mislukt");
        callbacks.onPhaseChange("error");
        return;
      }

      state = updateHtml(state, generatedHtml);
      emitState();

      // Skip critic loop for quick edits
      if (cfg.skipCriticForUpdates && classifyEdit(input) === "quick") {
        callbacks.onHtmlComplete(state.html!);
        callbacks.onPhaseChange("done", "Wijziging toegepast!");
        return;
      }
    }

    // ── Phase 4: Test ──
    callbacks.onPhaseChange("testing", "App testen...");
    const testResults = runTests(state);
    state = addTests(state, testResults);
    emitState();

    // ── Phase 5: Score ──
    callbacks.onPhaseChange("scoring", "Score berekenen...");
    const initialScore = scoreApp(state);
    state = updateScore(state, initialScore.overall);
    emitState();

    // ── Phase 6: Critic + Fix loop (until score >= 8 or max 5 iterations) ──
    for (let i = 0; i < cfg.maxFixCycles; i++) {
      // Check if we already pass
      if (scorePassesThreshold(scoreApp(state), cfg.targetScore)) {
        break;
      }

      callbacks.onPhaseChange("reviewing", `Kwaliteit controleren (ronde ${i + 1}/${cfg.maxFixCycles})...`);

      const criticResult = await analyzeApp(state.html!, input);
      callbacks.onCriticResult(criticResult);

      // Merge scorer issues with critic issues
      const currentScore = scoreApp(state);
      const scorerIssues = scoreToCriticIssues(currentScore);
      const allIssues = [...criticResult.issues, ...scorerIssues];

      state = addCriticResults(state, criticResult.score, allIssues);
      state = updateScore(state, currentScore.overall);
      emitState();

      if (criticResult.passed && currentScore.overall >= cfg.targetScore) {
        break;
      }

      // Stop if not improving after 2+ iterations
      if (i > 0 && !hasImproved(state)) {
        break;
      }

      // No fixable issues
      const fixableIssues = allIssues.filter((issue) => issue.severity === "critical");
      if (fixableIssues.length === 0 && currentScore.overall >= cfg.minScore) {
        break;
      }

      // ── Auto-fix ──
      callbacks.onPhaseChange("fixing", `Verbeteringen toepassen (ronde ${i + 1})...`);

      const fixPrompts = [
        ...fixableIssues.map((issue) => issue.fix),
        ...testResults.filter((t) => !t.passed).slice(0, 3).map((t) => `Fix: ${t.description}`),
      ];

      if (fixPrompts.length === 0) break;

      let fixedHtml = "";
      await buildDirect(
        [
          { role: "user", content: input },
          { role: "user", content: `Fix deze problemen:\n${fixPrompts.join("\n")}` },
        ],
        state.html!,
        {
          onDelta: callbacks.onHtmlDelta,
          onDone: (html) => { fixedHtml = html; },
          onError: () => {},
        },
      );

      if (isValidHtml(fixedHtml)) {
        state = updateHtml(state, fixedHtml);
        // Re-test
        const newTests = runTests(state);
        state = addTests(state, newTests);
        const newScore = scoreApp(state);
        state = updateScore(state, newScore.overall);
        emitState();
      } else {
        break;
      }
    }

    // ── Done: Save to memory + version ──
    callbacks.onHtmlComplete(state.html!);
    state.timestamps.done = Date.now();

    // Save version
    const finalScore = scoreApp(state);
    saveVersion({
      html: state.html!,
      label: state.plan?.app_name || "App",
      score: finalScore.overall,
      iteration: state.iteration,
      userIdea: input,
    });

    // Remember this build
    rememberApp(memory, {
      userIdea: input,
      appName: state.plan?.app_name || "App",
      screens: state.ui.map((s) => s.name),
      features: state.plan?.logic.map((l) => l.feature) || [],
      score: finalScore.overall,
      iterations: state.iteration,
    });

    const summary = getStateSummary(state);
    log("info", `Agent complete: ${summary}`);

    callbacks.onPhaseChange("done", "Klaar!");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onbekende fout";
    state = addError(state, message);
    callbacks.onError(message);
    callbacks.onPhaseChange("error", message);
  }
}

function isValidHtml(html: string): boolean {
  if (!html || html.trim().length < 50) return false;
  return html.includes("<html") || html.includes("<!DOCTYPE") || html.includes("<body");
}
