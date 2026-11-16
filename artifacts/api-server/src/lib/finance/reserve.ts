import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = { execute: (q: SQL) => Promise<any> };

const n = (v: unknown) => {
  const x = parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};

/**
 * The reserve, from its ledger: what the draw calculations set aside, less
 * every draw still standing (superseded draws do not count). This is the one
 * definition of the reserve; the Reserve page, the draw calculation, the
 * finance statements and the reconciliation all read it from here.
 */
export async function reserveLedgerTotals(exec: Exec = db) {
  const r = await exec.execute(sql`
    SELECT (SELECT coalesce(sum(reserve_amount), 0) FROM daily_calculations) AS contributed,
           (SELECT coalesce(sum(amount_drawn), 0) FROM reserve_allocations WHERE superseded_at IS NULL) AS drawn,
           (SELECT coalesce(sum(amount_drawn), 0) FROM reserve_allocations WHERE superseded_at IS NULL AND source = 'auto') AS drawn_auto,
           (SELECT coalesce(sum(amount_drawn), 0) FROM reserve_allocations WHERE superseded_at IS NULL AND source = 'manual') AS drawn_manual,
           (SELECT coalesce(sum(amount_drawn), 0) FROM reserve_allocations WHERE superseded_at IS NOT NULL) AS superseded`);
  const row = r.rows[0] as Record<string, unknown>;
  const contributedCents = Math.round(n(row.contributed) * 100);
  const drawnCents = Math.round(n(row.drawn) * 100);
  return {
    contributed: contributedCents / 100,
    drawn: drawnCents / 100,
    drawnAuto: n(row.drawn_auto),
    drawnManual: n(row.drawn_manual),
    superseded: n(row.superseded),
    balance: (contributedCents - drawnCents) / 100,
  };
}

/**
 * Rebuild the month-by-month reserve summary from the ledger. Each month's
 * row is what that month's calculations set aside and what was drawn against
 * that month's deficits - a draw applied later for an earlier day belongs to
 * the earlier month. Never incremented, only recomputed.
 */
export async function recomputeReserveFund(exec: Exec = db) {
  await exec.execute(sql`
    WITH c AS (SELECT date_trunc('month', calc_date)::date AS p, sum(reserve_amount) AS s FROM daily_calculations GROUP BY 1),
         a AS (SELECT date_trunc('month', allocation_date)::date AS p, sum(amount_drawn) AS s
                 FROM reserve_allocations WHERE superseded_at IS NULL GROUP BY 1),
         m AS (SELECT p FROM c UNION SELECT p FROM a UNION SELECT period_date FROM reserve_fund)
    INSERT INTO reserve_fund (period_date, total_contributed, total_allocated, balance)
    SELECT m.p, coalesce(c.s, 0), coalesce(a.s, 0), coalesce(c.s, 0) - coalesce(a.s, 0)
      FROM m LEFT JOIN c ON c.p = m.p LEFT JOIN a ON a.p = m.p
    ON CONFLICT (period_date) DO UPDATE
       SET total_contributed = excluded.total_contributed,
           total_allocated = excluded.total_allocated,
           balance = excluded.balance,
           updated_at = now()`);
}
