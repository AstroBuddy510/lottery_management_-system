import { sql } from "drizzle-orm";
import {
  pgTable, uuid, varchar, decimal, text, timestamp, integer, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { writersTable } from "./agents";
import { ticketsTable } from "./tickets";
import { payoutRequestsTable } from "./game-results";

/**
 * The Master Wallet: the money set aside to pay POS wins.
 *
 * One row, two figures. `available` is what can still be promised to a claim;
 * `held` is what has already been promised to claims waiting on a cashier or
 * on Paystack. A claim moves its payout from available to held the moment it
 * is verified, so two claims can never both count on the same cedi, and a
 * cashier is never shown a payment the wallet cannot make.
 *
 * Both figures are CHECKed non-negative in the database. An allocation that
 * would overdraw fails as a constraint violation inside its transaction - the
 * application does not have to remember to compare first, and a bug that
 * forgot would still be refused.
 *
 * This is a ledger of what the company has committed, not a bank account. The
 * cash itself sits in the Paystack balance; the Director funds that and
 * records the same amount here, and the Master Wallet page shows the two side
 * by side so a drift between them is visible the day it happens.
 */
export const masterWalletTable = pgTable(
  "master_wallet",
  {
    // Always 1. The CHECK below makes a second wallet impossible to create.
    id: integer("id").primaryKey().default(1),
    available: decimal("available", { precision: 14, scale: 2 }).notNull().default("0"),
    held: decimal("held", { precision: 14, scale: 2 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("master_wallet_singleton", sql`${table.id} = 1`),
    check("master_wallet_available_nonneg", sql`${table.available} >= 0`),
    check("master_wallet_held_nonneg", sql`${table.held} >= 0`),
  ],
);

/**
 * Every movement of the Master Wallet. Append-only.
 *
 *   fund      Director adds money                    available +
 *   withdraw  Director takes unpromised money out    available -
 *   hold      a verified claim reserves its payout   available -, held +
 *   release   a rejected / withheld claim lets go    held -, available +
 *   disburse  Paystack confirms the transfer         held -
 *
 * `withdraw` is also how a mistake is put right. Because no row can be
 * edited, a top-up keyed with one zero too many is corrected by a second,
 * visible entry taking the difference back out - which is what an auditor
 * wants to see anyway. It can only ever take from `available`: money already
 * promised to a claim cannot be withdrawn from under it.
 *
 * Rows are never updated or deleted, and that is enforced by a trigger in
 * migration 0019 rather than by convention - an UPDATE or DELETE against this
 * table raises. End-of-day reconciliation is only worth doing against a record
 * that cannot have been tidied afterwards.
 *
 * Each row carries the balances it left behind, so the ledger can be replayed
 * and checked against itself without trusting the wallet row.
 */
export const masterWalletLedgerTable = pgTable(
  "master_wallet_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryType: varchar("entry_type", { length: 12 }).notNull(),
    /** Always positive; the entry type says which way it moved. */
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    availableAfter: decimal("available_after", { precision: 14, scale: 2 }).notNull(),
    heldAfter: decimal("held_after", { precision: 14, scale: 2 }).notNull(),
    payoutRequestId: uuid("payout_request_id").references(() => payoutRequestsTable.id),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id),
    actorRole: varchar("actor_role", { length: 30 }),
    /** A bank or transfer reference on a funding entry; Paystack's on a disbursement. */
    reference: varchar("reference", { length: 120 }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("master_wallet_ledger_amount_positive", sql`${table.amount} > 0`),
    check(
      "master_wallet_ledger_entry_type",
      sql`${table.entryType} in ('fund', 'withdraw', 'hold', 'release', 'disburse')`,
    ),
    index("master_wallet_ledger_created_idx").on(table.createdAt),
    index("master_wallet_ledger_payout_idx").on(table.payoutRequestId),
    /**
     * A payout request is disbursed at most once, ever.
     *
     * The status checks in the application already prevent a second payment.
     * This is the one that still holds if they are wrong: a second `disburse`
     * row for the same request is a unique violation, and the transaction
     * that tried it rolls back.
     */
    uniqueIndex("master_wallet_ledger_one_disburse")
      .on(table.payoutRequestId)
      .where(sql`${table.entryType} = 'disburse'`),
  ],
);

/**
 * Every attempt to claim a ticket on a POS, including the ones refused.
 *
 * A refused claim is the interesting one. A ticket from another company has
 * no row in `tickets`, so there is no ticket to hang an event on - without
 * this table, a writer feeding in forged or foreign tickets all afternoon
 * would leave no trace at all. The outcome codes are what Risk Management
 * counts: one `not_found` is a misread QR, twenty from the same writer is
 * somebody trying numbers.
 */
export const payoutClaimAttemptsTable = pgTable(
  "payout_claim_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    writerId: uuid("writer_id").notNull().references(() => writersTable.id),
    /** Null when the scanned reference matched no ticket of ours. */
    ticketId: uuid("ticket_id").references(() => ticketsTable.id),
    /** What was presented, truncated - a ticket number or the start of a payload. */
    presented: varchar("presented", { length: 200 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    /** `accepted`, or the reason it was refused. See lib/payout-claims.ts. */
    outcome: varchar("outcome", { length: 30 }).notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payout_claim_attempts_writer_idx").on(table.writerId, table.createdAt),
    index("payout_claim_attempts_outcome_idx").on(table.outcome, table.createdAt),
  ],
);

export type MasterWallet = typeof masterWalletTable.$inferSelect;
export type MasterWalletLedgerEntry = typeof masterWalletLedgerTable.$inferSelect;
export type PayoutClaimAttempt = typeof payoutClaimAttemptsTable.$inferSelect;
