import { pgTable, uuid, date, decimal, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { usersTable } from "./users";

export const agentReserveReceiptsTable = pgTable("agent_reserve_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
  calcDate: date("calc_date").notNull(),
  amountDue: decimal("amount_due", { precision: 12, scale: 2 }).notNull(),
  amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }).notNull(),
  markedBy: uuid("marked_by").notNull().references(() => usersTable.id),
  markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
});

export const insertAgentReserveReceiptSchema = createInsertSchema(agentReserveReceiptsTable).omit({
  id: true,
  markedAt: true,
});
export type InsertAgentReserveReceipt = z.infer<typeof insertAgentReserveReceiptSchema>;
export type AgentReserveReceipt = typeof agentReserveReceiptsTable.$inferSelect;
