---
name: app-builder theme is force-dark
description: How theming works in artifacts/app-builder and how to apply a light surface
---

# app-builder theming

`artifacts/app-builder/src/index.css` defines all theme tokens directly on `:root`
with DARK values (e.g. `--background: 240 10% 4%`). The `.dark` class is an
intentional no-op (comment says "we force dark mode"). So the app is dark by default
and toggling/removing a `dark` class does nothing.

**To make a surface light:** use the `.light` class scope (added in index.css) which
redefines the tokens with light values. Apply it to a container; all token-based
descendants (`bg-background`, `text-foreground`, `bg-card`, `border-border`, etc.)
flip to light automatically.

**Why:** there is no light token set on `:root`, so light theming must come from a
scoped class, not from omitting `dark`.

**How to apply:**
- `Layout` (`components/layout.tsx`) applies `light` for non-workspace routes and
  `dark` for the workspace editor route (`/projects/:id`), keyed off `isWorkspace`.
- Radix portals (AlertDialog, Dialog, etc.) render at `document.body`, OUTSIDE the
  Layout container, so they inherit `:root` (dark). To theme a portaled dialog light,
  put `className="light"` directly on its Content element — CSS custom properties set
  by `.light` apply to that element itself and its children.
