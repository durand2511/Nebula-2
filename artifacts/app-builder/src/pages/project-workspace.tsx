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
  AlertTriangle,
  Wand2,
  X,
  Square,
  ImagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fileToReferenceImage,
  MAX_ATTACHED_IMAGES,
  REFERENCE_IMAGE_PROMPT,
  type AttachedImage,
} from "@/lib/image";

type ProjectFile = { id: number; path: string; content: string; language: string };

/**
 * Fixed, user-facing build phases shown as a friendly AI activity timeline while
 * an app is generating. Deliberately non-technical: no filenames or source code
 * are surfaced — the goal is a sense of an AI agent at work, not a code editor.
 */
const BUILD_PHASES: { label: string; description: string }[] = [
  { label: "Analyse opdracht", description: "De wensen en functionaliteit worden geïnterpreteerd." },
  { label: "Structuur bepalen", description: "De opbouw en navigatie van de app worden vastgelegd." },
  { label: "Wireframe ontwerpen", description: "De globale indeling van de schermen wordt geschetst." },
  { label: "UI ontwerpen", description: "Dashboard-layout en componenten worden samengesteld." },
  { label: "Functionaliteit bouwen", description: "Formulieren, validatie en opslag worden toegevoegd." },
  { label: "Gegevensopslag configureren", description: "Gegevens worden lokaal opgeslagen en bewaard." },
  { label: "Testen", description: "Gebruikersflows en foutafhandeling worden gecontroleerd." },
  { label: "Optimaliseren", description: "Prestaties en details worden verfijnd." },
];

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

  // Imported static sites (e.g. WordPress / Elementor) ship lazy-loaded images:
  // the real URL lives in data-src / data-srcset while `src` holds a 1x1 placeholder,
  // and a `.lazyload` class keeps the image at opacity:0 until the site's own
  // lazy-loader JS swaps it in. That script usually doesn't run in our sandbox, so
  // the images never appear (blank heroes, missing logo, empty quote cards). Promote
  // the real URLs — only on elements that actually carry them — so images render
  // without the original JS. (No-op for generated apps, which don't use data-src.)
  const delazy = (tag: string) => {
    if (!/\bdata-src=/i.test(tag) && !/\bdata-srcset=/i.test(tag)) return tag;
    // Strip the existing placeholder src/srcset (quoted OR unquoted) BEFORE
    // promoting data-src/data-srcset, otherwise a duplicate attribute would
    // survive and the browser keeps the first (placeholder) one.
    return tag
      .replace(/\ssrc=(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "")
      .replace(/\ssrcset=(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "")
      .replace(/\bdata-srcset=/i, "srcset=")
      .replace(/\bdata-src=/i, "src=")
      .replace(/\sloading=(?:"lazy"|'lazy'|lazy)(?=[\s>])/gi, "");
  };
  html = html.replace(/<img\b[^>]*>/gi, delazy);
  html = html.replace(/<source\b[^>]*>/gi, delazy);

  // The preview runs in a sandbox WITHOUT allow-same-origin (opaque origin) so
  // generated code can't reach Buildly's storage/cookies. A side effect is that
  // window.localStorage/sessionStorage THROW a SecurityError on access, which made
  // every generated app's save flow fail ("could not save"). Install an in-memory
  // shim (only when native storage is unavailable) so apps work for the session
  // without weakening the sandbox. Must run before any app code.
  const storageShim = `<script>(function(){function mk(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}function ok(n){try{var s=window[n];if(!s)return false;s.setItem("__b","1");s.removeItem("__b");return true}catch(e){return false}}["localStorage","sessionStorage"].forEach(function(n){if(!ok(n)){var s=mk();try{Object.defineProperty(window,n,{value:s,configurable:true})}catch(e){try{window[n]=s}catch(e2){}}}});})();</script>`;

  // Inject a tiny reporter (first thing in the doc) that forwards runtime errors
  // to the parent window so Buildly can surface them and offer an auto-fix.
  const reporter = `<script>(function(){function r(p){try{parent.postMessage({__buildlyError:true,message:String(p.message||"Error"),source:p.source||"",line:p.line||0},"*")}catch(e){}}window.addEventListener("error",function(e){r({message:e.message,source:e.filename,line:e.lineno})});window.addEventListener("unhandledrejection",function(e){var m=e.reason&&e.reason.message?e.reason.message:e.reason;r({message:"Unhandled promise rejection: "+m})});})();</script>`;
  // Enforce the native semantics of the `hidden` attribute. Generated apps often
  // toggle modals/dialogs/drawers via `el.hidden = true/false` but then style the
  // base class with `display:grid/flex`, which overrides `[hidden]` and leaves a
  // full-screen `position:fixed; inset:0` overlay permanently on top — swallowing
  // every click and making the whole app feel "dead". Forcing [hidden] to stay
  // hidden robustly neutralizes that bug class (beats normal app CSS via
  // !important; a hostile `display:... !important` could still override it).
  const baseStyle = `<style>[hidden]{display:none !important}img.lazyload,img.lazyloading,.lazyload,.lazyloading{opacity:1 !important}</style>`;
  const inject = baseStyle + storageShim + reporter;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + inject);
  } else {
    html = inject + html;
  }
  return html;
}

export function ProjectWorkspace() {
  const [, params] = useRoute("/projects/:id");
  const projectId = Number(params?.id);
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("preview");
  const [showCode, setShowCode] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const [isStreaming, setIsStreaming] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [streamedText, setStreamedText] = useState("");
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [pendingImages, setPendingImages] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSentRef = useRef(false);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);
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
  }, [messages, phaseIndex, pendingUser]);

  // Track the known message count so the optimistic user bubble can be dropped
  // only once the persisted message actually lands (handles repeated prompts).
  useEffect(() => {
    messagesLenRef.current = messages?.length ?? 0;
  }, [messages]);

  // Smoothly reveal buffered tokens so the live code "types" out continuously,
  // even though the reasoning model emits text in bursts separated by pauses.
  // The pace accelerates with backlog so it never lags far behind real output.
  // NOTE: driven by setInterval, NOT requestAnimationFrame. Buildly runs inside an
  // embedded canvas iframe, and browsers heavily throttle/pause rAF callbacks for
  // iframes — which froze the live reveal for real users (it only animated when the
  // app was a foreground tab, e.g. during automated testing). A timer keeps the
  // typewriter advancing regardless of the iframe's paint scheduling.
  useEffect(() => {
    if (!isStreaming) return;
    let lastT = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
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
    }, 33);
    return () => clearInterval(id);
  }, [isStreaming]);

  // Advance the friendly build timeline at a steady pace while streaming. The
  // final phase keeps spinning until the real build finishes (see `finally`),
  // so the timeline never claims completion before the app is actually ready.
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => {
      setPhaseIndex((i) => Math.min(i + 1, BUILD_PHASES.length - 1));
    }, 3800);
    return () => clearInterval(id);
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
    async (messageContent: string, images: string[] = []) => {
      if (!projectId) return;
      setIsStreaming(true);
      setPhaseIndex(0);
      setBuildError(null);
      setShowCode(false);
      setPendingUser(messageContent);
      setPendingImages(images);
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
          body: JSON.stringify(
            images.length > 0
              ? { content: messageContent, images }
              : { content: messageContent }
          ),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleEvent = (line: string) => {
          if (!line.startsWith("data:")) return;
          let event: { type: string; message?: string; path?: string; text?: string };
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            return;
          }
          if (event.type === "delta" && typeof event.text === "string") {
            // Buffer raw tokens; the reveal loop types them out smoothly so the
            // model's bursty output appears as continuous narration in the chat.
            rawStreamRef.current += event.text;
          } else if (event.type === "file" && event.path) {
            // Refresh the file list as files arrive so the saved app is ready the
            // moment the build finishes. Filenames are intentionally NOT surfaced
            // in the UI during generation.
            queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
          } else if (event.type === "error") {
            setBuildError(event.message ?? "Something went wrong");
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
        if (!stopped) setBuildError("Something went wrong while building");
      } finally {
        abortRef.current = null;
        // Reveal any remaining buffered tail so the final narration isn't cut off
        // in the brief moment before the view switches to the finished app.
        shownLenRef.current = rawStreamRef.current.length;
        setStreamedText(rawStreamRef.current);
        setIsStreaming(false);
        // Mark every phase complete the moment the real build finishes.
        setPhaseIndex(BUILD_PHASES.length);
        setPendingUser(null);
        setPendingImages([]);
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
    if (messages.length !== 0) return;
    const key = `initial-prompt-${projectId}`;
    const imgKey = `initial-images-${projectId}`;
    const initialPrompt = sessionStorage.getItem(key) ?? "";
    let initialImages: string[] = [];
    try {
      const raw = sessionStorage.getItem(imgKey);
      if (raw) initialImages = JSON.parse(raw) as string[];
    } catch {
      initialImages = [];
    }
    const text = initialPrompt.trim()
      ? initialPrompt
      : initialImages.length > 0
        ? REFERENCE_IMAGE_PROMPT
        : "";
    if (!text) return;
    autoSentRef.current = true;
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(imgKey);
    void streamMessage(text, initialImages);
  }, [messages, projectId, isStreaming, streamMessage]);

  const handleSendMessage = () => {
    if ((!prompt.trim() && attachedImages.length === 0) || !projectId || isStreaming) return;
    const images = attachedImages.map((img) => img.dataUrl);
    const content = prompt.trim()
      ? prompt
      : images.length > 0
        ? REFERENCE_IMAGE_PROMPT
        : "";
    setPrompt("");
    setAttachedImages([]);
    void streamMessage(content, images);
  };

  const addImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const processed = await Promise.all(imageFiles.map(fileToReferenceImage));
    setAttachedImages((prev) => [...prev, ...processed].slice(0, MAX_ATTACHED_IMAGES));
  }, []);

  const handleImageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    void addImageFiles(files);
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.some((f) => f.type.startsWith("image/"))) {
      void addImageFiles(files);
    }
  };

  const removeAttachedImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
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
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Chat */}
        <div className="w-[380px] border-r border-border bg-card/30 flex flex-col shrink-0">
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
                <div className="flex flex-col items-end gap-1.5">
                  {pendingImages.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5 max-w-[90%]">
                      {pendingImages.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt="attached reference"
                          className="h-16 w-16 rounded-md object-cover border border-border"
                        />
                      ))}
                    </div>
                  )}
                  {pendingUser && (
                    <div className="text-sm rounded-lg px-3.5 py-2 max-w-[90%] whitespace-pre-wrap bg-primary/10 text-foreground">
                      {pendingUser}
                    </div>
                  )}
                </div>
              )}

              {/* Live assistant narration — what it's doing, streamed token-by-token */}
              {isStreaming && liveNarration && (
                <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {liveNarration}
                  <span className="inline-block w-1.5 h-[1em] ml-0.5 -mb-[0.1em] bg-primary/70 animate-pulse align-middle" />
                </div>
              )}

              {/* Build error surfaced inline (no technical detail during the build) */}
              {buildError && (
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  <span>{buildError}</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          <div className="p-4 bg-card border-t border-border">
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachedImages.map((img) => (
                  <div
                    key={img.id}
                    className="relative h-16 w-16 rounded-md overflow-hidden border border-border group"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachedImage(img.id)}
                      className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-background/80 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove image"
                      data-testid={`button-remove-image-${img.id}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Ask Buildly to make changes..."
                className="pr-12 pl-11 min-h-[80px] max-h-[200px] resize-none bg-background border-border focus-visible:ring-1 focus-visible:ring-primary/50"
                disabled={isStreaming}
                data-testid="input-chat-prompt"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageInput}
                data-testid="input-image-file"
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute bottom-3 left-3 h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || attachedImages.length >= MAX_ATTACHED_IMAGES}
                title="Attach reference image"
                data-testid="button-attach-image"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
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
                  disabled={!prompt.trim() && attachedImages.length === 0}
                  data-testid="button-send-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="text-[10px] text-center text-muted-foreground mt-2">
              Enter to send · Shift+Enter for new line · attach or paste an image to match its style
            </div>
          </div>
        </div>

        {/* Center/Right Panel: Code & Preview */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background">
          {isStreaming ? (
            <div className="flex-1 flex flex-col min-h-0 bg-background">
              {/* Build header */}
              <div className="h-12 border-b border-border bg-card/50 flex items-center gap-3 px-4 shrink-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground min-w-0">
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  <span className="truncate">Buildly is building your app…</span>
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

              {/* AI activity timeline */}
              <div className="flex-1 min-h-0 overflow-auto p-8">
                <div className="mx-auto max-w-md">
                  <ol className="relative">
                    {BUILD_PHASES.map((phase, i) => {
                      const done = i < phaseIndex;
                      const active = i === phaseIndex;
                      const isLast = i === BUILD_PHASES.length - 1;
                      return (
                        <li key={phase.label} className="relative flex gap-4 pb-7 last:pb-0">
                          {!isLast && (
                            <span
                              className={`absolute left-4 top-9 -bottom-1 w-px -translate-x-1/2 ${
                                done ? "bg-primary/40" : "bg-border"
                              }`}
                            />
                          )}
                          <span
                            className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                              done
                                ? "border-primary/50 bg-primary/10 text-primary"
                                : active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-card/40 text-muted-foreground"
                            }`}
                          >
                            {done ? (
                              <Check className="h-4 w-4" />
                            ) : active ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <span className="h-2 w-2 rounded-full bg-current opacity-40" />
                            )}
                          </span>
                          <div className="pt-1.5">
                            <p
                              className={`text-sm font-medium leading-none ${
                                active
                                  ? "text-foreground"
                                  : done
                                  ? "text-foreground/80"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {phase.label}
                            </p>
                            {(active || done) && (
                              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                                {phase.description}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            </div>
          ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "code" | "preview")}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="h-12 border-b border-border bg-card/50 flex items-center px-4 shrink-0">
              <TabsList className="bg-transparent h-auto p-0 gap-4">
                <TabsTrigger
                  value="preview"
                  className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-2 py-3 h-12 text-muted-foreground data-[state=active]:text-foreground"
                >
                  <MonitorPlay className="h-4 w-4 mr-2" />
                  Preview
                </TabsTrigger>
                {showCode && (
                  <TabsTrigger
                    value="code"
                    className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-2 py-3 h-12 text-muted-foreground data-[state=active]:text-foreground"
                  >
                    <Code2 className="h-4 w-4 mr-2" />
                    Code
                  </TabsTrigger>
                )}
              </TabsList>

              <div className="ml-auto flex items-center gap-1">
                {activeTab === "preview" && previewHtml && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setPreviewKey((k) => k + 1)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Refresh
                  </Button>
                )}
                {previewHtml &&
                  (showCode ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setShowCode(false);
                        setActiveTab("preview");
                      }}
                    >
                      <Code2 className="h-3.5 w-3.5 mr-1.5" />
                      Verberg broncode
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setShowCode(true);
                        setActiveTab("code");
                      }}
                    >
                      <Code2 className="h-3.5 w-3.5 mr-1.5" />
                      Bekijk broncode
                    </Button>
                  ))}
              </div>
            </div>

            {/* Code Tab */}
            <TabsContent value="code" className="flex-1 flex m-0 min-h-0 overflow-hidden border-none p-0 outline-none">
              <div className="w-[240px] border-r border-border bg-card/20 flex flex-col min-h-0 shrink-0">
                <div className="px-4 py-3 border-b border-border/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <FolderOpen className="h-3 w-3" />
                  Files
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
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
                </div>
              </div>

              <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0d1117] relative">
                {activeFile ? (
                  <>
                    <div className="h-10 border-b border-white/10 bg-[#0d1117] flex items-center px-4 shrink-0 text-xs text-gray-400 font-mono">
                      {activeFile.path}
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                      <div className="p-4 min-w-max">
                        <pre className="text-[13px] leading-relaxed font-mono text-gray-300">
                          <code>{activeFile.content}</code>
                        </pre>
                      </div>
                    </div>
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
              {previewHtml ? (
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
