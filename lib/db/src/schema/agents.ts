import { pgTable, uuid, varchar, boolean, timestamp, numeric, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const agentsTable = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  agentCode: varchar("agent_code", { length: 2 }).notNull().unique(),
  fullCode: varchar("full_code", { length: 10 }).notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  agencyName: varchar("agency_name", { length: 100 }),
  location: varchar("location", { length: 200 }),
  lat: numeric("lat", { precision: 9, scale: 6 }),
  lng: numeric("lng", { precision: 9, scale: 6 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  outstandingDebt: numeric("outstanding_debt", { precision: 12, scale: 2 }).notNull().default("0"),
  debtSince: timestamp("debt_since", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const writersTable = pgTable("writers", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
  writerCode: varchar("writer_code", { length: 6 }).notNull(),
  fullCode: varchar("full_code", { length: 16 }).notNull().unique(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 20 }).unique(),
  pinHash: text("pin_hash"),
  idType: varchar("id_type", { length: 30 }),
  idNumber: varchar("id_number", { length: 50 }),
  operationModel: varchar("operation_model", { length: 10 }).notNull().default("postpaid"),
  registrationSource: varchar("registration_source", { length: 20 }).notNull().default("agent"),
  approvalStatus: varchar("approval_status", { length: 20 }).notNull().default("approved"),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  isActive: boolean("is_active").notNull().default(true),
  // Risk watch. A red-flagged writer is one whose sales are large enough that
  // their book moves the company's exposure on its own, so Risk Management
  // keeps their tickets visible at all times rather than only in aggregate.
  isRedFlagged: boolean("is_red_flagged").notNull().default(false),
  redFlagReason: text("red_flag_reason"),
  redFlaggedBy: uuid("red_flagged_by").references(() => usersTable.id),
  redFlaggedAt: timestamp("red_flagged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;

export const insertWriterSchema = createInsertSchema(writersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWriter = z.infer<typeof insertWriterSchema>;
export type Writer = typeof writersTable.$inferSelect;
