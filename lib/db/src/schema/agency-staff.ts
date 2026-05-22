import { pgTable, uuid, varchar, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";

export const agencyStaffTable = pgTable("agency_staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agentsTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  salary: numeric("salary", { precision: 12, scale: 2 }).notNull().default("0"),
  allowances: numeric("allowances", { precision: 12, scale: 2 }).notNull().default("0"),
  bonuses: numeric("bonuses", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAgencyStaffSchema = createInsertSchema(agencyStaffTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAgencyStaff = z.infer<typeof insertAgencyStaffSchema>;
export type AgencyStaff = typeof agencyStaffTable.$inferSelect;
