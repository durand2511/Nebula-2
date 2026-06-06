import type { ChatMessage } from "@/lib/aiStream";
import { User, Loader2, CheckCircle2 } from "lucide-react";
import { useEffect, useState, useRef } from "react";

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  loadingText?: string;
}

const AnimatedDots = () => {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const timer = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 400);
    return () => clearInterval(timer);
  }, []);
  return <span className="inline-block w-4">{dots}</span>;
};

const AssistantMessage = ({ msg, isBusy }: { msg: ChatMessage; isBusy?: boolean }) => {
  return (
    <div className="space-y-2 max-w-[90%]">
      {msg.title && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            {isBusy ? (
              <Loader2 className="h-4 w-4 text-primary shrink-0 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            )}
            <span className="text-sm font-medium text-foreground">{msg.title}</span>
          </div>
        </div>
      )}
      <div className="px-1">
        <div className="whitespace-pre-wrap leading-relaxed text-sm text-foreground">{msg.content}</div>
        {msg.details && (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground mt-1">{msg.details}</div>
        )}
      </div>
    </div>
  );
};

const ChatMessages = ({ messages, isLoading, loadingText }: Props) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change or loading state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, loadingText]);

  const lastAssistantIdx = isLoading
    ? messages.reduce((last, msg, i) => (msg.role === "assistant" ? i : last), -1)
    : -1;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      {messages.map((msg, i) => (
        <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : ""}`}>
          {msg.role === "assistant" ? (
            <AssistantMessage msg={msg} isBusy={i === lastAssistantIdx} />
          ) : (
            <>
              <div className="flex flex-col items-end gap-1.5 max-w-[85%]">
                {msg.images && msg.images.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {msg.images.map((src, j) => (
                      <img key={j} src={src} alt="Upload" className="h-16 w-16 rounded-lg object-cover border border-border" />
                    ))}
                  </div>
                )}
                <div className="rounded-xl px-3.5 py-2 text-sm bg-secondary text-secondary-foreground">
                  {msg.content}
                </div>
              </div>
              <div className="w-6 h-6 rounded-md bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-3.5 w-3.5 text-secondary-foreground" />
              </div>
            </>
          )}
        </div>
      ))}

      {isLoading && (
        <div className="flex gap-2.5 animate-in fade-in duration-300">
          <div className="max-w-[85%] px-1">
            <span className="text-sm text-muted-foreground">{loadingText || "Even nadenken"}</span>
            <AnimatedDots />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

export default ChatMessages;
