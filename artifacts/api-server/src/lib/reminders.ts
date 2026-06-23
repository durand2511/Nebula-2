/**
 * Background scheduler that sends the "24h before the class" reminder e-mails.
 * Rows live in email_reminders (created on booking, deleted on cancel). Every few minutes we
 * pick up the ones that are due (sendAt passed, lesson still in the future) and send them.
 */
import { db, emailReminders } from "@workspace/db";
import { and, eq, lte, gt } from "drizzle-orm";
import { sendBookingEmail } from "./email.js";
import { logger } from "./logger";

let started = false;

async function tick(): Promise<void> {
  try {
    const now = new Date();
    const due = await db
      .select()
      .from(emailReminders)
      .where(and(eq(emailReminders.sent, "false"), lte(emailReminders.sendAt, now), gt(emailReminders.lessonAt, now)));
    for (const r of due) {
      try {
        const dt = new Date(r.lessonAt);
        await sendBookingEmail(r.projectId, r.email, "reminder", {
          studio: r.studio,
          name: r.name,
          classTitle: r.classTitle,
          date: dt.toISOString().slice(0, 10),
          time: dt.toTimeString().slice(0, 5),
        });
      } catch (err) {
        logger.warn({ err, id: r.id }, "[reminder] send failed");
      }
      // Mark sent regardless — best-effort, we don't want a bad address to loop forever.
      await db.update(emailReminders).set({ sent: "true" }).where(eq(emailReminders.id, r.id));
    }
  } catch (err) {
    logger.warn({ err }, "[reminder] tick failed");
  }
}

export function startReminderScheduler(): void {
  if (started) return;
  started = true;
  setInterval(() => void tick(), 5 * 60 * 1000);
  void tick();
}
