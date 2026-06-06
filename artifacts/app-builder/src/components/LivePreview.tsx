import { Button } from "@/components/ui/button";
import { ExternalLink, Smartphone, Monitor, FileDown, Loader2, Code2, Eye } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import CodeExplorer from "@/components/CodeExplorer";
import type { AppArchitecture } from "@/ai/architecture";

interface Props {
  html: string | null;
  isStreaming?: boolean;
  architecture?: AppArchitecture | null;
}

const LivePreview = ({ html, isStreaming, architecture }: Props) => {
  const [isMobile, setIsMobile] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (showCode && isStreaming && codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [html, showCode, isStreaming]);

  const handleDownloadHtml = () => {
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-app.html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("HTML bestand gedownload!");
  };

  const handleOpen = () => {
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  if (!html) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center text-muted-foreground space-y-2">
          <Monitor className="h-12 w-12 mx-auto opacity-30" />
          <p className="text-sm font-medium">Live Preview</p>
          <p className="text-xs">Je gegenereerde app verschijnt hier</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-muted/30">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-destructive/50" />
          <div className="w-3 h-3 rounded-full bg-accent-foreground/20" />
          <div className="w-3 h-3 rounded-full bg-accent-foreground/15" />

          <div className="ml-3 flex items-center bg-secondary rounded-lg p-0.5">
            <button
              onClick={() => setShowCode(false)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                !showCode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="h-3 w-3" />
              Preview
            </button>
            <button
              onClick={() => setShowCode(true)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                showCode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Code2 className="h-3 w-3" />
              Code
            </button>
          </div>

          {isStreaming && (
            <div className="flex items-center gap-1.5 ml-2 text-xs text-primary animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Aan het opbouwen...</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!showCode && (
            <>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsMobile(false)}>
                <Monitor className={`h-3.5 w-3.5 ${!isMobile ? "text-foreground" : "text-muted-foreground"}`} />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsMobile(true)}>
                <Smartphone className={`h-3.5 w-3.5 ${isMobile ? "text-foreground" : "text-muted-foreground"}`} />
              </Button>
              <div className="w-px h-4 bg-border mx-1" />
            </>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleOpen}>
            <ExternalLink className="h-3 w-3 mr-1" />
            Open
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleDownloadHtml}>
            <FileDown className="h-3 w-3 mr-1" />
            Download
          </Button>
        </div>
      </div>

      {showCode ? (
        <CodeExplorer html={html} architecture={architecture || null} />
      ) : (
        <div className="flex-1 flex items-start justify-center p-4 overflow-auto">
          <iframe
            srcDoc={html}
            className={`bg-card border border-border rounded-lg shadow-sm transition-all duration-300 h-full ${
              isMobile ? "w-[375px]" : "w-full"
            }`}
            title="Live Preview"
            sandbox="allow-scripts"
          />
        </div>
      )}
    </div>
  );
};

export default LivePreview;
