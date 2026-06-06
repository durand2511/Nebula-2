import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, projects, projectMessages, projectFiles } from "@workspace/db";
import {
  CreateProjectBody,
  GetProjectParams,
  DeleteProjectParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";

const router = Router();

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

    const fileContext =
      existingFiles.length > 0
        ? `\n\nCurrent project files:\n${existingFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")}`
        : "";

    const systemPrompt = `You are Buildly, an expert AI web app builder. Generate beautiful, fully-functional web applications.

CRITICAL RULES:
- Always output a SINGLE self-contained index.html file that works directly in a browser iframe
- Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- All CSS and JavaScript must be inline — no external files
- For charts/graphs use Chart.js CDN. For icons use Lucide CDN or Unicode/emoji
- NO npm, NO build steps, NO external file imports
- Make it BEAUTIFUL: modern design, proper spacing, smooth animations, polished UI
- Make it FUNCTIONAL: all buttons/forms/interactions must work with real JavaScript
- Use a dark theme with vibrant accent colors unless the user says otherwise

FORMAT YOUR RESPONSE — first the file block, then the explanation:
FILE: index.html
LANGUAGE: html
\`\`\`
<!DOCTYPE html>
... complete working app ...
\`\`\`

Then 1-2 sentences describing what you built or changed.${fileContext}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        ...chatMessages,
      ],
    });

    const aiContent = completion.choices[0]?.message?.content ?? "I'm sorry, I couldn't generate a response.";

    const fileRegex = /FILE:\s*(.+?)\nLANGUAGE:\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g;
    let match;
    while ((match = fileRegex.exec(aiContent)) !== null) {
      const [, filePath, language, fileContent] = match;
      const trimmedPath = filePath.trim();
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

    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

    const [assistantMsg] = await db
      .insert(projectMessages)
      .values({ projectId, role: "assistant", content: aiContent })
      .returning();

    res.status(201).json(assistantMsg);
  } catch (err) {
    req.log.error({ err }, "Failed to send message");
    res.status(500).json({ error: "Internal server error" });
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
