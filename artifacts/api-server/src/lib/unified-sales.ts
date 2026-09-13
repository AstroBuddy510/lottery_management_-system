import {
  grossEntriesTable,
  winsEntriesTable,
  ticketsTable,
  writersTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

/**
 * Unified per-writer gross and wins.
 *
 * A writer's takings can arrive two ways: their agent enters a gross figure
 * for them, or the writer sells through the portal and each sale becomes a
 * ticket. Both are real sales and must feed the same formula, or the
 * dashboard and the daily calculation disagree with each other.
 *
 * The two sources are summed, not merged: an agent entry and a portal ticket
 * are separate sales. If an agent also keys in totals that already include
 * their writers' portal sales, that would double-count - the two submission
 * routes are expected to be exclusive per writer per draw.
 */

export interface WriterTotals {
  gross: number;
  wins: number;
  /** Split by origin, so a discrepancy can be traced to a source. */
  entryGross: number;
  entryWins: number;
  ticketGross: number;
  ticketWins: number;
  ticketCount: number;
}

function blank(): WriterTotals {
  return {
    gross: 0,
    wins: 0,
    entryGross: 0,
    entryWins: 0,
    ticketGross: 0,
    ticketWins: 0,
    ticketCount: 0,
  };
}

export interface UnifiedScope {
  /** Entry date, YYYY-MM-DD. Required for agent-entered figures. */
  calcDate: string;
  /** Restrict to one draw. Omitted means every game on that date. */
  gameId?: string | undefined;
}

/**
 * Returns totals keyed by writerId, combining agent entries and portal
 * tickets. Uses the same "skip late, unconfirmed" rule the calculation run
 * has always applied to gross entries.
 */
export async function getUnifiedWriterTotals(
  database: any,
  { calcDate, gameId }: UnifiedScope,
): Promise<Map<string, WriterTotals>> {
  const scoped = gameId && gameId !== "undefined" && gameId !== "null" ? gameId : undefined;
  const totals = new Map<string, WriterTotals>();
  const bucket = (writerId: string): WriterTotals => {
    let t = totals.get(writerId);
    if (!t) {
      t = blank();
      totals.set(writerId, t);
    }
    return t;
  };

  // ── Agent-entered gross ──
  const grossConditions = [eq(grossEntriesTable.entryDate, calcDate)];
  if (scoped) grossConditions.push(eq(grossEntriesTable.gameId, scoped));
  const grossEntries = await database
    .select()
    .from(grossEntriesTable)
    .where(and(...grossConditions));

  for (const e of grossEntries) {
    // A late entry counts only once an administrator has confirmed it.
    if (e.isLate && !e.adminConfirmed) continue;
    const t = bucket(e.writerId);
    t.entryGross += parseFloat(e.grossAmount);
  }

  // ── Agent-entered wins ──
  const winsConditions = [eq(winsEntriesTable.entryDate, calcDate)];
  if (scoped) winsConditions.push(eq(winsEntriesTable.gameId, scoped));
  const winsEntries = await database
    .select()
    .from(winsEntriesTable)
    .where(and(...winsConditions));

  for (const e of winsEntries) {
    const t = bucket(e.writerId);
    t.entryWins += parseFloat(e.winsAmount);
  }

  // ── Writer portal tickets (prepaid and postpaid alike) ──
  // Cancelled and void tickets are not sales and must not inflate gross.
  const ticketConditions = [sql`${ticketsTable.status} not in ('cancelled', 'void')`];
  if (scoped) {
    ticketConditions.push(eq(ticketsTable.gameId, scoped));
  } else {
    ticketConditions.push(sql`date(${ticketsTable.createdAt}) = ${calcDate}`);
  }

  const ticketRows = await database
    .select({
      writerId: ticketsTable.writerId,
      stake: sql<string>`coalesce(sum(${ticketsTable.stakeAmount}), 0)::text`,
      wins: sql<string>`coalesce(sum(${ticketsTable.winAmount}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(ticketsTable)
    .innerJoin(writersTable, eq(ticketsTable.writerId, writersTable.id))
    .where(and(...(ticketConditions as never[])))
    .groupBy(ticketsTable.writerId);

  for (const r of ticketRows) {
    const t = bucket(r.writerId);
    t.ticketGross += parseFloat(r.stake);
    t.ticketWins += parseFloat(r.wins);
    t.ticketCount += r.count;
  }

  for (const t of totals.values()) {
    t.gross = t.entryGross + t.ticketGross;
    t.wins = t.entryWins + t.ticketWins;
  }

  return totals;
}
