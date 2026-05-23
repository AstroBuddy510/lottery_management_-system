import { pgTable, uuid, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const salaryWalletTable = pgTable("salary_wallet", {
  id: uuid("id").primaryKey().defaultRandom(),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  totalFunded: numeric("total_funded", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDisbursed: numeric("total_disbursed", { precision: 12, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const salaryWalletTransactionsTable = pgTable("salary_wallet_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // "fund" | "disburse"
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }).notNull(),
  referenceId: uuid("reference_id"), // FK conceptual to salary_payments.id if disburse
  performedBy: uuid("performed_by").notNull().references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSalaryWalletSchema = createInsertSchema(salaryWalletTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertSalaryWallet = z.infer<typeof insertSalaryWalletSchema>;
export type SalaryWallet = typeof salaryWalletTable.$inferSelect;

export const insertSalaryWalletTransactionSchema = createInsertSchema(salaryWalletTransactionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSalaryWalletTransaction = z.infer<typeof insertSalaryWalletTransactionSchema>;
export type SalaryWalletTransaction = typeof salaryWalletTransactionsTable.$inferSelect;
