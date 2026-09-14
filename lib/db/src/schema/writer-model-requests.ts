import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { writersTable } from "./agents";
import { usersTable } from "./users";

/**
 * A writer asking to sell on credit.
 *
 * Postpaid means the writer takes bets without paying for units first, so the
 * company carries the exposure until settlement. That is a commercial
 * decision about a particular person, not a setting they flip themselves -
 * which is why the request is recorded here and someone else decides it.
 *
 * Before this existed the portal told writers "ask your agent" and created
 * nothing, so the request reached no one.
 */
export const writerModelRequestsTable = pgTable(
  "writer_model_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    writerId: uuid("writer_id")
      .notNull()
      .references(() => writersTable.id),
    /** What they are asking to become. */
    requestedModel: varchar("requested_model", { length: 10 }).notNull(),
    /** The model they were on when they asked, so a decision reads in context. */
    currentModel: varchar("current_model", { length: 10 }).notNull(),
    status: varchar("status", { length: 10 }).notNull().default("pending"),
    /** The writer's own words for why. */
    reason: text("reason"),
    decidedBy: uuid("decided_by").references(() => usersTable.id),
    /** Agent, administrator or cashier - who actually settled it. */
    decidedByRole: varchar("decided_by_role", { length: 20 }),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("writer_model_requests_status_idx").on(table.status, table.createdAt),
    index("writer_model_requests_writer_idx").on(table.writerId, table.createdAt),
  ],
);

export type WriterModelRequest = typeof writerModelRequestsTable.$inferSelect;
