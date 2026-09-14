import { pgTable, uuid, varchar, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

/**
 * Append-only history of everything that happens to a ticket.
 *
 * The tickets table holds only the current state, which is enough to pay a
 * winner and useless for answering "who touched this, and when". Fraud is
 * almost always a statement about ORDER - a ticket validated before it was
 * sold, a payout made before the draw, a second claim on a ticket already
 * paid - and order is exactly what a current-state column throws away.
 *
 * Nothing here is ever updated or deleted. A correction is another row.
 */

export const ticketEventTypeEnum = pgEnum("ticket_event_type", [
  "sold",
  "validated", // looked up / scanned for checking
  "settled_won",
  "settled_lost",
  "claim_approved",
  "claim_rejected",
  "paid",
  "voided",
  "cancelled",
]);

export const ticketEventsTable = pgTable(
  "ticket_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => ticketsTable.id),
    eventType: ticketEventTypeEnum("event_type").notNull(),
    fromStatus: varchar("from_status", { length: 20 }),
    toStatus: varchar("to_status", { length: 20 }),
    /** Null for anything the system did on its own, such as settlement. */
    actorUserId: uuid("actor_user_id").references(() => usersTable.id),
    actorRole: varchar("actor_role", { length: 30 }),
    /** Where it came from: portal, admin, settlement, system. */
    source: varchar("source", { length: 20 }).notNull().default("system"),
    note: text("note"),
    /**
     * When it happened, which is not always when it was written: a `sold`
     * row carries the ticket's own creation time so the two can never drift
     * and make a false anomaly.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ticket_events_ticket_idx").on(table.ticketId, table.occurredAt),
    index("ticket_events_type_idx").on(table.eventType, table.occurredAt),
  ],
);

export type TicketEvent = typeof ticketEventsTable.$inferSelect;
