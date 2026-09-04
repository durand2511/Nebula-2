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
import { useLang } from "@/lib/i18n";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type TerminalStatus = "connecting" | "open" | "closed" | "error";

type Props = {
  projectId: number; // 0 = koppel-sessie (login only)
  className?: string;
  onFilesChanged?: (e: { changed: string[]; created: string[]; deleted: string[] }) => void;
  onConnected?: (connected: boolean) => void;
  onStatus?: (s: TerminalStatus) => void;
  onLocked?: (message: string) => void;
};

function wsUrl(projectId: number, cols?: number, rows?: number): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const tok = encodeURIComponent(getToken() || "");
  // Real terminal size travels with the connect so the server spawns the pty at the right width —
  // Claude Code's startup banner is printed once and stays mangled if the size changes afterwards.
  const size = cols && rows ? `&cols=${cols}&rows=${rows}` : "";
  return `${proto}//${window.location.host}/api/claude/terminal?project=${projectId}&token=${tok}${size}`;
}

export type ClaudeTerminalHandle = {
  /** Type text into Claude's prompt (no Enter) — used to prefill a request. */
  send: (text: string) => boolean;
  focus: () => void;
};

export const ClaudeTerminal = forwardRef<ClaudeTerminalHandle, Props>(function ClaudeTerminal(
  { projectId, className, onFilesChanged, onConnected, onStatus, onLocked }: Props,
  ref,
) {
  const { t } = useLang();
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
  const cb = useRef({ onFilesChanged, onConnected, onStatus, onLocked });
  cb.current = { onFilesChanged, onConnected, onStatus, onLocked };

  const setStat = useCallback((s: TerminalStatus) => { statusRef.current = s; setStatus(s); cb.current.onStatus?.(s); }, []);

  // Create the xterm instance once per mount.
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 1500,
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
  const attemptsRef = useRef(0);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    let closedByUs = false;
    let gotExit = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setErrMsg("");
    setStat("connecting");
    term.reset();
    // Only announce the connect on the FIRST attempt. Reconnects (gen>0) happen silently — the server
    // reattaches to the still-running Claude session and replays the scrollback, so the user shouldn't
    // see "opnieuw koppelen"-churn during a task.
    if (gen === 0) term.writeln(`\x1b[2m» ${t("Verbinden met Claude Code…", "Connecting to Claude Code…")}\x1b[0m`);

    // Fit first so the connect URL carries the real terminal size (the panel is laid out by now).
    try { fitRef.current?.fit(); } catch { /* ignore */ }
    const ws = new WebSocket(wsUrl(projectId, term.cols, term.rows));
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
        case "o": attemptsRef.current = 0; term.write(m.d); break;
        case "ping": attemptsRef.current = 0; break; // keepalive heartbeat — proves the tunnel is alive
        case "hello": cb.current.onConnected?.(!!m.connected); break;
        case "status": cb.current.onConnected?.(!!m.connected); break;
        case "files": cb.current.onFilesChanged?.({ changed: m.changed || [], created: m.created || [], deleted: m.deleted || [] }); break;
        case "exit": gotExit = true; term.writeln(`\r\n\x1b[2m» ${t(`Claude Code is gestopt (code ${m.code}). Klik op "Opnieuw starten" om verder te gaan.`, `Claude Code stopped (code ${m.code}). Click "Restart" to continue.`)}\x1b[0m`); setStat("closed"); break;
        case "locked": cb.current.onLocked?.(String(m.message || "")); setErrMsg(String(m.message || t("Abonnement vereist.", "Subscription required."))); setStat("error"); break;
        case "err": setErrMsg(String(m.message || "Onbekende fout")); setStat("error"); break;
      }
    };
    ws.onerror = () => { if (!closedByUs) setStat("error"); };
    ws.onclose = (ev) => {
      if (closedByUs) return;
      if (ev.code === 1008 || ev.code === 4401) { setErrMsg(t("Niet ingelogd.", "Not logged in.")); setStat("error"); return; }
      if (ev.code === 4402) return; // locked → handled via the "locked" message
      // The session keeps running server-side; a dropped tunnel (proxy hiccup, sleeping laptop,
      // deploy) should NOT dump the user on a restart button and "lose" their progress. Reconnect
      // automatically — the server replays the scrollback and forces a clean repaint. Only a real
      // Claude exit (the "exit" message) is left to the manual restart button.
      if (!gotExit && statusRef.current !== "error" && attemptsRef.current < 8) {
        attemptsRef.current += 1;
        const delay = Math.min(8000, 500 * 2 ** attemptsRef.current);
        setStat("connecting");
        // Silent reconnect — no "opnieuw koppelen" message; the session keeps running server-side.
        retryTimer = setTimeout(() => setGen((g) => g + 1), delay);
        return;
      }
      if (statusRef.current !== "error") setStat("closed");
    };

    const sub = term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "i", d })); });

    // Client-side keepalive: a harmless no-op message ({t:"ka"}, ignored by the server) every 12s keeps
    // traffic flowing so a proxy doesn't idle-close the tunnel. Deliberately NOT a resize — a resize
    // carrying a stale/zero size (during a reflow or reconnect) could reach the PTY at a bad size and
    // crash Claude Code, which then respawned at the bypass-permissions startup screen.
    const clientPing = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ka" })); }, 12000);

    return () => { closedByUs = true; clearInterval(clientPing); if (retryTimer) clearTimeout(retryTimer); sub.dispose(); try { ws.close(); } catch { /* ignore */ } if (wsRef.current === ws) wsRef.current = null; };
  }, [projectId, gen, setStat]);

  return (
    <div className={`relative flex flex-col min-h-0 overflow-hidden ${className ?? ""}`}>
      {/* The xterm host is ABSOLUTELY positioned inside a bounded box, so its size always equals that
          box (from the flex layout) and never grows with content. Without this, FitAddon on Windows
          (Chrome/Edge) measured a content-driven height and blew the terminal up to a giant scroll. */}
      <div className="flex-1 min-h-0 relative">
        <div ref={hostRef} className="absolute inset-0 bg-[#0f0e14] p-2 rounded-lg overflow-hidden" data-testid="claude-terminal" />
      </div>
      {status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0f0e14]/70 rounded-lg pointer-events-none">
          <Loader2 className="h-5 w-5 animate-spin text-white/70" />
        </div>
      )}
      {(status === "closed" || status === "error") && (
        <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-2">
          {errMsg && <div className="text-xs text-red-300 bg-black/60 rounded px-2 py-1">{errMsg}</div>}
          <Button size="sm" onClick={() => setGen((g) => g + 1)} className="gap-2" data-testid="button-terminal-restart">
            <RefreshCw className="h-3.5 w-3.5" /> {t("Opnieuw starten", "Restart")}
          </Button>
        </div>
      )}
    </div>
  );
});
