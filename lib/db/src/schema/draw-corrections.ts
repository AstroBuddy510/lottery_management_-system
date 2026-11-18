import { pgTable, uuid, varchar, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { gamesTable } from "./games";
import { usersTable } from "./users";

/**
 * A correction to a draw's declared numbers after it has run: proposed by an
 * administrator, approved by the director, applied by one re-run with exactly
 * the approved numbers. See migration 0026.
 */
export const drawCorrectionsTable = pgTable("draw_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id").notNull().references(() => gamesTable.id),
  oldWinning: varchar("old_winning", { length: 50 }).notNull(),
  oldMachine: varchar("old_machine", { length: 50 }).notNull(),
  newWinning: varchar("new_winning", { length: 50 }).notNull(),
  newMachine: varchar("new_machine", { length: 50 }).notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 10 }).notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull().references(() => usersTable.id),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid("decided_by").references(() => usersTable.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  reversed: jsonb("reversed"),
  appliedBy: uuid("applied_by").references(() => usersTable.id),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});

export type DrawCorrection = typeof drawCorrectionsTable.$inferSelect;
