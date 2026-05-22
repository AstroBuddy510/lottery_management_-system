import { pgTable, uuid, varchar, numeric, timestamp, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companyStaffTable = pgTable("company_staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  profilePicture: text("profile_picture"),
  position: varchar("position", { length: 100 }).notNull(),
  salary: numeric("salary", { precision: 12, scale: 2 }).notNull().default("0"),
  allowances: numeric("allowances", { precision: 12, scale: 2 }).notNull().default("0"),
  bonuses: numeric("bonuses", { precision: 12, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 20 }).notNull().default("active"), // "active" | "suspended"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompanyStaffSchema = createInsertSchema(companyStaffTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCompanyStaff = z.infer<typeof insertCompanyStaffSchema>;
export type CompanyStaff = typeof companyStaffTable.$inferSelect;
