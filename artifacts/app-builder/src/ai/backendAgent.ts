/**
 * Backend Agent — Generates database schemas and backend structure.
 * Extends the existing backend.ts with agent-style capabilities.
 */

import type { AIDatabase, AppPlan } from "./componentMap";
import type { AgentState } from "./state";

export interface BackendSchema {
  database: AIDatabase;
  collections: string[];
  apis: APIEndpoint[];
  hasAuth: boolean;
  hasStorage: boolean;
  hasRealtime: boolean;
}

export interface APIEndpoint {
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  description: string;
  collection: string;
}

/** Generate a complete backend schema from the agent state */
export function generateBackendSchema(state: AgentState): BackendSchema {
  const plan = state.plan;
  if (!plan) {
    return {
      database: { tables: [] },
      collections: [],
      apis: [],
      hasAuth: false,
      hasStorage: false,
      hasRealtime: false,
    };
  }

  const allText = [
    plan.description,
    ...plan.screens.map((s) => `${s.name} ${s.purpose}`),
    ...plan.logic.map((l) => `${l.feature} ${l.description}`),
  ].join(" ").toLowerCase();

  const tables: AIDatabase["tables"] = [];
  const collections: string[] = [];
  const apis: APIEndpoint[] = [];
  let hasAuth = false;
  let hasStorage = false;
  let hasRealtime = false;

  // ── Auth detection ──
  if (/login|registr|account|gebruiker|profiel|auth/.test(allText)) {
    hasAuth = true;
    tables.push({
      name: "users",
      fields: [
        { name: "id", type: "string" },
        { name: "email", type: "string" },
        { name: "name", type: "string" },
        { name: "password_hash", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("users");
    apis.push(
      { name: "register", method: "POST", description: "Registreer nieuwe gebruiker", collection: "users" },
      { name: "login", method: "POST", description: "Log gebruiker in", collection: "users" },
    );
  }

  // ── E-commerce ──
  if (/product|winkel|shop|bestel|e-commerce|webshop/.test(allText)) {
    tables.push(
      {
        name: "products",
        fields: [
          { name: "id", type: "string" },
          { name: "name", type: "string" },
          { name: "price", type: "number" },
          { name: "description", type: "string" },
          { name: "image_url", type: "string" },
          { name: "category", type: "string" },
          { name: "in_stock", type: "boolean" },
        ],
      },
      {
        name: "orders",
        fields: [
          { name: "id", type: "string" },
          { name: "user_id", type: "string" },
          { name: "items", type: "string" },
          { name: "total", type: "number" },
          { name: "status", type: "string" },
          { name: "created_at", type: "string" },
        ],
      },
      {
        name: "cart",
        fields: [
          { name: "id", type: "string" },
          { name: "user_id", type: "string" },
          { name: "product_id", type: "string" },
          { name: "quantity", type: "number" },
        ],
      },
    );
    collections.push("products", "orders", "cart");
    apis.push(
      { name: "getProducts", method: "GET", description: "Haal producten op", collection: "products" },
      { name: "createOrder", method: "POST", description: "Maak bestelling aan", collection: "orders" },
    );
  }

  // ── Bookings ──
  if (/reserv|boek|afspraak|booking|agenda/.test(allText)) {
    tables.push({
      name: "bookings",
      fields: [
        { name: "id", type: "string" },
        { name: "user_name", type: "string" },
        { name: "email", type: "string" },
        { name: "phone", type: "string" },
        { name: "date", type: "string" },
        { name: "time", type: "string" },
        { name: "service", type: "string" },
        { name: "status", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("bookings");
    apis.push(
      { name: "getBookings", method: "GET", description: "Haal boekingen op", collection: "bookings" },
      { name: "createBooking", method: "POST", description: "Maak boeking aan", collection: "bookings" },
    );
  }

  // ── Contact / Messages ──
  if (/contact|bericht|message|formulier/.test(allText)) {
    tables.push({
      name: "messages",
      fields: [
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "email", type: "string" },
        { name: "subject", type: "string" },
        { name: "message", type: "string" },
        { name: "read", type: "boolean" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("messages");
    apis.push(
      { name: "sendMessage", method: "POST", description: "Verstuur contactbericht", collection: "messages" },
    );
  }

  // ── Blog / Content ──
  if (/blog|artikel|post|nieuws|content/.test(allText)) {
    tables.push({
      name: "posts",
      fields: [
        { name: "id", type: "string" },
        { name: "title", type: "string" },
        { name: "slug", type: "string" },
        { name: "content", type: "string" },
        { name: "author", type: "string" },
        { name: "category", type: "string" },
        { name: "published", type: "boolean" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("posts");
  }

  // ── Reviews ──
  if (/review|beoordeling|rating|feedback/.test(allText)) {
    tables.push({
      name: "reviews",
      fields: [
        { name: "id", type: "string" },
        { name: "user_name", type: "string" },
        { name: "rating", type: "number" },
        { name: "text", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("reviews");
  }

  // ── Tasks / Todo ──
  if (/todo|taak|task|checklist|planning/.test(allText)) {
    tables.push({
      name: "tasks",
      fields: [
        { name: "id", type: "string" },
        { name: "title", type: "string" },
        { name: "description", type: "string" },
        { name: "completed", type: "boolean" },
        { name: "priority", type: "string" },
        { name: "due_date", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("tasks");
  }

  // ── Chat / Realtime ──
  if (/chat|berichten|realtime|live/.test(allText)) {
    hasRealtime = true;
    tables.push({
      name: "chat_messages",
      fields: [
        { name: "id", type: "string" },
        { name: "sender_id", type: "string" },
        { name: "content", type: "string" },
        { name: "room_id", type: "string" },
        { name: "created_at", type: "string" },
      ],
    });
    collections.push("chat_messages");
  }

  // ── Storage ──
  if (/upload|foto|afbeelding|bestand|gallery|portfolio/.test(allText)) {
    hasStorage = true;
  }

  // ── Fitness specific ──
  if (/fitness|workout|training|oefening|gym/.test(allText)) {
    tables.push(
      {
        name: "workouts",
        fields: [
          { name: "id", type: "string" },
          { name: "user_id", type: "string" },
          { name: "name", type: "string" },
          { name: "duration", type: "number" },
          { name: "calories", type: "number" },
          { name: "date", type: "string" },
        ],
      },
      {
        name: "exercises",
        fields: [
          { name: "id", type: "string" },
          { name: "name", type: "string" },
          { name: "sets", type: "number" },
          { name: "reps", type: "number" },
          { name: "muscle_group", type: "string" },
        ],
      },
    );
    collections.push("workouts", "exercises");
  }

  // Fallback generic table
  if (tables.length === 0) {
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

  return { database: { tables }, collections, apis, hasAuth, hasStorage, hasRealtime };
}

/** Convert backend schema to a prompt hint for the builder */
export function schemaToPromptHint(schema: BackendSchema): string {
  const parts: string[] = [];

  if (schema.hasAuth) {
    parts.push("AUTHENTICATIE: Implementeer login/registratie met mellowData('users').");
  }

  if (schema.database.tables.length > 0) {
    const tableDescs = schema.database.tables
      .map((t) => `  - ${t.name}(${t.fields.map((f) => f.name).join(", ")})`)
      .join("\n");
    parts.push(`DATABASE COLLECTIES (gebruik mellowData):\n${tableDescs}`);
  }

  if (schema.apis.length > 0) {
    const apiDescs = schema.apis
      .map((a) => `  - ${a.method} ${a.name}: ${a.description}`)
      .join("\n");
    parts.push(`API ENDPOINTS:\n${apiDescs}`);
  }

  if (schema.hasRealtime) {
    parts.push("REALTIME: Implementeer live updates voor chat/berichten.");
  }

  if (schema.hasStorage) {
    parts.push("OPSLAG: Ondersteuning voor bestandsuploads.");
  }

  return parts.join("\n\n");
}
