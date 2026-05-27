import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const gameStatusEnum = pgEnum("game_status", [
  "offline",
  "live",
  "closed",
]);

export const gamesTable = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventNumber: varchar("event_number", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  goLiveAt: timestamp("go_live_at", { withTimezone: true }).notNull(),
  closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
  status: gameStatusEnum("status").notNull().default("offline"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => usersTable.id),
  winningNumbers: varchar("winning_numbers", { length: 50 }),
  machineNumbers: varchar("machine_numbers", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const gameTemplatesTable = pgTable("game_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday, 1 = Monday, etc.
  logoUrl: text("logo_url"), // base64 logo string
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertGameSchema = createInsertSchema(gamesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;

export const insertGameTemplateSchema = createInsertSchema(gameTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGameTemplate = z.infer<typeof insertGameTemplateSchema>;
export type GameTemplate = typeof gameTemplatesTable.$inferSelect;
