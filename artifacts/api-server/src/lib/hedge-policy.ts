import { db, hedgeSettingsTable, hedgeBetTypeCapsTable } from "@workspace/db";
import { DEFAULT_HEDGE_POLICY, type HedgePolicy } from "./exposure";

/**
 * The hedge policy in force, as one object the exposure engine can read.
 *
 * The settings row is created on first read rather than by the migration, so
 * a fresh database and an upgraded one behave the same: both start on the
 * documented defaults and neither needs a seed step.
 */
export async function loadHedgePolicy(): Promise<HedgePolicy> {
  const [row] = await db.select().from(hedgeSettingsTable).limit(1);

  if (!row) {
    const [created] = await db.insert(hedgeSettingsTable).values({}).returning();
    return { ...DEFAULT_HEDGE_POLICY, ...toPolicy(created), capsByBetType: {} };
  }

  const caps = await db
    .select({
      betTypeId: hedgeBetTypeCapsTable.betTypeId,
      maxLiability: hedgeBetTypeCapsTable.maxLiability,
    })
    .from(hedgeBetTypeCapsTable);

  const capsByBetType: Record<string, number> = {};
  for (const cap of caps) {
    const value = parseFloat(cap.maxLiability);
    if (Number.isFinite(value) && value > 0) capsByBetType[cap.betTypeId] = value;
  }

  return { ...toPolicy(row), capsByBetType };
}

type SettingsRow = {
  hugeWinThreshold: string;
  mediumCoveragePct: string;
  highCoveragePct: string;
  criticalCoveragePct: string;
  hedgeCoveragePct: string;
  minHedgeStake: string;
  hedgeHighCoverage: boolean;
};

function num(raw: string, fallback: number): number {
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function toPolicy(row: SettingsRow): Omit<HedgePolicy, "capsByBetType"> {
  return {
    hugeWinThreshold: num(row.hugeWinThreshold, DEFAULT_HEDGE_POLICY.hugeWinThreshold),
    mediumCoveragePct: num(row.mediumCoveragePct, DEFAULT_HEDGE_POLICY.mediumCoveragePct),
    highCoveragePct: num(row.highCoveragePct, DEFAULT_HEDGE_POLICY.highCoveragePct),
    criticalCoveragePct: num(row.criticalCoveragePct, DEFAULT_HEDGE_POLICY.criticalCoveragePct),
    hedgeCoveragePct: num(row.hedgeCoveragePct, DEFAULT_HEDGE_POLICY.hedgeCoveragePct),
    minHedgeStake: num(row.minHedgeStake, DEFAULT_HEDGE_POLICY.minHedgeStake),
    hedgeHighCoverage: row.hedgeHighCoverage,
  };
}
