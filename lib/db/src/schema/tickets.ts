import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, decimal, boolean, timestamp, pgEnum, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { writersTable } from "./agents";
import { gamesTable } from "./games";
import { betTypesTable } from "./bet-types";
import { writerTokenTransactionsTable } from "./writer-tokens";

export const ticketStatusEnum = pgEnum("ticket_status", [
  "active",
  "won",
  "lost",
  "cancelled",
  "void",
]);

export const ticketsTable = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketNumber: varchar("ticket_number", { length: 30 }).notNull().unique(),
  /**
   * Groups the bets a customer bought together and paid for once.
   *
   * Each bet stays its own ticket, because a bet is what settles and what
   * pays - a perm winning three times and a direct losing are separate events
   * whatever slip they were printed on. The slip number only says they were
   * sold in one basket, so one itemised receipt can be produced. Null on a
   * single bet sold on its own.
   *
   * Deliberately NOT unique. It is a grouping key: every bet in one basket
   * carries the same value. A unique constraint was briefly added here and
   * would have rejected every slip of more than one bet - production had five
   * such groups, all legitimate, each a single writer's basket. Two different
   * baskets colliding on one number is the real risk, and the sequence behind
   * next_slip_number() is what removes it; enforcing it as a constraint would
   * need a slips table of its own.
   */
  slipNumber: varchar("slip_number", { length: 30 }),
  writerId: uuid("writer_id").notNull().references(() => writersTable.id),
  gameId: uuid("game_id").notNull().references(() => gamesTable.id),
  betTypeId: uuid("bet_type_id").notNull().references(() => betTypesTable.id),
  numbers: varchar("numbers", { length: 200 }).notNull(),
  /**
   * What the player pays for ONE line. The stake they hand over is this times
   * lineCount, which is what `stakeAmount` holds - so every sales figure in
   * the system keeps meaning "money taken" without needing to know about
   * lines at all.
   */
  stakePerLine: decimal("stake_per_line", { precision: 12, scale: 2 }).notNull().default("0"),
  lineCount: integer("line_count").notNull().default(1),
  /** Set only on banker bets. */
  bankerNumber: integer("banker_number"),
  stakeAmount: decimal("stake_amount", { precision: 12, scale: 2 }).notNull(),
  potentialPayout: decimal("potential_payout", { precision: 12, scale: 2 }).notNull(),
  status: ticketStatusEnum("status").notNull().default("active"),
  isWinner: boolean("is_winner").notNull().default(false),
  winAmount: decimal("win_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  tokenTransactionId: uuid("token_transaction_id").references(() => writerTokenTransactionsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
  (table) => [
    // Every writer opening their ticket list reads this way: their own
    // tickets, newest first. Without it that is a full scan of the table
    // the whole company sells into.
    index("tickets_writer_created_idx").on(table.writerId, table.createdAt.desc()),
    // Settlement and the live board sweep one game at a time, by state.
    index("tickets_game_status_idx").on(table.gameId, table.status),
    // Reprinting a slip finds every ticket sold on it.
    index("tickets_slip_number_idx")
      .on(table.slipNumber)
      .where(sql`${table.slipNumber} IS NOT NULL`),
  ],
);

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
