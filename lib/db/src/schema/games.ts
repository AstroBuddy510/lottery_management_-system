import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
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
  goLiveAt: timestamp("go_live_at", { withTimezone: true }).notNull(),
  closeAt: timestamp("close_at", { withTimezone: true }).notNull(),
  status: gameStatusEnum("status").notNull().default("offline"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => usersTable.id),
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
