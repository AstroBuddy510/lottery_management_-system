import { pgTable, uuid, decimal, timestamp, pgEnum, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable } from "./agents";
import { usersTable } from "./users";

export const tokenTransactionTypeEnum = pgEnum("token_transaction_type", [
  "purchase",
  "bet_deduction",
  "win_credit",
  "refund",
  "admin_adjustment",
]);

export const writerTokenWalletsTable = pgTable("writer_token_wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().unique().references(() => writersTable.id),
  balance: decimal("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  totalPurchased: decimal("total_purchased", { precision: 12, scale: 2 }).notNull().default("0"),
  totalSpent: decimal("total_spent", { precision: 12, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const writerTokenTransactionsTable = pgTable("writer_token_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  transactionType: tokenTransactionTypeEnum("transaction_type").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  balanceAfter: decimal("balance_after", { precision: 12, scale: 2 }).notNull(),
  referenceId: uuid("reference_id"),
  description: text("description"),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWriterTokenWalletSchema = createInsertSchema(writerTokenWalletsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertWriterTokenWallet = z.infer<typeof insertWriterTokenWalletSchema>;
export type WriterTokenWallet = typeof writerTokenWalletsTable.$inferSelect;

export const insertWriterTokenTransactionSchema = createInsertSchema(writerTokenTransactionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWriterTokenTransaction = z.infer<typeof insertWriterTokenTransactionSchema>;
export type WriterTokenTransaction = typeof writerTokenTransactionsTable.$inferSelect;

/**
 * A writer's request to buy e-token units, paid by mobile money via Paystack.
 *
 * Payment and crediting are deliberately separate: Paystack confirming a
 * charge marks the request paid, but the units only reach the wallet when a
 * cashier credits them. That keeps a human between "money arrived" and
 * "betting credit issued", and leaves an auditable record of who issued it.
 */
export const tokenPurchaseStatusEnum = pgEnum("token_purchase_status", [
  "pending",   // initialised, awaiting payment
  "paid",      // Paystack confirmed the charge; awaiting a cashier
  "credited",  // units added to the wallet
  "failed",    // payment failed or abandoned
  "cancelled",
]);

export const writerTokenPurchasesTable = pgTable("writer_token_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  status: tokenPurchaseStatusEnum("status").notNull().default("pending"),
  // Paystack's transaction reference, unique so a webhook replay cannot
  // create or credit the same purchase twice.
  paystackReference: text("paystack_reference").unique(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  creditedBy: uuid("credited_by").references(() => usersTable.id),
  creditedAt: timestamp("credited_at", { withTimezone: true }),
  transactionId: uuid("transaction_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWriterTokenPurchaseSchema = createInsertSchema(writerTokenPurchasesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWriterTokenPurchase = z.infer<typeof insertWriterTokenPurchaseSchema>;
export type WriterTokenPurchase = typeof writerTokenPurchasesTable.$inferSelect;
