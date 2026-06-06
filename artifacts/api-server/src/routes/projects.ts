import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, projects, projectMessages, projectFiles } from "@workspace/db";
import {
  CreateProjectBody,
  GetProjectParams,
  DeleteProjectParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

const FILE_BLOCK_REGEX = /FILE:\s*(.+?)\nLANGUAGE:\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g;

function buildSystemPrompt(projectName: string, fileContext: string): string {
  return `You are Buildly, an expert AI web app builder. Generate beautiful, fully-functional web apps for a project called "${projectName}", with clean, well-structured, modular code.

CRITICAL RULES:
- Split the app into MULTIPLE well-organized files — never one giant file:
  - index.html — markup only; link sibling files with relative paths
  - styles.css — all custom styling
  - script.js — all JavaScript logic (for complex apps, split into several JS files like app.js, ui.js, storage.js, each referenced from index.html)
- index.html must reference siblings exactly like: <link rel="stylesheet" href="styles.css"> and <script src="script.js"></script> (and <script src="app.js"></script> etc.)
- You may use Tailwind via CDN in index.html for utility classes, but real custom styles belong in styles.css
- Use CDN links for libraries (Chart.js, etc). NO npm, NO build step
- Make it BEAUTIFUL and FULLY FUNCTIONAL — every button/form/interaction works. Dark theme with vibrant accents unless told otherwise

OUTPUT FORMAT — output each file as its own block, html first:
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

After ALL file blocks, write ONE short sentence (max 20 words) describing what you did. NEVER repeat code in that sentence.${fileContext}`;
}

function buildFileContext(files: { path: string; content: string }[]): string {
  if (files.length === 0) return "";
  return `\n\nCurrent project files (modify these as needed):\n${files
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n")}`;
}

function extractExplanation(raw: string): string {
  const lastFence = raw.lastIndexOf("```");
  let tail = lastFence >= 0 ? raw.slice(lastFence + 3) : raw;
  tail = tail
    .replace(/^[a-zA-Z]*\n/, "")
    .replace(/FILE:\s*[^\n]+/g, "")
    .replace(/LANGUAGE:\s*[^\n]+/g, "")
    .trim();
  return tail || "Done! Your app has been updated.";
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
    const [, filePath, language, fileContent] = match;
    const trimmedPath = filePath.trim();
    written.push(trimmedPath);
    const existing = existingFiles.find((f) => f.path === trimmedPath);
    if (existing) {
      await db
        .update(projectFiles)
        .set({ content: fileContent, language: language.trim(), updatedAt: new Date() })
        .where(eq(projectFiles.id, existing.id));
    } else {
      await db.insert(projectFiles).values({
        projectId,
        path: trimmedPath,
        content: fileContent,
        language: language.trim(),
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

    const systemPrompt = buildSystemPrompt(projectRows[0].name, buildFileContext(existingFiles));

    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 16384,
      messages: [
        { role: "system", content: systemPrompt },
        ...chatMessages,
      ],
    });

    const aiContent = completion.choices[0]?.message?.content ?? "I'm sorry, I couldn't generate a response.";

    await persistGeneratedFiles(projectId, aiContent, existingFiles);
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    const [assistantMsg] = await db
      .insert(projectMessages)
      .values({ projectId, role: "assistant", content: extractExplanation(aiContent) })
      .returning();

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

  const send = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

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
    const systemPrompt = buildSystemPrompt(projectRows[0].name, buildFileContext(existingFiles));

    send({
      type: "status",
      message: isFirstBuild ? "Planning your app" : "Reviewing your request",
    });

    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 16384,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
    });

    let full = "";
    const seenFiles = new Set<string>();
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (!delta) continue;
      full += delta;
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

    const explanation = extractExplanation(full);
    const [assistantMsg] = await db
      .insert(projectMessages)
      .values({ projectId, role: "assistant", content: explanation })
      .returning();

    send({ type: "message", id: assistantMsg.id, content: explanation });
    send({ type: "done", files: written });
    res.end();
  } catch (err) {
    req.log.error({ err }, "Failed to stream message");
    send({ type: "error", message: "Something went wrong while building your app." });
    res.end();
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
