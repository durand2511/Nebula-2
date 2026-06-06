import { useState, useRef, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { 
  useGetProject, 
  getGetProjectQueryKey,
  useListMessages, 
  getListMessagesQueryKey,
  useSendMessage,
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
  Bot,
  User,
  FolderOpen,
  File as FileIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export function ProjectWorkspace() {
  const [, params] = useRoute("/projects/:id");
  const projectId = Number(params?.id);
  const queryClient = useQueryClient();
  
  const [prompt, setPrompt] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: project, isLoading: isLoadingProject } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) }
  });

  const { data: messages, isLoading: isLoadingMessages } = useListMessages(projectId, {
    query: { enabled: !!projectId, queryKey: getListMessagesQueryKey(projectId) }
  });

  const { data: files, isLoading: isLoadingFiles } = useListFiles(projectId, {
    query: { enabled: !!projectId, queryKey: getListFilesQueryKey(projectId) }
  });

  const sendMessage = useSendMessage();

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Select first file if none selected
  useEffect(() => {
    if (files && files.length > 0 && !selectedFile) {
      setSelectedFile(files[0].path);
    }
  }, [files, selectedFile]);

  const handleSendMessage = () => {
    if (!prompt.trim() || !projectId) return;

    sendMessage.mutate(
      { projectId, data: { content: prompt } },
      {
        onSuccess: () => {
          setPrompt("");
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        }
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const activeFile = files?.find(f => f.path === selectedFile);

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
        <div className="ml-auto flex items-center gap-2">
          {sendMessage.isPending && (
            <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 px-3 py-1.5 rounded-md border border-primary/20">
              <Loader2 className="h-3 w-3 animate-spin" />
              AI is building...
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Chat */}
        <div className="w-[400px] border-r border-border bg-card/30 flex flex-col shrink-0">
          <div className="p-4 border-b border-border/50 flex justify-between items-center bg-card/50">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Buildly Assistant
            </h2>
          </div>
          
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-6 pb-4">
              {isLoadingMessages ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages?.length === 0 ? (
                <div className="text-center p-8 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
                  Describe what you want to build to get started.
                </div>
              ) : (
                messages?.map((msg) => (
                  <div 
                    key={msg.id} 
                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 ${
                      msg.role === 'user' ? 'bg-primary/20 text-primary' : 'bg-secondary text-secondary-foreground border border-border'
                    }`}>
                      {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </div>
                    <div className={`text-sm rounded-lg px-4 py-3 max-w-[85%] ${
                      msg.role === 'user' 
                        ? 'bg-primary/10 border border-primary/20 text-foreground' 
                        : 'bg-secondary/50 border border-border text-foreground/90 leading-relaxed'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              {sendMessage.isPending && (
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-md bg-secondary text-secondary-foreground border border-border flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="text-sm rounded-lg px-4 py-3 bg-secondary/50 border border-border flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-muted-foreground">Thinking...</span>
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
                disabled={sendMessage.isPending}
                data-testid="input-chat-prompt"
              />
              <Button 
                size="icon" 
                className="absolute bottom-3 right-3 h-8 w-8"
                onClick={handleSendMessage}
                disabled={!prompt.trim() || sendMessage.isPending}
                data-testid="button-send-message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-[10px] text-center text-muted-foreground mt-2">
              Press Enter to send, Shift+Enter for new line
            </div>
          </div>
        </div>

        {/* Center/Right Panel: Code & Preview */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          <Tabs defaultValue="code" className="flex-1 flex flex-col">
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
            </div>

            <TabsContent value="code" className="flex-1 flex m-0 overflow-hidden border-none p-0 outline-none">
              {/* File Tree */}
              <div className="w-[250px] border-r border-border bg-card/20 flex flex-col shrink-0">
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
                      <div className="text-xs text-muted-foreground p-2 italic">No files yet</div>
                    ) : (
                      files?.map(file => (
                        <button
                          key={file.id}
                          onClick={() => setSelectedFile(file.path)}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left truncate ${
                            selectedFile === file.path 
                              ? 'bg-primary/10 text-primary font-medium' 
                              : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
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

              {/* Code Viewer */}
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
                    <p>Select a file to view its contents</p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="preview" className="flex-1 flex flex-col m-0 border-none p-0 outline-none bg-card/10">
              <div className="flex-1 flex flex-col items-center justify-center p-8">
                <div className="w-full max-w-4xl bg-card rounded-lg border border-border shadow-2xl overflow-hidden flex flex-col h-full max-h-[800px]">
                  <div className="h-10 border-b border-border bg-secondary flex items-center px-4 gap-2 shrink-0">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                      <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
                    </div>
                    <div className="mx-auto bg-background/50 text-muted-foreground text-xs px-24 py-1 rounded-md border border-border/50 flex items-center gap-2">
                      <MonitorPlay className="w-3 h-3" />
                      localhost:3000
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-center bg-background/50 p-8 text-center border-t border-border/50">
                    <Terminal className="h-16 w-16 text-primary/30 mb-6" />
                    <h3 className="text-xl font-bold mb-2">Live Preview</h3>
                    <p className="text-muted-foreground max-w-md">
                      The application preview environment is booting up. 
                      <br/>
                      <span className="text-primary mt-2 block">{project.description}</span>
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
