/**
 * Agent State — Central state object that tracks the entire agent pipeline.
 * Used by all modules to share data and track progress.
 */

import type { AppPlan, AIScreen, AIDatabase, AIComponent } from "./componentMap";
import type { CriticIssue } from "./critic";

export interface TestResult {
  passed: boolean;
  category: string;
  description: string;
}

export interface AgentState {
  /** Original user input */
  userIdea: string;
  /** Structured app plan */
  plan: AppPlan | null;
  /** Generated UI screens */
  ui: AIScreen[];
  /** Database structure */
  database: AIDatabase;
  /** All components across screens */
  components: AIComponent[];
  /** Current score (1-10) */
  score: number;
  /** Test results */
  tests: TestResult[];
  /** Errors encountered */
  errors: string[];
  /** Critic issues from each iteration */
  criticHistory: { iteration: number; score: number; issues: CriticIssue[] }[];
  /** Current iteration number */
  iteration: number;
  /** Final generated HTML */
  html: string | null;
  /** Whether this is an edit of an existing app */
  isEdit: boolean;
  /** Previous HTML (for edits) */
  previousHtml: string | null;
  /** Phase timestamps for performance tracking */
  timestamps: Record<string, number>;
  /** Tool actions executed */
  toolHistory: { action: string; success: boolean; message: string }[];
  /** Version history for rollback */
  versionHistory: { id: string; html: string; score: number; timestamp: number }[];
}

/** Create a fresh agent state */
export function createAgentState(userIdea: string, previousHtml?: string | null): AgentState {
  return {
    userIdea,
    plan: null,
    ui: [],
    database: { tables: [] },
    components: [],
    score: 0,
    tests: [],
    errors: [],
    criticHistory: [],
    iteration: 0,
    html: null,
    isEdit: !!previousHtml,
    previousHtml: previousHtml || null,
    timestamps: { start: Date.now() },
    toolHistory: [],
    versionHistory: [],
  };
}

/** Update the plan in state */
export function updatePlan(state: AgentState, plan: AppPlan): AgentState {
  const allComponents = plan.screens.flatMap((s) => s.components);
  return {
    ...state,
    plan,
    ui: plan.screens,
    database: plan.database,
    components: allComponents,
    timestamps: { ...state.timestamps, planned: Date.now() },
  };
}

/** Update the HTML in state */
export function updateHtml(state: AgentState, html: string): AgentState {
  return {
    ...state,
    html,
    timestamps: { ...state.timestamps, [`built_${state.iteration}`]: Date.now() },
  };
}

/** Update the score */
export function updateScore(state: AgentState, score: number): AgentState {
  return { ...state, score };
}

/** Add test results to state */
export function addTests(state: AgentState, tests: TestResult[]): AgentState {
  return {
    ...state,
    tests: [...state.tests, ...tests],
    timestamps: { ...state.timestamps, [`tested_${state.iteration}`]: Date.now() },
  };
}

/** Add critic results and advance iteration */
export function addCriticResults(
  state: AgentState,
  score: number,
  issues: CriticIssue[],
): AgentState {
  return {
    ...state,
    criticHistory: [
      ...state.criticHistory,
      { iteration: state.iteration, score, issues },
    ],
    iteration: state.iteration + 1,
    timestamps: { ...state.timestamps, [`critic_${state.iteration}`]: Date.now() },
  };
}

/** Add an error to state */
export function addError(state: AgentState, error: string): AgentState {
  return {
    ...state,
    errors: [...state.errors, error],
  };
}

/** Add tool execution to history */
export function addToolResult(
  state: AgentState,
  action: string,
  success: boolean,
  message: string,
): AgentState {
  return {
    ...state,
    toolHistory: [...state.toolHistory, { action, success, message }],
  };
}

/** Check if the app has improved between iterations */
export function hasImproved(state: AgentState): boolean {
  const history = state.criticHistory;
  if (history.length < 2) return true;
  const prev = history[history.length - 2];
  const curr = history[history.length - 1];
  return curr.score > prev.score;
}

/** Get a summary of the current state */
export function getStateSummary(state: AgentState): string {
  const lastCritic = state.criticHistory[state.criticHistory.length - 1];
  const elapsed = Date.now() - state.timestamps.start;

  return [
    `App: ${state.plan?.app_name || "Onbekend"}`,
    `Iteratie: ${state.iteration}`,
    `Score: ${state.score}/10`,
    `Critic: ${lastCritic?.score ?? "n.v.t."}`,
    `Schermen: ${state.ui.length}`,
    `Componenten: ${state.components.length}`,
    `Tabellen: ${state.database.tables.length}`,
    `Tests: ${state.tests.filter((t) => t.passed).length}/${state.tests.length}`,
    `Tools: ${state.toolHistory.length}`,
    `Fouten: ${state.errors.length}`,
    `Tijd: ${(elapsed / 1000).toFixed(1)}s`,
  ].join(" | ");
}
