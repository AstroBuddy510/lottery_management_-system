import { cn, fmtGHS } from "@/lib/utils";

export type Severity = "low" | "medium" | "high" | "critical";

const SEVERITY_STYLE: Record<Severity, { label: string; chip: string; bar: string; dot: string }> = {
  critical: {
    label: "Critical",
    chip: "bg-red-500/10 text-red-700 border-red-300/60 dark:text-red-300 dark:border-red-500/30",
    bar: "bg-red-500",
    dot: "bg-red-500",
  },
  high: {
    label: "High",
    chip: "bg-orange-500/10 text-orange-700 border-orange-300/60 dark:text-orange-300 dark:border-orange-500/30",
    bar: "bg-orange-500",
    dot: "bg-orange-500",
  },
  medium: {
    label: "Medium",
    chip: "bg-amber-400/10 text-amber-700 border-amber-300/60 dark:text-amber-300 dark:border-amber-500/30",
    bar: "bg-amber-400",
    dot: "bg-amber-400",
  },
  low: {
    label: "Low",
    chip: "bg-emerald-500/10 text-emerald-700 border-emerald-300/50 dark:text-emerald-300 dark:border-emerald-500/30",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        s.chip,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

/** The played numbers, as they read on the ticket. */
export function NumberChips({
  numbers,
  highlight,
  size = "sm",
}: {
  numbers: number[];
  highlight?: number | null;
  size?: "sm" | "lg";
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {numbers.map((n) => (
        <span
          key={n}
          className={cn(
            "inline-flex items-center justify-center rounded-md font-mono font-bold tabular-nums border",
            size === "lg" ? "h-9 w-9 text-base" : "h-6 min-w-6 px-1.5 text-[11px]",
            n === highlight
              ? "bg-red-500 text-white border-red-500"
              : "bg-foreground/[0.04] border-border/60 text-foreground/90",
          )}
        >
          {n}
        </span>
      ))}
    </span>
  );
}

/**
 * How much of everything taken on the game a single combination would consume.
 * Past the full width the payout exceeds the take - the draw loses money
 * whatever else happens - so the bar marks that line rather than rescaling.
 */
export function CoverageBar({ coverage, severity }: { coverage: number; severity: Severity }) {
  const pct = Math.min(coverage, 1) * 100;
  const over = coverage > 1;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-foreground/[0.07]">
        <div
          className={cn("h-full rounded-full transition-all", SEVERITY_STYLE[severity].bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={cn(
          "w-12 shrink-0 text-right text-[11px] font-bold tabular-nums",
          over ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
        )}
      >
        {(coverage * 100).toFixed(0)}%
      </span>
    </div>
  );
}

export function Tile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "danger" | "warning" | "good";
}) {
  const tones = {
    neutral: "",
    danger: "text-red-600 dark:text-red-400",
    warning: "text-orange-600 dark:text-orange-400",
    good: "text-emerald-600 dark:text-emerald-400",
  };
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
        {label}
      </div>
      <div className={cn("mt-1.5 text-xl font-bold tracking-tight tabular-nums sm:text-2xl", tones[tone])}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

export interface NumberExposure {
  number: number;
  ticketCount: number;
  totalStake: number;
  liability: number;
}

/**
 * Every number from 1 to 90, shaded by what it would cost us. A number is not
 * a bet on its own, so this is an early warning rather than a settlement
 * figure: it shows where the book is crowding before any one combination
 * grows large enough to show up in the table below.
 */
export function NumberHeatMap({
  heat,
  selected,
  onSelect,
}: {
  heat: NumberExposure[];
  selected: number | null;
  onSelect: (n: number | null) => void;
}) {
  const byNumber = new Map(heat.map((h) => [h.number, h]));
  const max = heat.reduce((m, h) => Math.max(m, h.liability), 0);

  return (
    <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
      {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => {
        const row = byNumber.get(n);
        const liability = row?.liability ?? 0;
        const intensity = max > 0 ? liability / max : 0;
        const isSelected = selected === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onSelect(isSelected ? null : n)}
            title={
              row
                ? `${n} · ${row.ticketCount} ticket${row.ticketCount === 1 ? "" : "s"} · ${fmtGHS(row.totalStake)} staked · ${fmtGHS(liability)} at risk`
                : `${n} · no exposure`
            }
            style={
              intensity > 0
                ? { backgroundColor: `rgba(220, 38, 38, ${0.1 + intensity * 0.75})` }
                : undefined
            }
            className={cn(
              "flex aspect-square items-center justify-center rounded-md border text-[11px] font-bold tabular-nums transition-all sm:text-xs",
              intensity > 0.55 ? "text-white" : "text-foreground/70",
              intensity === 0 && "bg-foreground/[0.03] text-muted-foreground/50",
              isSelected
                ? "border-foreground ring-2 ring-foreground/30"
                : "border-transparent hover:border-foreground/30",
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

export function HeatLegend() {
  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      <span>Low</span>
      <div className="h-2 w-24 rounded-full bg-gradient-to-r from-red-500/10 to-red-600" />
      <span>High</span>
    </div>
  );
}
