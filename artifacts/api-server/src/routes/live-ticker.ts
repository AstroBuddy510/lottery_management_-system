import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { tickerEventsSql, type TickerEvent } from "../lib/ticker-events";

const router = Router();

/**
 * Everything the Live Ticker needs to draw itself, as of now.
 *
 * The page loads this once when it opens, again whenever its socket
 * (re)connects, and once a minute as a safety net. Between loads it applies
 * each sale from the socket to these same figures locally, which is why the
 * number counts and agency totals come back complete rather than as a top
 * ten: a number in eleventh place can be first a minute later, and the
 * browser can only promote it if it knows where it stood.
 *
 * "Today" is the Accra day. Ghana keeps GMT all year, so that is the UTC day
 * and needs no zone arithmetic.
 *
 * Cancelled and voided tickets are left out of every total - they were never
 * a stake the company holds - but still appear in the feed with their status,
 * so a cancellation does not look like a sale vanishing.
 */

const FEED_LIMIT = 200;
const SERIES_MINUTES = 60;

function todayBounds() {
  const day = new Date().toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { day, start: start.toISOString(), end: end.toISOString() };
}

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const money = (v: unknown) => num(v).toFixed(2);

router.get(
  "/live-ticker/snapshot",
  requireAuth,
  requireRole("director", "administrator"),
  async (_req, res) => {
    const { day, start, end } = todayBounds();
    const today = sql`t.created_at >= ${start}::timestamptz AND t.created_at < ${end}::timestamptz`;
    const counted = sql`${today} AND t.status NOT IN ('cancelled', 'void')`;

    const [totals, numbers, agencies, games, betTypes, channels, writers, minutes, feed] = await Promise.all([
      db.execute(sql`
        SELECT count(*)::int                      AS tickets,
               coalesce(sum(t.stake_amount), 0)   AS stakes,
               count(DISTINCT t.writer_id)::int   AS writers,
               count(DISTINCT w.agent_id)::int    AS agencies
          FROM tickets t
          JOIN writers w ON w.id = t.writer_id
         WHERE ${counted}
      `),
      // Each ticket counts once for every distinct number on it, banker
      // included; its stake is credited to each of those numbers. Separators
      // are anything that is not a digit, so "1,2", "1, 2" and "1-2" agree.
      db.execute(sql`
        SELECT nums.n                             AS number,
               count(*)::int                      AS count,
               coalesce(sum(t.stake_amount), 0)   AS stake
          FROM tickets t
          CROSS JOIN LATERAL (
            SELECT DISTINCT x::int AS n
              FROM (
                SELECT regexp_split_to_table(coalesce(t.numbers, ''), '[^0-9]+') AS x
                UNION ALL
                SELECT t.banker_number::text WHERE t.banker_number IS NOT NULL
              ) parts
             WHERE x ~ '^[0-9]{1,3}$'
          ) nums
         WHERE ${counted}
         GROUP BY nums.n
         ORDER BY count DESC, stake DESC, nums.n
      `),
      db.execute(sql`
        SELECT a.id                                AS agent_id,
               a.full_code                         AS agent_code,
               coalesce(nullif(a.agency_name, ''), u.full_name, a.full_code) AS agency_name,
               count(*)::int                       AS tickets,
               coalesce(sum(t.stake_amount), 0)    AS stakes,
               count(DISTINCT t.writer_id)::int    AS writers,
               max(t.created_at)                   AS last_sale_at
          FROM tickets t
          JOIN writers w ON w.id = t.writer_id
          JOIN agents  a ON a.id = w.agent_id
          LEFT JOIN users u ON u.id = a.user_id
         WHERE ${counted}
         GROUP BY a.id, a.full_code, a.agency_name, u.full_name
         ORDER BY stakes DESC
      `),
      db.execute(sql`
        SELECT g.id AS game_id, g.name AS game_name, g.event_number,
               count(*)::int AS tickets, coalesce(sum(t.stake_amount), 0) AS stakes
          FROM tickets t
          JOIN games g ON g.id = t.game_id
         WHERE ${counted}
         GROUP BY g.id, g.name, g.event_number
         ORDER BY stakes DESC
      `),
      db.execute(sql`
        SELECT coalesce(bt.name, 'Other') AS bet_type,
               count(*)::int AS tickets, coalesce(sum(t.stake_amount), 0) AS stakes
          FROM tickets t
          LEFT JOIN bet_types bt ON bt.id = t.bet_type_id
         WHERE ${counted}
         GROUP BY coalesce(bt.name, 'Other')
         ORDER BY stakes DESC
      `),
      db.execute(sql`
        SELECT CASE WHEN t.token_transaction_id IS NOT NULL THEN 'prepaid' ELSE 'postpaid' END AS model,
               count(*)::int AS tickets, coalesce(sum(t.stake_amount), 0) AS stakes
          FROM tickets t
         WHERE ${counted}
         GROUP BY 1
      `),
      // Who has sold today, so the browser can keep "active writers" exact as
      // sales arrive instead of guessing whether a writer is new.
      db.execute(sql`
        SELECT DISTINCT t.writer_id, w.agent_id
          FROM tickets t
          JOIN writers w ON w.id = t.writer_id
         WHERE ${counted}
      `),
      db.execute(sql`
        SELECT date_trunc('minute', t.created_at) AS minute,
               count(*)::int AS tickets, coalesce(sum(t.stake_amount), 0) AS stakes
          FROM tickets t
         WHERE ${counted}
           AND t.created_at >= date_trunc('minute', now()) - make_interval(mins => ${SERIES_MINUTES - 1}::int)
         GROUP BY 1
         ORDER BY 1
      `),
      db.execute(tickerEventsSql(today, sql`ORDER BY t.created_at DESC, t.id DESC LIMIT ${FEED_LIMIT}`)),
    ]);

    const t = (totals.rows[0] ?? {}) as Row;

    res.setHeader("Cache-Control", "no-store");
    res.json({
      day,
      serverTime: new Date().toISOString(),
      seriesMinutes: SERIES_MINUTES,
      totals: {
        tickets: num(t.tickets),
        stakes: money(t.stakes),
        writers: num(t.writers),
        agencies: num(t.agencies),
      },
      numbers: (numbers.rows as Row[]).map((r) => ({
        number: num(r.number),
        count: num(r.count),
        stake: money(r.stake),
      })),
      agencies: (agencies.rows as Row[]).map((r) => ({
        agentId: String(r.agent_id),
        agentCode: String(r.agent_code ?? ""),
        agencyName: String(r.agency_name ?? ""),
        tickets: num(r.tickets),
        stakes: money(r.stakes),
        writers: num(r.writers),
        lastSaleAt: r.last_sale_at ? new Date(r.last_sale_at as string).toISOString() : null,
      })),
      games: (games.rows as Row[]).map((r) => ({
        gameId: String(r.game_id),
        gameName: String(r.game_name ?? ""),
        eventNumber: String(r.event_number ?? ""),
        tickets: num(r.tickets),
        stakes: money(r.stakes),
      })),
      betTypes: (betTypes.rows as Row[]).map((r) => ({
        betType: String(r.bet_type),
        tickets: num(r.tickets),
        stakes: money(r.stakes),
      })),
      channels: (channels.rows as Row[]).map((r) => ({
        model: String(r.model),
        tickets: num(r.tickets),
        stakes: money(r.stakes),
      })),
      writers: (writers.rows as Row[]).map((r) => ({
        writerId: String(r.writer_id),
        agentId: String(r.agent_id),
      })),
      minutes: (minutes.rows as Row[]).map((r) => ({
        minute: new Date(r.minute as string).toISOString(),
        tickets: num(r.tickets),
        stakes: money(r.stakes),
      })),
      feed: (feed.rows as Row[]).map((r) => r.event as TickerEvent),
    });
  },
);

export default router;
