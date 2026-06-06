/**
 * Renderer — Converts JSON component definitions into React elements.
 * Supports ALL component types from componentMap.ts with safe fallbacks.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import type { AIComponent, AIScreen, AIComponentType } from "./componentMap";
import { COMPONENT_TYPES } from "./constraints";

/** Check if a component type is valid */
function isValidType(type: string): type is AIComponentType {
  return (COMPONENT_TYPES as readonly string[]).includes(type);
}

/** Render a single AI component to a React element */
export function renderComponent(component: AIComponent, index: number): React.ReactElement {
  const key = `${component.type}-${index}`;

  // Guard against invalid types
  if (!isValidType(component.type)) {
    return React.createElement(
      "div",
      { key, className: "p-2 border border-dashed border-destructive rounded text-xs text-destructive" },
      `[Ongeldig type: ${component.type}] ${component.label}`,
    );
  }

  switch (component.type) {
    case "button":
      return React.createElement(
        Button,
        { key, className: "w-full", variant: "default" },
        component.label,
      );

    case "input":
      return React.createElement(Input, {
        key,
        placeholder: component.label,
        className: "w-full",
        type: (component.props?.type as string) || "text",
      });

    case "checkbox":
      return React.createElement(
        "div",
        { key, className: "flex items-center gap-2" },
        React.createElement(Checkbox, { id: key }),
        React.createElement("label", { htmlFor: key, className: "text-sm" }, component.label),
      );

    case "card":
      return React.createElement(
        Card,
        { key, className: "w-full" },
        React.createElement(
          CardHeader,
          null,
          React.createElement(CardTitle, { className: "text-lg" }, component.label),
        ),
        component.children
          ? React.createElement(
              CardContent,
              null,
              component.children.map((child, i) => renderComponent(child, i)),
            )
          : null,
      );

    case "text":
      return React.createElement(
        "p",
        { key, className: "text-sm text-muted-foreground" },
        component.label,
      );

    case "image":
      return React.createElement("img", {
        key,
        src: (component.props?.src as string) || "/placeholder.svg",
        alt: component.label,
        className: "w-full rounded-lg object-cover",
      });

    case "form":
      return React.createElement(
        "form",
        {
          key,
          className: "space-y-3 w-full",
          onSubmit: (e: React.FormEvent) => e.preventDefault(),
        },
        React.createElement("p", { className: "font-medium text-sm" }, component.label),
        component.children
          ? component.children.map((child, i) => renderComponent(child, i))
          : React.createElement(Input, { placeholder: "Vul in..." }),
        React.createElement(Button, { type: "submit", className: "w-full" }, "Verstuur"),
      );

    case "navbar":
      return React.createElement(
        "nav",
        { key, className: "flex items-center justify-between p-4 bg-card border-b border-border" },
        React.createElement("span", { className: "font-bold" }, component.label),
        component.children
          ? React.createElement(
              "div",
              { className: "flex items-center gap-2" },
              component.children.map((child, i) => renderComponent(child, i)),
            )
          : null,
      );

    case "hero":
      return React.createElement(
        "div",
        { key, className: "text-center py-12 px-4 space-y-4" },
        React.createElement("h1", { className: "text-3xl font-bold" }, component.label),
        component.children?.map((child, i) => renderComponent(child, i)),
      );

    case "footer":
      return React.createElement(
        "footer",
        { key, className: "text-center py-6 text-sm text-muted-foreground border-t border-border" },
        component.label,
      );

    case "modal":
      return React.createElement(
        "div",
        { key, className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none" },
        React.createElement(
          "div",
          { className: "bg-card rounded-lg shadow-xl p-6 max-w-md w-full mx-4" },
          React.createElement("h3", { className: "font-semibold text-lg mb-2" }, component.label),
          component.children
            ? component.children.map((child, i) => renderComponent(child, i))
            : React.createElement("p", { className: "text-sm text-muted-foreground" }, "Modal inhoud"),
          React.createElement(
            Button,
            { variant: "outline", className: "mt-4 w-full" },
            "Sluiten",
          ),
        ),
      );

    case "list":
      return React.createElement(
        "ul",
        { key, className: "space-y-2 w-full" },
        component.children
          ? component.children.map((child, i) =>
              React.createElement(
                "li",
                { key: `li-${i}`, className: "flex items-center gap-2 p-2 rounded bg-secondary/50" },
                renderComponent(child, i),
              ),
            )
          : React.createElement(
              "li",
              { className: "p-2 rounded bg-secondary/50 text-sm" },
              component.label,
            ),
      );

    case "table":
      return React.createElement(
        "div",
        { key, className: "w-full overflow-x-auto rounded-lg border border-border" },
        React.createElement(
          Table,
          null,
          React.createElement(
            TableHeader,
            null,
            React.createElement(
              TableRow,
              null,
              React.createElement(TableHead, null, component.label),
              React.createElement(TableHead, null, "Waarde"),
            ),
          ),
          React.createElement(
            TableBody,
            null,
            React.createElement(
              TableRow,
              null,
              React.createElement(TableCell, null, "Voorbeeld"),
              React.createElement(TableCell, null, "Data"),
            ),
          ),
        ),
      );

    default: {
      // Exhaustive check — this should never happen with valid types
      const _exhaustive: never = component.type;
      return React.createElement(
        "div",
        { key, className: "p-2 border border-dashed border-border rounded" },
        `[${String(_exhaustive)}] ${component.label}`,
      );
    }
  }
}

/** Render a full screen of components */
export function renderScreen(screen: AIScreen): React.ReactElement {
  return React.createElement(
    "div",
    { className: "space-y-4 p-4" },
    React.createElement("h2", { className: "text-xl font-semibold" }, screen.name),
    React.createElement(
      "p",
      { className: "text-sm text-muted-foreground mb-4" },
      screen.purpose,
    ),
    ...screen.components.map((comp, i) => renderComponent(comp, i)),
  );
}

/** Render all screens as a preview */
export function renderAppPreview(screens: AIScreen[]): React.ReactElement {
  return React.createElement(
    "div",
    { className: "space-y-8 max-w-lg mx-auto" },
    ...screens.map((screen, i) =>
      React.createElement(
        "div",
        { key: i, className: "border border-border rounded-lg overflow-hidden" },
        renderScreen(screen),
      ),
    ),
  );
}
