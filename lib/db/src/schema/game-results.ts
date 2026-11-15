import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, decimal, boolean, timestamp, integer, pgEnum, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { gamesTable } from "./games";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";
import { writersTable, agentsTable } from "./agents";

/**
 * Where a winning ticket is on its way to being paid.
 *
 *   pending         in the Winning Tickets registry; nobody has claimed it yet
 *   verified        scanned on the selling writer's POS, checked against the
 *                   registry, and its payout held from the Master Wallet -
 *                   waiting in the cashier's POS WINS PAYMENT queue
 *   awaiting_funds  verified, but the Master Wallet could not cover the hold.
 *                   Sits outside the cashier queue until the Director funds it
 *   processing      a cashier approved it and the transfer is with Paystack
 *   paid            Paystack confirmed the money reached the writer's wallet
 *   rejected        a cashier refused it; flagged for the administrator
 *   withheld        the administrator dropped it after review. Final
 *
 * `approved` is the old flow's "authorised by an administrator" and is no
 * longer written - an administrator approving payouts is exactly the bypass
 * this lifecycle removes. The value stays because Postgres cannot drop an enum
 * member, and migration 0019 moves any such rows back to `pending`.
 */
export const payoutRequestStatusEnum = pgEnum("payout_request_status", [
  "pending",
  "approved",
  "paid",
  "rejected",
  "verified",
  "awaiting_funds",
  "processing",
  "withheld",
]);

export const gameResultsTable = pgTable("game_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id").notNull().unique().references(() => gamesTable.id),
  winningNumbers: varchar("winning_numbers", { length: 50 }).notNull(),
  machineNumbers: varchar("machine_numbers", { length: 50 }).notNull(),
  totalTickets: integer("total_tickets").notNull().default(0),
  totalStakes: decimal("total_stakes", { precision: 12, scale: 2 }).notNull().default("0"),
  totalWinners: integer("total_winners").notNull().default(0),
  totalPayouts: decimal("total_payouts", { precision: 12, scale: 2 }).notNull().default("0"),
  processedBy: uuid("processed_by").notNull().references(() => usersTable.id),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  smsNotificationsSent: boolean("sms_notifications_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payoutRequestsTable = pgTable("payout_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => ticketsTable.id),
  gameResultId: uuid("game_result_id").notNull().references(() => gameResultsTable.id),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
  payoutAmount: decimal("payout_amount", { precision: 12, scale: 2 }).notNull(),
  status: payoutRequestStatusEnum("status").notNull().default("pending"),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  /**
   * Stamped at calculation time when the writer who sold this ticket had not
   * settled their postpaid account for the draw. Company policy does not carry
   * wins on unsettled sales, so a reviewer decides this one rather than the
   * system paying it quietly. Holds what they owed, for the reviewer to see.
   */
  writerUnsettledAmount: decimal("writer_unsettled_amount", { precision: 12, scale: 2 }),
  notes: text("notes"),

  // ── Stage 03: the claim ──
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  /** `qr` when the printed code was scanned, `manual` when a number was typed. */
  claimMethod: varchar("claim_method", { length: 10 }),

  // ── Stage 04: who is to be paid, frozen at the moment of the claim ──
  /**
   * The wallet as it stood when the claim was made. The cashier approves THIS
   * number; re-reading the writer's record at transfer time would let a wallet
   * changed after approval receive money nobody reviewed it for.
   */
  payeeMomoNumber: varchar("payee_momo_number", { length: 20 }),
  payeeMomoProvider: varchar("payee_momo_provider", { length: 10 }),
  payeeName: varchar("payee_name", { length: 120 }),

  // ── Stage 05: the cashier's decision and the transfer ──
  reviewedBy: uuid("reviewed_by").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  /**
   * Our reference for the Paystack transfer, minted once when a cashier
   * approves and never changed. Paystack refuses a second transfer with the
   * same reference, so a retry after a timeout cannot pay twice - which a
   * fresh reference per attempt would.
   */
  transferReference: varchar("transfer_reference", { length: 60 }),
  transferCode: varchar("transfer_code", { length: 60 }),
  transferStatus: varchar("transfer_status", { length: 30 }),
  transferError: text("transfer_error"),
  transferInitiatedAt: timestamp("transfer_initiated_at", { withTimezone: true }),
  /**
   * How many transfers have been started for this request. A new attempt is
   * only ever made after Paystack has confirmed the previous one failed, and
   * it takes a new reference suffix - the number here is that suffix.
   */
  transferAttempts: integer("transfer_attempts").notNull().default(0),

  // ── Exception path: flagged, then resolved or withheld ──
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
  (table) => [
    index("payout_requests_game_result_idx").on(table.gameResultId),
    /**
     * One registry row per ticket, for ever.
     *
     * This was a plain index, and the lookup code carried a "a ticket may
     * match more than one payout row" workaround - which is to say nothing
     * stopped a ticket having two. Every state a claim passes through is a
     * transition on this one row, so with the row unique a ticket cannot be
     * redeemed twice by construction: there is no second row to pay.
     */
    uniqueIndex("payout_requests_ticket_unique").on(table.ticketId),
    index("payout_requests_writer_status_idx").on(table.writerId, table.status),
    // The cashier queue and the flagged queue each read one status at a time.
    index("payout_requests_status_claimed_idx").on(table.status, table.claimedAt),
    uniqueIndex("payout_requests_transfer_reference_unique")
      .on(table.transferReference)
      .where(sql`${table.transferReference} IS NOT NULL`),
  ],
);

export const insertGameResultSchema = createInsertSchema(gameResultsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertGameResult = z.infer<typeof insertGameResultSchema>;
export type GameResult = typeof gameResultsTable.$inferSelect;

export const insertPayoutRequestSchema = createInsertSchema(payoutRequestsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPayoutRequest = z.infer<typeof insertPayoutRequestSchema>;
export type PayoutRequest = typeof payoutRequestsTable.$inferSelect;
