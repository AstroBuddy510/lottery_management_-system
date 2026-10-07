import { pgTable, uuid, date, decimal, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable } from "./agents";
import { gamesTable } from "./games";

export const dailyCalculationsTable = pgTable("daily_calculations", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  gameId: uuid("game_id").references(() => gamesTable.id),
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
},
  (table) => [
    // Both lock checks on the entry routes ask "has this game been
    // calculated yet", once per entry and once per edit. This table had no
    // index of any kind.
    index("daily_calculations_game_idx").on(table.gameId),
    index("daily_calculations_writer_date_idx").on(table.writerId, table.calcDate),
  ],
);

export const insertDailyCalculationSchema = createInsertSchema(dailyCalculationsTable).omit({
  id: true,
  calculatedAt: true,
});
export type InsertDailyCalculation = z.infer<typeof insertDailyCalculationSchema>;
export type DailyCalculation = typeof dailyCalculationsTable.$inferSelect;
