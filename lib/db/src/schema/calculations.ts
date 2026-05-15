import { pgTable, uuid, date, decimal, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable } from "./agents";

export const dailyCalculationsTable = pgTable("daily_calculations", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  calcDate: date("calc_date").notNull(),
  grossSales: decimal("gross_sales", { precision: 12, scale: 2 }).notNull(),
  commissionPct: decimal("commission_pct", { precision: 5, scale: 4 }).notNull(),
  commissionAmount: decimal("commission_amount", { precision: 12, scale: 2 }).notNull(),
  netGross: decimal("net_gross", { precision: 12, scale: 2 }).notNull(),
  winsAmount: decimal("wins_amount", { precision: 12, scale: 2 }).notNull(),
  reservePct: decimal("reserve_pct", { precision: 5, scale: 4 }).notNull(),
  reserveAmount: decimal("reserve_amount", { precision: 12, scale: 2 }).notNull(),
  writerBalance: decimal("writer_balance", { precision: 12, scale: 2 }).notNull(),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDailyCalculationSchema = createInsertSchema(dailyCalculationsTable).omit({
  id: true,
  calculatedAt: true,
});
export type InsertDailyCalculation = z.infer<typeof insertDailyCalculationSchema>;
export type DailyCalculation = typeof dailyCalculationsTable.$inferSelect;
