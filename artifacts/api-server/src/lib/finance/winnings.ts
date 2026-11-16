import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { TICKET_VALIDITY_DAYS } from "../receipt";
import { reserveLedgerTotals } from "./reserve";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = { execute: (q: SQL) => Promise<any> };

const n = (v: unknown) => {
  const x = parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The last moment a win can be claimed: the end of the 15th day after its
 * draw closed (Accra is GMT all year). The same rule the claim screen and the
 * reports already apply.
 */
export const VALID_UNTIL = sql`(date_trunc('day', (g.close_at AT TIME ZONE 'UTC') + make_interval(days => ${TICKET_VALIDITY_DAYS})) + interval '1 day') AT TIME ZONE 'UTC'`;

/**
 * Release every POS win whose claim window has closed unclaimed.
 *
 * "Unclaimed" is a payout still pending or approved - nobody scanned it. A
 * win scanned in time and waiting on the cashier or Paystack is still owed
 * and is never released here. Each win is released once (unique key), and
 * the row keeps its win date, deadline and release time for the record.
 */
export async function releaseExpiredWinnings(exec: Exec = db): Promise<number> {
  const r = await exec.execute(sql`
    INSERT INTO winnings_expiries (payout_request_id, ticket_id, writer_id, game_id, amount, win_date, deadline, note)
    SELECT p.id, p.ticket_id, p.writer_id, g.id, p.payout_amount, g.close_at, ${VALID_UNTIL},
           'Not claimed within ${sql.raw(String(TICKET_VALIDITY_DAYS))} days of the draw'
      FROM payout_requests p
      JOIN game_results gr ON gr.id = p.game_result_id
      JOIN games g ON g.id = gr.game_id
     WHERE p.status IN ('pending', 'approved')
       AND p.payout_amount > 0
       AND now() >= ${VALID_UNTIL}
    ON CONFLICT (payout_request_id) DO NOTHING`);
  return r.rowCount ?? 0;
}

/**
 * Where every POS win stands. One status per win, worked out from the payout
 * request and whether it has been released:
 *
 *   unclaimed  owed, not yet scanned, still inside its 15 days
 *   claimed    scanned in time; waiting on the cashier, funds or Paystack
 *   review     claim sent back for review - still owed until decided
 *   paid       the money went out
 *   expired    not claimed in time; released to Expired/Unclaimed Winnings Income
 *   withheld   payment refused by an administrator
 */
export const WIN_STATUS = sql`CASE
  WHEN x.id IS NOT NULL THEN 'expired'
  WHEN p.status = 'paid' THEN 'paid'
  WHEN p.status = 'withheld' THEN 'withheld'
  WHEN p.status = 'rejected' THEN 'review'
  WHEN p.status IN ('verified', 'awaiting_funds', 'processing') THEN 'claimed'
  ELSE 'unclaimed' END`;

export async function winningsRegister(exec: Exec = db, limit = 3000) {
  const r = await exec.execute(sql`
    SELECT p.id, p.payout_amount AS amount, p.status AS payout_status, ${WIN_STATUS} AS status,
           g.name AS game_name, g.event_number, g.close_at AS win_date, ${VALID_UNTIL} AS deadline,
           p.claimed_at, p.paid_at, x.released_at, t.ticket_number,
           w.full_code AS writer_code, w.full_name AS writer_name, a.full_code AS agent_code
      FROM payout_requests p
      JOIN game_results gr ON gr.id = p.game_result_id
      JOIN games g ON g.id = gr.game_id
      JOIN tickets t ON t.id = p.ticket_id
      JOIN writers w ON w.id = p.writer_id
      JOIN agents a ON a.id = p.agent_id
      LEFT JOIN winnings_expiries x ON x.payout_request_id = p.id
     ORDER BY g.close_at DESC, p.created_at DESC
     LIMIT ${limit}`);
  return r.rows as Array<Record<string, unknown>>;
}

/** The figures Issue 8 asks for, all from the same records. */
export async function winningsSummary(exec: Exec = db) {
  const s = await exec.execute(sql`
    SELECT ${WIN_STATUS} AS status, count(*)::int AS n, coalesce(sum(p.payout_amount), 0) AS amount
      FROM payout_requests p LEFT JOIN winnings_expiries x ON x.payout_request_id = p.id
     GROUP BY 1`);
  const by: Record<string, { n: number; amount: number }> = {};
  for (const row of s.rows as Array<{ status: string; n: number; amount: string }>) by[row.status] = { n: row.n, amount: n(row.amount) };
  const get = (k: string) => by[k] ?? { n: 0, amount: 0 };

  const c = await exec.execute(sql`
    SELECT coalesce(sum(amount) FILTER (WHERE entry_type = 'contribution'), 0) AS received,
           coalesce(sum(amount) FILTER (WHERE entry_type = 'refund'), 0) AS refunded,
           coalesce(sum(c.amount) FILTER (WHERE c.entry_type = 'contribution' AND p.status = 'paid'
                                           AND NOT EXISTS (SELECT 1 FROM winnings_contributions r WHERE r.refund_of = c.id)), 0) AS applied
      FROM winnings_contributions c LEFT JOIN payout_requests p ON p.id = c.payout_request_id`);
  const cr = c.rows[0] as Record<string, unknown>;
  const received = n(cr.received);
  const refunded = n(cr.refunded);
  const applied = n(cr.applied);
  const held = r2(received - refunded - applied);

  const reserve = await reserveLedgerTotals(exec);
  const outstanding = r2(get("unclaimed").amount + get("claimed").amount + get("review").amount);
  const reserveAvailable = Math.max(0, reserve.balance);
  const shortfall = r2(Math.max(0, outstanding - reserveAvailable - Math.max(0, held)));
  const total = r2(Object.values(by).reduce((t, v) => t + v.amount, 0));

  return {
    totalObligations: total,
    byStatus: {
      unclaimed: get("unclaimed"), claimed: get("claimed"), review: get("review"),
      paid: get("paid"), expired: get("expired"), withheld: get("withheld"),
    },
    paid: get("paid").amount,
    expiredReleased: get("expired").amount,
    outstandingLiability: outstanding,
    reserveBalance: reserve.balance,
    reserveAvailable,
    contributions: { received, refunded, applied, held },
    shortfall,
  };
}
