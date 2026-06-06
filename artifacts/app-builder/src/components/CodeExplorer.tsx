/**
 * CodeExplorer — File tree + tabbed code view, similar to an IDE.
 * Splits the generated HTML into multiple virtual files for a clean overview.
 */

import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, X, Copy } from "lucide-react";
import { toast } from "sonner";
import type { AppArchitecture } from "@/ai/architecture";
import { splitHtmlToFiles, type VirtualFile } from "@/ai/fileSplitter";

interface CodeExplorerProps {
  html: string | null;
  architecture: AppArchitecture | null;
}

// ── Syntax color helpers ──

function getLanguageForFile(name: string): string {
  if (name.endsWith(".css")) return "css";
  if (name.endsWith(".js")) return "javascript";
  if (name.endsWith(".html")) return "html";
  return "text";
}

// ── Tree node component ──

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: VirtualFile;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: VirtualFile) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = node.type === "folder";
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <button
        onClick={() => {
          if (isFolder) setExpanded(!expanded);
          else onSelect(node);
        }}
        className={`w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-secondary/80 transition-colors rounded-sm ${
          isSelected ? "bg-secondary text-foreground" : "text-muted-foreground"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isFolder ? (
          <>
            {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            {expanded ? <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" /> : <Folder className="h-3.5 w-3.5 text-primary shrink-0" />}
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isFolder && expanded && node.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// ── Main component ──

const CodeExplorer = ({ html, architecture }: CodeExplorerProps) => {
  const fileTree = useMemo(
    () => (html ? splitHtmlToFiles(html, architecture) : []),
    [html, architecture],
  );

  const [openTabs, setOpenTabs] = useState<VirtualFile[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const handleSelectFile = (node: VirtualFile) => {
    if (!openTabs.find((t) => t.path === node.path)) {
      setOpenTabs((prev) => [...prev, node]);
    }
    setActiveTab(node.path);
  };

  const handleCloseTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs((prev) => {
      const updated = prev.filter((t) => t.path !== path);
      if (activeTab === path) {
        setActiveTab(updated.length > 0 ? updated[updated.length - 1].path : null);
      }
      return updated;
    });
  };

  const activeFile = openTabs.find((t) => t.path === activeTab);

  const handleCopy = () => {
    if (activeFile?.content) {
      navigator.clipboard.writeText(activeFile.content);
      toast.success("Code gekopieerd!");
    }
  };

  // Count total files
  const countFiles = (nodes: VirtualFile[]): number => {
    return nodes.reduce((acc, n) => {
      if (n.type === "folder" && n.children) return acc + countFiles(n.children);
      return acc + 1;
    }, 0);
  };

  if (fileTree.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Geen bestanden beschikbaar
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* File tree sidebar */}
      <div className="w-52 border-r border-border bg-card shrink-0 overflow-y-auto">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>Bestanden</span>
          <span className="text-primary">{countFiles(fileTree)}</span>
        </div>
        {fileTree.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={activeTab}
            onSelect={handleSelectFile}
          />
        ))}
      </div>

      {/* Code area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        {openTabs.length > 0 && (
          <div className="flex items-center border-b border-border bg-card overflow-x-auto shrink-0">
            {openTabs.map((tab) => (
              <button
                key={tab.path}
                onClick={() => setActiveTab(tab.path)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border shrink-0 transition-colors ${
                  activeTab === tab.path
                    ? "bg-background text-foreground border-b-2 border-b-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <FileText className="h-3 w-3" />
                <span>{tab.name}</span>
                <button
                  onClick={(e) => handleCloseTab(tab.path, e)}
                  className="ml-1 hover:bg-secondary rounded p-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </button>
            ))}
            {activeFile && (
              <button
                onClick={handleCopy}
                className="ml-auto mr-2 flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Copy className="h-3 w-3" />
                Kopieer
              </button>
            )}
          </div>
        )}

        {/* Code content */}
        {activeFile ? (
          <div className="flex-1 overflow-auto bg-card/30">
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-border/50 bg-card/50">
              <span className="text-[10px] text-muted-foreground font-mono">{activeFile.path}</span>
              <span className="text-[10px] text-muted-foreground uppercase">{activeFile.language || getLanguageForFile(activeFile.name)}</span>
            </div>
            <pre className="p-4 text-[11px] font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
              {activeFile.content}
            </pre>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
            <FileText className="h-8 w-8 opacity-20" />
            <p className="text-xs">Klik op een bestand om de code te bekijken</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CodeExplorer;
