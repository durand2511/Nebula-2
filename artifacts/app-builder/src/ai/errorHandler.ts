/**
 * Error Handler — Centralized error handling with fallback logic.
 */

import { log } from "./logger";

export interface HandledError {
  phase: string;
  message: string;
  recoverable: boolean;
  fallback?: string;
  timestamp: number;
}

const errorLog: HandledError[] = [];

/** Handle an error with optional fallback */
export function handleError(phase: string, error: unknown, fallbackAction?: () => void): HandledError {
  const message = error instanceof Error ? error.message : String(error);
  const recoverable = isRecoverable(message);

  const handled: HandledError = {
    phase,
    message,
    recoverable,
    fallback: recoverable ? "Retrying with fallback..." : undefined,
    timestamp: Date.now(),
  };

  errorLog.push(handled);
  log("error", `[${phase}] ${message}`, { recoverable });

  if (recoverable && fallbackAction) {
    try {
      fallbackAction();
      handled.fallback = "Fallback succeeded";
    } catch (fbErr) {
      handled.fallback = `Fallback failed: ${fbErr instanceof Error ? fbErr.message : String(fbErr)}`;
    }
  }

  return handled;
}

/** Determine if an error is recoverable */
function isRecoverable(message: string): boolean {
  const transient = [
    "timeout", "network", "fetch", "503", "429", "rate limit",
    "ECONNRESET", "ETIMEDOUT", "invalid json", "unexpected token",
  ];
  const lower = message.toLowerCase();
  return transient.some((t) => lower.includes(t));
}

/** Wrap an async function with error handling */
export async function safeguard<T>(
  phase: string,
  fn: () => Promise<T>,
  fallbackValue: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleError(phase, error);
    return fallbackValue;
  }
}

/** Get all logged errors */
export function getErrorLog(): HandledError[] {
  return [...errorLog];
}

/** Clear error log */
export function clearErrorLog(): void {
  errorLog.length = 0;
}
