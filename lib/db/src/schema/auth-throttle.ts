import { pgTable, text, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";

/**
 * Failed sign-in counters, keyed by what is being protected.
 *
 * Scope is "phone" or "ip"; key is the phone number or the address. One row
 * per thing being watched, updated in place, so the table stays roughly as
 * large as the number of people who have recently mistyped a PIN rather than
 * growing with every attempt.
 *
 * This lives in Postgres rather than in memory because the API runs as a
 * serverless function: instances do not share memory and a cold start would
 * hand an attacker a fresh allowance.
 */
export const authThrottleTable = pgTable(
  "auth_throttle",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),

    /** Consecutive failures. Reset to zero on a successful sign-in. */
    failedCount: integer("failed_count").notNull().default(0),

    /** When the most recent failure landed; the lock is measured from here. */
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);
