import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, boolean, timestamp, numeric, text, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const agentsTable = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  agentCode: varchar("agent_code", { length: 2 }).notNull().unique(),
  fullCode: varchar("full_code", { length: 10 }).notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  agencyName: varchar("agency_name", { length: 100 }),
  location: varchar("location", { length: 200 }),
  lat: numeric("lat", { precision: 9, scale: 6 }),
  lng: numeric("lng", { precision: 9, scale: 6 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  outstandingDebt: numeric("outstanding_debt", { precision: 12, scale: 2 }).notNull().default("0"),
  debtSince: timestamp("debt_since", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const writersTable = pgTable("writers", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agentsTable.id),
  writerCode: varchar("writer_code", { length: 6 }).notNull(),
  fullCode: varchar("full_code", { length: 16 }).notNull().unique(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 20 }).unique(),
  pinHash: text("pin_hash"),
  idType: varchar("id_type", { length: 30 }),
  idNumber: varchar("id_number", { length: 50 }),
  /**
   * Where this writer sells from.
   *
   * Nullable in the database although the creation form requires it: 74
   * writers predate the field, and a NOT NULL column would have meant either
   * refusing to load them or inventing coordinates for them. They read as "no
   * location set" and are absent from the terminal map until someone edits
   * them, which is honest about what is known.
   *
   * `location` is the text an agent typed; lat/lng are geocoded from it. The
   * text is kept because it is what a human recognises and what can be
   * re-geocoded later if the coordinates turn out wrong.
   */
  location: varchar("location", { length: 200 }),
  lat: numeric("lat", { precision: 9, scale: 6 }),
  lng: numeric("lng", { precision: 9, scale: 6 }),
  /**
   * Where a win is paid: the writer's registered mobile-money wallet.
   *
   * Kept apart from `phone` on purpose. The phone is how a writer signs in and
   * is texted; the wallet is where money goes, and the two are often different
   * SIMs. Paying to "whatever the phone number is" would send a disbursement
   * to a number nobody ever confirmed was a wallet.
   *
   * `momoAccountName` is what the network says the wallet is registered to,
   * resolved when the number is saved, so the cashier approving a payout sees
   * a name and not just eleven digits. `paystackRecipientCode` is Paystack's
   * handle for this exact number+network; it is cleared whenever either
   * changes, so a stale recipient can never be paid.
   */
  momoNumber: varchar("momo_number", { length: 20 }),
  /** Paystack's Ghana mobile-money codes: mtn, vod (Telecel), atl (AirtelTigo). */
  momoProvider: varchar("momo_provider", { length: 10 }),
  momoAccountName: varchar("momo_account_name", { length: 120 }),
  paystackRecipientCode: varchar("paystack_recipient_code", { length: 60 }),
  momoUpdatedAt: timestamp("momo_updated_at", { withTimezone: true }),
  momoUpdatedBy: uuid("momo_updated_by").references(() => usersTable.id),
  operationModel: varchar("operation_model", { length: 10 }).notNull().default("postpaid"),
  registrationSource: varchar("registration_source", { length: 20 }).notNull().default("agent"),
  approvalStatus: varchar("approval_status", { length: 20 }).notNull().default("approved"),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  isActive: boolean("is_active").notNull().default(true),
  // Risk watch. A red-flagged writer is one whose sales are large enough that
  // their book moves the company's exposure on its own, so Risk Management
  // keeps their tickets visible at all times rather than only in aggregate.
  isRedFlagged: boolean("is_red_flagged").notNull().default(false),
  redFlagReason: text("red_flag_reason"),
  redFlaggedBy: uuid("red_flagged_by").references(() => usersTable.id),
  redFlaggedAt: timestamp("red_flagged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** See the note on usersTable.sessionsValidFrom. */
  sessionsValidFrom: timestamp("sessions_valid_from", { withTimezone: true }),
},
  (table) => [
    index("writers_red_flagged_idx")
      .on(table.isRedFlagged)
      .where(sql`${table.isRedFlagged}`),
    // The terminal map asks for "writers with coordinates" and nothing else.
    // Declared here as well as in the migration because drizzle-kit push drops
    // indexes the schema does not know about.
    index("writers_located_idx")
      .on(table.agentId)
      .where(sql`${table.lat} is not null and ${table.lng} is not null`),
  ],
);

export const insertAgentSchema = createInsertSchema(agentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;

export const insertWriterSchema = createInsertSchema(writersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWriter = z.infer<typeof insertWriterSchema>;
export type Writer = typeof writersTable.$inferSelect;
