import { pgTable, uuid, decimal, timestamp, pgEnum, date, varchar, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable } from "./agents";
import { gamesTable } from "./games";
import { usersTable } from "./users";

export const postpaidSettlementStatusEnum = pgEnum("postpaid_settlement_status", [
  "open",
  "calculated",
  "settled",
  "overdue",
]);

/**
 * How the writer said they were paying. Declared by the writer, and for cash
 * still only a claim until a cashier confirms the money is in hand.
 */
export const postpaidPaymentMethodEnum = pgEnum("postpaid_payment_method", [
  "cash",
  "momo",
]);

export const postpaidDailyLedgerTable = pgTable("postpaid_daily_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  gameId: uuid("game_id").notNull().references(() => gamesTable.id),
  ledgerDate: date("ledger_date").notNull(),
  /** Gross postpaid stakes taken. This is the company's money. */
  totalStakes: decimal("total_stakes", { precision: 12, scale: 2 }).notNull().default("0"),
  /**
   * Wins recorded against this writer's sales, for information only.
   *
   * The company pays these through the agents, not the writer out of pocket,
   * so winnings must NEVER reduce what the writer hands in. A writer who owed
   * less on a draw they happened to record wins on would be taking a risk-free
   * position, which is the whole thing this ledger exists to prevent.
   */
  totalWinnings: decimal("total_winnings", { precision: 12, scale: 2 }).notNull().default("0"),
  netBalance: decimal("net_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  /**
   * The writer commission rate applied to this draw, copied from system
   * settings at the moment betting closed and never re-read after.
   *
   * Frozen deliberately: the admin adjusts the live rate over time, and a
   * settled or in-flight ledger must keep the rate it was quoted at. Null
   * means betting has not closed yet and nothing has been quoted.
   */
  commissionPct: decimal("commission_pct", { precision: 5, scale: 4 }),
  /** Gross stakes x the frozen rate. What the writer keeps. */
  commissionAmount: decimal("commission_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  /** Gross stakes minus commission. What the writer hands the cashier. */
  amountPayable: decimal("amount_payable", { precision: 12, scale: 2 }).notNull().default("0"),
  /** When the figures above were locked in. */
  quotedAt: timestamp("quoted_at", { withTimezone: true }),
  settlementStatus: postpaidSettlementStatusEnum("settlement_status").notNull().default("open"),
  settlementMethod: varchar("settlement_method", { length: 20 }),
  settlementReference: text("settlement_reference"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  settledBy: uuid("settled_by").references(() => usersTable.id),
  /** The writer says they have paid. For cash, a cashier still has to agree. */
  paymentDeclaredAt: timestamp("payment_declared_at", { withTimezone: true }),
  paymentDeclaredMethod: postpaidPaymentMethodEnum("payment_declared_method"),
  /**
   * Set when calculations ran on this draw with the ledger still unpaid. It is
   * what stamps the writer's payouts for review - the company does not carry
   * wins on sales that were never settled.
   */
  unsettledAtCalculation: timestamp("unsettled_at_calculation", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPostpaidDailyLedgerSchema = createInsertSchema(postpaidDailyLedgerTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPostpaidDailyLedger = z.infer<typeof insertPostpaidDailyLedgerSchema>;
export type PostpaidDailyLedger = typeof postpaidDailyLedgerTable.$inferSelect;
