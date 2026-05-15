import { pgTable, uuid, varchar, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const messageTypeEnum = pgEnum("message_type", ["announcement", "alert", "reminder"]);
export const targetTypeEnum = pgEnum("target_type", ["all", "all_agents", "agent", "writer"]);

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  sentBy: uuid("sent_by").notNull().references(() => usersTable.id),
  messageType: messageTypeEnum("message_type").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  targetType: targetTypeEnum("target_type").notNull(),
  targetId: uuid("target_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationReceiptsTable = pgTable("notification_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  notificationId: uuid("notification_id").notNull().references(() => notificationsTable.id),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
