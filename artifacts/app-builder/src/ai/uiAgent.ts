/**
 * UI Agent — Generates UI component structures for app screens.
 * Works with the planner output to create detailed component trees.
 */

import type { AIComponent, AIComponentType, AIScreen, AppPlan } from "./componentMap";

/** Generate UI components for all screens in a plan */
export function generateUI(plan: AppPlan): AIScreen[] {
  return plan.screens.map((screen) => ({
    ...screen,
    components:
      screen.components.length > 0
        ? screen.components
        : inferComponents(screen, plan),
  }));
}

/** Infer appropriate components for a screen based on its purpose */
function inferComponents(screen: AIScreen, plan: AppPlan): AIComponent[] {
  const components: AIComponent[] = [];
  const lower = `${screen.name} ${screen.purpose}`.toLowerCase();

  // Login / Auth screen
  if (lower.includes("login") || lower.includes("inlog") || lower.includes("auth")) {
    components.push(
      { type: "text", label: "Welkom terug", position: "top" },
      { type: "input", label: "E-mailadres", position: "middle", props: { placeholder: "naam@voorbeeld.nl" } },
      { type: "input", label: "Wachtwoord", position: "middle", props: { type: "password" } },
      { type: "button", label: "Inloggen", action: "submit_login", position: "bottom" },
      { type: "button", label: "Registreren", action: "navigate_register", position: "bottom" },
    );
    return limitComponents(components);
  }

  // Register screen
  if (lower.includes("registr") || lower.includes("aanmeld") || lower.includes("signup")) {
    components.push(
      { type: "text", label: "Account aanmaken", position: "top" },
      { type: "input", label: "Naam", position: "middle" },
      { type: "input", label: "E-mailadres", position: "middle" },
      { type: "input", label: "Wachtwoord", position: "middle", props: { type: "password" } },
      { type: "button", label: "Registreren", action: "submit_register", position: "bottom" },
    );
    return limitComponents(components);
  }

  // Dashboard
  if (lower.includes("dashboard") || lower.includes("overzicht")) {
    components.push(
      { type: "text", label: "Dashboard", position: "top" },
      { type: "card", label: "Statistieken", position: "middle" },
      { type: "card", label: "Recente activiteit", position: "middle" },
      { type: "button", label: "Bekijk meer", action: "navigate_detail", position: "bottom" },
    );
    return limitComponents(components);
  }

  // Contact / Form
  if (lower.includes("contact") || lower.includes("formulier")) {
    components.push(
      { type: "text", label: "Contact", position: "top" },
      { type: "input", label: "Naam", position: "middle" },
      { type: "input", label: "E-mail", position: "middle" },
      { type: "input", label: "Bericht", position: "middle" },
      { type: "button", label: "Verstuur", action: "submit_contact", position: "bottom" },
    );
    return limitComponents(components);
  }

  // Product / Shop
  if (lower.includes("product") || lower.includes("winkel") || lower.includes("shop")) {
    components.push(
      { type: "text", label: "Producten", position: "top" },
      { type: "card", label: "Product 1", position: "middle" },
      { type: "card", label: "Product 2", position: "middle" },
      { type: "button", label: "Toevoegen aan winkelwagen", action: "add_to_cart", position: "bottom" },
    );
    return limitComponents(components);
  }

  // Profile
  if (lower.includes("profiel") || lower.includes("account") || lower.includes("profile")) {
    components.push(
      { type: "image", label: "Profielfoto", position: "top" },
      { type: "text", label: "Gebruikersnaam", position: "middle" },
      { type: "input", label: "Naam wijzigen", position: "middle" },
      { type: "button", label: "Opslaan", action: "save_profile", position: "bottom" },
    );
    return limitComponents(components);
  }

  // Settings
  if (lower.includes("instelling") || lower.includes("settings")) {
    components.push(
      { type: "text", label: "Instellingen", position: "top" },
      { type: "checkbox", label: "Notificaties", position: "middle" },
      { type: "checkbox", label: "Donkere modus", position: "middle" },
      { type: "button", label: "Opslaan", action: "save_settings", position: "bottom" },
    );
    return limitComponents(components);
  }

  // Default: generic screen
  components.push(
    { type: "text", label: screen.name, position: "top" },
    { type: "card", label: "Inhoud", position: "middle" },
    { type: "button", label: "Actie", action: "default_action", position: "bottom" },
  );

  return limitComponents(components);
}

/** Ensure max 5 components per screen */
function limitComponents(components: AIComponent[]): AIComponent[] {
  return components.slice(0, 5);
}

/** Validate that all components use valid types */
export function validateComponents(screens: AIScreen[]): {
  valid: boolean;
  errors: string[];
} {
  const validTypes: AIComponentType[] = [
    "button", "input", "checkbox", "card", "text", "image",
    "form", "navbar", "hero", "footer", "modal", "list", "table",
  ];
  const errors: string[] = [];

  for (const screen of screens) {
    if (screen.components.length > 5) {
      errors.push(`${screen.name}: meer dan 5 componenten`);
    }
    for (const comp of screen.components) {
      if (!validTypes.includes(comp.type)) {
        errors.push(`${screen.name}: ongeldig type "${comp.type}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
