import {
  grossEntriesTable,
  winsEntriesTable,
  ticketsTable,
  writersTable,
  ticketEventsTable,
} from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";

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
  /**
   * Restrict to these writers. Omitted means every writer, which is what the
   * calculation run and the company-wide dashboard want.
   *
   * A writer asking for their own figures used to come through here unscoped:
   * every writer's gross, wins and tickets were aggregated and all but one
   * row thrown away in JavaScript. One writer's dashboard did the whole
   * company's arithmetic, and with every writer polling, the work grew with
   * the square of the roster.
   */
  writerIds?: readonly string[] | undefined;
}

/**
 * Returns totals keyed by writerId, combining agent entries and portal
 * tickets. Uses the same "skip late, unconfirmed" rule the calculation run
 * has always applied to gross entries.
 */
export async function getUnifiedWriterTotals(
  database: any,
  { calcDate, gameId, writerIds }: UnifiedScope,
): Promise<Map<string, WriterTotals>> {
  const scoped = gameId && gameId !== "undefined" && gameId !== "null" ? gameId : undefined;
  // An empty list means "no writers", which is not the same as "all writers".
  const only = writerIds && writerIds.length > 0 ? writerIds : undefined;
  if (writerIds && writerIds.length === 0) return new Map();
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
  if (only) grossConditions.push(inArray(grossEntriesTable.writerId, only as string[]));
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
  if (only) winsConditions.push(inArray(winsEntriesTable.writerId, only as string[]));
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
  if (only) ticketConditions.push(inArray(ticketsTable.writerId, only as string[]));
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

/**
 * When each writer's figures last moved.
 *
 * The Live Entries table shows a "Gross At" and a "Wins At" so a supervisor
 * can tell a stale row from a quiet one. Those columns used to read the
 * created_at of the agent's typed entry, which is the only timestamp that
 * exists if you never look at tickets - so a writer selling steadily through
 * the portal showed an empty clock all day.
 *
 * Gross moves when an entry is keyed in or a ticket is sold. Wins move when a
 * wins entry is keyed in or a draw settles. Settlement time comes from the
 * ticket_events row rather than the ticket, because the tickets table keeps no
 * record of when it was settled - only that it was.
 *
 * Kept out of getUnifiedWriterTotals on purpose: the nightly calculation run
 * needs the money and not the clock, and these are four more queries.
 */
export interface WriterActivity {
  /** ISO timestamp, or null when nothing has moved. */
  grossAt: string | null;
  winsAt: string | null;
}

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function getUnifiedWriterActivity(
  database: any,
  { calcDate, gameId, writerIds }: UnifiedScope,
): Promise<Map<string, WriterActivity>> {
  const scoped = gameId && gameId !== "undefined" && gameId !== "null" ? gameId : undefined;
  const only = writerIds && writerIds.length > 0 ? writerIds : undefined;
  if (writerIds && writerIds.length === 0) return new Map();

  const activity = new Map<string, WriterActivity>();
  const mark = (writerId: string, field: "grossAt" | "winsAt", at: unknown) => {
    const stamp = iso(at);
    if (!stamp) return;
    let row = activity.get(writerId);
    if (!row) {
      row = { grossAt: null, winsAt: null };
      activity.set(writerId, row);
    }
    row[field] = later(row[field], stamp);
  };

  const grossConditions = [eq(grossEntriesTable.entryDate, calcDate)];
  if (scoped) grossConditions.push(eq(grossEntriesTable.gameId, scoped));
  if (only) grossConditions.push(inArray(grossEntriesTable.writerId, only as string[]));
  const grossStamps = await database
    .select({
      writerId: grossEntriesTable.writerId,
      at: sql<string>`max(${grossEntriesTable.createdAt})`,
    })
    .from(grossEntriesTable)
    .where(and(...grossConditions))
    .groupBy(grossEntriesTable.writerId);
  for (const r of grossStamps) mark(r.writerId, "grossAt", r.at);

  const winsConditions = [eq(winsEntriesTable.entryDate, calcDate)];
  if (scoped) winsConditions.push(eq(winsEntriesTable.gameId, scoped));
  if (only) winsConditions.push(inArray(winsEntriesTable.writerId, only as string[]));
  const winsStamps = await database
    .select({
      writerId: winsEntriesTable.writerId,
      at: sql<string>`max(${winsEntriesTable.createdAt})`,
    })
    .from(winsEntriesTable)
    .where(and(...winsConditions))
    .groupBy(winsEntriesTable.writerId);
  for (const r of winsStamps) mark(r.writerId, "winsAt", r.at);

  // The same ticket filter getUnifiedWriterTotals uses, so the clock and the
  // money can never describe different sets of tickets.
  const ticketConditions = [sql`${ticketsTable.status} not in ('cancelled', 'void')`];
  if (only) ticketConditions.push(inArray(ticketsTable.writerId, only as string[]));
  if (scoped) {
    ticketConditions.push(eq(ticketsTable.gameId, scoped));
  } else {
    ticketConditions.push(sql`date(${ticketsTable.createdAt}) = ${calcDate}`);
  }

  const soldStamps = await database
    .select({
      writerId: ticketsTable.writerId,
      at: sql<string>`max(${ticketsTable.createdAt})`,
    })
    .from(ticketsTable)
    .where(and(...(ticketConditions as never[])))
    .groupBy(ticketsTable.writerId);
  for (const r of soldStamps) mark(r.writerId, "grossAt", r.at);

  const settledStamps = await database
    .select({
      writerId: ticketsTable.writerId,
      at: sql<string>`max(${ticketEventsTable.occurredAt})`,
    })
    .from(ticketEventsTable)
    .innerJoin(ticketsTable, eq(ticketEventsTable.ticketId, ticketsTable.id))
    .where(
      and(
        eq(ticketEventsTable.eventType, "settled_won"),
        ...(ticketConditions as never[]),
      ),
    )
    .groupBy(ticketsTable.writerId);
  for (const r of settledStamps) mark(r.writerId, "winsAt", r.at);

  return activity;
}
