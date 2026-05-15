import { pgTable, uuid, date, decimal, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable } from "./agents";

export const reserveFundTable = pgTable("reserve_fund", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodDate: date("period_date").notNull().unique(),
  totalContributed: decimal("total_contributed", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  totalAllocated: decimal("total_allocated", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  balance: decimal("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const reserveAllocationsTable = pgTable("reserve_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  allocationDate: date("allocation_date").notNull(),
  amountDrawn: decimal("amount_drawn", { precision: 12, scale: 2 }).notNull(),
  reason: text("reason"),
  reserveBalanceAfter: decimal("reserve_balance_after", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReserveFundSchema = createInsertSchema(reserveFundTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertReserveFund = z.infer<typeof insertReserveFundSchema>;
export type ReserveFund = typeof reserveFundTable.$inferSelect;

export const insertReserveAllocationSchema = createInsertSchema(reserveAllocationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertReserveAllocation = z.infer<typeof insertReserveAllocationSchema>;
export type ReserveAllocation = typeof reserveAllocationsTable.$inferSelect;
