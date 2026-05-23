import { pgTable, uuid, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { companyStaffTable } from "./company-staff";
import { agencyStaffTable } from "./agency-staff";
import { agentsTable } from "./agents";

export const salaryPaymentsTable = pgTable("salary_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffType: text("staff_type").notNull(), // "company" | "agency"
  staffId: uuid("staff_id").notNull(), // FK conceptual to company_staff or agency_staff
  agentId: uuid("agent_id").references(() => agentsTable.id), // only for agency staff
  periodMonth: integer("period_month").notNull(), // 1–12
  periodYear: integer("period_year").notNull(),
  baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  allowances: numeric("allowances", { precision: 12, scale: 2 }).notNull().default("0"),
  bonuses: numeric("bonuses", { precision: 12, scale: 2 }).notNull().default("0"),
  deductions: numeric("deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  netAmount: numeric("net_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("pending"), // "pending" | "paid" | "partial"
  dueDate: timestamp("due_date", { withTimezone: true }), // 30 days from last payment
  paidBy: uuid("paid_by").references(() => usersTable.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSalaryPaymentSchema = createInsertSchema(salaryPaymentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSalaryPayment = z.infer<typeof insertSalaryPaymentSchema>;
export type SalaryPayment = typeof salaryPaymentsTable.$inferSelect;
