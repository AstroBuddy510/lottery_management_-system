import { pgTable, uuid, date, decimal, boolean, timestamp, varchar, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable } from "./agents";
import { usersTable } from "./users";
import { gamesTable } from "./games";

export const grossEntriesTable = pgTable("gross_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  gameId: uuid("game_id").references(() => gamesTable.id),
  entryDate: date("entry_date").notNull(),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull(),
  bookletsCount: integer("booklets_count").notNull().default(0),
  enteredBy: uuid("entered_by").notNull().references(() => usersTable.id),
  locked: boolean("locked").notNull().default(false),
  isLate: boolean("is_late").notNull().default(false),
  adminConfirmed: boolean("admin_confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const winsEntriesTable = pgTable("wins_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  gameId: uuid("game_id").references(() => gamesTable.id),
  entryDate: date("entry_date").notNull(),
  winsAmount: decimal("wins_amount", { precision: 12, scale: 2 }).notNull(),
  enteredBy: uuid("entered_by").notNull().references(() => usersTable.id),
  locked: boolean("locked").notNull().default(false),
  oversight: boolean("oversight").notNull().default(false),
  status: varchar("status", { length: 50 }).notNull().default("approved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertGrossEntrySchema = createInsertSchema(grossEntriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  locked: true,
});
export type InsertGrossEntry = z.infer<typeof insertGrossEntrySchema>;
export type GrossEntry = typeof grossEntriesTable.$inferSelect;

export const insertWinsEntrySchema = createInsertSchema(winsEntriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  locked: true,
});
export type InsertWinsEntry = z.infer<typeof insertWinsEntrySchema>;
export type WinsEntry = typeof winsEntriesTable.$inferSelect;
