/**
 * iCalendar (.ics) feed: the booking app syncs its lessons here; the studio subscribes to the
 * token-protected .ics URL in their own calendar (Google/Outlook/Apple). Subscribed calendars
 * re-fetch periodically, so newly added lessons show up automatically. No per-provider OAuth.
 */
import { db, projectCalendar } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

export type Lesson = { id: string; title: string; date: string; time: string; mode?: string; onlineLink?: string; onlineInfo?: string; teacher?: string };

// Base URL for the .ics feed. Prefer the live host the request came in on (passed by the route),
// then PUBLIC_API_URL, then a dev fallback — so studios never get a localhost subscription link.
const apiBase = (baseUrl?: string) => (baseUrl || process.env.PUBLIC_API_URL || "http://localhost:5001").replace(/\/+$/, "");
const feedUrl = (projectId: number, token: string, baseUrl?: string) => `${apiBase(baseUrl)}/api/projects/${projectId}/calendar/${token}.ics`;

/** Get-or-create the calendar row + feed token. */
export async function ensureCalendar(projectId: number, baseUrl?: string): Promise<{ token: string; url: string }> {
  let [row] = await db.select().from(projectCalendar).where(eq(projectCalendar.projectId, projectId));
  if (!row || !row.token) {
    const token = crypto.randomBytes(16).toString("hex");
    [row] = await db.insert(projectCalendar).values({ projectId, token, lessons: row?.lessons ?? "[]" })
      .onConflictDoUpdate({ target: projectCalendar.projectId, set: { token } }).returning();
  }
  return { token: row.token, url: feedUrl(projectId, row.token, baseUrl) };
}

export async function saveLessons(projectId: number, lessons: Lesson[], baseUrl?: string): Promise<{ token: string; url: string }> {
  const { token, url } = await ensureCalendar(projectId, baseUrl);
  await db.update(projectCalendar).set({ lessons: JSON.stringify(lessons.slice(0, 2000)), updatedAt: new Date() }).where(eq(projectCalendar.projectId, projectId));
  return { token, url };
}

export async function getStatus(projectId: number, baseUrl?: string): Promise<{ token: string; url: string; lessonCount: number }> {
  const [row] = await db.select().from(projectCalendar).where(eq(projectCalendar.projectId, projectId));
  const { token, url } = await ensureCalendar(projectId, baseUrl);
  let n = 0; try { n = (JSON.parse(row?.lessons ?? "[]") as Lesson[]).length; } catch { /* ignore */ }
  return { token, url, lessonCount: n };
}

const icsEsc = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const pad = (n: number) => String(n).padStart(2, "0");
// Local "floating" date-time: 2026-06-30 + 19:00 → 20260630T190000 (interpreted in viewer's TZ).
function dt(date: string, time: string): string {
  const [y, m, d] = (date || "").split("-");
  const [hh, mm] = (time || "09:00").split(":");
  if (!y || !m || !d) return "";
  return `${y}${pad(+m)}${pad(+d)}T${pad(+(hh || 0))}${pad(+(mm || 0))}00`;
}
function plusHour(date: string, time: string): string {
  const [y, m, d] = (date || "").split("-").map(Number);
  const [hh, mm] = (time || "09:00").split(":").map(Number);
  if (!y) return "";
  const dd = new Date(y, m - 1, d, (hh || 0) + 1, mm || 0);
  return `${dd.getFullYear()}${pad(dd.getMonth() + 1)}${pad(dd.getDate())}T${pad(dd.getHours())}${pad(dd.getMinutes())}00`;
}

export function buildIcs(studio: string, domain: string, lessons: Lesson[]): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const host = domain || "buildly.app";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Buildly//Booking//NL", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `NAME:${icsEsc(studio)} lessen`, `X-WR-CALNAME:${icsEsc(studio)} lessen`, "X-PUBLISHED-TTL:PT3H", "REFRESH-INTERVAL;VALUE=DURATION:PT3H",
  ];
  for (const l of lessons) {
    const start = dt(l.date, l.time);
    if (!start) continue;
    const online = (l.mode === "online" || l.mode === "hybride") && l.onlineLink ? l.onlineLink : "";
    const descParts = [l.teacher ? "Docent: " + l.teacher : "", online ? "Online: " + online : "", l.onlineInfo || ""].filter(Boolean);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:lesson-${icsEsc(l.id)}@${host}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${start}`);
    lines.push(`DTEND:${plusHour(l.date, l.time)}`);
    lines.push(`SUMMARY:${icsEsc(l.title || "Les")}${l.mode === "online" ? " (online)" : l.mode === "hybride" ? " (hybride)" : ""}`);
    if (online) lines.push(`LOCATION:${icsEsc(online)}`);
    else lines.push(`LOCATION:${icsEsc(studio)}`);
    if (descParts.length) lines.push(`DESCRIPTION:${icsEsc(descParts.join("\n"))}`);
    if (online) lines.push(`URL:${icsEsc(online)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  // CRLF line endings per RFC 5545.
  return lines.join("\r\n") + "\r\n";
}

export async function getLessons(projectId: number, token: string): Promise<Lesson[] | null> {
  const [row] = await db.select().from(projectCalendar).where(eq(projectCalendar.projectId, projectId));
  if (!row || !row.token || row.token !== token) return null;
  try { return JSON.parse(row.lessons) as Lesson[]; } catch { return []; }
}
