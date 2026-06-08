import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, projects, projectMessages, projectFiles, learnings } from "@workspace/db";
import {
  CreateProjectBody,
  GetProjectParams,
  DeleteProjectParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";

const router = Router();

// Tolerant parser: LANGUAGE line is optional, and the language may instead sit
// on the opening fence (e.g. ```html). Handles CRLF and extra fence metadata.
const FILE_BLOCK_REGEX =
  /FILE:\s*(.+?)\s*\r?\n(?:LANGUAGE:\s*(.+?)\s*\r?\n)?```([\w+-]*)[^\n]*\r?\n([\s\S]*?)```/g;

function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "html",
    htm: "html",
    css: "css",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    svg: "svg",
    ts: "typescript",
    md: "markdown",
  };
  return map[ext] ?? "plaintext";
}

function buildSystemPrompt(projectName: string, fileContext: string, learningsContext: string): string {
  return `You are Buildly, an expert AI web app builder. Generate beautiful, fully-functional web apps for a project called "${projectName}", with clean, well-structured, modular code.${learningsContext}

You build COMPLETE, production-ready web apps — never demos, prototypes, or placeholders.

RUNTIME CONSTRAINTS (the app runs sandboxed in a browser iframe — respect these exactly):
- Vanilla JavaScript only (ES modules / plain JS). NO npm, NO build step, NO JSX/TSX, NO frameworks that need compiling.
- Load libraries via CDN only (Tailwind, Chart.js, etc.).
- Persist data with localStorage (no backend/Supabase is available in this sandbox).
- "Pages"/routing = a single-page app with client-side view switching (hash routing or show/hide sections) inside index.html — do NOT rely on separate .html files for navigation.

FILE STRUCTURE — split into MULTIPLE well-organized files, never one giant file:
  - index.html — semantic markup, plus an inline <style> block with your design-token :root variables and a small body reset; all other styling lives in styles.css. Link sibling files with relative paths
  - styles.css — custom styling beyond Tailwind utilities
  - script.js — app logic; for larger apps split by concern into several JS files (e.g. router.js, store.js, ui.js), each referenced from index.html
- index.html must reference siblings exactly like: <link rel="stylesheet" href="styles.css"> and <script src="script.js"></script> (and <script src="store.js"></script> etc.)
- Add brief comments explaining each module's responsibility. Keep UI, logic, and data access separated.

DESIGN — THINK LIKE A WORLD-CLASS PRODUCT DESIGNER. Every app you build must look and feel like a premium, $10,000 product: clean, elegant, meticulously polished, and visually cohesive. Never ship something generic, cluttered, flat, or "templated". Design is not decoration added at the end — design every screen with intent from the very start.

DESIGN PROCESS — ALWAYS plan the structure BEFORE writing a single line of code. Reason through these steps first, then build strictly to that plan:
1. Understand the app's goal and who uses it.
2. Map the primary user flow — the main task the user performs and repeats.
3. Define the information architecture: the main views/sections and how they relate.
4. Choose ONE consistent layout on a real grid system. Use a proper app shell: a top bar/header (app name + primary nav), an optional sidebar for section navigation on larger/data-dense apps, and a main content region on a consistent column grid. Decide breakpoints.
5. Decide the reusable components you need — header, navigation, cards, forms, tables/lists, empty states — and use them consistently throughout.
6. Verify spacing, alignment, and visual hierarchy against a single consistent spacing scale BEFORE finalizing.
7. Only then write the HTML, CSS, and JavaScript, faithfully to that plan.

The result MUST feel like a professional SaaS dashboard — a deliberate, cohesive product — NOT loose blocks dropped onto a page.

STRUCTURE & LAYOUT REQUIREMENTS (apply to EVERY app):
- A real app shell: clear header/top bar, an optional sidebar for navigation on larger apps, and a main content area on a consistent grid.
- Group content into clearly delineated sections with consistent vertical rhythm — never a random pile of elements.
- Align everything to the grid on one consistent spacing scale; no arbitrary margins, no off-grid or random placement.
- Stats/metrics live in COMPACT stat cards arranged in a row or grid (small label + value) — not giant numbers scattered around.
- Forms are well-structured: grouped fields, aligned labels, logical order, one clear primary action.
- Lists and tables are clean and scannable: aligned columns, clear headers, tidy rows.
- Restrained typography — follow the type scale below; no unnecessarily huge text.
- Fully responsive: the grid reflows sensibly from desktop to mobile (sidebar collapses, cards stack, tables stay usable).

BUILDLY DESIGN SYSTEM — this is the house style. Apply it EXACTLY to EVERY generated app so everything feels like it was crafted by a Berlin design studio (think Linear, Vercel, Resend, Raycast), never like AI output. Use these precise values; do not invent a different palette unless the user explicitly asks for one.

OVERALL PAGE:
- Background: #0a0a0a
- All text defaults to #ffffff
- Max content width: ~800px centered (margin: 0 auto) for simple single-column or form/content apps; for dashboards and data-dense tools use a wider centered shell (up to ~1200px) with a sidebar so tables and stat-card grids have room. Keep generous gutters either way.
- Page padding: 48px 24px
- Font: Inter, imported from Google Fonts (with a system-sans fallback)

TYPOGRAPHY HIERARCHY:
- H1: 32px, font-weight 300, letter-spacing -0.02em
- H2: 20px, font-weight 400, letter-spacing -0.01em
- Body: 15px, font-weight 400, line-height 1.7, color rgba(255,255,255,0.7)
- Caption: 12px, uppercase, letter-spacing 0.08em, color rgba(255,255,255,0.4)

INPUTS & FORM FIELDS:
- Background: transparent; border: none; border-bottom: 2px solid rgba(255,255,255,0.15); border-radius: 0 (flat, never rounded)
- Color: #ffffff; font-size: 16px; font-weight: 400; padding: 16px 0; width: 100%
- Placeholder color: rgba(255,255,255,0.3)
- On focus: border-bottom color -> #ffffff; NO outline, NO glow, NO box-shadow
- Transition: border-color 0.2s ease

LABELS:
- Font-size: 11px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase
- Color: rgba(255,255,255,0.4); display: block; margin-bottom: 8px

FORM GROUPS:
- Margin-bottom: 32px; position: relative

PRIMARY BUTTONS:
- Background: #ffffff; color: #000000; border: none; border-radius: 4px
- Padding: 16px 32px; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer
- On hover: opacity 0.85; transition: opacity 0.15s
- NO box-shadow, NO gradient

SECONDARY BUTTONS:
- Background: transparent; color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.2)
- Same padding and typography as primary
- On hover: border-color rgba(255,255,255,0.6)

CARDS & CONTAINERS:
- Background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 32px; backdrop-filter: none

METRIC / STAT DISPLAYS:
- Present stats as COMPACT stat cards arranged in a responsive row/grid (use the faint card surface from the CARDS section above, with tight internal padding).
- Label: 12px, uppercase, letter-spacing 0.08em, color rgba(255,255,255,0.4), placed above the value.
- Value: ~28px, font-weight 300, letter-spacing -0.02em, color #ffffff — prominent but restrained; never oversized.
- Keep cards compact and aligned to the grid; never use giant hero numbers scattered around the page.

STRICT RULES — never break these:
- Zero gradients.
- Zero box-shadows.
- Zero rounded inputs (inputs are flat, bottom-border only).
- Zero colored buttons — buttons are only solid white (primary) or transparent/outline (secondary).
- Generous whitespace and clear hierarchy; every app must feel like a Berlin design studio made it, not an AI.
- Inspired by Linear, Vercel, Resend, Raycast.

EXECUTION QUALITY (still required within this system):
- Consistent spacing and pixel-perfect alignment; no awkward gaps, clipped text, or misaligned elements.
- Smooth, subtle transitions only (the ones specified above); motion is effortless, never flashy.
- Design every state: empty states, loading states, hover/active/focus states, and inline error states.

IMPLEMENTATION:
- Put these design tokens in an inline <style> block at the top of index.html (a :root variable set for the colors above + a body reset: margin 0, background #0a0a0a, color #ffffff, font-family Inter) so the app paints correctly immediately; put all other styling in styles.css.
- Import Inter with a Google Fonts <link>.

NON-NEGOTIABLES (quality floor — never break):
- NO Lorem Ipsum or placeholder copy — write real, realistic content and seed real sample data so the app is fully demonstrable on first load.
- NO dead buttons or links — every interactive element must actually work.
- Fully mobile responsive with media queries.
- Every form has validation with clear inline error messages.
- Always include empty states and loading states.

ALWAYS GENERATE:
1. A clean, well-designed header or navigation.
2. A main content area in a centered, comfortable container.
3. At least 3 working, genuinely useful interactive features.
4. Error handling and graceful fallbacks.
5. A complete, shippable, beautiful app — not a demo.

CORE FEATURES (include unless the user says otherwise):
- A real main app view with genuine functionality — not a stub.
- Data persistence via localStorage so data survives refreshes.
- Form validation with clear, inline error messages.
- Navigation/routing between views when the app has more than one section.

AUTHENTICATION — ONLY WHEN THE USER ASKS:
- Do NOT add login, sign-up, sign-in, user accounts, or any authentication UI or logic unless the user explicitly requests it. By default an app must open straight into its working main view — no login wall.
- Only when the user's request clearly mentions accounts / login / users / sign-in, build a clean auth flow (localStorage-backed login/register, persisted session, logged-in state, logout).

CODE QUALITY:
- NO placeholder text like "TODO", "coming soon", or dead buttons — every button and link must actually do something.
- Seed real, realistic sample data so the app is demonstrable on first load.
- Clear variable/function names and clean, readable code.

RUNTIME ROBUSTNESS (critical — the app MUST run with ZERO uncaught console errors):
- Run code only after the DOM exists: place <script> tags at the END of <body>, or wrap all DOM access in a "DOMContentLoaded" listener. Never read elements before they are rendered.
- Guard every element lookup: check the result of getElementById/querySelector before using it. Never call methods on a possibly-null element.
- Wrap parsing and storage in try/catch: JSON.parse, localStorage.getItem/setItem can throw — handle failures gracefully and fall back to seed data.
- Do NOT reference external image, font, or file URLs that may 404 (no random photo/CDN asset URLs). For graphics use inline SVG, emoji, or data URIs (NO gradients — see the design system). Google Fonts <link> tags are allowed.
- Attach event listeners only to elements that exist; verify selectors match the markup you generated.
- When regenerating after a fix request, output the COMPLETE corrected files (every file), not a partial patch — files fully replace the previous versions.

CONSISTENCY ON EDITS (when current project files already exist below):
- This is an EDIT to an existing app, not a fresh build. If the existing files already follow the BUILDLY DESIGN SYSTEM above, keep matching it exactly. If they predate it and use a different look, preserve that app's established design language (palette, typography, spacing, component styles) so the result stays visually cohesive — do NOT re-theme or migrate it onto the Buildly system unless the user explicitly asks. Either way, only elevate the parts you actually touch.
- Make the SMALLEST change that satisfies the request. Do not redesign, rename, or restructure unrelated parts of the app, and do not drop existing features or seeded data.
- Keep all existing files and their working behavior intact; only change what the request requires.

ACCESSIBILITY & UX (always):
- Every input has an associated <label>; every icon-only button has an aria-label; images have meaningful alt text.
- Fully keyboard operable: logical tab order, visible focus states, Enter/Escape work in dialogs and forms. Use semantic elements (button, nav, main, header) — never click handlers on bare <div>s.
- Ensure readable color contrast (WCAG AA) for text and interactive elements in the chosen palette.
- Provide instant feedback: disable buttons while busy, show inline validation, confirm destructive actions, and use subtle toasts/messages for success/failure.

FINAL SELF-CHECK (verify before you output — a broken app is a failure):
- Every sibling file you reference in index.html (<link href>, <script src>) is actually generated below, and every file you generate is referenced. No dangling references, no orphan files.
- All href/src to your own files use relative paths (e.g. "styles.css", "script.js") — never absolute paths or external URLs for local assets.
- The app runs with ZERO uncaught console errors and every interactive element works.
- The requested feature is fully implemented end-to-end, with realistic seed data visible on first load.

OUTPUT FORMAT:
Start with 1-2 warm, conversational sentences (NO code, NO file names) spoken directly to the user, explaining what you're about to build. For a change to an existing app, say specifically what you will change and why. THEN output each file as its own block, html first:
FILE: index.html
LANGUAGE: html
\`\`\`
...full file...
\`\`\`
FILE: styles.css
LANGUAGE: css
\`\`\`
...full file...
\`\`\`
FILE: script.js
LANGUAGE: javascript
\`\`\`
...full file...
\`\`\`

Output nothing after the final code block — your opening sentences to the user are the only prose you write.${fileContext}`;
}

function buildFileContext(files: { path: string; content: string }[]): string {
  if (files.length === 0) return "";
  return `\n\nCurrent project files (modify these as needed):\n${files
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n")}`;
}

// Pulls the accumulated lessons learned from past user feedback so every new
// generation benefits from corrections made on earlier apps.
async function buildLearningsContext(): Promise<string> {
  try {
    const rows = await db
      .select({ content: learnings.content })
      .from(learnings)
      .orderBy(desc(learnings.createdAt))
      .limit(40);
    if (rows.length === 0) return "";
    const list = rows
      .reverse()
      .map((r) => `- ${r.content}`)
      .join("\n");
    return `\n\nLESSONS LEARNED FROM PAST USER FEEDBACK (apply these proactively to every app you build so you don't repeat past mistakes):\n${list}`;
  } catch {
    return "";
  }
}

// After a user adjusts a generated app, distill a single generalizable, reusable
// lesson from their request and store it so future generations improve.
async function recordLearning(
  projectId: number,
  userAdjustment: string,
): Promise<void> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "You analyze a user's correction/adjustment request for an AI-generated web app and extract ONE short, GENERALIZABLE design or engineering rule that would help build better apps in the future. " +
            "Write it as a single imperative sentence (max 25 words) that applies to apps in general, NOT to this specific app's content. " +
            "Ignore one-off, app-specific content changes (e.g. 'rename this button to X', 'change this text'). " +
            "If there is no generalizable lesson, reply with exactly NONE.",
        },
        { role: "user", content: userAdjustment },
      ],
    });
    const lesson = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!lesson || lesson.toUpperCase() === "NONE" || lesson.length < 8 || lesson.length > 300) {
      return;
    }

    // Safety gate: reject distilled "lessons" that look like prompt-injection /
    // meta-instructions, since they get injected into every future system prompt.
    const lower = lesson.toLowerCase();
    const injectionMarkers = [
      "ignore previous",
      "ignore the previous",
      "ignore all",
      "disregard",
      "system prompt",
      "you are now",
      "forget everything",
      "override",
      "jailbreak",
    ];
    if (injectionMarkers.some((m) => lower.includes(m))) {
      logger.warn({ projectId }, "Rejected potential prompt-injection learning");
      return;
    }

    // Dedupe: skip if we already stored an identical lesson.
    const existing = await db
      .select({ id: learnings.id })
      .from(learnings)
      .where(eq(learnings.content, lesson))
      .limit(1);
    if (existing.length > 0) return;

    await db.insert(learnings).values({ content: lesson, sourceProjectId: projectId });
    logger.info({ projectId }, "Recorded new learning from user adjustment");
  } catch (err) {
    // Learning is best-effort; never let it affect the user's generation.
    logger.error({ err, projectId }, "Failed to record learning");
  }
}

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

const MAX_GENERATION_TOKENS = 32768;
const MAX_CONTINUATIONS = 2;
const CONTINUE_PROMPT =
  "Your previous message was cut off. Continue from exactly where you stopped, without repeating anything you already wrote. Resume mid-line if needed.";

// Retry a transient OpenAI failure a couple of times with backoff so a single
// network blip doesn't turn into a failed generation for the user.
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        logger.warn({ err, attempt, label }, "OpenAI call failed; retrying");
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// Derive a concise, human project title from the user's first prompt. Runs
// fire-and-forget after the first build so it never blocks or breaks generation.
async function generateProjectName(projectId: number, prompt: string): Promise<void> {
  try {
    const completion = await withRetry(
      () =>
        openai.chat.completions.create({
          model: "gpt-5.4",
          max_completion_tokens: 30,
          messages: [
            {
              role: "system",
              content:
                "Create a short, catchy product name (2-4 words, Title Case) for the app the user describes. Reply with ONLY the name — no quotes, punctuation, or explanation.",
            },
            { role: "user", content: prompt },
          ],
        }),
      "project-name",
    );
    const name = (completion.choices[0]?.message?.content ?? "")
      .replace(/["'`*]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (name && name.length >= 2 && name.length <= 60) {
      await db.update(projects).set({ name }).where(eq(projects.id, projectId));
      logger.info({ projectId, name }, "Auto-named project");
    }
  } catch (err) {
    logger.error({ err, projectId }, "Failed to auto-name project");
  }
}

// Generate a full response, transparently continuing when the model truncates
// (finish_reason === "length") so large multi-file apps don't get saved half-written.
async function generateWithContinuation(messages: ChatMsg[]): Promise<string> {
  let full = "";
  const msgs = [...messages];
  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    const completion = await withRetry(
      () =>
        openai.chat.completions.create({
          model: "gpt-5.4",
          max_completion_tokens: MAX_GENERATION_TOKENS,
          messages: msgs,
        }),
      "sync-completion",
    );
    const choice = completion.choices[0];
    const part = choice?.message?.content ?? "";
    full += part;
    if (choice?.finish_reason !== "length") break;
    if (round === MAX_CONTINUATIONS) {
      logger.warn(
        "Generation still truncated after continuation budget; last file may be incomplete",
      );
      break;
    }
    msgs.push({ role: "assistant", content: part });
    msgs.push({ role: "user", content: CONTINUE_PROMPT });
  }
  return full;
}

function extractNarration(raw: string): string {
  // The model now speaks first, before the first FILE block. Keep that opening
  // prose as the assistant's chat message and drop everything from FILE: onward.
  // Match FILE: only at the start of a line, so prose like "update FILE: x" in
  // the narration itself doesn't prematurely truncate it.
  const marker = raw.match(/^FILE:/m);
  const idx = marker?.index ?? -1;
  const head = (idx >= 0 ? raw.slice(0, idx) : raw)
    .replace(/```[\s\S]*$/, "")
    .replace(/LANGUAGE:\s*[^\n]+/g, "")
    .trim();
  return head || "Done! Your app has been updated.";
}

async function persistGeneratedFiles(
  projectId: number,
  raw: string,
  existingFiles: { id: number; path: string }[],
): Promise<string[]> {
  const written: string[] = [];
  let match;
  FILE_BLOCK_REGEX.lastIndex = 0;
  while ((match = FILE_BLOCK_REGEX.exec(raw)) !== null) {
    const [, filePath, langLine, fenceLang, fileContent] = match;
    const trimmedPath = filePath.trim();
    if (!trimmedPath) continue;
    const language = (langLine || fenceLang || "").trim() || inferLanguage(trimmedPath);
    written.push(trimmedPath);
    const existing = existingFiles.find((f) => f.path === trimmedPath);
    if (existing) {
      await db
        .update(projectFiles)
        .set({ content: fileContent, language, updatedAt: new Date() })
        .where(eq(projectFiles.id, existing.id));
    } else {
      await db.insert(projectFiles).values({
        projectId,
        path: trimmedPath,
        content: fileContent,
        language,
      });
    }
  }
  return written;
}

router.get("/projects", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        messageCount: sql<number>`(select count(*) from project_messages where project_id = ${projects.id})::int`,
        fileCount: sql<number>`(select count(*) from project_files where project_id = ${projects.id})::int`,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/recent", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        messageCount: sql<number>`(select count(*) from project_messages where project_id = ${projects.id})::int`,
        fileCount: sql<number>`(select count(*) from project_files where project_id = ${projects.id})::int`,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt))
      .limit(6);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to get recent projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects", async (req, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const [project] = await db
      .insert(projects)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? "",
      })
      .returning();
    res.status(201).json({
      ...project,
      messageCount: 0,
      fileCount: 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:projectId", async (req, res) => {
  const parsed = GetProjectParams.safeParse({ projectId: Number(req.params.projectId) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        messageCount: sql<number>`(select count(*) from project_messages where project_id = ${projects.id})::int`,
        fileCount: sql<number>`(select count(*) from project_files where project_id = ${projects.id})::int`,
      })
      .from(projects)
      .where(eq(projects.id, parsed.data.projectId));
    if (rows.length === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/projects/:projectId", async (req, res) => {
  const parsed = DeleteProjectParams.safeParse({ projectId: Number(req.params.projectId) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    await db.delete(projects).where(eq(projects.id, parsed.data.projectId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:projectId/messages", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const msgs = await db
      .select()
      .from(projectMessages)
      .where(eq(projectMessages.projectId, projectId))
      .orderBy(projectMessages.createdAt);
    res.json(msgs);
  } catch (err) {
    req.log.error({ err }, "Failed to list messages");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects/:projectId/messages", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const content = req.body?.content;
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  try {
    const projectRows = await db.select().from(projects).where(eq(projects.id, projectId));
    if (projectRows.length === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    await db.insert(projectMessages).values({ projectId, role: "user", content });

    const history = await db
      .select()
      .from(projectMessages)
      .where(eq(projectMessages.projectId, projectId))
      .orderBy(projectMessages.createdAt);

    const chatMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const existingFiles = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    const isAdjustment = existingFiles.length > 0;
    const learningsContext = await buildLearningsContext();
    const systemPrompt = buildSystemPrompt(
      projectRows[0].name,
      buildFileContext(existingFiles),
      learningsContext,
    );

    const aiContent =
      (await generateWithContinuation([
        { role: "system", content: systemPrompt },
        ...chatMessages,
      ])) || "I'm sorry, I couldn't generate a response.";

    const written = await persistGeneratedFiles(projectId, aiContent, existingFiles);
    if (written.length === 0 && existingFiles.length === 0) {
      res.status(422).json({
        error: "I couldn't generate valid files. Please try rephrasing your request.",
      });
      return;
    }
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    const [assistantMsg] = await db
      .insert(projectMessages)
      .values({ projectId, role: "assistant", content: extractNarration(aiContent) })
      .returning();

    if (isAdjustment) {
      // Learn from this adjustment (follow-up on an existing app) without blocking the response.
      void recordLearning(projectId, content);
    } else {
      // Give the project a real name derived from the first prompt.
      void generateProjectName(projectId, content);
    }

    res.status(201).json(assistantMsg);
  } catch (err) {
    req.log.error({ err }, "Failed to send message");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects/:projectId/messages/stream", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const content = req.body?.content;
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let clientGone = false;
  const send = (event: Record<string, unknown>) => {
    if (clientGone || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Detect a real client disconnect (e.g. the user pressed "Stop"). We listen on
  // the RESPONSE, not the request: req "close" fires as soon as the POST body is
  // read, which would falsely look like an abort before we've sent anything.
  res.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });

  // Keep the proxied SSE connection from idling out while the model "thinks":
  // on complex apps there can be a 30s+ gap before the first token, which the
  // edge proxy would otherwise treat as a dead connection and drop. A comment
  // line resets idle timers and is ignored by the client's `data:` parser.
  const heartbeat = setInterval(() => {
    if (clientGone || res.writableEnded || res.destroyed) return;
    try {
      res.write(": ping\n\n");
    } catch {
      /* socket already torn down */
    }
  }, 10000);

  try {
    const projectRows = await db.select().from(projects).where(eq(projects.id, projectId));
    if (projectRows.length === 0) {
      send({ type: "error", message: "Project not found" });
      res.end();
      return;
    }

    await db.insert(projectMessages).values({ projectId, role: "user", content });

    const history = await db
      .select()
      .from(projectMessages)
      .where(eq(projectMessages.projectId, projectId))
      .orderBy(projectMessages.createdAt);

    const chatMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const existingFiles = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    const isFirstBuild = existingFiles.length === 0;
    const learningsContext = await buildLearningsContext();
    const systemPrompt = buildSystemPrompt(
      projectRows[0].name,
      buildFileContext(existingFiles),
      learningsContext,
    );

    send({
      type: "status",
      message: isFirstBuild ? "Planning your app" : "Reviewing your request",
    });

    let full = "";
    const seenFiles = new Set<string>();
    const streamMsgs: ChatMsg[] = [
      { role: "system", content: systemPrompt },
      ...chatMessages,
    ];

    outer: for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
      // Don't kick off (or pay for) another round if the user already bailed.
      if (clientGone) break;

      const stream = await withRetry(
        () =>
          openai.chat.completions.create({
            model: "gpt-5.4",
            max_completion_tokens: MAX_GENERATION_TOKENS,
            stream: true,
            messages: streamMsgs,
          }),
        "stream-completion",
      );

      // Tear down the upstream OpenAI request the moment the client hangs up.
      const onClose = () => {
        if (res.writableEnded) return;
        clientGone = true;
        try {
          stream.controller.abort();
        } catch {
          /* already settled */
        }
      };
      res.on("close", onClose);

      // The client may have disconnected while the request was in flight.
      if (clientGone) {
        onClose();
        res.off("close", onClose);
        break;
      }

      let part = "";
      let finishReason: string | null = null;
      try {
        for await (const chunk of stream) {
          if (clientGone) break;
          finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (!delta) continue;
          part += delta;
          full += delta;
          // Stream raw tokens so the UI can show the code being written live.
          send({ type: "delta", text: delta });
          const re = /FILE:\s*([^\n]+)\n/g;
          let m;
          while ((m = re.exec(full)) !== null) {
            const path = m[1].trim();
            if (!seenFiles.has(path)) {
              seenFiles.add(path);
              send({ type: "file", path });
            }
          }
        }
      } catch (streamErr) {
        if (!clientGone) throw streamErr;
      } finally {
        res.off("close", onClose);
      }

      if (clientGone) break outer;
      // Stop unless the model ran out of room mid-output.
      if (finishReason !== "length") break;
      if (round === MAX_CONTINUATIONS) {
        logger.warn(
          { projectId },
          "Streamed generation still truncated after continuation budget; last file may be incomplete",
        );
        break;
      }
      send({ type: "status", message: "Finishing a large app" });
      streamMsgs.push({ role: "assistant", content: part });
      streamMsgs.push({ role: "user", content: CONTINUE_PROMPT });
    }

    if (clientGone) {
      // User pressed Stop — keep any fully-formed files already generated so the
      // work isn't lost, but skip the SSE replies (the connection is gone).
      await persistGeneratedFiles(projectId, full, existingFiles);
      await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      return;
    }

    send({ type: "status", message: "Saving files" });

    const written = await persistGeneratedFiles(projectId, full, existingFiles);

    if (written.length === 0 && existingFiles.length === 0) {
      send({
        type: "error",
        message: "I couldn't generate valid files. Please try rephrasing your request.",
      });
      res.end();
      return;
    }

    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    const explanation = extractNarration(full);
    const [assistantMsg] = await db
      .insert(projectMessages)
      .values({ projectId, role: "assistant", content: explanation })
      .returning();

    send({ type: "message", id: assistantMsg.id, content: explanation });
    send({ type: "done", files: written });
    res.end();

    if (isFirstBuild) {
      // Give the project a real name derived from the first prompt.
      void generateProjectName(projectId, content);
    } else {
      // Learn from this adjustment (follow-up on an existing app) so future apps improve.
      void recordLearning(projectId, content);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to stream message");
    send({ type: "error", message: "Something went wrong while building your app." });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

router.get("/projects/:projectId/files", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const files = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId))
      .orderBy(projectFiles.path);
    res.json(files);
  } catch (err) {
    req.log.error({ err }, "Failed to list files");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:projectId/files/:filePath", async (req, res) => {
  const projectId = Number(req.params.projectId);
  const filePath = req.params.filePath;
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    const file = rows.find((f) => f.path === filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.json(file);
  } catch (err) {
    req.log.error({ err }, "Failed to get file");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/projects/:projectId/files/:filePath", async (req, res) => {
  const projectId = Number(req.params.projectId);
  const filePath = req.params.filePath;
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  const { content, language } = req.body ?? {};
  if (content === undefined || typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    const existing = rows.find((f) => f.path === filePath);
    let file;
    if (existing) {
      const [updated] = await db
        .update(projectFiles)
        .set({
          content,
          language: language ?? existing.language,
          updatedAt: new Date(),
        })
        .where(eq(projectFiles.id, existing.id))
        .returning();
      file = updated;
    } else {
      const [created] = await db
        .insert(projectFiles)
        .values({
          projectId,
          path: filePath,
          content,
          language: language ?? "plaintext",
        })
        .returning();
      file = created;
    }
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
    res.json(file);
  } catch (err) {
    req.log.error({ err }, "Failed to update file");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
