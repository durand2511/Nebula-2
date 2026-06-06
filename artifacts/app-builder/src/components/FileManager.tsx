import { useState, useEffect, useRef } from "react";
import { Upload, Trash2, Copy, X, FileText, Image, File, ExternalLink, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  uploadFile,
  listFiles,
  deleteFile,
  isImage,
  formatFileSize,
  type StorageFile,
} from "@/lib/storage";

interface Props {
  projectId?: string;
  onClose: () => void;
}

const FileManager = ({ projectId, onClose }: Props) => {
  const { user } = useAuth();
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<StorageFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = async () => {
    if (!user) return;
    const result = await listFiles(user.id, projectId);
    setFiles(result);
  };

  useEffect(() => {
    loadFiles();
  }, [user, projectId]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || !user) return;
    setIsUploading(true);

    const results = await Promise.all(
      Array.from(fileList).map((f) => uploadFile(user.id, f, projectId))
    );

    const succeeded = results.filter(Boolean).length;
    const failed = results.length - succeeded;

    if (succeeded > 0) toast.success(`${succeeded} bestand${succeeded > 1 ? "en" : ""} geüpload`);
    if (failed > 0) toast.error(`${failed} bestand${failed > 1 ? "en" : ""} mislukt`);

    setIsUploading(false);
    loadFiles();
  };

  const handleDelete = async (file: StorageFile) => {
    const ok = await deleteFile(file.path);
    if (ok) {
      toast.success("Bestand verwijderd");
      setFiles((prev) => prev.filter((f) => f.path !== file.path));
      if (preview?.path === file.path) setPreview(null);
    } else {
      toast.error("Verwijderen mislukt");
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL gekopieerd!");
    } catch {
      toast.error("Kopiëren mislukt");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  const getIcon = (mimeType: string) => {
    if (isImage(mimeType)) return <Image className="h-4 w-4 text-primary" />;
    if (mimeType === "application/pdf") return <FileText className="h-4 w-4 text-destructive" />;
    return <File className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Bestanden</h2>
            <span className="text-xs text-muted-foreground">({files.length})</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Upload area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
              dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-foreground font-medium">
              {isUploading ? "Uploaden..." : "Sleep bestanden hierheen of klik om te uploaden"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Afbeeldingen, PDF's, HTML, CSS, JS — max 50MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
              accept="image/*,.pdf,.html,.css,.js,.json,.txt"
            />
          </div>

          {/* File list */}
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nog geen bestanden geüpload.</p>
          ) : (
            <div className="space-y-1">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/50 group transition-colors"
                >
                  {/* Thumbnail or icon */}
                  {isImage(file.mimeType) ? (
                    <button
                      onClick={() => setPreview(file)}
                      className="w-10 h-10 rounded-md overflow-hidden bg-muted shrink-0"
                    >
                      <img
                        src={file.publicUrl}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                      {getIcon(file.mimeType)}
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => copyUrl(file.publicUrl)}
                      title="Kopieer URL"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => window.open(file.publicUrl, "_blank")}
                      title="Openen"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(file)}
                      title="Verwijderen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Image preview overlay */}
        {preview && (
          <div
            className="absolute inset-0 bg-black/80 flex items-center justify-center z-10"
            onClick={() => setPreview(null)}
          >
            <img
              src={preview.publicUrl}
              alt={preview.name}
              className="max-w-[90%] max-h-[80%] rounded-lg shadow-2xl object-contain"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default FileManager;
