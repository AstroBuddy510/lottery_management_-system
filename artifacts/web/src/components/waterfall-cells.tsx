import { TableCell, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { WATERFALL_COLUMNS, waterfallAny } from "@/lib/waterfall";

/**
 * The seven figure columns of the platform waterfall, for any table:
 * Gross Sales | Commission | Net After Commission | Reserve |
 * Net After Reserve | Wins Deduct | Profit / (Deficit).
 *
 * Headings and cells come from the same list, so a table cannot show a value
 * under the wrong heading or drop a column. Rows may use either field-name
 * style (grossSales / gross, commissionAmount / commission, ...).
 */
export function WaterfallHeads({ className }: { className?: string }) {
  return (
    <>
      {WATERFALL_COLUMNS.map((c) => (
        <TableHead key={c.key} className={cn("text-right text-xs font-semibold whitespace-nowrap", className)}>{c.label}</TableHead>
      ))}
    </>
  );
}

const money = (n: number) => {
  const s = `GH₵ ${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < -0.004 ? `(${s})` : s;
};

export function WaterfallRowCells({ row, size = "xs" }: { row: object | null | undefined; size?: "xs" | "sm" }) {
  const w = waterfallAny(row ?? {});
  const base = cn("text-right font-mono tabular-nums whitespace-nowrap", size === "xs" ? "text-xs" : "text-sm");
  return (
    <>
      <TableCell className={base}>{money(w.gross)}</TableCell>
      <TableCell className={cn(base, "text-amber-600 dark:text-amber-400")}>{money(w.commission)}</TableCell>
      <TableCell className={cn(base, "text-teal-600 dark:text-teal-400")}>{money(w.netAfterCommission)}</TableCell>
      <TableCell className={cn(base, "text-indigo-600 dark:text-indigo-400")}>{money(w.reserve)}</TableCell>
      <TableCell className={base}>{money(w.netAfterReserve)}</TableCell>
      <TableCell className={cn(base, "text-rose-600 dark:text-rose-400")}>{money(w.wins)}</TableCell>
      <TableCell className={cn(base, "font-bold", w.profitOrDeficit < 0 ? "text-rose-600 dark:text-rose-400" : "text-green-600 dark:text-green-400")}>
        {money(w.profitOrDeficit)}
      </TableCell>
    </>
  );
}
