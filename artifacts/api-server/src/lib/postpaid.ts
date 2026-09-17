/**
 * What a postpaid writer owes for a draw, and when they owe it.
 *
 * A postpaid writer sells on the company's behalf and holds the cash. At the
 * end of the draw they hand it in, keeping their commission. Two rules govern
 * the figure, and both exist because of how the paper system used to fail:
 *
 * 1. Wins do NOT come off what they owe. The company pays winners through the
 *    agents; the writer is never out of pocket for a win. Netting wins off the
 *    settlement would hand a writer a risk-free position - sell all day, record
 *    a big win, owe nothing - which is the exact behaviour the ledger exists to
 *    stop. Wins are shown to the writer, and only shown.
 *
 * 2. The commission rate is frozen when betting closes. The admin adjusts the
 *    live rate over time; a ledger already quoted must keep the rate it was
 *    quoted at, or last month's settled books move when someone edits a
 *    setting.
 *
 * The deadline is the calculation run, not the draw. A writer who has not
 * settled by then has their payouts stamped for review rather than paid
 * silently - the company does not carry wins on sales that were never
 * settled.
 */
import {
  postpaidDailyLedgerTable,
  systemSettingsTable,
  writersTable,
  gamesTable,
  payoutRequestsTable,
} from "@workspace/db";
import { eq, and, isNull, sql, desc } from "drizzle-orm";

/** Two decimal places, as money is stored. */
function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export interface SettlementFigures {
  grossStakes: number;
  commissionPct: number;
  commissionAmount: number;
  amountPayable: number;
}

/**
 * Split gross stakes into the writer's commission and the company's money.
 *
 * Commission is a share of GROSS sales, which is what the Settings screen
 * says it is. The remainder is what the writer hands over.
 */
export function splitSettlement(grossStakes: number, commissionPct: number): SettlementFigures {
  const gross = Math.max(grossStakes, 0);
  const pct = Math.min(Math.max(commissionPct, 0), 1);
  const commission = Math.round(gross * pct * 100) / 100;
  return {
    grossStakes: gross,
    commissionPct: pct,
    commissionAmount: commission,
    // Never negative: a writer cannot end up owed money by selling.
    amountPayable: Math.max(Math.round((gross - commission) * 100) / 100, 0),
  };
}

/**
 * The writer commission rate the admin currently has set, as a fraction.
 *
 * Settings rows are append-only, so the live rate is the newest row - ordered
 * the same way the Settings screen orders it, otherwise the rate quoted here
 * and the rate the admin sees could differ.
 */
export async function currentWriterCommissionPct(tx: any): Promise<number> {
  const [settings] = await tx
    .select({ pct: systemSettingsTable.writerCommissionPct })
    .from(systemSettingsTable)
    .orderBy(desc(systemSettingsTable.updatedAt))
    .limit(1);

  const pct = Number(settings?.pct ?? 0);
  return Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 1) : 0;
}

/**
 * Quote every ledger whose betting window has shut and that has not been
 * quoted yet, and hand the writer their figure.
 *
 * Betting closing is the trigger, not the game record flipping to `closed` -
 * that only happens when calculations run, which is the writer's DEADLINE and
 * far too late to be telling them what they owe. Idempotent, so it is safe to
 * call on every read: a ledger with a rate already on it is never re-quoted.
 */
export async function quoteDueLedgers(
  tx: any,
  opts: { gameId?: string; writerId?: string } = {},
): Promise<number> {
  const pct = await currentWriterCommissionPct(tx);

  const conditions = [
    isNull(postpaidDailyLedgerTable.commissionPct),
    eq(postpaidDailyLedgerTable.settlementStatus, "open"),
    // Betting has shut, however the game record is marked.
    sql`(${gamesTable.closeAt} <= now() or ${gamesTable.status} = 'closed')`,
  ];
  if (opts.gameId) conditions.push(eq(postpaidDailyLedgerTable.gameId, opts.gameId));
  if (opts.writerId) conditions.push(eq(postpaidDailyLedgerTable.writerId, opts.writerId));

  const due = await tx
    .select({
      id: postpaidDailyLedgerTable.id,
      totalStakes: postpaidDailyLedgerTable.totalStakes,
    })
    .from(postpaidDailyLedgerTable)
    .innerJoin(gamesTable, eq(postpaidDailyLedgerTable.gameId, gamesTable.id))
    .where(and(...(conditions as never[])));

  for (const row of due as Array<{ id: string; totalStakes: string }>) {
    const figures = splitSettlement(Number(row.totalStakes), pct);
    await tx
      .update(postpaidDailyLedgerTable)
      .set({
        commissionPct: pct.toFixed(4),
        commissionAmount: money(figures.commissionAmount),
        amountPayable: money(figures.amountPayable),
        // Kept in step so anything still reading netBalance sees the payable
        // figure rather than the old wins-netted one.
        netBalance: money(figures.amountPayable),
        quotedAt: new Date(),
        settlementStatus: "calculated",
      })
      .where(eq(postpaidDailyLedgerTable.id, row.id));
  }

  return due.length;
}

export interface UnsettledWriter {
  ledgerId: string;
  writerId: string;
  writerName: string;
  writerCode: string;
  amountPayable: string;
}

/** Who has not handed in their money for this draw. */
export async function unsettledWritersForGame(tx: any, gameId: string): Promise<UnsettledWriter[]> {
  const rows = await tx
    .select({
      ledgerId: postpaidDailyLedgerTable.id,
      writerId: postpaidDailyLedgerTable.writerId,
      writerName: writersTable.fullName,
      writerCode: writersTable.fullCode,
      amountPayable: postpaidDailyLedgerTable.amountPayable,
    })
    .from(postpaidDailyLedgerTable)
    .innerJoin(writersTable, eq(postpaidDailyLedgerTable.writerId, writersTable.id))
    .where(
      and(
        eq(postpaidDailyLedgerTable.gameId, gameId),
        sql`${postpaidDailyLedgerTable.settlementStatus} <> 'settled'`,
        sql`${postpaidDailyLedgerTable.amountPayable}::numeric > 0`,
      ),
    );

  return rows as UnsettledWriter[];
}

/**
 * Mark the draw's unsettled writers, and stamp their payouts so a reviewer
 * sees the debt next to the win rather than having to go and look for it.
 *
 * Called from the calculation run, inside its transaction, AFTER settlement
 * has created the payout requests.
 */
export async function stampUnsettledAtCalculation(
  tx: any,
  gameId: string,
): Promise<UnsettledWriter[]> {
  const unsettled = await unsettledWritersForGame(tx, gameId);
  if (unsettled.length === 0) return [];

  const now = new Date();
  for (const w of unsettled) {
    await tx
      .update(postpaidDailyLedgerTable)
      .set({ unsettledAtCalculation: now })
      .where(eq(postpaidDailyLedgerTable.id, w.ledgerId));

    // Only this draw's requests, and only ones nobody has decided yet.
    await tx
      .update(payoutRequestsTable)
      .set({ writerUnsettledAmount: w.amountPayable })
      .where(
        and(
          eq(payoutRequestsTable.writerId, w.writerId),
          eq(payoutRequestsTable.status, "pending"),
          sql`${payoutRequestsTable.gameResultId} in (select id from game_results where game_id = ${gameId})`,
        ),
      );
  }

  return unsettled;
}
