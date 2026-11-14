import { sql } from "drizzle-orm";
import { pgTable, uuid, date, decimal, varchar, timestamp, integer, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable, writersTable } from "./agents";
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

/**
 * POS terminal registry.
 *
 * A terminal is a physical device, identified three ways: the serial number on
 * the case, the IMEI burned into the modem, and the brand/model that says what
 * it is. Serial and IMEI are both unique because both are meant to identify one
 * device in the world, and a duplicate of either means somebody mistyped or the
 * same unit was registered twice - which is the failure that makes an inventory
 * worthless.
 *
 * registeredAt is set by the database, not the client. The date a device
 * entered the estate is an audit fact; it is not something a form should be
 * able to backdate.
 */
export const posTerminalsTable = pgTable("pos_terminals", {
  id: uuid("id").primaryKey().defaultRandom(),
  serialNumber: varchar("serial_number", { length: 100 }).notNull().unique(),
  brand: varchar("brand", { length: 100 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  /** 15 digits on nearly every device; the column is wider so a 16/17-digit IMEISV still fits. */
  imei: varchar("imei", { length: 20 }).notNull().unique(),
  /**
   * "available", "assigned", "repair", "damaged", "lost", "retired".
   *
   * "repair" is what a device unassigned as faulty rests in. Only "available"
   * terminals are offered for assignment, so a known-broken unit cannot be
   * handed to the next writer by someone who did not know.
   */
  status: varchar("status", { length: 50 }).notNull().default("available"),
  notes: text("notes"),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  registeredBy: uuid("registered_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
},
  (table) => [
    index("pos_terminals_status_idx").on(table.status),
    // Every assignment reads the stock list, and stock is "status = available".
    index("pos_terminals_available_idx")
      .on(table.status)
      .where(sql`${table.status} = 'available'`),
  ],
);

/**
 * Which writer holds which terminal, and who held it before.
 *
 * Append-and-close rather than overwrite: unassigning a device stamps
 * unassignedAt on the old row, so "who had this terminal in September" stays
 * answerable. A current holding is the row whose unassignedAt is still null.
 *
 * Not "returned": a terminal is not lent out and handed back, it stays with a
 * writer indefinitely and the pairing ends when something changes - usually a
 * fault. The column records the date that happened.
 *
 * The two partial unique indexes are what actually enforce "one terminal per
 * writer". Checking that in the route is not enough - two assignment requests
 * arriving together would both read "no open assignment" and both insert. The
 * same reasoning applies in reverse: a device cannot be in two writers' hands
 * at once, so the terminal is constrained too. Postgres rejects the second
 * writer rather than the application hoping it never happens.
 */
export const terminalAssignmentsTable = pgTable("terminal_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  terminalId: uuid("terminal_id").notNull().references(() => posTerminalsTable.id),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
  notes: text("notes"),
  assignedBy: uuid("assigned_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
},
  (table) => [
    uniqueIndex("terminal_assignments_one_open_per_writer")
      .on(table.writerId)
      .where(sql`${table.unassignedAt} is null`),
    uniqueIndex("terminal_assignments_one_open_per_terminal")
      .on(table.terminalId)
      .where(sql`${table.unassignedAt} is null`),
    index("terminal_assignments_terminal_idx").on(table.terminalId, table.assignedAt),
    index("terminal_assignments_writer_idx").on(table.writerId, table.assignedAt),
  ],
);

export const insertPosTerminalSchema = createInsertSchema(posTerminalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  registeredAt: true,
});
export type InsertPosTerminal = z.infer<typeof insertPosTerminalSchema>;
export type PosTerminal = typeof posTerminalsTable.$inferSelect;

export const insertTerminalAssignmentSchema = createInsertSchema(terminalAssignmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTerminalAssignment = z.infer<typeof insertTerminalAssignmentSchema>;
export type TerminalAssignment = typeof terminalAssignmentsTable.$inferSelect;

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
