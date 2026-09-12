import { pgTable, uuid, varchar, decimal, timestamp, pgEnum, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable, agentsTable } from "./agents";
import { gamesTable } from "./games";
import { usersTable } from "./users";

export const riskFlagTypeEnum = pgEnum("risk_flag_type", [
  "frequent_combination",
  "high_stakes_writer",
  "suspicious_pattern",
  "velocity_alert",
]);

export const riskFlagSeverityEnum = pgEnum("risk_flag_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const riskFlagStatusEnum = pgEnum("risk_flag_status", [
  "open",
  "reviewed",
  "dismissed",
  "escalated",
]);

export const riskFlagsTable = pgTable("risk_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  flagType: riskFlagTypeEnum("flag_type").notNull(),
  writerId: uuid("writer_id").references(() => writersTable.id),
  agentId: uuid("agent_id").references(() => agentsTable.id),
  gameId: uuid("game_id").references(() => gamesTable.id),
  numbers: varchar("numbers", { length: 30 }),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  totalStakeAmount: decimal("total_stake_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  severity: riskFlagSeverityEnum("severity").notNull(),
  description: text("description").notNull(),
  status: riskFlagStatusEnum("status").notNull().default("open"),
  reviewedBy: uuid("reviewed_by").references(() => usersTable.id),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertRiskFlagSchema = createInsertSchema(riskFlagsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRiskFlag = z.infer<typeof insertRiskFlagSchema>;
export type RiskFlag = typeof riskFlagsTable.$inferSelect;
