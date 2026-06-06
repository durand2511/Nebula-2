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
  Terminal,
  Send,
  Loader2,
  FileCode,
  ChevronLeft,
  Code2,
  MonitorPlay,
  Sparkles,
  User,
  FolderOpen,
  File as FileIcon,
  RefreshCw,
  Check,
  FileCode2,
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
  return html;
}

function fileLabel(path: string): string {
  return `Writing ${path}`;
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

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

  useEffect(() => {
    if (files && files.length > 0 && !selectedFile) {
      setSelectedFile(files[0].path);
    }
  }, [files, selectedFile]);

  const streamMessage = useCallback(
    async (messageContent: string) => {
      if (!projectId) return;
      setIsStreaming(true);
      setBuildSteps([]);
      setPendingUser(messageContent);
      setActiveTab("preview");

      try {
        const res = await fetch(`/api/projects/${projectId}/messages/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: messageContent }),
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
          let event: { type: string; message?: string; path?: string };
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            return;
          }
          if (event.type === "status" && event.message) {
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
      } catch {
        setBuildSteps((prev) => [
          ...prev.map((s) => ({ ...s, done: true })),
          { label: "Something went wrong while building", done: true },
        ]);
      } finally {
        setIsStreaming(false);
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

  const activeFile = files?.find((f) => f.path === selectedFile);
  const previewHtml = buildPreviewHtml(files);

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
          <Terminal className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
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
            <Terminal className="h-4 w-4 text-primary" />
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
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Buildly Assistant
            </h2>
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
                messages?.map((msg) => (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    {msg.role === "user" ? (
                      <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0 bg-primary/20 text-primary">
                        <User className="h-3.5 w-3.5" />
                      </div>
                    ) : (
                      <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0 bg-primary text-primary-foreground">
                        <Sparkles className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <div
                      className={`text-sm rounded-lg px-4 py-2.5 max-w-[85%] whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-primary/10 border border-primary/20 text-foreground"
                          : "bg-secondary/50 border border-border text-foreground/90 leading-relaxed"
                      }`}
                    >
                      {msg.role === "assistant" ? cleanContent(msg.content) : msg.content}
                    </div>
                  </div>
                ))
              )}

              {/* Optimistic pending user message */}
              {pendingUser && (
                <div className="flex gap-3 flex-row-reverse">
                  <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0 bg-primary/20 text-primary">
                    <User className="h-3.5 w-3.5" />
                  </div>
                  <div className="text-sm rounded-lg px-4 py-2.5 max-w-[85%] whitespace-pre-wrap bg-primary/10 border border-primary/20 text-foreground">
                    {pendingUser}
                  </div>
                </div>
              )}

              {/* Live build steps */}
              {isStreaming && buildSteps.length > 0 && (
                <div className="flex gap-3">
                  <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0 bg-primary text-primary-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                    {buildSteps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        {step.done ? (
                          <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                        ) : (
                          <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
                        )}
                        <span className={step.done ? "text-muted-foreground" : "text-foreground font-medium"}>
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>
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
              <Button
                size="icon"
                className="absolute bottom-3 right-3 h-8 w-8"
                onClick={handleSendMessage}
                disabled={!prompt.trim() || isStreaming}
                data-testid="button-send-message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-[10px] text-center text-muted-foreground mt-2">
              Enter to send · Shift+Enter for new line
            </div>
          </div>
        </div>

        {/* Center/Right Panel: Code & Preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
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
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <div className="relative">
                    <FileCode2 className="h-12 w-12 text-primary/40" />
                    <Loader2 className="h-6 w-6 animate-spin text-primary absolute -bottom-1 -right-1" />
                  </div>
                  <p className="text-lg font-semibold text-foreground">
                    {buildSteps.find((s) => !s.done)?.label ?? "Building your app"}
                  </p>
                  <p className="text-sm">Writing your code file by file…</p>
                </div>
              ) : previewHtml ? (
                <iframe
                  key={previewKey}
                  srcDoc={previewHtml}
                  className="flex-1 w-full border-0 bg-white"
                  sandbox="allow-scripts allow-forms allow-modals allow-popups"
                  title="App Preview"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <Terminal className="h-16 w-16 opacity-20" />
                  <h3 className="text-xl font-bold text-foreground">No Preview Yet</h3>
                  <p className="text-sm max-w-sm text-center">
                    Chat with Buildly to generate your app. The preview will appear here instantly.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
