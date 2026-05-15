import { pgTable, uuid, varchar, decimal, date, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable } from "./agents";
import { usersTable } from "./users";

export const salesLogsTable = pgTable("sales_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  gameType: varchar("game_type", { length: 50 }).notNull(),
  ticketAmount: decimal("ticket_amount", { precision: 12, scale: 2 }).notNull(),
  saleDate: date("sale_date").notNull(),
  imageUrl: text("image_url"),
  loggedBy: uuid("logged_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSalesLogSchema = createInsertSchema(salesLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSalesLog = z.infer<typeof insertSalesLogSchema>;
export type SalesLog = typeof salesLogsTable.$inferSelect;
