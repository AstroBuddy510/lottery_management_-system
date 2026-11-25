import { db, systemSettingsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

/**
 * The one accounting formula for a writer's draw. Every screen, statement and
 * ledger in the platform reads figures produced here (or stored from here in
 * daily_calculations), so they cannot disagree.
 *
 *   1. Gross Sales
 *   2. Commission            = Gross Sales x commission rate
 *   3. Net After Commission  = Gross Sales - Commission
 *   4. Reserve               = Net After Commission x reserve rate
 *                              (on the net, never on gross)
 *   5. Net After Reserve     = Net After Commission - Reserve
 *   6. Profit / (Deficit)    = Net After Reserve - Wins Deduct
 *        > 0  profit:  the agency owes the company
 *        < 0  deficit: the company owes the agency
 *
 * Worked in whole pesewas. Each percentage step is rounded half-up to the
 * pesewa once, and the subtractions are exact, so the columns of a statement
 * always add across: Commission + Net After Commission = Gross, and so on.
 *
 * There is no reserve "cover" here. The Reserve Fund may pay a deficit out,
 * but that is the company funding the payout from its reserve - a Reserve
 * ledger entry - and it does not change what the draw produced.
 */

export interface CalculationResult {
  grossSales: number;
  commissionPct: number;
  commissionAmount: number;
  netAfterCommission: number;
  reservePct: number;
  reserveAmount: number;
  netAfterReserve: number;
  winsAmount: number;
  profitOrDeficit: number;
  /** Stored column names, kept so existing callers read the same values. */
  netGross: number;
  writerBalance: number;
}

/** Round half away from zero to a whole number, immune to binary residue (0.5 stored as 0.4999...). */
function roundHalfUp(x: number): number {
  const sign = x < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(x) + 0.5 + 1e-9);
}

/** Money in cedis -> whole pesewas. */
export const toPesewas = (v: number | string | null | undefined): number => roundHalfUp(Number(v ?? 0) * 100);
/** Whole pesewas -> cedis. */
export const toCedis = (p: number): number => p / 100;

export function calculateWriter(
  grossSales: number,
  winsAmount: number,
  commissionPct: number,
  reservePct: number,
): CalculationResult {
  const gross = toPesewas(grossSales);
  const wins = toPesewas(winsAmount);
  const commission = roundHalfUp(gross * commissionPct);
  const netAfterCommission = gross - commission;
  const reserve = roundHalfUp(netAfterCommission * reservePct);
  const netAfterReserve = netAfterCommission - reserve;
  const profitOrDeficit = netAfterReserve - wins;
  return {
    grossSales: toCedis(gross),
    commissionPct,
    commissionAmount: toCedis(commission),
    netAfterCommission: toCedis(netAfterCommission),
    reservePct,
    reserveAmount: toCedis(reserve),
    netAfterReserve: toCedis(netAfterReserve),
    winsAmount: toCedis(wins),
    profitOrDeficit: toCedis(profitOrDeficit),
    netGross: toCedis(netAfterCommission),
    writerBalance: toCedis(profitOrDeficit),
  };
}

/**
 * The commission and reserve rates the Administrator has set in Settings,
 * as fractions (0.30 = 30%). The single place every module reads them from;
 * each calculation row also stores the rates it used, so history keeps the
 * rates in force on its day.
 */
export async function currentRates(exec: Pick<typeof db, "select"> = db): Promise<{ commissionPct: number; reservePct: number }> {
  const [s] = await exec
    .select({ commissionPct: systemSettingsTable.commissionPct, reservePct: systemSettingsTable.reservePct })
    .from(systemSettingsTable)
    .orderBy(desc(systemSettingsTable.updatedAt))
    .limit(1);
  if (!s) throw new Error("System settings are missing: set the commission and reserve rates in Settings.");
  return { commissionPct: Number(s.commissionPct), reservePct: Number(s.reservePct) };
}

/**
 * The waterfall for figures already stored (one daily_calculations row, or a
 * sum of them). Net After Reserve and Profit/(Deficit) are derived from the
 * stored components rather than read, so a statement is right by
 * construction.
 */
export function waterfallFromStored(r: {
  grossSales: string | number; commissionAmount: string | number; netGross: string | number;
  reserveAmount: string | number; winsAmount: string | number;
}) {
  const gross = toPesewas(r.grossSales);
  const commission = toPesewas(r.commissionAmount);
  const net = toPesewas(r.netGross);
  const reserve = toPesewas(r.reserveAmount);
  const wins = toPesewas(r.winsAmount);
  return { gross, commission, net, reserve, netAfterReserve: net - reserve, wins, profitOrDeficit: net - reserve - wins };
}
