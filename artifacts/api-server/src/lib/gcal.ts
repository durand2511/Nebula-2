/**
 * Direct Google Calendar coupling (OAuth) for INSTANT sync. The studio connects their Google
 * account once; thereafter every lesson change writes/updates/deletes the matching event via the
 * Calendar API straight away — no waiting for Google to poll the .ics feed.
 *
 * Setup (one-time, by the platform owner): create OAuth credentials in Google Cloud and set
 * GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the environment. The redirect URI is
 * <live-host>/api/gcal/callback.
 */
import { db, projectGcal } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import type { Lesson } from "./calendar.js";

const TZID = "Europe/Amsterdam";
const SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";
const pad = (n: number) => String(n).padStart(2, "0");

export function gcalConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/gcal/callback`;
}

/** Build the Google consent URL. state = "<projectId>.<feedToken>" so the callback can verify. */
export function authUrl(projectId: number, feedToken: string, baseUrl: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(baseUrl),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",            // always return a refresh_token
    include_granted_scopes: "true",
    state: `${projectId}.${feedToken}`,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error_description || json?.error || `Google token ${res.status}`);
  return json;
}

/** Exchange the OAuth code for tokens + persist them (keeps an existing refresh_token if Google omits one). */
export async function exchangeCode(projectId: number, code: string, baseUrl: string): Promise<void> {
  const tok = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: redirectUri(baseUrl),
    grant_type: "authorization_code",
  });
  const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000);
  let email = "";
  try { // id_token is a JWT; the middle segment holds the email claim when present
    if (tok.id_token) email = JSON.parse(Buffer.from(String(tok.id_token).split(".")[1], "base64").toString()).email || "";
  } catch { /* ignore */ }
  const [existing] = await db.select().from(projectGcal).where(eq(projectGcal.projectId, projectId));
  const refreshToken = tok.refresh_token || existing?.refreshToken || "";
  if (existing) {
    await db.update(projectGcal).set({ refreshToken, accessToken: tok.access_token || "", tokenExpiry: expiry, email: email || existing.email }).where(eq(projectGcal.projectId, projectId));
  } else {
    await db.insert(projectGcal).values({ projectId, refreshToken, accessToken: tok.access_token || "", tokenExpiry: expiry, email });
  }
}

/** A valid access token for the project (refreshes if needed), or null if not connected. */
async function getAccessToken(projectId: number): Promise<string | null> {
  const [row] = await db.select().from(projectGcal).where(eq(projectGcal.projectId, projectId));
  if (!row || !row.refreshToken) return null;
  if (row.accessToken && row.tokenExpiry && row.tokenExpiry.getTime() > Date.now() + 60_000) return row.accessToken;
  try {
    const tok = await tokenRequest({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: row.refreshToken,
      grant_type: "refresh_token",
    });
    const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000);
    await db.update(projectGcal).set({ accessToken: tok.access_token || "", tokenExpiry: expiry }).where(eq(projectGcal.projectId, projectId));
    return tok.access_token || null;
  } catch (err) { logger.warn({ err, projectId }, "[gcal] token refresh failed"); return null; }
}

async function calApi(method: string, path: string, accessToken: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = {}; try { json = await res.json(); } catch { /* 204 etc. */ }
  return { ok: res.ok, status: res.status, json };
}

/** Local wall-clock datetime "YYYY-MM-DDTHH:MM:00" (paired with timeZone Europe/Amsterdam). */
function localDT(date: string, time: string, addHours = 0): string {
  const [hh, mm] = (time || "09:00").split(":").map(Number);
  if (!addHours) return `${date}T${pad(hh || 0)}:${pad(mm || 0)}:00`;
  const [y, m, d] = date.split("-").map(Number);
  const dd = new Date(y, m - 1, d, (hh || 0) + addHours, mm || 0);
  return `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}T${pad(dd.getHours())}:${pad(dd.getMinutes())}:00`;
}

function eventBody(l: Lesson): Record<string, unknown> {
  const online = (l.mode === "online" || l.mode === "hybride") && l.onlineLink ? l.onlineLink : "";
  const descParts = [l.teacher ? "Docent: " + l.teacher : "", online ? "Online: " + online : "", l.onlineInfo || ""].filter(Boolean);
  const suffix = l.mode === "online" ? " (online)" : l.mode === "hybride" ? " (hybride)" : "";
  return {
    summary: (l.title || "Les") + suffix,
    description: descParts.join("\n"),
    location: online || undefined,
    start: { dateTime: localDT(l.date, l.time), timeZone: TZID },
    end: { dateTime: l.endTime ? localDT(l.date, l.endTime) : localDT(l.date, l.time, 1), timeZone: TZID },
  };
}

/** Reconcile the project's Google Calendar with the current lessons: insert/update/delete events. */
export async function pushLessons(projectId: number, lessons: Lesson[]): Promise<void> {
  const at = await getAccessToken(projectId);
  if (!at) return;
  const [row] = await db.select().from(projectGcal).where(eq(projectGcal.projectId, projectId));
  if (!row) return;
  const calId = encodeURIComponent(row.calendarId || "primary");
  let map: Record<string, string> = {};
  try { map = JSON.parse(row.eventMap || "{}"); } catch { map = {}; }
  const seen = new Set<string>();
  for (const l of lessons) {
    if (!l.date || !l.time) continue;
    seen.add(String(l.id));
    const body = eventBody(l);
    try {
      const evId = map[l.id];
      if (evId) {
        const r = await calApi("PATCH", `${calId}/events/${encodeURIComponent(evId)}`, at, body);
        if (r.status === 404 || r.status === 410) { const c = await calApi("POST", `${calId}/events`, at, body); if (c.json?.id) map[l.id] = c.json.id; }
      } else {
        const c = await calApi("POST", `${calId}/events`, at, body);
        if (c.json?.id) map[l.id] = c.json.id;
      }
    } catch (err) { logger.warn({ err, projectId, lesson: l.id }, "[gcal] push event failed"); }
  }
  // Remove events for lessons that no longer exist.
  for (const lid of Object.keys(map)) {
    if (!seen.has(lid)) {
      try { await calApi("DELETE", `${calId}/events/${encodeURIComponent(map[lid])}`, at); } catch { /* ignore */ }
      delete map[lid];
    }
  }
  await db.update(projectGcal).set({ eventMap: JSON.stringify(map) }).where(eq(projectGcal.projectId, projectId));
}

export async function gcalStatus(projectId: number): Promise<{ configured: boolean; connected: boolean; email: string }> {
  const [row] = await db.select().from(projectGcal).where(eq(projectGcal.projectId, projectId));
  return { configured: gcalConfigured(), connected: !!row?.refreshToken, email: row?.email || "" };
}

export async function disconnectGcal(projectId: number): Promise<void> {
  const [row] = await db.select().from(projectGcal).where(eq(projectGcal.projectId, projectId));
  if (row?.refreshToken) { try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(row.refreshToken), { method: "POST" }); } catch { /* ignore */ } }
  await db.delete(projectGcal).where(eq(projectGcal.projectId, projectId));
}
