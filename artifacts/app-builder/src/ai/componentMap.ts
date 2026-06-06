/**
 * Maps AI-generated component types to real React component imports.
 * Used by the builder to translate abstract plans into renderable structures.
 */

export type AIComponentType =
  | "button"
  | "input"
  | "card"
  | "checkbox"
  | "text"
  | "image"
  | "form"
  | "navbar"
  | "hero"
  | "footer"
  | "modal"
  | "list"
  | "table";

export interface AIComponent {
  type: AIComponentType;
  label: string;
  action?: string;
  position?: "top" | "middle" | "bottom";
  props?: Record<string, unknown>;
  children?: AIComponent[];
}

export interface AIScreen {
  name: string;
  purpose: string;
  components: AIComponent[];
}

export interface AIDatabase {
  tables: {
    name: string;
    fields: { name: string; type: "string" | "number" | "boolean" }[];
  }[];
}

export interface AILogicFeature {
  feature: string;
  description: string;
}

export interface AppPlan {
  app_name: string;
  description: string;
  screens: AIScreen[];
  database: AIDatabase;
  logic: AILogicFeature[];
}

/** Maps component type to HTML/Tailwind snippet hints for the builder prompt */
export const componentHints: Record<AIComponentType, string> = {
  button: "Tailwind styled button with hover effects and onclick handler",
  input: "Styled input field with label, validation, and placeholder",
  card: "Card container with shadow, rounded corners, header and content",
  checkbox: "Custom styled checkbox with label and toggle state",
  text: "Typography element (h1-h6, p) with proper hierarchy",
  image: "Responsive image with alt text and lazy loading",
  form: "Complete form with validation, submit handler, and feedback",
  navbar: "Sticky navigation bar with mobile hamburger menu",
  hero: "Hero section with headline, subtitle, and CTA button",
  footer: "Footer with links, contact info, and copyright",
  modal: "Modal dialog with backdrop, close button, and content",
  list: "Styled list with items, icons, and interactive elements",
  table: "Responsive data table with headers and rows",
};
