/**
 * Architecture module — Defines the app architecture before any code generation.
 * Creates a structured blueprint with pages, components, layouts, state, and data models.
 */

import type { AIScreen, AIDatabase, AILogicFeature } from "./componentMap";

export interface AppArchitecture {
  app_name: string;
  description: string;
  tech_stack: {
    frontend: string;
    backend: string;
    database: string;
    styling: string;
  };
  structure: {
    pages: ArchPage[];
    components: ArchComponent[];
    layouts: ArchLayout[];
    modals: ArchModal[];
    state_management: string;
    api_layer: ArchApiEndpoint[];
    data_models: ArchDataModel[];
  };
  design_system: {
    colors: { name: string; value: string }[];
    spacing: string;
    border_radius: string;
    shadows: string;
    typography: string;
  };
}

export interface ArchPage {
  name: string;
  route: string;
  purpose: string;
  layout: string;
  components: string[];
  user_flow: string;
}

export interface ArchComponent {
  name: string;
  type: string;
  purpose: string;
  props: { name: string; type: string; required: boolean }[];
  reusable: boolean;
}

export interface ArchLayout {
  name: string;
  description: string;
  slots: string[];
}

export interface ArchModal {
  name: string;
  trigger: string;
  purpose: string;
  components: string[];
}

export interface ArchApiEndpoint {
  name: string;
  method: string;
  description: string;
  model: string;
}

export interface ArchDataModel {
  name: string;
  fields: { name: string; type: string; required: boolean }[];
  relations?: string[];
}

/** Generate architecture from an AppPlan */
export function generateArchitecture(
  appName: string,
  description: string,
  screens: AIScreen[],
  database: AIDatabase,
  logic: AILogicFeature[],
): AppArchitecture {
  // Derive pages from screens
  const pages: ArchPage[] = screens.map((screen, i) => ({
    name: screen.name,
    route: i === 0 ? "/" : `/${slugify(screen.name)}`,
    purpose: screen.purpose,
    layout: i === 0 ? "MainLayout" : "DefaultLayout",
    components: screen.components.map((c) => `${capitalize(c.type)}Component`),
    user_flow: screen.purpose,
  }));

  // Derive reusable components from all screens
  const componentSet = new Map<string, ArchComponent>();
  for (const screen of screens) {
    for (const comp of screen.components) {
      const key = comp.type;
      if (!componentSet.has(key)) {
        componentSet.set(key, {
          name: `${capitalize(comp.type)}Component`,
          type: comp.type,
          purpose: comp.label,
          props: [
            { name: "label", type: "string", required: true },
            ...(comp.action ? [{ name: "onAction", type: "() => void", required: false }] : []),
          ],
          reusable: true,
        });
      }
    }
  }

  // Derive layouts
  const layouts: ArchLayout[] = [
    {
      name: "MainLayout",
      description: "Hoofdlayout met navigatie en content area",
      slots: ["navbar", "main", "footer"],
    },
    {
      name: "DefaultLayout",
      description: "Standaard pagina layout",
      slots: ["header", "content"],
    },
  ];

  // Derive modals from components that look modal-like
  const modals: ArchModal[] = screens
    .flatMap((s) => s.components)
    .filter((c) => c.type === "modal" || c.type === "form")
    .map((c) => ({
      name: `${capitalize(c.label)}Modal`,
      trigger: "button_click",
      purpose: c.label,
      components: [c.type],
    }));

  // Derive data models from database
  const dataModels: ArchDataModel[] = database.tables.map((t) => ({
    name: t.name,
    fields: t.fields.map((f) => ({
      name: f.name,
      type: f.type,
      required: true,
    })),
  }));

  // Derive API layer from logic
  const apiLayer: ArchApiEndpoint[] = logic.map((l) => ({
    name: slugify(l.feature),
    method: inferMethod(l.description),
    description: l.description,
    model: inferModel(l.feature),
  }));

  return {
    app_name: appName,
    description,
    tech_stack: {
      frontend: "JavaScript + Tailwind CSS",
      backend: "localStorage (client-side)",
      database: database.tables.length > 0 ? "localStorage JSON" : "Geen",
      styling: "Tailwind CSS via CDN",
    },
    structure: {
      pages,
      components: Array.from(componentSet.values()),
      layouts,
      modals,
      state_management: "JavaScript state + localStorage",
      api_layer: apiLayer,
      data_models: dataModels,
    },
    design_system: {
      colors: [
        { name: "primary", value: "hsl(220, 90%, 56%)" },
        { name: "secondary", value: "hsl(220, 14%, 96%)" },
        { name: "accent", value: "hsl(262, 83%, 58%)" },
      ],
      spacing: "4px base unit (Tailwind)",
      border_radius: "8px (rounded-lg)",
      shadows: "shadow-sm, shadow-md, shadow-lg",
      typography: "Inter / system-ui",
    },
  };
}

/** Convert architecture to a prompt hint for the builder */
export function architectureToPrompt(arch: AppArchitecture): string {
  const pages = arch.structure.pages
    .map((p) => `📄 ${p.name} (${p.route})\n   Doel: ${p.purpose}\n   Layout: ${p.layout}\n   Componenten: ${p.components.join(", ")}`)
    .join("\n\n");

  const components = arch.structure.components
    .map((c) => `🧩 ${c.name} (${c.type})\n   ${c.purpose}\n   Props: ${c.props.map((p) => `${p.name}: ${p.type}`).join(", ")}`)
    .join("\n\n");

  const layouts = arch.structure.layouts
    .map((l) => `📐 ${l.name}: ${l.description}\n   Slots: ${l.slots.join(", ")}`)
    .join("\n\n");

  const models = arch.structure.data_models
    .map((m) => `💾 ${m.name}: ${m.fields.map((f) => `${f.name}(${f.type})`).join(", ")}`)
    .join("\n");

  const api = arch.structure.api_layer
    .map((a) => `🔌 ${a.method.toUpperCase()} ${a.name}: ${a.description}`)
    .join("\n");

  return `=== ARCHITECTUUR ===
App: ${arch.app_name}
${arch.description}

=== TECH STACK ===
Frontend: ${arch.tech_stack.frontend}
Backend: ${arch.tech_stack.backend}
Database: ${arch.tech_stack.database}
Styling: ${arch.tech_stack.styling}

=== PAGINA'S ===
${pages}

=== COMPONENTEN ===
${components}

=== LAYOUTS ===
${layouts}

=== DATA MODELLEN ===
${models || "Geen"}

=== API LAAG ===
${api || "Geen externe API"}

=== DESIGN SYSTEEM ===
Kleuren: ${arch.design_system.colors.map((c) => `${c.name}: ${c.value}`).join(", ")}
Typografie: ${arch.design_system.typography}
Spacing: ${arch.design_system.spacing}
Borders: ${arch.design_system.border_radius}

=== INSTRUCTIES ===
- Bouw de app op als MODULAIRE JavaScript functies
- Elke pagina is een functie: function render${arch.structure.pages.map((p) => capitalize(slugify(p.name))).join(", render")}()
- Elke component is een herbruikbare functie
- Gebruik de layouts als basis structuur
- Implementeer state management met de data modellen
- Maak navigatie tussen pagina's met JavaScript
`;
}

/** Generate a folder structure representation */
export function architectureToFileTree(arch: AppArchitecture): string {
  const lines: string[] = [
    `📁 ${slugify(arch.app_name)}/`,
    `├── 📁 components/`,
  ];

  for (const comp of arch.structure.components) {
    lines.push(`│   ├── ${comp.name}.js`);
  }

  lines.push(`├── 📁 pages/`);
  for (const page of arch.structure.pages) {
    lines.push(`│   ├── ${capitalize(slugify(page.name))}Page.js`);
  }

  lines.push(`├── 📁 layouts/`);
  for (const layout of arch.structure.layouts) {
    lines.push(`│   ├── ${layout.name}.js`);
  }

  if (arch.structure.modals.length > 0) {
    lines.push(`├── 📁 modals/`);
    for (const modal of arch.structure.modals) {
      lines.push(`│   ├── ${modal.name}.js`);
    }
  }

  if (arch.structure.data_models.length > 0) {
    lines.push(`├── 📁 models/`);
    for (const model of arch.structure.data_models) {
      lines.push(`│   ├── ${model.name}.js`);
    }
  }

  if (arch.structure.api_layer.length > 0) {
    lines.push(`├── 📁 api/`);
    for (const api of arch.structure.api_layer) {
      lines.push(`│   ├── ${api.name}.js`);
    }
  }

  lines.push(`├── 📁 state/`);
  lines.push(`│   ├── store.js`);
  lines.push(`├── app.js`);
  lines.push(`└── styles.css`);

  return lines.join("\n");
}

// ── Helpers ──

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function inferMethod(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes("toevoeg") || lower.includes("maak") || lower.includes("creat")) return "POST";
  if (lower.includes("verwijder") || lower.includes("delet")) return "DELETE";
  if (lower.includes("wijzig") || lower.includes("updat") || lower.includes("bewerk")) return "PUT";
  return "GET";
}

function inferModel(feature: string): string {
  const lower = feature.toLowerCase();
  const words = lower.split(/\s+/);
  return words[words.length - 1] || feature;
}
