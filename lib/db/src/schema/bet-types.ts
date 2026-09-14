import { pgTable, uuid, varchar, decimal, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const betTypesTable = pgTable("bet_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 50 }).notNull(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  description: text("description"),
  numbersRequired: integer("numbers_required").notNull(),
  payoutMultiplier: decimal("payout_multiplier", { precision: 10, scale: 2 }).notNull(),
  isPermutation: boolean("is_permutation").notNull().default(false),
  /**
   * Which set of rules prices and settles this bet. The multiplier above says
   * how much a line pays; the mechanic says what a line IS - a pair, a triple,
   * a banker-and-partner - and therefore how many of them a selection buys.
   */
  mechanic: varchar("mechanic", { length: 30 }).notNull().default("direct_two"),
  /** Numbers the player picks, not counting a banker. */
  minNumbers: integer("min_numbers").notNull().default(2),
  maxNumbers: integer("max_numbers").notNull().default(2),
  /**
   * Stake bounds for ONE line. A zero maximum means no ceiling - which is how
   * the screen shows "0 / 0" for a type nobody has priced yet.
   */
  minStake: decimal("min_stake", { precision: 12, scale: 2 }).notNull().default("0"),
  maxStake: decimal("max_stake", { precision: 12, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  updatedBy: uuid("updated_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertBetTypeSchema = createInsertSchema(betTypesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBetType = z.infer<typeof insertBetTypeSchema>;
export type BetType = typeof betTypesTable.$inferSelect;
