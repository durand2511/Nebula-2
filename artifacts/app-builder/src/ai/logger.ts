/**
 * Logger — Logs all agent steps with timestamps. Debug mode support.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: number;
}

let debugMode = false;
const logs: LogEntry[] = [];
const MAX_LOGS = 500;

/** Enable/disable debug mode */
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

/** Check if debug mode is on */
export function isDebugMode(): boolean {
  return debugMode;
}

/** Log a message */
export function log(level: LogLevel, message: string, data?: unknown): void {
  const entry: LogEntry = { level, message, data, timestamp: Date.now() };

  if (logs.length >= MAX_LOGS) logs.shift();
  logs.push(entry);

  // Console output
  const prefix = `[Mellow ${level.toUpperCase()}]`;
  switch (level) {
    case "debug":
      if (debugMode) console.debug(prefix, message, data ?? "");
      break;
    case "info":
      console.info(prefix, message, data ?? "");
      break;
    case "warn":
      console.warn(prefix, message, data ?? "");
      break;
    case "error":
      console.error(prefix, message, data ?? "");
      break;
  }
}

/** Get all logs */
export function getLogs(level?: LogLevel): LogEntry[] {
  if (level) return logs.filter((l) => l.level === level);
  return [...logs];
}

/** Clear logs */
export function clearLogs(): void {
  logs.length = 0;
}

/** Log a phase transition */
export function logPhase(phase: string, detail?: string): void {
  log("info", `Phase → ${phase}${detail ? `: ${detail}` : ""}`);
}
