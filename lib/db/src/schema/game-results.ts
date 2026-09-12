import { pgTable, uuid, varchar, decimal, boolean, timestamp, integer, pgEnum, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { gamesTable } from "./games";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";
import { writersTable, agentsTable } from "./agents";

export const payoutRequestStatusEnum = pgEnum("payout_request_status", [
  "pending",
  "approved",
  "paid",
  "rejected",
]);

export const gameResultsTable = pgTable("game_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id").notNull().unique().references(() => gamesTable.id),
  winningNumbers: varchar("winning_numbers", { length: 50 }).notNull(),
  machineNumbers: varchar("machine_numbers", { length: 50 }).notNull(),
  totalTickets: integer("total_tickets").notNull().default(0),
  totalStakes: decimal("total_stakes", { precision: 12, scale: 2 }).notNull().default("0"),
  totalWinners: integer("total_winners").notNull().default(0),
  totalPayouts: decimal("total_payouts", { precision: 12, scale: 2 }).notNull().default("0"),
  processedBy: uuid("processed_by").notNull().references(() => usersTable.id),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  smsNotificationsSent: boolean("sms_notifications_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payoutRequestsTable = pgTable("payout_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => ticketsTable.id),
  gameResultId: uuid("game_result_id").notNull().references(() => gameResultsTable.id),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
  payoutAmount: decimal("payout_amount", { precision: 12, scale: 2 }).notNull(),
  status: payoutRequestStatusEnum("status").notNull().default("pending"),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGameResultSchema = createInsertSchema(gameResultsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertGameResult = z.infer<typeof insertGameResultSchema>;
export type GameResult = typeof gameResultsTable.$inferSelect;

export const insertPayoutRequestSchema = createInsertSchema(payoutRequestsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPayoutRequest = z.infer<typeof insertPayoutRequestSchema>;
export type PayoutRequest = typeof payoutRequestsTable.$inferSelect;
