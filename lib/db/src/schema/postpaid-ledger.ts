import { pgTable, uuid, decimal, timestamp, pgEnum, date, varchar, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable } from "./agents";
import { gamesTable } from "./games";

export const postpaidSettlementStatusEnum = pgEnum("postpaid_settlement_status", [
  "open",
  "calculated",
  "settled",
  "overdue",
]);

export const postpaidDailyLedgerTable = pgTable("postpaid_daily_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  gameId: uuid("game_id").notNull().references(() => gamesTable.id),
  ledgerDate: date("ledger_date").notNull(),
  totalStakes: decimal("total_stakes", { precision: 12, scale: 2 }).notNull().default("0"),
  totalWinnings: decimal("total_winnings", { precision: 12, scale: 2 }).notNull().default("0"),
  netBalance: decimal("net_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  settlementStatus: postpaidSettlementStatusEnum("settlement_status").notNull().default("open"),
  settlementMethod: varchar("settlement_method", { length: 20 }),
  settlementReference: text("settlement_reference"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPostpaidDailyLedgerSchema = createInsertSchema(postpaidDailyLedgerTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPostpaidDailyLedger = z.infer<typeof insertPostpaidDailyLedgerSchema>;
export type PostpaidDailyLedger = typeof postpaidDailyLedgerTable.$inferSelect;
