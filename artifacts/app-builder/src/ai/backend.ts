/**
 * Backend module — Generates database structure for the app.
 * Analyzes the plan and creates appropriate table definitions.
 */

import type { AIDatabase, AppPlan } from "./componentMap";
import type { AgentState } from "./state";

export interface BackendStructure {
  database: AIDatabase;
  collections: string[];
  hasAuth: boolean;
  hasStorage: boolean;
}

/** Generate backend/database structure from an app plan */
export function generateBackend(state: AgentState): BackendStructure {
  const plan = state.plan;
  if (!plan) {
    return { database: { tables: [] }, collections: [], hasAuth: false, hasStorage: false };
  }

  const tables: AIDatabase["tables"] = [];
  const collections: string[] = [];
  let hasAuth = false;
  let hasStorage = false;

  // Analyze screens and features to determine required data structures
  const allText = [
    plan.description,
    ...plan.screens.map((s) => `${s.name} ${s.purpose}`),
    ...plan.logic.map((l) => `${l.feature} ${l.description}`),
  ]
    .join(" ")
    .toLowerCase();

  // Detect auth requirement
  if (
    allText.includes("login") ||
    allText.includes("registr") ||
    allText.includes("account") ||
    allText.includes("gebruiker") ||
    allText.includes("profiel") ||
    allText.includes("auth")
  ) {
    hasAuth = true;
    tables.push({
      name: "users",
      fields: [
        { name: "id", type: "string" },
        { name: "email", type: "string" },
        { name: "name", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("users");
  }

  // Detect content types
  if (
    allText.includes("product") ||
    allText.includes("winkel") ||
    allText.includes("shop") ||
    allText.includes("bestel") ||
    allText.includes("e-commerce")
  ) {
    tables.push({
      name: "products",
      fields: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "price", type: "number" },
        { name: "description", type: "string" },
        { name: "in_stock", type: "boolean" },
      ],
    });
    tables.push({
      name: "orders",
      fields: [
        { name: "id", type: "string" },
        { name: "user_id", type: "string" },
        { name: "total", type: "number" },
        { name: "status", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("products", "orders");
  }

  if (
    allText.includes("reserv") ||
    allText.includes("boek") ||
    allText.includes("afspraak") ||
    allText.includes("booking")
  ) {
    tables.push({
      name: "bookings",
      fields: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "email", type: "string" },
        { name: "date", type: "string" },
        { name: "time", type: "string" },
        { name: "status", type: "string" },
      ],
    });
    collections.push("bookings");
  }

  if (
    allText.includes("contact") ||
    allText.includes("formulier") ||
    allText.includes("bericht") ||
    allText.includes("message")
  ) {
    tables.push({
      name: "messages",
      fields: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "email", type: "string" },
        { name: "message", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("messages");
  }

  if (
    allText.includes("blog") ||
    allText.includes("artikel") ||
    allText.includes("post") ||
    allText.includes("nieuws")
  ) {
    tables.push({
      name: "posts",
      fields: [
        { name: "id", type: "string" },
        { name: "title", type: "string" },
        { name: "content", type: "string" },
        { name: "author", type: "string" },
        { name: "published", type: "boolean" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("posts");
  }

  if (
    allText.includes("review") ||
    allText.includes("beoordeling") ||
    allText.includes("rating")
  ) {
    tables.push({
      name: "reviews",
      fields: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "rating", type: "number" },
        { name: "text", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("reviews");
  }

  if (
    allText.includes("todo") ||
    allText.includes("taak") ||
    allText.includes("task") ||
    allText.includes("checklist")
  ) {
    tables.push({
      name: "tasks",
      fields: [
        { name: "id", type: "string" },
        { name: "title", type: "string" },
        { name: "completed", type: "boolean" },
        { name: "priority", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("tasks");
  }

  // Detect file/image storage needs
  if (
    allText.includes("upload") ||
    allText.includes("foto") ||
    allText.includes("afbeelding") ||
    allText.includes("bestand") ||
    allText.includes("gallery")
  ) {
    hasStorage = true;
  }

  // If we found no specific tables but there's a plan, add a generic data table
  if (tables.length === 0 && plan.screens.length > 0) {
    tables.push({
      name: "app_items",
      fields: [
        { name: "id", type: "string" },
        { name: "type", type: "string" },
        { name: "data", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("app_items");
  }

  return { database: { tables }, collections, hasAuth, hasStorage };
}

/** Convert backend structure to a prompt hint for the builder */
export function backendToPromptHint(backend: BackendStructure): string {
  const parts: string[] = [];

  if (backend.hasAuth) {
    parts.push("De app heeft authenticatie nodig (login/registratie via mellowData).");
  }

  if (backend.database.tables.length > 0) {
    const tableDescs = backend.database.tables
      .map(
        (t) =>
          `- ${t.name}: ${t.fields.map((f) => f.name).join(", ")}`,
      )
      .join("\n");
    parts.push(`Database collecties (gebruik mellowData):\n${tableDescs}`);
  }

  if (backend.hasStorage) {
    parts.push("De app heeft bestandsopslag nodig voor uploads.");
  }

  return parts.join("\n\n");
}
