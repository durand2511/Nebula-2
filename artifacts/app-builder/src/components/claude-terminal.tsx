/**
 * ClaudeTerminal — xterm.js front-end for the Claude Code pty on the server.
 *
 * Connects to /api/claude/terminal (WebSocket, Bearer token as query param), streams keystrokes and
 * output, follows the container size, and surfaces the two events the rest of the app cares about:
 *   • onFilesChanged  — Claude saved files → refresh preview + file list
 *   • onConnected     — the user's Claude login was detected → "gekoppeld"
 */
import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getToken } from "@/lib/session";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type TerminalStatus = "connecting" | "open" | "closed" | "error";

type Props = {
  projectId: number; // 0 = koppel-sessie (login only)
  className?: string;
  onFilesChanged?: (e: { changed: string[]; created: string[]; deleted: string[] }) => void;
  onConnected?: (connected: boolean) => void;
  onStatus?: (s: TerminalStatus) => void;
};

function wsUrl(projectId: number): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const tok = encodeURIComponent(getToken() || "");
  return `${proto}//${window.location.host}/api/claude/terminal?project=${projectId}&token=${tok}`;
}

export type ClaudeTerminalHandle = {
  /** Type text into Claude's prompt (no Enter) — used to prefill a request. */
  send: (text: string) => boolean;
  focus: () => void;
};

export const ClaudeTerminal = forwardRef<ClaudeTerminalHandle, Props>(function ClaudeTerminal(
  { projectId, className, onFilesChanged, onConnected, onStatus }: Props,
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useImperativeHandle(ref, () => ({
    send: (text: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ t: "i", d: text })); termRef.current?.focus(); return true; }
      return false;
    },
    focus: () => termRef.current?.focus(),
  }), []);
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const statusRef = useRef<TerminalStatus>("connecting");
  const [errMsg, setErrMsg] = useState<string>("");
  const [gen, setGen] = useState(0); // bump to force a fresh connection ("Opnieuw starten")

  // Keep latest callbacks without re-subscribing the socket.
  const cb = useRef({ onFilesChanged, onConnected, onStatus });
  cb.current = { onFilesChanged, onConnected, onStatus };

  const setStat = useCallback((s: TerminalStatus) => { statusRef.current = s; setStatus(s); cb.current.onStatus?.(s); }, []);

  // Create the xterm instance once per mount.
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: "#0f0e14", foreground: "#e8e6f0", cursor: "#e8e6f0", selectionBackground: "#3b3654",
        black: "#1a1825", red: "#ff7b72", green: "#7ee787", yellow: "#f2cc60", blue: "#79c0ff", magenta: "#d2a8ff", cyan: "#56d4dd", white: "#e8e6f0",
        brightBlack: "#6e6a86", brightRed: "#ffa198", brightGreen: "#a5f3b4", brightYellow: "#f8e3a1", brightBlue: "#a5d6ff", brightMagenta: "#e2c5ff", brightCyan: "#a1e8ec", brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    try { fit.fit(); } catch { /* not laid out yet */ }
    // fit again after the browser has actually laid the element out (first fit can be pre-layout)
    const t0 = setTimeout(() => { try { fit.fit(); } catch { /* ignore */ } }, 120);

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* ignore */ }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "r", cols: term.cols, rows: term.rows }));
    });
    ro.observe(hostRef.current);

    return () => { clearTimeout(t0); ro.disconnect(); term.dispose(); termRef.current = null; fitRef.current = null; };
  }, []);

  // (Re)connect the socket.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    let closedByUs = false;
    setErrMsg("");
    setStat("connecting");
    term.reset();
    term.writeln("\x1b[2m» Verbinden met Claude Code…\x1b[0m");

    const ws = new WebSocket(wsUrl(projectId));
    wsRef.current = ws;

    ws.onopen = () => {
      setStat("open");
      try { fitRef.current?.fit(); } catch { /* ignore */ }
      ws.send(JSON.stringify({ t: "r", cols: term.cols, rows: term.rows }));
      term.focus();
    };
    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      switch (m.t) {
        case "o": term.write(m.d); break;
        case "hello": cb.current.onConnected?.(!!m.connected); break;
        case "status": cb.current.onConnected?.(!!m.connected); break;
        case "files": cb.current.onFilesChanged?.({ changed: m.changed || [], created: m.created || [], deleted: m.deleted || [] }); break;
        case "exit": term.writeln(`\r\n\x1b[2m» Claude Code is gestopt (code ${m.code}). Klik op "Opnieuw starten" om verder te gaan.\x1b[0m`); setStat("closed"); break;
        case "err": setErrMsg(String(m.message || "Onbekende fout")); setStat("error"); break;
      }
    };
    ws.onerror = () => { if (!closedByUs) setStat("error"); };
    ws.onclose = (ev) => {
      if (closedByUs) return;
      if (ev.code === 1008 || ev.code === 4401) { setErrMsg("Niet ingelogd."); setStat("error"); return; }
      if (statusRef.current !== "error") setStat("closed");
    };

    const sub = term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "i", d })); });

    return () => { closedByUs = true; sub.dispose(); try { ws.close(); } catch { /* ignore */ } if (wsRef.current === ws) wsRef.current = null; };
  }, [projectId, gen, setStat]);

  return (
    <div className={`relative flex flex-col min-h-0 ${className ?? ""}`}>
      <div ref={hostRef} className="flex-1 min-h-0 bg-[#0f0e14] p-2 rounded-lg overflow-hidden" data-testid="claude-terminal" />
      {status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0f0e14]/70 rounded-lg pointer-events-none">
          <Loader2 className="h-5 w-5 animate-spin text-white/70" />
        </div>
      )}
      {(status === "closed" || status === "error") && (
        <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-2">
          {errMsg && <div className="text-xs text-red-300 bg-black/60 rounded px-2 py-1">{errMsg}</div>}
          <Button size="sm" onClick={() => setGen((g) => g + 1)} className="gap-2" data-testid="button-terminal-restart">
            <RefreshCw className="h-3.5 w-3.5" /> Opnieuw starten
          </Button>
        </div>
      )}
    </div>
  );
});
