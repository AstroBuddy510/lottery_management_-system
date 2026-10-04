import { pgTable, uuid, boolean, integer, text, timestamp, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

/**
 * Automated postpaid settlement.
 *
 * The manual postpaid flow collects once, after the draw. That leaves the
 * company carrying a whole game's sales on trust, and a writer who notices
 * they recorded no wins has every reason to go quiet. This tightens it: a
 * writer must settle what they have sold by the halfway point of each game's
 * selling window, and the terminal stops selling until they do.
 *
 * One row. A feature switch, not a history - when it is off, postpaid behaves
 * exactly as it did before, which is the whole point of having the switch.
 */
export const postpaidAutoSettingsTable = pgTable("postpaid_auto_settings", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Off by default. Turning it on changes when writers are made to pay. */
  enabled: boolean("enabled").notNull().default(false),

  /**
   * Minutes before the midpoint at which to warn, largest first, as a comma
   * separated list. Text rather than an array so the admin screen can edit it
   * as one field and so no migration is needed to change how many there are.
   */
  reminderLeadMinutes: text("reminder_lead_minutes").notNull().default("30,15,5"),

  /** Breathing room after the midpoint before selling actually stops. */
  graceMinutes: integer("grace_minutes").notNull().default(0),

  /** Whether an unpaid end-of-day bill blocks selling the following day. */
  blockNextDay: boolean("block_next_day").notNull().default(true),

  /** Below this, do not interrupt a writer to collect. */
  minimumChargeable: decimal("minimum_chargeable", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),

  /** Reminders by WhatsApp, on top of the in-app banner. */
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),

  /**
   * Last time the reminder sweep ran. There is no scheduler in this
   * deployment, so the sweep is driven opportunistically by live traffic and
   * throttled against this column; see lib/postpaid-auto.ts.
   */
  lastSweptAt: timestamp("last_swept_at", { withTimezone: true }),

  updatedBy: uuid("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertPostpaidAutoSettingsSchema = createInsertSchema(
  postpaidAutoSettingsTable,
).omit({ id: true, updatedAt: true });
