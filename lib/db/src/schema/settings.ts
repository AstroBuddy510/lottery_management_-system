import {
  pgTable,
  uuid,
  decimal,
  timestamp,
  date,
  smallint,
  time,
  boolean,
  text,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const systemSettingsTable = pgTable("system_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  commissionPct: decimal("commission_pct", { precision: 5, scale: 4 }).notNull(),
  agentCommissionPct: decimal("agent_commission_pct", { precision: 5, scale: 4 }).notNull().default("0"),
  writerCommissionPct: decimal("writer_commission_pct", { precision: 5, scale: 4 }).notNull().default("0"),
  reservePct: decimal("reserve_pct", { precision: 5, scale: 4 }).notNull(),
  updatedBy: uuid("updated_by").notNull().references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  effectiveDate: date("effective_date").notNull(),
  folderColor: text("folder_color").notNull().default("#10b981"),
  folderViewType: text("folder_view_type").notNull().default("large"),
});

export const cashierTimeWindowsTable = pgTable("cashier_time_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  dayOfWeek: smallint("day_of_week"),
  windowOpen: time("window_open").notNull(),
  windowClose: time("window_close").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSystemSettingsSchema = createInsertSchema(systemSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertSystemSettings = z.infer<typeof insertSystemSettingsSchema>;
export type SystemSettings = typeof systemSettingsTable.$inferSelect;

export const insertCashierTimeWindowSchema = createInsertSchema(cashierTimeWindowsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCashierTimeWindow = z.infer<typeof insertCashierTimeWindowSchema>;
export type CashierTimeWindow = typeof cashierTimeWindowsTable.$inferSelect;
