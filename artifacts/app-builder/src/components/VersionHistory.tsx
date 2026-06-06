import { useState } from "react";
import { X, History, RotateCcw, Eye, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface Version {
  id: string;
  html: string;
  label: string;
  timestamp: string;
}

interface Props {
  versions: Version[];
  currentHtml: string | null;
  onRevert: (version: Version) => void;
  onPreview: (html: string) => void;
  onClose: () => void;
}

const VersionHistory = ({ versions, currentHtml, onRevert, onPreview, onClose }: Props) => {
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const handlePreview = (v: Version) => {
    setPreviewingId(v.id);
    onPreview(v.html);
  };

  const handleStopPreview = () => {
    setPreviewingId(null);
    if (currentHtml) onPreview(currentHtml);
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Zojuist";
    if (diffMin < 60) return `${diffMin} min geleden`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} uur geleden`;
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Versiegeschiedenis</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
          {versions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-10 w-10 mx-auto opacity-30 mb-2" />
              <p className="text-sm">Nog geen versies opgeslagen</p>
              <p className="text-xs mt-1">Elke keer dat je app wordt gegenereerd, wordt een versie bewaard.</p>
            </div>
          ) : (
            versions.map((v, i) => (
              <div
                key={v.id}
                className={`rounded-xl border p-3 transition-colors ${
                  previewingId === v.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {i === 0 && !previewingId ? "📌 " : ""}
                      {v.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatTime(v.timestamp)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {previewingId === v.id ? (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleStopPreview}>
                        Stop preview
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handlePreview(v)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-primary hover:text-primary"
                      onClick={() => { onRevert(v); onClose(); }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {previewingId && (
          <div className="border-t border-border px-6 py-3">
            <p className="text-xs text-muted-foreground text-center">
              Je bekijkt een preview. Klik <RotateCcw className="h-3 w-3 inline" /> om te herstellen of sluit dit venster.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VersionHistory;
