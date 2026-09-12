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
