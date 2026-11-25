import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = { execute: (q: SQL) => Promise<any> };

const n = (v: unknown) => {
  const x = parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/*
 * Agency balances.
 *
 * Sign: a positive balance is money the company owes the agency; a negative
 * one is money the agency owes the company. That is the convention the draw
 * calculation has always used for agents.outstanding_debt. The screens that
 * read it said "debt" for both signs; everything here says the direction in
 * words instead.
 *
 * Once an agency's opening balance is approved, its balance is
 *
 *   opening (signed)
 *   - every calculated draw's net for its writers after the opening date
 *     (a positive writer balance is money the agency holds for the company)
 *   + every pay-in it made after the opening date
 *   - every pay-out it received after the opening date
 *
 * and agents.outstanding_debt is only a copy of that, refreshed whenever any
 * of those records change. Before approval the stored figure is left alone
 * and every screen here marks it unconfirmed.
 */

export const signedOpening = (amount: unknown, direction: string) =>
  direction === "company_owes" ? n(amount) : -n(amount);

/** The ledger-derived balance for every agency with an approved opening balance. */
export async function derivedAgencyBalances(exec: Exec = db, agentId?: string) {
  const only = agentId ? sql`AND o.agent_id = ${agentId}` : sql``;
  const r = await exec.execute(sql`
    SELECT o.agent_id, o.id AS opening_id, o.amount, o.direction, o.as_of,
           coalesce((SELECT sum(c.writer_balance) FROM daily_calculations c JOIN writers w ON w.id = c.writer_id
                      WHERE w.agent_id = o.agent_id AND c.calc_date > o.as_of), 0) AS draws_net,
           coalesce((SELECT sum(p.amount) FROM payments p
                      WHERE p.agent_id = o.agent_id AND p.status = 'completed' AND NOT p.is_voided
                        AND p.transaction_type = 'pay_in' AND p.payment_date > o.as_of), 0) AS pay_in,
           coalesce((SELECT sum(p.amount) FROM payments p
                      WHERE p.agent_id = o.agent_id AND p.status = 'completed' AND NOT p.is_voided
                        AND p.transaction_type = 'pay_out' AND p.payment_date > o.as_of), 0) AS pay_out
      FROM agency_opening_balances o
     WHERE o.status = 'approved' ${only}`);
  return (r.rows as Array<Record<string, unknown>>).map((x) => {
    const opening = signedOpening(x.amount, String(x.direction));
    const drawsNet = n(x.draws_net);
    const payIn = n(x.pay_in);
    const payOut = n(x.pay_out);
    return {
      agentId: String(x.agent_id),
      openingId: String(x.opening_id),
      asOf: String(x.as_of).slice(0, 10),
      opening,
      drawsNet,
      payIn,
      payOut,
      balance: r2(opening - drawsNet + payIn - payOut),
    };
  });
}

/**
 * Copy the derived balance into agents.outstanding_debt for every agency
 * whose opening balance is approved, so the screens that read that column
 * show the ledger's figure. debt_since is set the day an agency goes into
 * debt and cleared when it comes out.
 */
export async function refreshAgencyBalances(exec: Exec = db, agentId?: string): Promise<number> {
  const rows = await derivedAgencyBalances(exec, agentId);
  let changed = 0;
  for (const b of rows) {
    const r = await exec.execute(sql`
      UPDATE agents
         SET outstanding_debt = ${b.balance.toFixed(2)}::numeric,
             debt_since = CASE WHEN ${b.balance.toFixed(2)}::numeric < 0 THEN coalesce(debt_since, now()) ELSE NULL END,
             status = CASE WHEN status = 'flagged' THEN 'active' ELSE status END
       WHERE id = ${b.agentId}
         AND (outstanding_debt <> ${b.balance.toFixed(2)}::numeric OR status = 'flagged')`);
    changed += r.rowCount ?? 0;
  }
  return changed;
}

/** True when an agency's balance is governed by an approved opening figure. */
export async function hasApprovedOpening(agentId: string, exec: Exec = db): Promise<boolean> {
  const r = await exec.execute(sql`SELECT 1 FROM agency_opening_balances WHERE agent_id = ${agentId} AND status = 'approved' LIMIT 1`);
  return r.rows.length > 0;
}

/**
 * An agency's statement for a period: the balance brought forward, each
 * draw and payment in date order with the running balance, and the balance
 * carried forward. Built from the same records as the derived balance.
 */
export async function agencyStatement(agentId: string, from: string, to: string, exec: Exec = db) {
  const [opening] = (await exec.execute(sql`
    SELECT amount, direction, as_of, basis, decided_at FROM agency_opening_balances WHERE agent_id = ${agentId} AND status = 'approved'`)).rows as Array<Record<string, unknown>>;
  const asOf = opening ? String(opening.as_of).slice(0, 10) : null;
  const start = asOf && asOf >= from ? asOf : from;
  // Movements before the period (and after the opening date) roll into the balance brought forward.
  const movements = (await exec.execute(sql`
    SELECT * FROM (
      SELECT c.calc_date AS day, 'draw' AS kind, g.name AS label, g.event_number AS ref,
             sum(c.gross_sales) AS gross, sum(c.commission_amount) AS commission, sum(c.wins_amount) AS wins,
             sum(c.reserve_amount) AS reserve, -sum(c.writer_balance) AS effect
        FROM daily_calculations c JOIN writers w ON w.id = c.writer_id LEFT JOIN games g ON g.id = c.game_id
       WHERE w.agent_id = ${agentId} ${asOf ? sql`AND c.calc_date > ${asOf}` : sql``} AND c.calc_date <= ${to}
       GROUP BY c.calc_date, g.name, g.event_number
      UNION ALL
      SELECT p.payment_date, p.transaction_type, CASE WHEN p.transaction_type = 'pay_in' THEN 'Received from the agency' ELSE 'Paid to the agency' END,
             p.receipt_number, NULL, NULL, NULL, NULL,
             CASE WHEN p.transaction_type = 'pay_in' THEN p.amount ELSE -p.amount END
        FROM payments p
       WHERE p.agent_id = ${agentId} AND p.status = 'completed' AND NOT p.is_voided
         ${asOf ? sql`AND p.payment_date > ${asOf}` : sql``} AND p.payment_date <= ${to}
    ) m ORDER BY day, kind`)).rows as Array<Record<string, unknown>>;

  let running = opening ? signedOpening(opening.amount, String(opening.direction)) : 0;
  const lines: Array<{ day: string; kind: string; label: string; ref: string | null; gross: number | null; commission: number | null; wins: number | null; reserve: number | null; effect: number; balance: number }> = [];
  let broughtForward = running;
  for (const m of movements) {
    const day = String(m.day).slice(0, 10);
    const effect = n(m.effect);
    running = r2(running + effect);
    if (day < start) {
      broughtForward = running;
      continue;
    }
    lines.push({
      day, kind: String(m.kind), label: String(m.label ?? ""), ref: (m.ref as string) ?? null,
      gross: m.gross === null ? null : n(m.gross), commission: m.commission === null ? null : n(m.commission),
      wins: m.wins === null ? null : n(m.wins), reserve: m.reserve === null ? null : n(m.reserve),
      effect, balance: running,
    });
  }
  return {
    confirmed: Boolean(opening),
    opening: opening ? { amount: n(opening.amount), direction: String(opening.direction), asOf, basis: String(opening.basis) } : null,
    from: start,
    to,
    broughtForward: r2(broughtForward),
    lines,
    carriedForward: r2(running),
  };
}

/* ── Agent commission ────────────────────────────────────────────────────── */

/**
 * The agent commission rate in force on a day: the latest settings change
 * that was both effective by that day and recorded by it. A change recorded
 * today never reaches back to earlier sales, even if it is back-dated - the
 * rate applies prospectively.
 */
const RATE_ON = (day: SQL) => sql`coalesce(
  (SELECT s.agent_commission_pct FROM system_settings s
    WHERE s.effective_date <= ${day} AND s.updated_at < (${day} + 1)::timestamptz
    ORDER BY s.updated_at DESC LIMIT 1),
  (SELECT s.agent_commission_pct FROM system_settings s ORDER BY s.updated_at ASC LIMIT 1),
  0)`;

/**
 * Commission by agent and week (Monday to Sunday, Accra): the gross sales
 * of every writer under the agent, as the draw calculations recorded them
 * (cancelled and voided sales are already out of those figures), times the
 * rate in force on each day.
 */
export async function commissionWeeks(exec: Exec = db, agentId?: string) {
  const only = agentId ? sql`AND w.agent_id = ${agentId}` : sql``;
  const r = await exec.execute(sql`
    WITH daily AS (
      SELECT w.agent_id, c.calc_date, sum(c.gross_sales) AS gross
        FROM daily_calculations c JOIN writers w ON w.id = c.writer_id
       WHERE true ${only}
       GROUP BY 1, 2
    ), rated AS (
      SELECT d.agent_id, d.calc_date, d.gross, ${RATE_ON(sql`d.calc_date`)} AS rate FROM daily d
    )
    SELECT agent_id, date_trunc('week', calc_date)::date AS week_start,
           sum(gross) AS gross, round(sum(gross * rate), 2) AS commission,
           min(rate) AS min_rate, max(rate) AS max_rate
      FROM rated GROUP BY 1, 2 ORDER BY 2 DESC`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra" }).format(new Date());
  return (r.rows as Array<Record<string, unknown>>).map((x) => {
    const weekStart = String(x.week_start).slice(0, 10);
    const end = new Date(`${weekStart}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const weekEnd = end.toISOString().slice(0, 10);
    return {
      agentId: String(x.agent_id), weekStart, weekEnd,
      gross: n(x.gross), commission: n(x.commission),
      rate: n(x.max_rate), rateChanged: n(x.min_rate) !== n(x.max_rate),
      closed: weekEnd < today,
    };
  });
}

/**
 * Every agency's commission wallet in two queries, for the Agency Overview.
 * Same figures as commissionWallet(), per agency. "accrued" is commission
 * earned and not yet paid out, the running week included.
 */
export async function commissionWallets(exec: Exec = db) {
  const [weeks, payouts] = await Promise.all([
    commissionWeeks(exec),
    exec.execute(sql`
      SELECT agent_id,
             coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0) AS paid,
             coalesce(sum(amount) FILTER (WHERE status IN ('requested', 'approved')), 0) AS pending
        FROM agent_commission_payouts GROUP BY agent_id`),
  ]);
  const paidBy = new Map((payouts.rows as Array<Record<string, unknown>>).map((r) => [String(r.agent_id), { paid: n(r.paid), pending: n(r.pending) }]));
  const byAgent = new Map<string, { totalEarned: number; earnedClosed: number; currentWeek: number }>();
  for (const w of weeks) {
    const a = byAgent.get(w.agentId) ?? { totalEarned: 0, earnedClosed: 0, currentWeek: 0 };
    a.totalEarned += w.commission;
    if (w.closed) a.earnedClosed += w.commission;
    else a.currentWeek += w.commission;
    byAgent.set(w.agentId, a);
  }
  const ids = new Set([...byAgent.keys(), ...paidBy.keys()]);
  return [...ids].map((agentId) => {
    const e = byAgent.get(agentId) ?? { totalEarned: 0, earnedClosed: 0, currentWeek: 0 };
    const p = paidBy.get(agentId) ?? { paid: 0, pending: 0 };
    return {
      agentId,
      totalEarned: r2(e.totalEarned),
      earnedClosed: r2(e.earnedClosed),
      currentWeek: r2(e.currentWeek),
      paid: p.paid,
      pending: p.pending,
      accrued: r2(e.totalEarned - p.paid),
      available: r2(e.earnedClosed - p.paid - p.pending),
    };
  });
}

/** An agent's commission wallet: earned, paid, pending, available. Payable by the company - not cash it holds. */
export async function commissionWallet(agentId: string, exec: Exec = db) {
  const weeks = await commissionWeeks(exec, agentId);
  const p = (await exec.execute(sql`
    SELECT coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0) AS paid,
           coalesce(sum(amount) FILTER (WHERE status IN ('requested', 'approved')), 0) AS pending
      FROM agent_commission_payouts WHERE agent_id = ${agentId}`)).rows[0] as Record<string, unknown>;
  const earnedClosed = r2(weeks.filter((w) => w.closed).reduce((s, w) => s + w.commission, 0));
  const current = weeks.find((w) => !w.closed);
  const paid = n(p.paid);
  const pending = n(p.pending);
  return {
    weeks,
    totalEarned: r2(weeks.reduce((s, w) => s + w.commission, 0)),
    earnedClosed,
    currentWeek: current ?? null,
    paid,
    pending,
    outstanding: r2(earnedClosed - paid),
    available: r2(earnedClosed - paid - pending),
  };
}
