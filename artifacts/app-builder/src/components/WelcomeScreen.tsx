import { useState, useRef, useEffect } from "react";
import { ArrowUp, Sparkles } from "lucide-react";

interface Props {
  onSend: (message: string) => void;
}

const suggestions = [
  "A booking app for my fitness studio",
  "Portfolio site for a photographer",
  "Restaurant landing page with online menu",
  "SaaS dashboard for project management",
];

const WelcomeScreen = ({ onSend }: Props) => {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 400) + "px";
    }
  }, [input]);

  const handleSubmit = () => {
    if (!input.trim()) return;
    onSend(input.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* Gradient background */}
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background: "radial-gradient(ellipse at 50% 40%, hsl(260 80% 25%) 0%, hsl(300 50% 20%) 35%, hsl(330 60% 18%) 55%, hsl(220 15% 8%) 80%)",
        }}
      />
      {/* Extra glow */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 30% 50%, hsl(260 90% 35% / 0.4) 0%, transparent 50%), radial-gradient(circle at 70% 40%, hsl(330 80% 35% / 0.3) 0%, transparent 50%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8 px-4 w-full max-w-2xl">
        {/* Badge */}
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-card/60 backdrop-blur border border-border/50 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          <span>AI-Powered App Builder</span>
        </div>

        {/* Heading */}
        <h1 className="text-4xl md:text-5xl font-bold text-center leading-tight">
          Let's build something
        </h1>

        {/* Input box */}
        <div className={`w-full rounded-2xl bg-card/80 backdrop-blur-xl border border-border/50 p-4 shadow-2xl transition-transform duration-300 ease-out ${isFocused ? '-translate-y-3' : 'translate-y-0'}`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Describe the app you want to build..."
            rows={2}
            className="w-full resize-none bg-transparent text-foreground text-sm placeholder:text-muted-foreground focus:outline-none overflow-y-auto"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-muted-foreground">Press Enter to generate</span>
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Suggestions */}
        <div className="flex flex-wrap gap-2 justify-center">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSend(s)}
              className="text-xs px-3.5 py-2 rounded-full border border-border/50 bg-card/40 backdrop-blur text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
