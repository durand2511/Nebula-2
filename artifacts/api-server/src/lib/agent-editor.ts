/**
 * Agent-SDK website editor.
 *
 * The AI editor used to run a bespoke tool loop; this replaces it with the official
 * @anthropic-ai/claude-agent-sdk (the same engine as Claude Code). Since our project
 * files live in the `projectFiles` Postgres table — not on disk — we bridge:
 *
 *   1. materialise every project file into an isolated temp directory,
 *   2. run the agent (Read/Write/Edit/Glob/Grep) against that directory,
 *   3. stream each of its actions to the build session so the UI shows live progress,
 *   4. diff the directory back into the DB (writes, creates AND deletes),
 *   5. clean up the temp directory.
 *
 * The diff-back step is what makes edits actually stick — whatever the agent left on
 * disk becomes the new source of truth for the project.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { db, projectFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordUsage } from "./ai-usage.js";
import { logger } from "./logger";

// Model the editor's Agent SDK subprocess runs on. NOTE: the earlier "exit code 1" crash
// was NOT a model-access problem — it was the root/permissions guard (see permissionMode
// below); the CLI died before ever calling the API, so Opus access was never actually
// tested. Sonnet 4.5 is what we've now verified working end-to-end; switch to
// "claude-opus-4-8" if you want the top model for edit quality (will surface a clear error
// if the key isn't entitled).
const AGENT_MODEL = "claude-sonnet-4-5";
const MAX_TURNS = 80;
// Reference images the user attached are dropped here so the agent can Read them;
// this folder is synthetic and never written back to the DB.
const REFS_DIR = "_refs";

export type AgentEvent = Record<string, unknown>;

export type AgentEditResult = {
  ok: boolean;
  changed: string[];
  created: string[];
  deleted: string[];
  finalText: string;
};

type FileRow = { id: number; path: string; content: string };

function inferLanguage(p: string): string {
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "html": case "htm": return "html";
    case "css": return "css";
    case "js": case "mjs": case "cjs": return "javascript";
    case "ts": return "typescript";
    case "json": return "json";
    case "svg": return "svg";
    case "md": return "markdown";
    default: return "plaintext";
  }
}

// Guard against a stored path escaping the sandbox dir (`..`, absolute paths, symlinks).
function safeJoin(root: string, rel: string): string | null {
  const full = path.resolve(root, rel);
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  return full === root || full.startsWith(withSep) ? full : null;
}

// Recursively list files relative to `root`, skipping the synthetic refs dir.
async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(root, abs);
    if (rel === REFS_DIR || rel.startsWith(REFS_DIR + path.sep)) continue;
    if (e.isDirectory()) {
      out.push(...(await walk(root, abs)));
    } else if (e.isFile()) {
      out.push(rel.split(path.sep).join("/"));
    }
  }
  return out;
}

function systemPrompt(): string {
  return [
    "You are Nebula's website editor. You edit a small STATIC website that lives entirely in the current working directory: HTML pages plus CSS and JS files. There is no build step, no framework, no server code — just files served as-is.",
    "",
    "HOW YOU WORK:",
    "- Do exactly what the user asks — no more, no less. Don't refactor, restructure, or 'improve' unrelated code.",
    "- ALWAYS Read a file before you Edit it, so your old_string matches exactly.",
    "- Prefer Edit for targeted changes; use Write to create a new file or fully replace a small one.",
    "- Touch the file that OWNS the thing being changed: styling → the CSS file, behaviour → the JS file, copy → that page's HTML. Don't funnel everything into index.html.",
    "- When you say you changed something, you MUST actually have written it with Edit/Write in this session. Never claim a change you didn't make.",
    "- Keep all existing layout, sections, navigation and content intact unless the change requires otherwise.",
    "",
    "IMPORTED SITES: some files are large minified HTML from an imported site — do NOT rewrite those. For a site-wide visual restyle, write/extend `.nebula-restyle.css` (it is auto-injected on every page, after the site's own CSS); target the site's real selectors and keep its brand colours.",
    "",
    "DESIGN (only when creating new visual work, and only if the user hasn't given their own): calm, premium, editorial. Warm off-white page (#f7f4ee), crisp white cards, dark ink text (#241f1a), generous whitespace, subtle 4px radii, no heavy shadows, no purple gradients or generic AI look. Never go dark unless asked.",
    "",
    "Finish by giving a short, plain-language summary of what you changed.",
  ].join("\n");
}

/**
 * Run one agent edit against a project. Streams progress through `emit`; returns the
 * set of files it changed. Throws only on setup failure — an agent-level failure is
 * reported via the returned `ok: false`.
 */
export async function runAgentEdit(opts: {
  projectId: number;
  prompt: string;
  images?: string[];
  emit: (event: AgentEvent) => void;
  abortController?: AbortController;
  /** Run on the customer's coupled Claude subscription instead of the platform API key. When set, this
   *  env (HOME/CLAUDE_CONFIG_DIR pointing at their restored login, NO ANTHROPIC_API_KEY) is used as-is
   *  and no throwaway agent-home is created. See prepareUserClaudeEnv in claude-terminal.ts. */
  subprocessEnv?: Record<string, string | undefined>;
  /** Override the model (voice on a subscription omits it → account default). null = don't set a model. */
  model?: string | null;
  /** Override the system prompt (the voice assistant is conversational, not just an editor). */
  systemPromptOverride?: string;
  /** Extra in-process MCP tool servers (e.g. the voice assistant's statistics/SEO/backup/publish tools). */
  mcpServers?: Record<string, unknown>;
  /** Extra tool names to allow (the mcp__server__tool names for the servers above). */
  extraAllowedTools?: string[];
}): Promise<AgentEditResult> {
  const { projectId, prompt, images = [], emit } = opts;
  const abortController = opts.abortController ?? new AbortController();
  const ownCredsEnv = opts.subprocessEnv; // when present, use the customer's subscription

  const rows: FileRow[] = await db
    .select({ id: projectFiles.id, path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId));

  // realpath so the agent's absolute tool paths share our prefix (macOS /var → /private/var),
  // which keeps the "Bezig met <file>" display clean and the write-back diff aligned.
  const tmpRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `nebula-agent-${projectId}-`)));
  const original = new Map<string, FileRow>(); // path → row (pre-edit snapshot)

  // The CLI subprocess needs a WRITABLE HOME/config dir: on boot it writes ~/.claude.json,
  // ~/.claude/ and XDG state. In the Render container HOME isn't writable, so the CLI exited
  // with code 1 ("Claude Code process exited with code 1"). Give it a private writable home,
  // kept OUTSIDE tmpRoot so its config files never get diffed back into projectFiles.
  // Own-subscription runs (voice) bring their own env with the customer's login. API-key runs (the
  // editor) get a throwaway writable home so the CLI can write ~/.claude.json / XDG state.
  const agentHome = ownCredsEnv ? "" : await fs.mkdtemp(path.join(os.tmpdir(), `nebula-agent-home-${projectId}-`));
  const subprocessEnv: Record<string, string | undefined> = ownCredsEnv ?? {
    ...process.env,
    HOME: agentHome,
    CLAUDE_CONFIG_DIR: path.join(agentHome, ".claude"),
    XDG_CONFIG_HOME: path.join(agentHome, ".config"),
    XDG_CACHE_HOME: path.join(agentHome, ".cache"),
    XDG_DATA_HOME: path.join(agentHome, ".local", "share"),
    XDG_STATE_HOME: path.join(agentHome, ".local", "state"),
  };

  try {
    // Pre-create the writable dirs so the CLI never trips on a missing nested path (API-key runs only —
    // the own-creds env's dirs were already created by prepareUserClaudeEnv).
    if (!ownCredsEnv) {
      await Promise.all(
        [subprocessEnv.CLAUDE_CONFIG_DIR, subprocessEnv.XDG_CONFIG_HOME, subprocessEnv.XDG_CACHE_HOME, subprocessEnv.XDG_DATA_HOME, subprocessEnv.XDG_STATE_HOME]
          .map((p) => fs.mkdir(p as string, { recursive: true })),
      );
    }
    emit({ type: "status", message: "Project laden…" });
    for (const row of rows) {
      const dest = safeJoin(tmpRoot, row.path);
      if (!dest) { logger.warn({ projectId, path: row.path }, "[agent] skipping unsafe path"); continue; }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, row.content ?? "", "utf8");
      original.set(row.path, row);
    }

    // Materialise reference images so the agent can Read them.
    const refNotes: string[] = [];
    if (images.length > 0) {
      const refDir = path.join(tmpRoot, REFS_DIR);
      await fs.mkdir(refDir, { recursive: true });
      for (let i = 0; i < images.length; i++) {
        const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(images[i]);
        if (!m) continue;
        const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase().replace(/[^a-z0-9]/g, "");
        const name = `${REFS_DIR}/ref${i + 1}.${ext || "png"}`;
        await fs.writeFile(path.join(tmpRoot, name), Buffer.from(m[2], "base64"));
        refNotes.push(name);
      }
    }

    const userPrompt = refNotes.length
      ? `${prompt}\n\nReference image(s) attached — Read them before you start: ${refNotes.join(", ")}.`
      : prompt;

    emit({ type: "status", message: "Aan het werk…" });

    let finalText = "";
    let ok = true;

    // Capture the CLI subprocess's stderr. When the process exits non-zero the SDK only
    // throws "Claude Code process exited with code N" — the actual reason (model access,
    // unwritable HOME/config, missing env, …) is on stderr, so we buffer it and surface
    // it in the logs if the run throws.
    let stderrBuf = "";

    // model: undefined → default (AGENT_MODEL); null → don't set one (subscription's account default).
    const modelOpt = opts.model === undefined ? AGENT_MODEL : opts.model;
    const q = query({
      prompt: userPrompt,
      options: {
        cwd: tmpRoot,
        ...(modelOpt ? { model: modelOpt } : {}),
        ...(opts.mcpServers ? { mcpServers: opts.mcpServers as never } : {}),
        systemPrompt: opts.systemPromptOverride ?? systemPrompt(),
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", ...(opts.extraAllowedTools ?? [])],
        // Use acceptEdits, NOT bypassPermissions: the Render container runs as root, and the
        // CLI refuses "--dangerously-skip-permissions cannot be used with root/sudo privileges"
        // (that flag is what bypassPermissions + allowDangerouslySkipPermissions emit), so it
        // exited 1 before doing anything. Our allowedTools are already an explicit allowlist
        // (Read/Write/Edit/Glob/Grep) and acceptEdits auto-approves the file edits — no prompts,
        // no root guard. Verified locally end-to-end (edit actually written).
        permissionMode: "acceptEdits",
        settingSources: [], // clean sandbox — ignore any host ~/.claude or project settings
        maxTurns: MAX_TURNS,
        abortController,
        env: subprocessEnv, // replaces the child env entirely — process.env is spread in above
        stderr: (data: string) => { stderrBuf += data; },
      },
    });

    try {
      for await (const msg of q) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text.trim()) {
              emit({ type: "status", message: firstLine(block.text) });
            } else if (block.type === "tool_use") {
              emit(describeTool(block.name, block.input as Record<string, unknown>, tmpRoot));
            }
          }
        } else if (msg.type === "result") {
          finalText = msg.subtype === "success" ? msg.result : "";
          ok = msg.subtype === "success" && !msg.is_error;
          // Charge the tokens the agent actually spent (per model) to the usage context.
          for (const [model, u] of Object.entries(msg.modelUsage ?? {})) {
            recordUsage(model, { input_tokens: u.inputTokens, output_tokens: u.outputTokens });
          }
          if (!ok) logger.warn({ projectId, subtype: msg.subtype }, "[agent] run ended without success");
        }
      }
    } catch (err) {
      // The SDK's "process exited with code N" hides the cause — log the subprocess stderr.
      logger.error({ projectId, model: AGENT_MODEL, stderr: stderrBuf.slice(-4000) }, "[agent] CLI subprocess failed");
      throw err;
    }

    // ── Diff the sandbox back into the DB ────────────────────────────────────
    emit({ type: "status", message: "Wijzigingen opslaan…" });
    const onDisk = new Set(await walk(tmpRoot));
    const changed: string[] = [], created: string[] = [], deleted: string[] = [];

    for (const rel of onDisk) {
      const abs = safeJoin(tmpRoot, rel);
      if (!abs) continue;
      const content = await fs.readFile(abs, "utf8").catch(() => null);
      if (content == null) continue;
      const prev = original.get(rel);
      const language = inferLanguage(rel);
      if (!prev) {
        await db.insert(projectFiles).values({ projectId, path: rel, content, language });
        created.push(rel);
        emit({ type: "agent", event: "file_saved", path: rel, op: "create", linesAdded: content.split("\n").length, linesRemoved: 0, symbols: [], summary: "" });
      } else if (content !== prev.content) {
        await db.update(projectFiles).set({ content, language, updatedAt: new Date() }).where(eq(projectFiles.id, prev.id));
        changed.push(rel);
        const { added, removed } = lineDelta(prev.content, content);
        emit({ type: "agent", event: "file_saved", path: rel, op: "update", linesAdded: added, linesRemoved: removed, symbols: [], summary: "" });
      }
    }

    for (const [rel, row] of original) {
      if (!onDisk.has(rel)) {
        await db.delete(projectFiles).where(eq(projectFiles.id, row.id));
        deleted.push(rel);
        emit({ type: "status", message: `${rel} verwijderd` });
      }
    }

    logger.info({ projectId, changed: changed.length, created: created.length, deleted: deleted.length, ok }, "[agent] edit complete");
    return { ok, changed, created, deleted, finalText };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    if (agentHome) await fs.rm(agentHome, { recursive: true, force: true }).catch(() => {});
  }
}

function firstLine(text: string): string {
  const line = text.trim().split("\n").find((l) => l.trim()) ?? "";
  return line.length > 160 ? line.slice(0, 157) + "…" : line;
}

// A rough add/remove line count for the "+X −Y regels" badge (line-set difference).
function lineDelta(before: string, after: string): { added: number; removed: number } {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  return {
    added: newLines.filter((l) => !oldSet.has(l)).length,
    removed: oldLines.filter((l) => !newSet.has(l)).length,
  };
}

// Map a tool_use to the client's existing AgentEvt activity vocabulary so the UI
// renders it with the same styled timeline (and drives the "Bezig met <file>" line).
function describeTool(name: string, input: Record<string, unknown>, root: string): AgentEvent {
  const rel = (p: unknown): string => {
    if (typeof p !== "string") return "";
    const r = path.isAbsolute(p) ? path.relative(root, p) : p;
    return r.split(path.sep).join("/");
  };
  switch (name) {
    case "Read": return { type: "agent", event: "file_read", path: rel(input.file_path), size: 0 };
    case "Write":
    case "Edit": return { type: "agent", event: "patch_applied", path: rel(input.file_path) };
    case "Glob": return { type: "status", message: `Bestanden zoeken: ${String(input.pattern ?? "")}` };
    case "Grep": return { type: "status", message: `Zoeken in code: ${String(input.pattern ?? "")}` };
    default: return { type: "status", message: name };
  }
}
