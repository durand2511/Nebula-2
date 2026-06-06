/**
 * JSON Validator — Validates and sanitizes AI output to ensure valid JSON.
 */

export interface ValidationResult {
  valid: boolean;
  data: unknown | null;
  error: string | null;
  repaired: boolean;
}

/** Try to parse and validate JSON, with auto-repair for common AI mistakes */
export function validateJSON(input: string): ValidationResult {
  if (!input || typeof input !== "string") {
    return { valid: false, data: null, error: "Empty or non-string input", repaired: false };
  }

  // Try direct parse first
  try {
    const data = JSON.parse(input);
    return { valid: true, data, error: null, repaired: false };
  } catch {
    // Try repair
  }

  // Attempt repairs
  let repaired = input.trim();

  // Remove markdown code fences
  repaired = repaired.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  // Remove leading text before first { or [
  const firstBrace = repaired.indexOf("{");
  const firstBracket = repaired.indexOf("[");
  const start = firstBrace >= 0 && firstBracket >= 0
    ? Math.min(firstBrace, firstBracket)
    : Math.max(firstBrace, firstBracket);

  if (start > 0) repaired = repaired.slice(start);

  // Remove trailing text after last } or ]
  const lastBrace = repaired.lastIndexOf("}");
  const lastBracket = repaired.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  if (end > 0 && end < repaired.length - 1) repaired = repaired.slice(0, end + 1);

  // Fix trailing commas
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");

  // Fix single quotes to double quotes (naive but common)
  repaired = repaired.replace(/'/g, '"');

  try {
    const data = JSON.parse(repaired);
    return { valid: true, data, error: null, repaired: true };
  } catch (e) {
    return {
      valid: false,
      data: null,
      error: e instanceof Error ? e.message : "Invalid JSON",
      repaired: false,
    };
  }
}

/** Extract JSON from mixed text (AI often wraps JSON in explanation) */
export function extractJSON<T = unknown>(text: string): T | null {
  const result = validateJSON(text);
  return result.valid ? (result.data as T) : null;
}

/** Validate that parsed JSON matches expected shape */
export function validateShape(data: unknown, requiredKeys: string[]): { valid: boolean; missing: string[] } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, missing: requiredKeys };
  }
  const obj = data as Record<string, unknown>;
  const missing = requiredKeys.filter((key) => !(key in obj));
  return { valid: missing.length === 0, missing };
}
