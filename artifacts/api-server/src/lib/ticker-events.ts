import { sql, type SQL } from "drizzle-orm";
import { logger } from "./logger";

/**
 * The Live Ticker's one description of a sale.
 *
 * The same SELECT feeds both halves of the page: the NOTIFY sent the moment a
 * sale commits, and the snapshot a browser loads when it opens or reconnects.
 * Building both from this one fragment is what keeps a row that arrived over
 * the socket identical to the same row loaded later - otherwise the feed
 * would visibly change shape on the first refresh.
 */
export const TICKER_CHANNEL = "live_ticker";

export type TickerEvent = {
  id: string;
  ticketNumber: string;
  createdAt: string;
  stake: string;
  numbers: string;
  banker: number | null;
  status: string;
  betType: string | null;
  gameId: string;
  gameName: string;
  eventNumber: string;
  writerId: string;
  writerName: string;
  writerCode: string;
  location: string | null;
  model: string;
  agentId: string;
  agentCode: string;
  agencyName: string;
  terminalSerial: string | null;
  terminalModel: string | null;
};

/**
 * One JSON object per ticket, under the column name `event`.
 *
 * The terminal is the one the writer holds now - an open assignment, at most
 * one per writer by the partial unique index - and is null for a writer
 * selling without a registered device. Its location is the writer's own,
 * falling back to the agency's: a terminal is registered to a person, and
 * the person is registered to a place.
 *
 * The channel is read off the ticket, not the writer: a prepaid sale is one
 * paid from the float, which is exactly a ticket with a wallet debit behind
 * it. A writer can change model mid-day; their morning's sales stay what
 * they were.
 */
export function tickerEventsSql(where: SQL, tail: SQL = sql``): SQL {
  return sql`
    SELECT json_build_object(
      'id',             t.id,
      'ticketNumber',   t.ticket_number,
      'createdAt',      to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'stake',          t.stake_amount::text,
      'numbers',        t.numbers,
      'banker',         t.banker_number,
      'status',         t.status,
      'betType',        bt.name,
      'gameId',         g.id,
      'gameName',       g.name,
      'eventNumber',    g.event_number,
      'writerId',       w.id,
      'writerName',     w.full_name,
      'writerCode',     w.full_code,
      'location',       coalesce(nullif(w.location, ''), nullif(a.location, '')),
      'model',          CASE WHEN t.token_transaction_id IS NOT NULL THEN 'prepaid' ELSE 'postpaid' END,
      'agentId',        a.id,
      'agentCode',      a.full_code,
      'agencyName',     coalesce(nullif(a.agency_name, ''), u.full_name, a.full_code),
      'terminalSerial', term.serial_number,
      'terminalModel',  term.device
    ) AS event
    FROM tickets t
    JOIN writers w ON w.id = t.writer_id
    JOIN agents  a ON a.id = w.agent_id
    LEFT JOIN users u ON u.id = a.user_id
    JOIN games   g ON g.id = t.game_id
    LEFT JOIN bet_types bt ON bt.id = t.bet_type_id
    LEFT JOIN LATERAL (
      SELECT p.serial_number, trim(p.brand || ' ' || p.model) AS device
        FROM terminal_assignments ta
        JOIN pos_terminals p ON p.id = ta.terminal_id
       WHERE ta.writer_id = w.id AND ta.unassigned_at IS NULL
       ORDER BY ta.assigned_at DESC
       LIMIT 1
    ) term ON true
    WHERE ${where}
    ${tail}
  `;
}

/**
 * Announce freshly sold tickets to every open Live Ticker.
 *
 * Called inside the sale's own transaction. Postgres holds a NOTIFY until the
 * transaction commits and drops it if it rolls back, so a sale that fails -
 * insufficient float, a closed game - is never shown as sold, and one that
 * succeeds is shown the instant it is real, with no polling interval between.
 *
 * Wrapped in a savepoint and never rethrown. The ticker is a view of the
 * sales, not part of them: if building the announcement fails for any
 * reason, the writer's sale must still go through. The savepoint is what
 * makes that possible - an error inside a Postgres transaction otherwise
 * poisons every statement after it, and the sale with it.
 *
 * One NOTIFY per ticket keeps every payload small: Postgres refuses payloads
 * over 8000 bytes, and a slip can carry many bets.
 */
export async function announceTicketsSold(tx: any, ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const ids = sql.join(ticketIds.map((id) => sql`${id}::uuid`), sql`, `);
  try {
    await tx.transaction(async (sp: any) => {
      await sp.execute(sql`
        SELECT pg_notify(${TICKER_CHANNEL}, feed.event::text)
          FROM (${tickerEventsSql(sql`t.id IN (${ids})`, sql`ORDER BY t.created_at, t.id`)}) AS feed
      `);
    });
  } catch (err) {
    logger.warn({ err }, "Live Ticker announcement failed; the sale is unaffected");
  }
}
