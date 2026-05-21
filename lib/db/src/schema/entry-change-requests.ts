import { pgTable, uuid, date, numeric, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { writersTable } from "./agents";

export const entryChangeRequestsTable = pgTable("entry_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestedBy: uuid("requested_by").notNull().references(() => usersTable.id),
  entryType: varchar("entry_type", { length: 5 }).notNull(),
  entryId: uuid("entry_id").notNull(),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  entryDate: date("entry_date").notNull(),
  currentAmount: numeric("current_amount", { precision: 12, scale: 2 }).notNull(),
  requestedAmount: numeric("requested_amount", { precision: 12, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending_admin"),
  adminNote: text("admin_note"),
  reviewedByAdmin: uuid("reviewed_by_admin").references(() => usersTable.id),
  adminReviewedAt: timestamp("admin_reviewed_at", { withTimezone: true }),
  directorNote: text("director_note"),
  reviewedByDirector: uuid("reviewed_by_director").references(() => usersTable.id),
  directorReviewedAt: timestamp("director_reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type EntryChangeRequest = typeof entryChangeRequestsTable.$inferSelect;
