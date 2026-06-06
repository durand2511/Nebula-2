import { useState, useRef, useEffect } from "react";
import type { AppArchitecture } from "@/ai/architecture";
import { useNavigate } from "react-router-dom";
import { Globe, ChevronDown, Home, FolderOpen, Plus, LogOut, Files, User, History, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ChatInput, { type PlanData } from "@/components/ChatInput";
import ChatMessages from "@/components/ChatMessages";
import LivePreview from "@/components/LivePreview";
import WelcomeScreen from "@/components/WelcomeScreen";
import AppSidebar from "@/components/AppSidebar";
import AllProjectsView from "@/components/AllProjectsView";
import PublishPanel from "@/components/PublishPanel";
import FileManager from "@/components/FileManager";
import VersionHistory, { type Version } from "@/components/VersionHistory";
import VisualEditor from "@/components/VisualEditor";
import BuildSteps from "@/components/BuildSteps";
import ArchitecturePanel from "@/components/ArchitecturePanel";
import { chatWithAI, planWithAI, streamGenerateApp, type ChatMessage, type QuickEdit } from "@/lib/aiStream";
import { runAgent, type AgentPhase } from "@/ai/agent";
import { createProject, updateProject, type AppProject } from "@/lib/projects";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type ViewState = "home" | "editor" | "projects";

const PHASE_LABELS: Record<AgentPhase, string> = {
  idle: "",
  understanding: "Verzoek analyseren...",
  planning: "Plan opstellen...",
  building: "App genereren...",
  testing: "App testen...",
  scoring: "Score berekenen...",
  reviewing: "Kwaliteit controleren...",
  fixing: "Verbeteringen toepassen...",
  done: "Klaar!",
  error: "Er ging iets mis",
};

const LOADING_STAGES = [
  "Verzoek verwerken...",
  "Componenten updaten...",
  "Wijzigingen toepassen...",
  "Layout aanpassen...",
  "Bijna klaar...",
];

const INIT_STAGES = [
  "Starting fresh session...",
  "Clearing previous data",
  "Creating new environment",
  "Ready",
];

const Index = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState<ViewState>("home");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState(LOADING_STAGES[0]);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
  const [currentProject, setCurrentProject] = useState<AppProject | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showVisualEditor, setShowVisualEditor] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [planPrompt, setPlanPrompt] = useState("");
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [isInitializing, setIsInitializing] = useState(false);
  const [architecture, setArchitecture] = useState<AppArchitecture | null>(null);
  const [initText, setInitText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadingStageRef = useRef(0);
  const loadingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const saveCurrentProject = async () => {
    if (currentProject) {
      await updateProject(currentProject.id, {
        chatHistory: messages,
        html: generatedHtml || currentProject.html,
      });
    }
  };

  const resetProjectState = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setIsStreaming(false);
    stopLoadingCycle();
    setMessages([]);
    setGeneratedHtml(null);
    setCurrentProject(null);
    setPlan(null);
    setPlanPrompt("");
    setShowPublish(false);
    setArchitecture(null);
    setVersions([]);
    setSessionId(crypto.randomUUID());
  };

  const showInitAnimation = async () => {
    setIsInitializing(true);
    for (const stage of INIT_STAGES) {
      setInitText(stage);
      await new Promise((r) => setTimeout(r, 400));
    }
    await new Promise((r) => setTimeout(r, 300));
    setIsInitializing(false);
    setInitText("");
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { return () => { if (loadingTimerRef.current) clearInterval(loadingTimerRef.current); }; }, []);

  const startLoadingCycle = () => {
    loadingStageRef.current = 0;
    setLoadingText(LOADING_STAGES[0]);
    if (loadingTimerRef.current) clearInterval(loadingTimerRef.current);
    loadingTimerRef.current = setInterval(() => {
      loadingStageRef.current = Math.min(loadingStageRef.current + 1, LOADING_STAGES.length - 1);
      setLoadingText(LOADING_STAGES[loadingStageRef.current]);
    }, 2200);
  };

  const stopLoadingCycle = () => {
    if (loadingTimerRef.current) clearInterval(loadingTimerRef.current);
    loadingTimerRef.current = null;
  };

  const saveChatToProject = (msgs: ChatMessage[]) => {
    if (currentProject) {
      updateProject(currentProject.id, { chatHistory: msgs });
    }
  };

  const saveHtmlToProject = async (html: string) => {
    if (currentProject) {
      const updated = await updateProject(currentProject.id, { html });
      if (updated) setCurrentProject(updated);
    }
  };

  const addVersion = (html: string, label: string) => {
    const v: Version = {
      id: crypto.randomUUID(),
      html,
      label,
      timestamp: new Date().toISOString(),
    };
    setVersions((prev) => [v, ...prev].slice(0, 50)); // Keep last 50 versions
  };

  const replaceImagePlaceholders = (html: string, images?: string[]): string => {
    if (!images || images.length === 0) return html;
    let result = html;
    images.forEach((dataUrl, i) => {
      const placeholder = `{{USER_IMAGE_${i + 1}}}`;
      while (result.includes(placeholder)) {
        result = result.replace(placeholder, dataUrl);
      }
    });
    return result;
  };

  /** Apply quick CSS/text edits directly to the HTML without a full AI rebuild */
  const applyQuickEdits = (html: string, edits: QuickEdit[]): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    for (const edit of edits) {
      try {
        const cssProperty = edit.type === "color" ? "color"
          : edit.type === "bgColor" ? "background-color"
          : edit.type === "fontSize" ? "font-size"
          : edit.type === "fontFamily" ? "font-family"
          : null;

        if (edit.type === "text") {
          const els = doc.querySelectorAll(edit.target);
          els.forEach(el => { el.textContent = edit.value; });
        } else if (cssProperty) {
          if (edit.scope === "global" && (edit.target === "body" || edit.target === "*")) {
            // For global scope, inject/update a style tag
            let styleTag = doc.querySelector('style[data-quick-edit]');
            if (!styleTag) {
              styleTag = doc.createElement("style");
              styleTag.setAttribute("data-quick-edit", "true");
              doc.head.appendChild(styleTag);
            }
            // Append the rule
            styleTag.textContent += `\n${edit.target} { ${cssProperty}: ${edit.value} !important; }`;
            // Also apply to common children for color/bg changes
            if (cssProperty === "color") {
              styleTag.textContent += `\n${edit.target} * { ${cssProperty}: ${edit.value} !important; }`;
            }
          } else {
            // Targeted: apply inline styles
            const els = doc.querySelectorAll(edit.target);
            els.forEach(el => {
              (el as HTMLElement).style.setProperty(cssProperty, edit.value, "important");
            });
            // If no elements matched by selector, try broader approach
            if (els.length === 0) {
              let styleTag = doc.querySelector('style[data-quick-edit]');
              if (!styleTag) {
                styleTag = doc.createElement("style");
                styleTag.setAttribute("data-quick-edit", "true");
                doc.head.appendChild(styleTag);
              }
              styleTag.textContent += `\n${edit.target} { ${cssProperty}: ${edit.value} !important; }`;
            }
          }
        }
      } catch (e) {
        console.warn("Quick edit failed for target:", edit.target, e);
      }
    }

    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  };



  const executeBuild = async (input: string, msgsBeforeBuild: ChatMessage[], planDetails?: string, images?: string[]) => {
    startLoadingCycle();
    setIsStreaming(true);

    const mode = generatedHtml ? "update" : "create";
    const userContent = generatedHtml
      ? `Pas de bestaande app gericht aan op basis van deze laatste wijziging: ${input}`
      : input;
    const userMsg: ChatMessage = { role: "user", content: userContent, ...(images && { images }) };
    const conversationForAi: ChatMessage[] = [
      ...msgsBeforeBuild
        .filter(m => m.role === "user")
        .map(m => ({ role: "user" as const, content: m.content, ...(m.images && { images: m.images }) })),
      userMsg,
    ];

    let fullResponse = "";
    let lastPreviewUpdate = 0;
    const PREVIEW_INTERVAL = 800;

    await streamGenerateApp({
      messages: conversationForAi,
      currentHtml: generatedHtml,
      onDelta: (chunk) => {
        fullResponse += chunk;
        const now = Date.now();
        if (now - lastPreviewUpdate > PREVIEW_INTERVAL) {
          const partial = fullResponse.trim();
          if (partial.includes("<body") && partial.length > 500) {
            let previewHtml = partial;
            if (!previewHtml.includes("</body>")) previewHtml += "\n</body></html>";
            setGeneratedHtml(replaceImagePlaceholders(previewHtml, images));
          }
          lastPreviewUpdate = now;
        }
      },
      onDone: () => {
        let html = fullResponse;
        if (html.includes("```html")) html = html.replace(/```html\n?/g, "").replace(/```\n?/g, "");
        html = html.trim();
        if (html.includes("<!DOCTYPE") || html.includes("<html")) {
          html = replaceImagePlaceholders(html, images);
          setGeneratedHtml(html);
          saveHtmlToProject(html);
          addVersion(html, mode === "update" ? "Wijziging" : "Eerste versie");
        }

        if (planDetails) {
          const summaryMsg: ChatMessage = {
            role: "assistant",
            title: mode === "update" ? "Wijziging toegepast" : "App gebouwd",
            content: "",
            details: planDetails,
          };
          setMessages((prev) => {
            const updated = [...prev, summaryMsg];
            saveChatToProject(updated);
            return updated;
          });
        }

        setIsLoading(false);
        setIsStreaming(false);
        stopLoadingCycle();
      },
      onError: (error) => {
        toast.error(error);
        setIsLoading(false);
        setIsStreaming(false);
        stopLoadingCycle();
      },
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSend = async (input: string, attachments?: File[]) => {
    const comingFromHome = currentView !== "editor";

    if (comingFromHome) {
      await saveCurrentProject();
      resetProjectState();
      setCurrentView("editor");
      await showInitAnimation();
    }

    // Always create a fresh project when coming from home/dashboard
    let activeProject = comingFromHome ? null : currentProject;
    if (!activeProject && user) {
      const newProject = await createProject("Nieuw project", "", user.id);
      if (newProject) {
        setCurrentProject(newProject);
        activeProject = newProject;
      }
    }

    let images: string[] | undefined;
    if (attachments && attachments.length > 0) {
      const imageFiles = attachments.filter(f => f.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        images = await Promise.all(imageFiles.map(fileToBase64));
      }
    }

    // When coming from home, start with a clean message list
    const baseMessages: ChatMessage[] = comingFromHome ? [] : messages;
    const userMsg: ChatMessage = { role: "user", content: input, ...(images && { images }) };
    const updatedMessages = [...baseMessages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);
    startLoadingCycle();

    try {
      await runAgent(
        input,
        updatedMessages,
        comingFromHome ? null : generatedHtml,
        {
          onPhaseChange: (phase, msg) => {
            setAgentPhase(phase);
            if (msg) setLoadingText(msg);
            else setLoadingText(PHASE_LABELS[phase] || "");
            if (phase === "building") setIsStreaming(true);
            if (phase === "done" || phase === "error") {
              setIsLoading(false);
              setIsStreaming(false);
              stopLoadingCycle();
            }
          },
          onHtmlDelta: (chunk) => {
            setGeneratedHtml((prev) => {
              const next = (prev || "") + chunk;
              // Show partial preview
              if (next.includes("<body") && next.length > 500) {
                let preview = next.trim();
                if (!preview.includes("</body>")) preview += "\n</body></html>";
                return replaceImagePlaceholders(preview, images);
              }
              return next;
            });
          },
          onHtmlComplete: (html) => {
            const finalHtml = replaceImagePlaceholders(html, images);
            setGeneratedHtml(finalHtml);
            saveHtmlToProject(finalHtml);
            addVersion(finalHtml, generatedHtml ? "Wijziging" : "Eerste versie");
          },
          onChatResponse: (message, title) => {
            setMessages((prev) => {
              const newMsgs = [...prev, { role: "assistant" as const, content: message, title }];
              if (activeProject) updateProject(activeProject.id, { chatHistory: newMsgs });
              return newMsgs;
            });
          },
          onQuickEdits: (edits) => {
            if (generatedHtml) {
              const updatedHtml = applyQuickEdits(generatedHtml, edits);
              setGeneratedHtml(updatedHtml);
              saveHtmlToProject(updatedHtml);
              addVersion(updatedHtml, "Snelle wijziging");
              toast.success("Wijziging direct toegepast!");
            }
          },
          onPlanReady: () => {
            // Plans are handled internally by the agent now
          },
          onArchitectureReady: (arch) => {
            setArchitecture(arch);
          },
          onCriticResult: (result) => {
            if (!result.passed && result.issues.length > 0) {
              console.log("Critic issues:", result.issues);
            }
          },
          onStateUpdate: (agentState) => {
            console.log("Agent state:", agentState);
          },
          onError: (error) => {
            toast.error(error);
          },
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Er ging iets mis. Probeer het opnieuw.");
      setIsLoading(false);
      setIsStreaming(false);
      stopLoadingCycle();
    }
  };

  const handleRequestPlan = async (input: string) => {
    if (currentView !== "editor") setCurrentView("editor");
    setPlanPrompt(input);
    setIsLoading(true);
    setLoadingText("Plan opstellen...");

    const userMsg: ChatMessage = { role: "user", content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    try {
      const planResult = await planWithAI({
        prompt: input,
        hasExistingApp: !!generatedHtml,
        currentHtml: generatedHtml,
      });

      setPlan({ summary: planResult.summary, steps: planResult.steps });
      setIsLoading(false);
    } catch (e) {
      toast.error("Plan maken mislukt.");
      setIsLoading(false);
    }
  };

  const handleApprovePlan = async () => {
    const currentPlan = plan;
    setPlan(null);
    setIsLoading(true);
    setLoadingText("Plan uitvoeren...");

    const planDetailsText = currentPlan
      ? currentPlan.steps.map((s, i) => `${i + 1}. ${s.title}\n   ${s.description}`).join("\n")
      : undefined;

    try {
      await executeBuild(planPrompt, messages, planDetailsText);
    } catch (e) {
      toast.error("Uitvoering mislukt.");
      setIsLoading(false);
      setIsStreaming(false);
      stopLoadingCycle();
    }
  };

  const handleRejectPlan = () => {
    setPlan(null);
    const rejectMsg: ChatMessage = { role: "assistant" as const, content: "Geen probleem, pas je verzoek aan en probeer het opnieuw.", title: "Plan afgewezen" };
    setMessages((prev) => [...prev, rejectMsg]);
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setIsStreaming(false);
    stopLoadingCycle();
    const cancelMsg: ChatMessage = { role: "assistant" as const, content: "Afgebroken.", title: "Gestopt" };
    setMessages((prev) => [...prev, cancelMsg]);
  };

  const handleNewProject = () => {
    saveCurrentProject();
    resetProjectState();
    setCurrentView("home");
  };

  const handleNewChat = async () => {
    await saveCurrentProject();
    resetProjectState();
    setGeneratedHtml(null);

    if (user) {
      const newProject = await createProject("Nieuw project", "", user.id);
      if (newProject) setCurrentProject(newProject);
    }

    setCurrentView("editor");
    await showInitAnimation();
  };

  const handleOpenProject = (project: AppProject) => {
    saveCurrentProject();
    setCurrentProject(project);
    setGeneratedHtml(project.html);
    setMessages(project.chatHistory || []);
    setPlan(null);
    setPlanPrompt("");
    setSessionId(crypto.randomUUID());
    setCurrentView("editor");
  };

  const handleProjectUpdate = async (updates: Partial<AppProject>) => {
    if (!currentProject) return;
    const updated = await updateProject(currentProject.id, updates);
    if (updated) setCurrentProject(updated);
  };

  const showSidebar = currentView !== "editor";

  return (
    <div className="flex h-screen bg-background">
      {showSidebar && (
        <AppSidebar
          onNewProject={handleNewProject}
          onOpenProject={handleOpenProject}
          onShowAllProjects={() => setCurrentView("projects")}
          onGoHome={() => { setCurrentView("home"); }}
          activeProjectId={currentProject?.id}
          currentView={currentView}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {currentView === "home" && (
          <WelcomeScreen onSend={handleSend} />
        )}

        {currentView === "projects" && (
          <AllProjectsView
            key={currentView}
            onNewProject={handleNewProject}
            onOpenProject={handleOpenProject}
          />
        )}

        {currentView === "editor" && (
          <div key={sessionId} className="flex flex-col flex-1 min-h-0">
            {isInitializing && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-muted-foreground animate-pulse">{initText}</p>
                </div>
              </div>
            )}
            <header className="flex items-center justify-between border-b border-border bg-card px-5 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="relative group">
                  <button className="text-sm font-bold hover:text-muted-foreground transition-colors flex items-center gap-1.5">
                    {currentProject?.name || "Mellow"}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </button>
                  <div className="absolute top-full left-0 mt-1 w-48 rounded-lg border border-border bg-card shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                    <button
                      onClick={handleNewChat}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-foreground hover:bg-secondary rounded-t-lg transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      Nieuw project
                    </button>
                    <button
                      onClick={() => setCurrentView("home")}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-foreground hover:bg-secondary transition-colors"
                    >
                      <Home className="h-4 w-4" />
                      Dashboard
                    </button>
                    <button
                      onClick={() => setCurrentView("projects")}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-foreground hover:bg-secondary transition-colors"
                    >
                      <FolderOpen className="h-4 w-4" />
                      Alle projecten
                    </button>
                    <button
                      onClick={() => navigate("/profile")}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-foreground hover:bg-secondary transition-colors"
                    >
                      <User className="h-4 w-4" />
                      Profiel
                    </button>
                    <button
                      onClick={signOut}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-destructive hover:bg-secondary rounded-b-lg transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Uitloggen
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowVisualEditor(true)} disabled={!generatedHtml} title="Visuele editor">
                  <MousePointer2 className="h-4 w-4 mr-1.5" />
                  Bewerk
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)} disabled={versions.length === 0} title="Versiegeschiedenis">
                  <History className="h-4 w-4 mr-1.5" />
                  Geschiedenis
                </Button>
                <Button variant="default" size="sm" onClick={() => setShowPublish(true)} disabled={!generatedHtml}>
                  <Globe className="h-4 w-4 mr-1.5" />
                  Publiceer
                </Button>
              </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
              <div className="w-[380px] flex flex-col border-r border-border shrink-0">
                {messages.length === 0 && !isLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center px-4">
                    <ChatInput
                      onSend={handleSend}
                      onRequestPlan={handleRequestPlan}
                      onCancel={handleCancel}
                      isLoading={isLoading}
                      placeholder="Vraag Mellow..."
                      plan={plan}
                      onApprovePlan={handleApprovePlan}
                      onRejectPlan={handleRejectPlan}
                    />
                  </div>
                ) : (
                  <>
                    <ChatMessages messages={messages} isLoading={isLoading} loadingText={loadingText} />
                    {isLoading && (
                      <BuildSteps currentPhase={agentPhase} />
                    )}
                    <ChatInput
                      onSend={handleSend}
                      onRequestPlan={handleRequestPlan}
                      onCancel={handleCancel}
                      isLoading={isLoading}
                      placeholder="Vraag Mellow..."
                      plan={plan}
                      onApprovePlan={handleApprovePlan}
                      onRejectPlan={handleRejectPlan}
                    />
                  </>
                )}
              </div>
              <LivePreview key={sessionId} html={generatedHtml} isStreaming={isStreaming} architecture={architecture} />
            </div>

            {showPublish && currentProject && (
              <PublishPanel
                project={currentProject}
                html={generatedHtml || ""}
                onUpdate={handleProjectUpdate}
                onClose={() => setShowPublish(false)}
              />
            )}

            {showFiles && (
              <FileManager
                projectId={currentProject?.id}
                onClose={() => setShowFiles(false)}
              />
            )}

            {showHistory && (
              <VersionHistory
                versions={versions}
                currentHtml={generatedHtml}
                onRevert={(v) => {
                  setGeneratedHtml(v.html);
                  saveHtmlToProject(v.html);
                  toast.success("Versie hersteld!");
                }}
                onPreview={(html) => setGeneratedHtml(html)}
                onClose={() => setShowHistory(false)}
              />
            )}

            {showVisualEditor && generatedHtml && (
              <VisualEditor
                html={generatedHtml}
                onSave={(newHtml) => {
                  setGeneratedHtml(newHtml);
                  saveHtmlToProject(newHtml);
                  addVersion(newHtml, "Visuele bewerking");
                }}
                onClose={() => setShowVisualEditor(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
