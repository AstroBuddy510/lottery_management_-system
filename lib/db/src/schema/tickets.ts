import { pgTable, uuid, varchar, decimal, boolean, timestamp, pgEnum, integer } from "drizzle-orm/pg-core";
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
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
