/**
 * The platform's one accounting waterfall, for screens and statements.
 *
 *   Gross Sales
 *   - Commission            (Gross x commission rate)
 *   = Net After Commission
 *   - Reserve               (Net After Commission x reserve rate)
 *   = Net After Reserve
 *   - Wins Deduct
 *   = Profit / (Deficit)    > 0 the agency owes the company; < 0 the company owes the agency
 *
 * The figures come from the server (lib/calculator.ts there). This file only
 * fixes the column ORDER and LABELS every table and PDF uses, and derives the
 * two subtotals from the stored components in whole pesewas, so no screen can
 * put a value under the wrong heading or add across differently.
 */

type Num = string | number | null | undefined;

export interface StoredFigures {
  grossSales: Num;
  commissionAmount: Num;
  netGross: Num;
  reserveAmount: Num;
  winsAmount: Num;
}

export interface Waterfall {
  gross: number;
  commission: number;
  netAfterCommission: number;
  reserve: number;
  netAfterReserve: number;
  wins: number;
  profitOrDeficit: number;
}

const p = (v: Num) => Math.round(Number(v ?? 0) * 100);

export function waterfall(r: StoredFigures): Waterfall {
  const gross = p(r.grossSales);
  const commission = p(r.commissionAmount);
  const net = p(r.netGross);
  const reserve = p(r.reserveAmount);
  const wins = p(r.winsAmount);
  return {
    gross: gross / 100,
    commission: commission / 100,
    netAfterCommission: net / 100,
    reserve: reserve / 100,
    netAfterReserve: (net - reserve) / 100,
    wins: wins / 100,
    profitOrDeficit: (net - reserve - wins) / 100,
  };
}

/** Same, for rows that use the short names (gross, commission, netGross, reserve, wins). */
export function waterfallShort(r: { gross: Num; commission: Num; netGross: Num; reserve: Num; wins: Num }): Waterfall {
  return waterfall({ grossSales: r.gross, commissionAmount: r.commission, netGross: r.netGross, reserveAmount: r.reserve, winsAmount: r.wins });
}

/** For rows from any report, whichever field names it uses (grossSales | gross, commissionAmount | commission, ...). */
export function waterfallAny(r: object | null | undefined): Waterfall {
  const o = (r ?? {}) as Record<string, Num>;
  return waterfall({
    grossSales: o.grossSales ?? o.gross,
    commissionAmount: o.commissionAmount ?? o.commission,
    netGross: o.netGross,
    reserveAmount: o.reserveAmount ?? o.reserve,
    winsAmount: o.winsAmount ?? o.wins,
  });
}

/** Column keys and headings, in waterfall order. */
export const WATERFALL_COLUMNS: Array<{ key: keyof Waterfall; label: string; short: string }> = [
  { key: "gross", label: "Gross Sales", short: "Gross" },
  { key: "commission", label: "Commission", short: "Commission" },
  { key: "netAfterCommission", label: "Net After Commission", short: "Net After Comm." },
  { key: "reserve", label: "Reserve", short: "Reserve" },
  { key: "netAfterReserve", label: "Net After Reserve", short: "Net After Reserve" },
  { key: "wins", label: "Wins Deduct", short: "Wins Deduct" },
  { key: "profitOrDeficit", label: "Profit / (Deficit)", short: "Profit / (Deficit)" },
];

/** GHS 1,234.50 or, for a deficit, (GHS 1,029.40). */
export function ghsPD(v: number, prefix = "GHS"): string {
  const s = `${prefix} ${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < -0.004 ? `(${s})` : s;
}
