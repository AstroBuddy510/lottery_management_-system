import {
  pgTable, uuid, varchar, numeric, date, boolean, text, timestamp, jsonb, index, unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * The company's own books. See drizzle/manual/0022_finance_foundation.sql for
 * the constraints and the append-only triggers; the comments there are the
 * long version.
 *
 * The rule that runs through all of it: a balance is never stored, it is
 * summed from rows that are never edited. The cash book is generated from the
 * records that caused each movement and keyed on them, so it cannot hold the
 * same movement twice and cannot quietly miss one.
 */

/** Real money: cash on hand, a bank account, the Paystack balance. */
export const finMoneyAccountsTable = pgTable("fin_money_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 12 }).notNull(),
  institution: varchar("institution", { length: 120 }),
  accountRef: varchar("account_ref", { length: 60 }),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  openingDate: date("opening_date"),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every receipt and payment. Append-only. */
export const finCashBookTable = pgTable(
  "fin_cash_book",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    direction: varchar("direction", { length: 3 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    accountId: uuid("account_id").notNull().references(() => finMoneyAccountsTable.id),
    method: varchar("method", { length: 20 }).notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: varchar("source_id", { length: 80 }).notNull(),
    leg: varchar("leg", { length: 40 }).notNull().default("main"),
    partyType: varchar("party_type", { length: 20 }),
    partyId: uuid("party_id"),
    partyLabel: varchar("party_label", { length: 160 }),
    reference: varchar("reference", { length: 120 }),
    memo: text("memo"),
    handledBy: uuid("handled_by").references(() => usersTable.id),
    reversesId: uuid("reverses_id"),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("fin_cash_book_source_unique").on(t.sourceType, t.sourceId, t.leg),
    index("fin_cash_book_occurred_idx").on(t.occurredAt.desc()),
    index("fin_cash_book_account_idx").on(t.accountId, t.occurredAt),
  ],
);

/** What Paystack actually charged, once per reference. */
export const finPaymentFeesTable = pgTable("fin_payment_fees", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  kind: varchar("kind", { length: 12 }).notNull(),
  sourceType: varchar("source_type", { length: 40 }).notNull(),
  sourceId: varchar("source_id", { length: 80 }).notNull(),
  gross: numeric("gross", { precision: 14, scale: 2 }).notNull(),
  fee: numeric("fee", { precision: 14, scale: 2 }),
  capturedFrom: varchar("captured_from", { length: 12 }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  feeSetBy: uuid("fee_set_by").references(() => usersTable.id),
  feeSetAt: timestamp("fee_set_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Named earmarks inside the money accounts. */
export const finFundsTable = pgTable("fin_funds", {
  code: varchar("code", { length: 30 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Allocations to, and releases or spending from, a fund. Append-only. */
export const finFundMovementsTable = pgTable(
  "fin_fund_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fundCode: varchar("fund_code", { length: 30 }).notNull().references(() => finFundsTable.code),
    entryType: varchar("entry_type", { length: 10 }).notNull(),
    delta: numeric("delta", { precision: 14, scale: 2 }).notNull(),
    accountId: uuid("account_id").references(() => finMoneyAccountsTable.id),
    reason: text("reason").notNull(),
    reference: varchar("reference", { length: 120 }),
    sourceType: varchar("source_type", { length: 40 }),
    sourceId: varchar("source_id", { length: 80 }),
    authorisedBy: uuid("authorised_by").references(() => usersTable.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("fin_fund_movements_source_unique").on(t.sourceType, t.sourceId)],
);

/** A counted or stated balance set against the book's figure. Append-only. */
export const finBalanceChecksTable = pgTable("fin_balance_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => finMoneyAccountsTable.id),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  statementBalance: numeric("statement_balance", { precision: 14, scale: 2 }).notNull(),
  bookBalance: numeric("book_balance", { precision: 14, scale: 2 }).notNull(),
  difference: numeric("difference", { precision: 14, scale: 2 }).notNull(),
  source: varchar("source", { length: 12 }).notNull(),
  note: text("note"),
  enteredBy: uuid("entered_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Who did what to a financial record. Append-only. */
export const finAuditLogTable = pgTable("fin_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id),
  actorRole: varchar("actor_role", { length: 30 }),
  action: varchar("action", { length: 60 }).notNull(),
  entity: varchar("entity", { length: 40 }).notNull(),
  entityId: varchar("entity_id", { length: 80 }),
  detail: jsonb("detail"),
  note: text("note"),
});

export type FinMoneyAccount = typeof finMoneyAccountsTable.$inferSelect;
export type FinCashBookEntry = typeof finCashBookTable.$inferSelect;
export type FinPaymentFee = typeof finPaymentFeesTable.$inferSelect;
