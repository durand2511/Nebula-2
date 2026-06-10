import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import { formatFileContent, langFromPath } from "@/lib/format-code";

// Above this size we skip syntax highlighting (keeps the DOM responsive).
const HIGHLIGHT_MAX = 600_000;

type ViewerState = {
  loading: boolean;
  code: string;
  highlighted: string | null;
};

export function CodeViewer({ path, content }: { path: string; content: string }) {
  const [state, setState] = useState<ViewerState>({
    loading: true,
    code: content,
    highlighted: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, code: content, highlighted: null });

    (async () => {
      const { hljsLang } = langFromPath(path);

      const code = await formatFileContent(path, content);

      let highlighted: string | null = null;
      if (hljsLang && code.length <= HIGHLIGHT_MAX) {
        try {
          highlighted = hljs.highlight(code, { language: hljsLang }).value;
        } catch {
          highlighted = null;
        }
      }

      if (!cancelled) setState({ loading: false, code, highlighted });
    })();

    return () => {
      cancelled = true;
    };
  }, [path, content]);

  if (state.loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-xs font-mono">Formatting…</span>
      </div>
    );
  }

  const lineCount = state.code.length === 0 ? 0 : state.code.split("\n").length;
  const gutter = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");

  return (
    <div className="flex min-w-max text-[13px] leading-[1.6] font-mono">
      <div
        aria-hidden
        className="select-none text-right text-gray-600 px-4 py-4 shrink-0 border-r border-white/5 bg-[#0d1117] sticky left-0 whitespace-pre"
      >
        {gutter}
      </div>
      <pre className="text-gray-300 px-4 py-4 m-0 whitespace-pre">
        {state.highlighted !== null ? (
          <code dangerouslySetInnerHTML={{ __html: state.highlighted }} />
        ) : (
          <code>{state.code}</code>
        )}
      </pre>
    </div>
  );
}
