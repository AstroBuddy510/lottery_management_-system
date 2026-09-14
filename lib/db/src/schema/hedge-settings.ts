import { pgTable, uuid, decimal, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { betTypesTable } from "./bet-types";

/**
 * When a line is big enough to insure.
 *
 * Risk Management ranks every combination by what we would owe if it were
 * drawn. Deciding which of those is "huge" is a commercial judgement, not a
 * constant, so it lives here: a cash ceiling above which a payout must be
 * laid off at the NLA, the share of the pool at which a line turns serious,
 * and how much of the liability to cover when we do hedge.
 *
 * One row. Updated in place, unlike system_settings, because a threshold has
 * no retroactive meaning - last night's draw was judged by the numbers that
 * were in force when it was sold, and the exposure screen is always live.
 */
export const hedgeSettingsTable = pgTable("hedge_settings", {
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * Cash ceiling on a single combination. At or above this, the line must be
   * hedged however small a share of the pool it is - a payout this size is a
   * problem on its own.
   */
  hugeWinThreshold: decimal("huge_win_threshold", { precision: 14, scale: 2 })
    .notNull()
    .default("10000"),

  /** Share of everything taken on the game at which a line turns serious. */
  mediumCoveragePct: decimal("medium_coverage_pct", { precision: 5, scale: 4 }).notNull().default("0.25"),
  highCoveragePct: decimal("high_coverage_pct", { precision: 5, scale: 4 }).notNull().default("0.5"),
  criticalCoveragePct: decimal("critical_coverage_pct", { precision: 5, scale: 4 }).notNull().default("1"),

  /** How much of a liability to lay off. 1 = cover it in full. */
  hedgeCoveragePct: decimal("hedge_coverage_pct", { precision: 5, scale: 4 }).notNull().default("1"),

  /** Below this the hedge costs more in trouble than it saves. */
  minHedgeStake: decimal("min_hedge_stake", { precision: 12, scale: 2 }).notNull().default("0"),

  /** Whether a high-coverage line must be hedged even under the cash ceiling. */
  hedgeHighCoverage: boolean("hedge_high_coverage").notNull().default(true),

  updatedBy: uuid("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * A per-bet-type ceiling. Bet types pay at very different odds, so one cash
 * figure across all of them is crude: a cap here overrides the global
 * threshold for that bet type alone.
 */
export const hedgeBetTypeCapsTable = pgTable("hedge_bet_type_caps", {
  id: uuid("id").primaryKey().defaultRandom(),
  betTypeId: uuid("bet_type_id")
    .notNull()
    .unique()
    .references(() => betTypesTable.id),
  maxLiability: decimal("max_liability", { precision: 14, scale: 2 }).notNull(),
  updatedBy: uuid("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type HedgeSettings = typeof hedgeSettingsTable.$inferSelect;
export type HedgeBetTypeCap = typeof hedgeBetTypeCapsTable.$inferSelect;
