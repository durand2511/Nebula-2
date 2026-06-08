import { useState, useRef, useEffect, useCallback } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetProject,
  getGetProjectQueryKey,
  useListMessages,
  getListMessagesQueryKey,
  useListFiles,
  getListFilesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Send,
  Loader2,
  FileCode,
  ChevronLeft,
  Code2,
  MonitorPlay,
  FolderOpen,
  File as FileIcon,
  RefreshCw,
  Check,
  FileCode2,
  AlertTriangle,
  Wand2,
  X,
  Square,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

type ProjectFile = { id: number; path: string; content: string; language: string };
type BuildStep = { label: string; done: boolean };

/** Strip FILE: ... ``` ... ``` blocks from AI text (safety net — server already cleans). */
function cleanContent(raw: string): string {
  const cleaned = raw
    .replace(/FILE:\s*[^\n]+\nLANGUAGE:\s*[^\n]+\n```[^\n]*\n[\s\S]*?```/g, "")
    .trim();
  return cleaned || "Done! Your app has been updated.";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Combine separate files into one self-contained HTML doc so the iframe preview works. */
function buildPreviewHtml(files: ProjectFile[] | undefined): string {
  if (!files || files.length === 0) return "";
  const index =
    files.find((f) => f.path === "index.html") ??
    files.find((f) => f.path.endsWith("index.html")) ??
    files.find((f) => f.path.endsWith(".html"));
  if (!index) return "";
  let html = index.content;

  for (const f of files) {
    if (f.path.endsWith(".css")) {
      const name = escapeRegExp(f.path);
      const re = new RegExp(`<link[^>]*href=["']\\.?/?${name}["'][^>]*>`, "gi");
      html = html.replace(re, `<style>\n${f.content}\n</style>`);
    }
  }
  for (const f of files) {
    if (f.path.endsWith(".js")) {
      const name = escapeRegExp(f.path);
      const re = new RegExp(`<script[^>]*src=["']\\.?/?${name}["'][^>]*>\\s*</script>`, "gi");
      html = html.replace(re, `<script>\n${f.content}\n</script>`);
    }
  }

  // Neutralize any leftover references to LOCAL siblings we couldn't inline
  // (e.g. a file the AI referenced but didn't generate). In srcDoc there is no
  // base URL, so these would 404 and silently break the app. External URLs
  // (http(s)://, //, data:) are left untouched.
  const isExternal = (url: string) => /^(https?:)?\/\//i.test(url) || url.startsWith("data:");
  html = html.replace(
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
    (m, href: string) => (/rel=["']?stylesheet/i.test(m) && !isExternal(href) ? "" : m),
  );
  html = html.replace(
    /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (m, src: string) => (isExternal(src) ? m : ""),
  );

  // Inject a tiny reporter (first thing in the doc) that forwards runtime errors
  // to the parent window so Buildly can surface them and offer an auto-fix.
  const reporter = `<script>(function(){function r(p){try{parent.postMessage({__buildlyError:true,message:String(p.message||"Error"),source:p.source||"",line:p.line||0},"*")}catch(e){}}window.addEventListener("error",function(e){r({message:e.message,source:e.filename,line:e.lineno})});window.addEventListener("unhandledrejection",function(e){var m=e.reason&&e.reason.message?e.reason.message:e.reason;r({message:"Unhandled promise rejection: "+m})});})();</script>`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + reporter);
  } else {
    html = reporter + html;
  }
  return html;
}

function fileLabel(path: string): string {
  return `Writing ${path}`;
}

/**
 * From the raw streaming text, pull out the file currently being written and the
 * code produced so far, so the UI can show it live as it's typed.
 */
function extractLiveFile(raw: string): { path: string; code: string } | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf("\nFILE:");
  const start = idx === -1 ? (raw.startsWith("FILE:") ? 0 : -1) : idx + 1;
  if (start === -1) return null;
  const seg = raw.slice(start);
  const header = seg.match(/^FILE:\s*(.+?)\r?\n/);
  if (!header) return null;
  const path = header[1].trim();
  const fence = seg.match(/```[\w+-]*[^\n]*\r?\n/);
  if (!fence || fence.index === undefined) return { path, code: "" };
  const after = seg.slice(fence.index + fence[0].length);
  const close = after.indexOf("```");
  const code = close === -1 ? after : after.slice(0, close);
  return { path, code };
}

export function ProjectWorkspace() {
  const [, params] = useRoute("/projects/:id");
  const projectId = Number(params?.id);
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [previewKey, setPreviewKey] = useState(0);

  const [isStreaming, setIsStreaming] = useState(false);
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>([]);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [streamedText, setStreamedText] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const codeScrollRef = useRef<HTMLDivElement>(null);
  const messagesLenRef = useRef(0);
  const pendingBaseRef = useRef(0);
  // Raw tokens received so far, and how many we've revealed to the UI. A rAF loop
  // closes the gap at a steady pace so bursty model output still types out live.
  const rawStreamRef = useRef("");
  const shownLenRef = useRef(0);

  const { data: project, isLoading: isLoadingProject } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });

  const { data: messages, isLoading: isLoadingMessages } = useListMessages(projectId, {
    query: { enabled: !!projectId, queryKey: getListMessagesQueryKey(projectId) },
  });

  const { data: files, isLoading: isLoadingFiles } = useListFiles(projectId, {
    query: { enabled: !!projectId, queryKey: getListFilesQueryKey(projectId) },
  });

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, buildSteps, pendingUser]);

  // Track the known message count so the optimistic user bubble can be dropped
  // only once the persisted message actually lands (handles repeated prompts).
  useEffect(() => {
    messagesLenRef.current = messages?.length ?? 0;
  }, [messages]);

  // Smoothly reveal buffered tokens so the live code "types" out continuously,
  // even though the reasoning model emits text in bursts separated by pauses.
  // The pace accelerates with backlog so it never lags far behind real output.
  useEffect(() => {
    if (!isStreaming) return;
    let raf = 0;
    let lastT = performance.now();
    const tick = (now: number) => {
      const dt = now - lastT;
      lastT = now;
      const target = rawStreamRef.current.length;
      const shown = shownLenRef.current;
      if (shown < target) {
        const backlog = target - shown;
        const cps = Math.max(600, backlog * 2);
        const next = Math.min(target, shown + Math.ceil((cps * dt) / 1000));
        shownLenRef.current = next;
        setStreamedText(rawStreamRef.current.slice(0, next));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isStreaming]);

  useEffect(() => {
    if (files && files.length > 0 && !selectedFile) {
      setSelectedFile(files[0].path);
    }
  }, [files, selectedFile]);

  // Listen for runtime errors forwarded by the preview iframe.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Only trust messages coming from our own preview iframe.
      if (!previewIframeRef.current || e.source !== previewIframeRef.current.contentWindow) return;
      const d = e.data as { __buildlyError?: boolean; message?: string; source?: string; line?: number };
      if (!d || !d.__buildlyError || typeof d.message !== "string") return;
      const file = d.source ? d.source.split("/").pop() : "";
      const detail = file ? `${d.message} (${file}:${d.line ?? "?"})` : d.message;
      setPreviewErrors((prev) => (prev.includes(detail) ? prev : [...prev, detail].slice(-4)));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Reset captured errors whenever the preview reloads.
  useEffect(() => {
    setPreviewErrors([]);
  }, [previewKey]);

  // Abort any in-flight build if the user navigates away / the page unmounts,
  // so generation doesn't keep running (and billing) in the background.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const streamMessage = useCallback(
    async (messageContent: string) => {
      if (!projectId) return;
      setIsStreaming(true);
      setBuildSteps([]);
      setPendingUser(messageContent);
      pendingBaseRef.current = messagesLenRef.current;
      setPreviewErrors([]);
      rawStreamRef.current = "";
      shownLenRef.current = 0;
      setStreamedText("");
      setActiveTab("preview");

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch(`/api/projects/${projectId}/messages/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: messageContent }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const pushStep = (label: string) =>
          setBuildSteps((prev) => [
            ...prev.map((s) => ({ ...s, done: true })),
            { label, done: false },
          ]);

        const handleEvent = (line: string) => {
          if (!line.startsWith("data:")) return;
          let event: { type: string; message?: string; path?: string; text?: string };
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            return;
          }
          if (event.type === "delta" && typeof event.text === "string") {
            // Buffer raw tokens; the reveal loop below types them out smoothly so
            // the model's bursty output still appears as continuous live code.
            rawStreamRef.current += event.text;
          } else if (event.type === "status" && event.message) {
            pushStep(event.message);
          } else if (event.type === "file" && event.path) {
            pushStep(fileLabel(event.path));
            // refresh file list as files arrive so the tree fills in live
            queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
          } else if (event.type === "done") {
            setBuildSteps((prev) => prev.map((s) => ({ ...s, done: true })));
          } else if (event.type === "error") {
            pushStep(event.message ?? "Something went wrong");
          }
        };

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) handleEvent(part.trim());
        }
        // Flush any trailing event left in the buffer when the stream ends.
        if (buffer.trim()) handleEvent(buffer.trim());
      } catch (err) {
        const stopped = err instanceof DOMException && err.name === "AbortError";
        setBuildSteps((prev) => [
          ...prev.map((s) => ({ ...s, done: true })),
          { label: stopped ? "Stopped by you" : "Something went wrong while building", done: true },
        ]);
      } finally {
        abortRef.current = null;
        // Reveal any remaining buffered tail so the final lines aren't cut off
        // in the brief moment before the view switches to the saved files.
        shownLenRef.current = rawStreamRef.current.length;
        setStreamedText(rawStreamRef.current);
        setIsStreaming(false);
        setBuildSteps((prev) => prev.map((s) => ({ ...s, done: true })));
        setPendingUser(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(projectId) }),
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) }),
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) }),
        ]);
        setPreviewKey((k) => k + 1);
      }
    },
    [projectId, queryClient]
  );

  // Auto-send initial prompt from the home page (stored in sessionStorage)
  useEffect(() => {
    if (!projectId || messages === undefined || isStreaming || autoSentRef.current) return;
    const key = `initial-prompt-${projectId}`;
    const initialPrompt = sessionStorage.getItem(key);
    if (initialPrompt && messages.length === 0) {
      autoSentRef.current = true;
      sessionStorage.removeItem(key);
      void streamMessage(initialPrompt);
    }
  }, [messages, projectId, isStreaming, streamMessage]);

  const handleSendMessage = () => {
    if (!prompt.trim() || !projectId || isStreaming) return;
    const content = prompt;
    setPrompt("");
    void streamMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleAutoFix = () => {
    if (isStreaming || !projectId || previewErrors.length === 0) return;
    const errText = previewErrors.join("; ");
    setPreviewErrors([]);
    void streamMessage(
      `The app has a runtime error in the preview: ${errText}. Find the root cause and fix it so the app runs with no console errors. Return the full corrected files.`
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const activeFile = files?.find((f) => f.path === selectedFile);
  const previewHtml = buildPreviewHtml(files);
  const liveFile = isStreaming ? extractLiveFile(streamedText) : null;
  const activeStep = buildSteps.find((s) => !s.done)?.label;

  // Conversational narration: the model speaks first (before any "FILE:" block),
  // so show that opening text as a live, streaming assistant message in the chat.
  // Match FILE: only at line start so prose mentioning it doesn't cut narration.
  const fileMarker = streamedText.match(/^FILE:/m);
  const fileMarkerIdx = fileMarker?.index ?? -1;
  const liveNarration =
    isStreaming && streamedText
      ? (fileMarkerIdx === -1 ? streamedText : streamedText.slice(0, fileMarkerIdx)).trim()
      : "";

  // The server persists the user message immediately, so a mid-build refetch of
  // `messages` can momentarily contain it alongside our optimistic copy. Drop the
  // optimistic bubble only once a NEW persisted user message has landed (count
  // grew past the pre-send baseline), so identical re-prompts still show.
  const lastMsg = messages?.[messages.length - 1];
  const persistedArrived =
    (messages?.length ?? 0) > pendingBaseRef.current &&
    lastMsg?.role === "user" &&
    lastMsg.content === pendingUser;
  const showPendingUser = pendingUser !== null && !persistedArrived;

  // Keep the live code box scrolled to the newest line as tokens stream in.
  useEffect(() => {
    if (codeScrollRef.current) {
      codeScrollRef.current.scrollTop = codeScrollRef.current.scrollHeight;
    }
  }, [streamedText]);

  if (isLoadingProject) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Project not found</h2>
          <Link href="/projects" className="text-primary hover:underline mt-4 inline-block">
            Return to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh)] overflow-hidden bg-background">
      {/* Top Bar */}
      <header className="h-14 border-b border-border bg-card/50 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2 border-l border-border/50 pl-4">
            <h1 className="font-semibold text-sm">{project.name}</h1>
            <Badge variant="outline" className="text-[10px] h-5 ml-2 border-primary/20 text-primary/80">
              {project.fileCount} files
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Chat */}
        <div className="w-[380px] border-r border-border bg-card/30 flex flex-col shrink-0">
          <div className="p-4 border-b border-border/50 flex justify-between items-center bg-card/50">
            <h2 className="font-semibold text-sm">Buildly Assistant</h2>
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-5 pb-4">
              {isLoadingMessages ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages?.length === 0 && !isStreaming ? (
                <div className="text-center p-8 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
                  Describe what you want to build to get started.
                </div>
              ) : (
                messages?.map((msg) =>
                  msg.role === "user" ? (
                    <div key={msg.id} className="flex justify-end">
                      <div className="text-sm rounded-lg px-3.5 py-2 max-w-[90%] whitespace-pre-wrap bg-primary/10 text-foreground">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={msg.id}
                      className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap"
                    >
                      {cleanContent(msg.content)}
                    </div>
                  )
                )
              )}

              {/* Optimistic pending user message */}
              {showPendingUser && (
                <div className="flex justify-end">
                  <div className="text-sm rounded-lg px-3.5 py-2 max-w-[90%] whitespace-pre-wrap bg-primary/10 text-foreground">
                    {pendingUser}
                  </div>
                </div>
              )}

              {/* Live assistant narration — what it's doing, streamed token-by-token */}
              {isStreaming && liveNarration && (
                <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {liveNarration}
                  <span className="inline-block w-1.5 h-[1em] ml-0.5 -mb-[0.1em] bg-primary/70 animate-pulse align-middle" />
                </div>
              )}

              {/* Activity log (Replit-style) */}
              {buildSteps.length > 0 && (
                <div className="space-y-1.5">
                  {buildSteps.map((step, i) => {
                    const isFile = step.label.startsWith("Writing");
                    return (
                      <div key={i} className="flex items-center gap-2.5 text-xs">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md border border-border/60 bg-card/40 shrink-0 text-muted-foreground">
                          {!step.done ? (
                            <Loader2 className="h-3 w-3 animate-spin text-foreground" />
                          ) : isFile ? (
                            <FileCode2 className="h-3 w-3" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                        </span>
                        <span className={step.done ? "text-muted-foreground" : "text-foreground"}>
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          <div className="p-4 bg-card border-t border-border">
            <div className="relative">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Buildly to make changes..."
                className="pr-12 min-h-[80px] max-h-[200px] resize-none bg-background border-border focus-visible:ring-1 focus-visible:ring-primary/50"
                disabled={isStreaming}
                data-testid="input-chat-prompt"
              />
              {isStreaming ? (
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute bottom-3 right-3 h-8 w-8"
                  onClick={handleStop}
                  data-testid="button-stop"
                  title="Stop building"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="absolute bottom-3 right-3 h-8 w-8"
                  onClick={handleSendMessage}
                  disabled={!prompt.trim()}
                  data-testid="button-send-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="text-[10px] text-center text-muted-foreground mt-2">
              Enter to send · Shift+Enter for new line
            </div>
          </div>
        </div>

        {/* Center/Right Panel: Code & Preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {isStreaming ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Live build header */}
              <div className="h-12 border-b border-border bg-card/50 flex items-center gap-3 px-4 shrink-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground min-w-0">
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  <span className="truncate">
                    {liveFile ? `Writing ${liveFile.path}` : activeStep ?? "Building your app"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStop}
                  className="ml-auto h-8 gap-1.5 shrink-0"
                  data-testid="button-stop-center"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Stop
                </Button>
              </div>

              {/* Live code box */}
              <div className="flex-1 min-h-0 p-4">
                <div className="h-full flex flex-col rounded-xl border border-border bg-[#0d1117] overflow-hidden shadow-xl">
                  <div className="h-9 flex items-center gap-2 px-4 border-b border-white/10 shrink-0">
                    <span className="flex gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
                    </span>
                    <span className="ml-2 text-xs font-mono text-gray-400 truncate">
                      {liveFile?.path ?? "generating…"}
                    </span>
                  </div>
                  <div ref={codeScrollRef} className="flex-1 overflow-auto p-4">
                    {liveFile && liveFile.code ? (
                      <pre className="text-[12.5px] leading-relaxed font-mono text-gray-300 whitespace-pre-wrap break-words">
                        <code>{liveFile.code}</code>
                        <span className="inline-block w-2 h-[1.1em] -mb-[0.15em] bg-primary/80 animate-pulse ml-0.5 align-middle" />
                      </pre>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-gray-500 font-mono">
                        <Sparkles className="h-4 w-4 text-primary/70" />
                        {activeStep ?? "Thinking through your request…"}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Activity trail */}
              {buildSteps.length > 0 && (
                <div className="border-t border-border bg-card/40 px-4 py-2.5 shrink-0 max-h-24 overflow-auto">
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {buildSteps.map((step, i) => (
                      <span key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {step.done ? (
                          <Check className="h-3 w-3 text-primary shrink-0" />
                        ) : (
                          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                        )}
                        {step.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "code" | "preview")}
            className="flex-1 flex flex-col"
          >
            <div className="h-12 border-b border-border bg-card/50 flex items-center px-4 shrink-0">
              <TabsList className="bg-transparent h-auto p-0 gap-4">
                <TabsTrigger
                  value="code"
                  className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-2 py-3 h-12 text-muted-foreground data-[state=active]:text-foreground"
                >
                  <Code2 className="h-4 w-4 mr-2" />
                  Code
                </TabsTrigger>
                <TabsTrigger
                  value="preview"
                  className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-2 py-3 h-12 text-muted-foreground data-[state=active]:text-foreground"
                >
                  <MonitorPlay className="h-4 w-4 mr-2" />
                  Preview
                </TabsTrigger>
              </TabsList>

              {activeTab === "preview" && previewHtml && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setPreviewKey((k) => k + 1)}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Refresh
                </Button>
              )}
            </div>

            {/* Code Tab */}
            <TabsContent value="code" className="flex-1 flex m-0 overflow-hidden border-none p-0 outline-none">
              <div className="w-[240px] border-r border-border bg-card/20 flex flex-col shrink-0">
                <div className="px-4 py-3 border-b border-border/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <FolderOpen className="h-3 w-3" />
                  Files
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-0.5">
                    {isLoadingFiles ? (
                      <div className="flex justify-center p-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : files?.length === 0 ? (
                      <div className="text-xs text-muted-foreground p-3 italic">
                        No files yet — chat to generate your app
                      </div>
                    ) : (
                      files?.map((file) => (
                        <button
                          key={file.id}
                          onClick={() => setSelectedFile(file.path)}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left ${
                            selectedFile === file.path
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                          }`}
                        >
                          <FileIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                          <span className="truncate">{file.path}</span>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex-1 flex flex-col min-w-0 bg-[#0d1117] relative">
                {activeFile ? (
                  <>
                    <div className="h-10 border-b border-white/10 bg-[#0d1117] flex items-center px-4 shrink-0 text-xs text-gray-400 font-mono">
                      {activeFile.path}
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-4 min-w-max">
                        <pre className="text-[13px] leading-relaxed font-mono text-gray-300">
                          <code>{activeFile.content}</code>
                        </pre>
                      </div>
                    </ScrollArea>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                    <FileCode className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-sm">Select a file to view its contents</p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Preview Tab */}
            <TabsContent value="preview" className="flex-1 flex flex-col m-0 border-none p-0 outline-none">
              {isStreaming && !previewHtml ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-white text-gray-500">
                  <div className="relative">
                    <FileCode2 className="h-12 w-12 text-primary/40" />
                    <Loader2 className="h-6 w-6 animate-spin text-primary absolute -bottom-1 -right-1" />
                  </div>
                  <p className="text-lg font-semibold text-gray-900">
                    {buildSteps.find((s) => !s.done)?.label ?? "Building your app"}
                  </p>
                  <p className="text-sm">Writing your code file by file…</p>
                </div>
              ) : previewHtml ? (
                <div className="relative flex-1 flex">
                  <iframe
                    key={previewKey}
                    ref={previewIframeRef}
                    srcDoc={previewHtml}
                    className="flex-1 w-full border-0 bg-white"
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    title="App Preview"
                  />
                  {previewErrors.length > 0 && !isStreaming && (
                    <div className="absolute bottom-4 left-4 right-4 z-10">
                      <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 backdrop-blur px-4 py-3 shadow-lg">
                        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            Runtime error detected
                          </p>
                          <p className="text-xs text-muted-foreground truncate font-mono">
                            {previewErrors[previewErrors.length - 1]}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          className="h-8 shrink-0"
                          onClick={handleAutoFix}
                          data-testid="button-auto-fix"
                        >
                          <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                          Fix automatically
                        </Button>
                        <button
                          onClick={() => setPreviewErrors([])}
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          aria-label="Dismiss"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <MonitorPlay className="h-16 w-16 opacity-20" />
                  <h3 className="text-xl font-bold text-foreground">No Preview Yet</h3>
                  <p className="text-sm max-w-sm text-center">
                    Chat with Buildly to generate your app. The preview will appear here instantly.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
