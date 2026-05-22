import { pgTable, uuid, decimal, date, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { usersTable } from "./users";

export type ExpenseLineItem = {
  expenseCategoryId: string;
  name: string;
  amount: string;
};

export const paymentsTable = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
  cashierId: uuid("cashier_id").notNull().references(() => usersTable.id),
  transactionType: text("transaction_type").notNull().default("pay_in"),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  expenseItems: jsonb("expense_items").$type<ExpenseLineItem[]>(),
  paymentDate: date("payment_date").notNull(),
  receiptNumber: text("receipt_number").unique(),
  notes: text("notes"),
  isVoided: boolean("is_voided").notNull().default(false),
  voidedBy: uuid("voided_by").references(() => usersTable.id),
  voidedReason: text("voided_reason"),
  paymentMethod: text("payment_method").notNull().default("manual"),
  paystackReference: text("paystack_reference").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({
  id: true,
  createdAt: true,
  isVoided: true,
  voidedBy: true,
  voidedReason: true,
});
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
