import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const learnings = pgTable("learnings", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  sourceProjectId: integer("source_project_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertLearningSchema = createInsertSchema(learnings).omit({
  id: true,
  createdAt: true,
});

export type Learning = typeof learnings.$inferSelect;
export type InsertLearning = z.infer<typeof insertLearningSchema>;
