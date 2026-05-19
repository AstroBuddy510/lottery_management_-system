import { pgTable, uuid, varchar, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", [
  "director",
  "administrator",
  "cashier",
  "gross_entry",
  "wins_entry",
  "agent",
]);

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 20 }).unique(),
  email: varchar("email", { length: 100 }).unique(),
  pinHash: text("pin_hash"),
  passwordHash: text("password_hash"),
  role: userRoleEnum("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLogin: timestamp("last_login", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  lastLogin: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
