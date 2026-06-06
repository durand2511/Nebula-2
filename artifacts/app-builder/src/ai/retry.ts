/**
 * Retry System — Retries failed AI calls with exponential backoff.
 * Max 3 retries by default.
 */

import { log } from "./logger";

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 8000,
};

/** Retry an async function with exponential backoff */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY, ...config };

  let lastError: unknown;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 0) {
        log("info", `[Retry] ${label} succeeded on attempt ${attempt + 1}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      if (attempt >= cfg.maxRetries) {
        log("error", `[Retry] ${label} failed after ${cfg.maxRetries + 1} attempts: ${message}`);
        break;
      }

      if (cfg.shouldRetry && !cfg.shouldRetry(error, attempt)) {
        log("warn", `[Retry] ${label} not retryable: ${message}`);
        break;
      }

      const delay = Math.min(cfg.baseDelay * Math.pow(2, attempt), cfg.maxDelay);
      log("warn", `[Retry] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms: ${message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/** Retry specifically for AI JSON calls — retries on invalid JSON */
export async function retryAICall<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  return withRetry(fn, label, {
    maxRetries: 3,
    shouldRetry: (error) => {
      const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
      return msg.includes("json") || msg.includes("parse") || msg.includes("unexpected")
        || msg.includes("timeout") || msg.includes("network") || msg.includes("fetch")
        || msg.includes("503") || msg.includes("429");
    },
  });
}
