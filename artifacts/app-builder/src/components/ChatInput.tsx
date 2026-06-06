import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { ArrowUp, Square, Paperclip, X, FileText, Mic, MicOff, Lightbulb } from "lucide-react";

interface Attachment {
  file: File;
  preview?: string;
}

export interface PlanStep {
  title: string;
  description: string;
}

export interface PlanData {
  steps: PlanStep[];
  summary: string;
}

interface Props {
  onSend: (message: string, attachments?: File[]) => void;
  onRequestPlan: (message: string) => void;
  onCancel?: () => void;
  isLoading: boolean;
  placeholder?: string;
  plan?: PlanData | null;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
}

const ChatInput = ({ onSend, onRequestPlan, onCancel, isLoading, placeholder, plan, onApprovePlan, onRejectPlan }: Props) => {
  const [input, setInput] = useState("");
  const [queued, setQueued] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [planActive, setPlanActive] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;
    el.style.height = "0px";
    const minH = 36;
    const h = Math.max(Math.min(el.scrollHeight, 400), minH);
    el.style.height = `${h}px`;
    wrap.style.height = `${h + 48}px`;
  }, [input]);

  useEffect(() => {
    if (!isLoading && queued) {
      onSend(queued);
      setQueued(null);
    }
  }, [isLoading, queued, onSend]);

  const handleSubmit = () => {
    if (!input.trim() && attachments.length === 0) return;
    if (isLoading) {
      setQueued(input.trim());
      setInput("");
      return;
    }
    const files = attachments.map((a) => a.file);
    onSend(input.trim(), files.length > 0 ? files : undefined);
    setInput("");
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitWithPlan();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length > 0) {
      e.preventDefault();
      const newAttachments: Attachment[] = imageItems
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null)
        .map((file) => ({
          file,
          preview: URL.createObjectURL(file),
        }));
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
    // For text paste, force a re-render by updating input in the next tick
    if (!imageItems.length) {
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          setInput(textareaRef.current.value);
        }
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAttachments: Attachment[] = files.map((file) => {
      const attachment: Attachment = { file };
      if (file.type.startsWith("image/")) {
        attachment.preview = URL.createObjectURL(file);
      }
      return attachment;
    });
    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handlePlan = () => {
    if (isLoading) return;
    if (planActive) {
      // Toggle off
      setPlanActive(false);
      return;
    }
    setPlanActive(true);
  };

  const handleSubmitWithPlan = () => {
    if (!input.trim() && attachments.length === 0) return;
    if (planActive && input.trim()) {
      setPlanActive(false);
      onRequestPlan(input.trim());
      setInput("");
      return;
    }
    handleSubmit();
  };

  const toggleDictation = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Spraakherkenning wordt niet ondersteund in deze browser.");
      return;
    }

    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "nl-NL";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
    setIsRecording(true);
  }, [isRecording]);

  return (
    <div className={`p-4 flex flex-col items-center transition-transform duration-300 ease-out ${isFocused ? '-translate-y-3' : 'translate-y-0'}`}>
      {queued && (
        <div className="text-xs text-muted-foreground mb-2">
          Bericht in wachtrij: "{queued.slice(0, 40)}{queued.length > 40 ? "…" : ""}"
        </div>
      )}

      {/* Plan approval card */}
      {plan && (
        <div className="w-full max-w-3xl mb-3 rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Lightbulb className="h-4 w-4 text-primary" />
            Plan
          </div>
          <p className="text-sm text-muted-foreground">{plan.summary}</p>
          <div className="space-y-2">
            {plan.steps.map((step, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="text-muted-foreground shrink-0 font-medium">{i + 1}.</span>
                <div>
                  <span className="font-medium text-foreground">{step.title}</span>
                  <p className="text-muted-foreground text-xs mt-0.5">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onApprovePlan}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Goedkeuren
            </button>
            <button
              onClick={onRejectPlan}
              className="px-4 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Afwijzen
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-3xl space-y-2">
        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="flex gap-3 flex-wrap px-1">
            {attachments.map((att, i) => (
              <div key={i} className="relative group">
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  {att.preview ? (
                    <img src={att.preview} alt={att.file.name} className="h-16 w-16 object-cover" />
                  ) : (
                    <div className="h-16 w-16 flex flex-col items-center justify-center gap-1 px-1">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                        {att.file.name.slice(0, 12)}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input bar with all actions inside */}
        <div ref={wrapRef} className="flex flex-col rounded-2xl border border-border bg-card px-4 py-3 gap-2 overflow-hidden transition-[height] duration-200 ease-out">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder || "Describe what you want to build..."}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-foreground focus:outline-none placeholder:text-muted-foreground overflow-y-auto transition-[height] duration-300 ease-out"
            style={{ maxHeight: "400px" }}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <Paperclip className="h-3.5 w-3.5" />
                <span>Bijlage</span>
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
              
              <button
                onClick={handlePlan}
                disabled={isLoading}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors disabled:opacity-30 ${
                  planActive
                    ? "text-primary-foreground bg-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <Lightbulb className="h-3.5 w-3.5" />
                <span>Plan</span>
              </button>

              <button
                onClick={toggleDictation}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
                  isRecording
                    ? "text-destructive bg-destructive/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {isRecording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                <span>{isRecording ? "Stop" : "Dicteer"}</span>
              </button>
            </div>

            <button
              onClick={isLoading ? onCancel : handleSubmitWithPlan}
              disabled={!isLoading && !input.trim() && attachments.length === 0}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all hover:opacity-80 disabled:opacity-30 ${
                isLoading
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-foreground text-background"
              }`}
            >
              {isLoading ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
