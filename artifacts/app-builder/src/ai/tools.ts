/**
 * Tools — Action system for the AI agent.
 * Defines executable actions the AI can invoke via structured JSON.
 */

import type { AIComponent, AIScreen, AIComponentType, AppPlan } from "./componentMap";
import type { AgentState } from "./state";

export interface ToolAction {
  action: string;
  data: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export type ToolHandler = (state: AgentState, data: Record<string, unknown>) => ToolResult;

/** Registry of available tools */
const toolRegistry: Record<string, ToolHandler> = {
  create_component: handleCreateComponent,
  update_screen: handleUpdateScreen,
  add_feature: handleAddFeature,
  remove_component: handleRemoveComponent,
  add_screen: handleAddScreen,
  remove_screen: handleRemoveScreen,
  update_database: handleUpdateDatabase,
  fix_bug: handleFixBug,
};

/** Execute a tool action */
export function executeTool(state: AgentState, action: ToolAction): ToolResult {
  const handler = toolRegistry[action.action];
  if (!handler) {
    return {
      success: false,
      message: `Onbekende actie: ${action.action}`,
    };
  }
  return handler(state, action.data);
}

/** Execute multiple tool actions in sequence */
export function executeTools(state: AgentState, actions: ToolAction[]): ToolResult[] {
  return actions.map((action) => executeTool(state, action));
}

/** Get all available tool definitions (for AI context) */
export function getToolDefinitions(): {
  name: string;
  description: string;
  parameters: Record<string, string>;
}[] {
  return [
    {
      name: "create_component",
      description: "Maak een nieuw UI component aan op een scherm",
      parameters: {
        screenIndex: "number — index van het scherm",
        type: "string — component type (button, input, card, checkbox, text, image)",
        label: "string — label/tekst van het component",
        action: "string — optionele actie (onclick, navigate, submit)",
        position: "string — positie (top, middle, bottom)",
      },
    },
    {
      name: "update_screen",
      description: "Pas een bestaand scherm aan",
      parameters: {
        screenIndex: "number — index van het scherm",
        name: "string — nieuwe naam",
        purpose: "string — nieuw doel/beschrijving",
      },
    },
    {
      name: "add_feature",
      description: "Voeg een feature toe aan het plan",
      parameters: {
        feature: "string — naam van de feature",
        description: "string — beschrijving van de feature",
      },
    },
    {
      name: "remove_component",
      description: "Verwijder een component van een scherm",
      parameters: {
        screenIndex: "number — index van het scherm",
        componentIndex: "number — index van het component",
      },
    },
    {
      name: "add_screen",
      description: "Voeg een nieuw scherm toe (max 5)",
      parameters: {
        name: "string — naam van het scherm",
        purpose: "string — doel van het scherm",
      },
    },
    {
      name: "remove_screen",
      description: "Verwijder een scherm",
      parameters: {
        screenIndex: "number — index van het scherm",
      },
    },
    {
      name: "update_database",
      description: "Voeg een database tabel toe of pas aan",
      parameters: {
        tableName: "string — naam van de tabel",
        fields: "array — velden met name en type",
      },
    },
    {
      name: "fix_bug",
      description: "Fix een specifiek probleem in de app",
      parameters: {
        issue: "string — beschrijving van het probleem",
        fix: "string — beschrijving van de oplossing",
      },
    },
  ];
}

// ── Tool Handlers ──

function handleCreateComponent(state: AgentState, data: Record<string, unknown>): ToolResult {
  const screenIndex = data.screenIndex as number;
  const screen = state.ui[screenIndex];
  if (!screen) {
    return { success: false, message: `Scherm ${screenIndex} bestaat niet` };
  }

  if (screen.components.length >= 5) {
    return { success: false, message: "Maximum 5 componenten per scherm" };
  }

  const component: AIComponent = {
    type: (data.type as AIComponentType) || "text",
    label: (data.label as string) || "",
    action: data.action as string | undefined,
    position: (data.position as "top" | "middle" | "bottom") || "middle",
  };

  screen.components.push(component);
  return {
    success: true,
    message: `Component "${component.label}" toegevoegd aan ${screen.name}`,
    data: component,
  };
}

function handleUpdateScreen(state: AgentState, data: Record<string, unknown>): ToolResult {
  const screenIndex = data.screenIndex as number;
  const screen = state.ui[screenIndex];
  if (!screen) {
    return { success: false, message: `Scherm ${screenIndex} bestaat niet` };
  }

  if (data.name) screen.name = data.name as string;
  if (data.purpose) screen.purpose = data.purpose as string;

  return {
    success: true,
    message: `Scherm "${screen.name}" aangepast`,
  };
}

function handleAddFeature(state: AgentState, data: Record<string, unknown>): ToolResult {
  if (!state.plan) {
    return { success: false, message: "Geen plan beschikbaar" };
  }

  state.plan.logic.push({
    feature: (data.feature as string) || "",
    description: (data.description as string) || "",
  });

  return {
    success: true,
    message: `Feature "${data.feature}" toegevoegd`,
  };
}

function handleRemoveComponent(state: AgentState, data: Record<string, unknown>): ToolResult {
  const screenIndex = data.screenIndex as number;
  const componentIndex = data.componentIndex as number;
  const screen = state.ui[screenIndex];
  if (!screen) return { success: false, message: `Scherm ${screenIndex} bestaat niet` };
  if (!screen.components[componentIndex]) {
    return { success: false, message: `Component ${componentIndex} bestaat niet` };
  }

  const removed = screen.components.splice(componentIndex, 1)[0];
  return {
    success: true,
    message: `Component "${removed.label}" verwijderd`,
  };
}

function handleAddScreen(state: AgentState, data: Record<string, unknown>): ToolResult {
  if (state.ui.length >= 5) {
    return { success: false, message: "Maximum 5 schermen bereikt" };
  }

  const screen: AIScreen = {
    name: (data.name as string) || `Scherm ${state.ui.length + 1}`,
    purpose: (data.purpose as string) || "",
    components: [],
  };

  state.ui.push(screen);
  return {
    success: true,
    message: `Scherm "${screen.name}" toegevoegd`,
    data: screen,
  };
}

function handleRemoveScreen(state: AgentState, data: Record<string, unknown>): ToolResult {
  const screenIndex = data.screenIndex as number;
  if (!state.ui[screenIndex]) {
    return { success: false, message: `Scherm ${screenIndex} bestaat niet` };
  }

  const removed = state.ui.splice(screenIndex, 1)[0];
  return {
    success: true,
    message: `Scherm "${removed.name}" verwijderd`,
  };
}

function handleUpdateDatabase(state: AgentState, data: Record<string, unknown>): ToolResult {
  const tableName = data.tableName as string;
  const fields = data.fields as { name: string; type: "string" | "number" | "boolean" }[];

  if (!tableName || !fields) {
    return { success: false, message: "tableName en fields zijn verplicht" };
  }

  const existingIndex = state.database.tables.findIndex(
    (t) => t.name === tableName,
  );

  if (existingIndex >= 0) {
    state.database.tables[existingIndex].fields = fields;
    return { success: true, message: `Tabel "${tableName}" bijgewerkt` };
  }

  state.database.tables.push({ name: tableName, fields });
  return { success: true, message: `Tabel "${tableName}" aangemaakt` };
}

function handleFixBug(state: AgentState, data: Record<string, unknown>): ToolResult {
  const issue = data.issue as string;
  const fix = data.fix as string;

  return {
    success: true,
    message: `Bug geregistreerd: "${issue}" → Fix: "${fix}"`,
    data: { issue, fix },
  };
}
