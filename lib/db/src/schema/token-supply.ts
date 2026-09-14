import { pgTable, uuid, decimal, timestamp, pgEnum, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { writersTable } from "./agents";

/**
 * E-token supply chain.
 *
 * Tokens are created once, into a company pool, and then move: pool -> a
 * cashier's float -> a writer's wallet. Every movement is a ledger row, so at
 * any moment
 *
 *   total minted = pool balance + sum(cashier floats) + sum(disbursed to writers)
 *
 * and the difference between "how many exist" and "where are they now" is
 * always answerable. Nothing creates tokens except a pool mint.
 */

export const tokenPoolTxnTypeEnum = pgEnum("token_pool_txn_type", [
  "mint",              // new supply created
  "issue_to_cashier",  // pool -> cashier float
  "reversal",          // correcting entry
]);

export const cashierTokenTxnTypeEnum = pgEnum("cashier_token_txn_type", [
  "receipt",       // float credited from the pool
  "disbursement",  // float debited, writer credited
  "reversal",
]);

/** One row. The company's untapped supply. */
export const tokenPoolTable = pgTable("token_pool", {
  id: uuid("id").primaryKey().defaultRandom(),
  balance: decimal("balance", { precision: 14, scale: 2 }).notNull().default("0"),
  totalMinted: decimal("total_minted", { precision: 14, scale: 2 }).notNull().default("0"),
  totalIssued: decimal("total_issued", { precision: 14, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const tokenPoolTransactionsTable = pgTable("token_pool_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionType: tokenPoolTxnTypeEnum("transaction_type").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: decimal("balance_after", { precision: 14, scale: 2 }).notNull(),
  // Set on issue_to_cashier: which cashier received it.
  cashierId: uuid("cashier_id").references(() => usersTable.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A cashier's float: tokens they hold and can disburse. */
export const cashierTokenWalletsTable = pgTable("cashier_token_wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  cashierId: uuid("cashier_id")
    .notNull()
    .unique()
    .references(() => usersTable.id),
  balance: decimal("balance", { precision: 14, scale: 2 }).notNull().default("0"),
  totalReceived: decimal("total_received", { precision: 14, scale: 2 }).notNull().default("0"),
  totalDisbursed: decimal("total_disbursed", { precision: 14, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const cashierTokenTransactionsTable = pgTable("cashier_token_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  cashierId: uuid("cashier_id")
    .notNull()
    .references(() => usersTable.id),
  transactionType: cashierTokenTxnTypeEnum("transaction_type").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  balanceAfter: decimal("balance_after", { precision: 14, scale: 2 }).notNull(),
  // Set on a disbursement: who received the tokens, against which purchase.
  writerId: uuid("writer_id").references(() => writersTable.id),
  purchaseId: uuid("purchase_id"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTokenPoolTransactionSchema = createInsertSchema(tokenPoolTransactionsTable).omit({
  id: true,
  createdAt: true,
});
export type TokenPoolTransaction = typeof tokenPoolTransactionsTable.$inferSelect;
export type CashierTokenWallet = typeof cashierTokenWalletsTable.$inferSelect;
export type CashierTokenTransaction = typeof cashierTokenTransactionsTable.$inferSelect;
export type TokenPool = typeof tokenPoolTable.$inferSelect;
