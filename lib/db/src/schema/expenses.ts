import { pgTable, uuid, text, decimal, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const recurringExpensesTable = pgTable("recurring_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  defaultAmount: decimal("default_amount", { precision: 12, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertRecurringExpenseSchema = createInsertSchema(recurringExpensesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRecurringExpense = z.infer<typeof insertRecurringExpenseSchema>;
export type RecurringExpense = typeof recurringExpensesTable.$inferSelect;

export const companyExpensesTable = pgTable("company_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // 'recurring' or 'non-recurring'
  recurringExpenseId: uuid("recurring_expense_id").references(() => recurringExpensesTable.id),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  payeeName: text("payee_name").notNull(),
  authorizingOfficer: text("authorizing_officer"), // nullable for recurring, mandatory for non-recurring in api logic
  receiptImage: text("receipt_image"), // base64 string
  cashierId: uuid("cashier_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompanyExpenseSchema = createInsertSchema(companyExpensesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCompanyExpense = z.infer<typeof insertCompanyExpenseSchema>;
export type CompanyExpense = typeof companyExpensesTable.$inferSelect;
