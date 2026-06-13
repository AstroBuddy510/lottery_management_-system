import { pgTable, uuid, date, decimal, varchar, timestamp, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";
import { usersTable } from "./users";

// Booklet printing expenses/restock
export const bookletBatchesTable = pgTable("booklet_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchDate: date("batch_date").notNull(),
  quantity: integer("quantity").notNull(),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  costPerBooklet: decimal("cost_per_booklet", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  enteredBy: uuid("entered_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Booklet allocation to agents
export const bookletAllocationsTable = pgTable("booklet_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
  allocatedDate: date("allocated_date").notNull(),
  quantity: integer("quantity").notNull(),
  notes: text("notes"),
  enteredBy: uuid("entered_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Digital Padlocks registry
export const padlocksTable = pgTable("padlocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  serialNumber: varchar("serial_number", { length: 100 }).notNull().unique(),
  brandName: varchar("brand_name", { length: 100 }).notNull().default(""),
  lockType: varchar("lock_type", { length: 50 }).notNull().default("new"), // "new" (Brand New), "old" (Old Lock)
  status: varchar("status", { length: 50 }).notNull().default("available"), // "available", "assigned", "damaged", "lost"
  condition: varchar("condition", { length: 50 }).notNull().default("good"), // "good", "damaged", "broken"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Padlock assignment records
export const padlockAssignmentsTable = pgTable("padlock_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  padlockId: uuid("padlock_id").notNull().references(() => padlocksTable.id),
  agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
  destination: varchar("destination", { length: 255 }).notNull(),
  conditionBefore: varchar("condition_before", { length: 50 }).notNull(),
  conditionAfter: varchar("condition_after", { length: 50 }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  enteredBy: uuid("entered_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertBookletBatchSchema = createInsertSchema(bookletBatchesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBookletBatch = z.infer<typeof insertBookletBatchSchema>;
export type BookletBatch = typeof bookletBatchesTable.$inferSelect;

export const insertBookletAllocationSchema = createInsertSchema(bookletAllocationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBookletAllocation = z.infer<typeof insertBookletAllocationSchema>;
export type BookletAllocation = typeof bookletAllocationsTable.$inferSelect;

export const insertPadlockSchema = createInsertSchema(padlocksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPadlock = z.infer<typeof insertPadlockSchema>;
export type Padlock = typeof padlocksTable.$inferSelect;

export const insertPadlockAssignmentSchema = createInsertSchema(padlockAssignmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPadlockAssignment = z.infer<typeof insertPadlockAssignmentSchema>;
export type PadlockAssignment = typeof padlockAssignmentsTable.$inferSelect;
