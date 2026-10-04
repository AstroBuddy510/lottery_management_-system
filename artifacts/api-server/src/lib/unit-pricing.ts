/**
 * What a writer's money buys in e-token units.
 *
 * A writer hands over cash and receives selling power. Their commission is
 * built into the units rather than paid back later, so the arithmetic is a
 * GROSS-UP, not a markup:
 *
 *   units = paid / (1 - commissionPct)
 *
 * At 30%, GH¢100 buys 142.86 units, and that is the figure that makes the
 * books close. The writer sells 142.86, earns 30% of it (42.86) and remits
 * 100 - exactly the cash they handed over. A plain x1.30 markup would credit
 * 130, leaving the company 91 on a 100 payment, which is not what anyone
 * intends by "commission inclusive".
 *
 * The rate is the writer commission from Settings, so the office changes it in
 * one place. It is frozen onto the purchase when the units are credited, for
 * the same reason the settlement ledger freezes its rate: a later edit must
 * not restate what a writer was already given.
 */

export interface UnitQuote {
  /** Cash the writer hands over. */
  paid: number;
  /** Rate used, 0-1, as applied. */
  commissionPct: number;
  /** Units credited to the wallet. */
  units: number;
  /** The part of the units that is the writer's own commission. */
  commissionValue: number;
}

function money(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * A commission rate at or above 100% would demand infinite units for any
 * payment, so it is refused rather than clamped: silently crediting something
 * arbitrary on a misconfigured rate is how money goes missing.
 */
export const MAX_COMMISSION_PCT = 0.95;

export function quoteUnits(paid: number, commissionPct: number): UnitQuote {
  const amount = Math.max(paid, 0);
  if (!Number.isFinite(commissionPct) || commissionPct < 0) {
    throw new Error("COMMISSION_RATE_INVALID");
  }
  if (commissionPct > MAX_COMMISSION_PCT) {
    throw new Error("COMMISSION_RATE_TOO_HIGH");
  }
  // No commission configured: units are simply what was paid. This is also the
  // path every existing deployment takes until a rate is set, so switching
  // this on changes nothing until the office means it to.
  if (commissionPct === 0) {
    return { paid: money(amount), commissionPct: 0, units: money(amount), commissionValue: 0 };
  }
  const units = money(amount / (1 - commissionPct));
  return {
    paid: money(amount),
    commissionPct,
    units,
    commissionValue: money(units - amount),
  };
}

/** The inverse: what cash does this many units represent? Used for display. */
export function cashBehindUnits(units: number, commissionPct: number): number {
  const pct = Math.min(Math.max(commissionPct, 0), MAX_COMMISSION_PCT);
  return money(Math.max(units, 0) * (1 - pct));
}
