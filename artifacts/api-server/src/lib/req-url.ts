/**
 * Derive the PUBLIC base URL (scheme + host) a request came in on, so absolute links we hand back
 * (calendar .ics feeds, Stripe onboarding return URLs, …) point at the real live site instead of a
 * hardcoded localhost. Works behind Render's proxy via X-Forwarded-Proto / X-Forwarded-Host.
 *
 * Priority: explicit PUBLIC_API_URL env (canonical override) → the request's forwarded host → the
 * Host header → localhost (last-resort dev fallback).
 */
import type { Request } from "express";

export function reqBaseUrl(req: Request): string {
  const env = process.env.PUBLIC_API_URL || process.env.PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  const h = req.headers;
  const fwdHost = typeof h["x-forwarded-host"] === "string" ? (h["x-forwarded-host"] as string).split(",")[0].trim() : "";
  const host = fwdHost || (typeof h["host"] === "string" ? h["host"] : "");
  if (host) {
    const fwdProto = typeof h["x-forwarded-proto"] === "string" ? (h["x-forwarded-proto"] as string).split(",")[0].trim() : "";
    const proto = fwdProto || (/^localhost|^127\.|^0\.0\.0\.0/.test(host) ? "http" : "https");
    return `${proto}://${host}`;
  }
  return "http://localhost:5001";
}
