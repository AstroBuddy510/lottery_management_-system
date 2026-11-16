import {
  pgTable,
  uuid,
  integer,
  smallint,
  numeric,
  date,
  text,
  varchar,
  boolean,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { agentsTable, writersTable } from "./agents";

/**
 * Thermal paper rolls for the POS terminals' printers.
 *
 * Rolls move in one direction, and each step is its own table:
 *
 *   purchase  ->  office store  ->  allotment  ->  agent  ->  distribution  ->  writer
 *
 * No balance is ever stored. The store holds what was purchased less what
 * was allotted; an agent holds what they were allotted less what they gave
 * their writers. Computing them from the movements is what keeps them right:
 * a stored balance is a second copy of the truth, and the first missed update
 * makes it wrong without anything noticing.
 */

/**
 * A purchase of rolls, bought by the box.
 *
 * The roll count is a generated column - boxes times rolls per box - so it
 * cannot disagree with the two numbers it comes from.
 */
export const thermalRollPurchasesTable = pgTable(
  "thermal_roll_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseDate: date("purchase_date").notNull(),
    boxes: integer("boxes").notNull(),
    rollsPerBox: integer("rolls_per_box").notNull(),
    totalRolls: integer("total_rolls")
      .notNull()
      .generatedAlwaysAs(sql`boxes * rolls_per_box`),
    totalCost: numeric("total_cost", { precision: 12, scale: 2 }).notNull(),
    supplier: varchar("supplier", { length: 120 }),
    invoiceRef: varchar("invoice_ref", { length: 120 }),
    notes: text("notes"),
    enteredBy: uuid("entered_by").notNull().references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("thermal_roll_purchases_date_idx").on(t.purchaseDate.desc()),
    check("thermal_roll_purchases_boxes_positive", sql`${t.boxes} > 0`),
    check("thermal_roll_purchases_rpb_positive", sql`${t.rollsPerBox} > 0`),
    check("thermal_roll_purchases_cost_nonneg", sql`${t.totalCost} >= 0`),
  ],
);

/** Rolls handed from the office store to an agent. */
export const thermalRollAllotmentsTable = pgTable(
  "thermal_roll_allotments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
    allottedDate: date("allotted_date").notNull(),
    quantity: integer("quantity").notNull(),
    notes: text("notes"),
    enteredBy: uuid("entered_by").notNull().references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("thermal_roll_allotments_agent_idx").on(t.agentId),
    index("thermal_roll_allotments_date_idx").on(t.allottedDate.desc()),
    check("thermal_roll_allotments_qty_positive", sql`${t.quantity} > 0`),
  ],
);

/**
 * Rolls an agent passed on to one of their writers.
 *
 * agent_id is kept alongside writer_id on purpose: it is the agent whose
 * stock this came out of, and a writer can move agencies later without
 * rewriting which agent's balance a past handover reduced.
 */
export const thermalRollDistributionsTable = pgTable(
  "thermal_roll_distributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
    writerId: uuid("writer_id").notNull().references(() => writersTable.id),
    distributedDate: date("distributed_date").notNull(),
    quantity: integer("quantity").notNull(),
    notes: text("notes"),
    enteredBy: uuid("entered_by").notNull().references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("thermal_roll_distributions_agent_idx").on(t.agentId),
    index("thermal_roll_distributions_writer_idx").on(t.writerId),
    check("thermal_roll_distributions_qty_positive", sql`${t.quantity} > 0`),
  ],
);

/**
 * One row: the low-stock line, and whether the alert for crossing it has
 * already gone out.
 *
 * alertActive is what stops the alert repeating on every allotment while
 * stock stays low. It is set when the store drops to the threshold and
 * cleared when a purchase lifts it back above, so the next fall alerts again.
 */
export const thermalRollSettingsTable = pgTable(
  "thermal_roll_settings",
  {
    id: smallint("id").primaryKey().default(1),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(50),
    alertActive: boolean("alert_active").notNull().default(false),
    lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => usersTable.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("thermal_roll_settings_singleton", sql`${t.id} = 1`),
    check("thermal_roll_settings_threshold_nonneg", sql`${t.lowStockThreshold} >= 0`),
  ],
);
