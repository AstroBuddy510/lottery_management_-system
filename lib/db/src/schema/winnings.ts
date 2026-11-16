import { pgTable, uuid, varchar, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { payoutRequestsTable } from "./game-results";
import { ticketsTable } from "./tickets";
import { writersTable } from "./agents";
import { usersTable } from "./users";
import { finMoneyAccountsTable } from "./finance";

/**
 * A POS win nobody claimed within its 15 days, released from the winnings
 * liability exactly once. The payout request keeps its own status (the claim
 * screens already treat it as expired); this row is the accounting record
 * that it stopped being owed and became Expired/Unclaimed Winnings Income.
 * Append-only.
 */
export const winningsExpiriesTable = pgTable("winnings_expiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  payoutRequestId: uuid("payout_request_id").notNull().unique().references(() => payoutRequestsTable.id),
  ticketId: uuid("ticket_id").notNull().references(() => ticketsTable.id),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  gameId: uuid("game_id"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  winDate: timestamp("win_date", { withTimezone: true }).notNull(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

/**
 * Cash put up - usually by a writer - towards wins the reserve could not
 * cover. Not income: it is money received for a purpose. A refund is its own
 * row pointing at the contribution it returns. Append-only.
 */
export const winningsContributionsTable = pgTable("winnings_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryType: varchar("entry_type", { length: 12 }).notNull().default("contribution"),
  refundOf: uuid("refund_of"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  contributorType: varchar("contributor_type", { length: 12 }).notNull(),
  contributorId: uuid("contributor_id"),
  contributorName: varchar("contributor_name", { length: 160 }).notNull(),
  method: varchar("method", { length: 12 }).notNull(),
  accountId: uuid("account_id").notNull().references(() => finMoneyAccountsTable.id),
  purpose: text("purpose").notNull(),
  payoutRequestId: uuid("payout_request_id"),
  gameId: uuid("game_id"),
  reference: varchar("reference", { length: 120 }),
  receivedBy: uuid("received_by").notNull().references(() => usersTable.id),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
