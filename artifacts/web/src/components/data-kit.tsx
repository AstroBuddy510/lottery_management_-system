import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileDown, Printer, Loader2,
  ArrowDownLeft, ArrowUpRight, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Building blocks shared by the Payments screens, so every section pages,
 * scrolls, exports and prints the same way.
 */

/* ── Panel: a titled card with a toolbar ─────────────────────────────────── */

export function Panel({
  title, subtitle, icon: Icon, actions, children, footer, className, bodyClassName,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border/80 bg-card shadow-sm min-w-0 overflow-hidden flex flex-col", className)}>
      <header className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary dark:border-border dark:bg-muted dark:text-foreground">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight text-foreground">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </header>
      <div className={cn("min-w-0", bodyClassName)}>{children}</div>
      {footer}
    </section>
  );
}

/* ── ScrollTable: both scrollbars, a header that stays put ───────────────── */

/**
 * A fixed-height box that scrolls both ways, with the column headings pinned.
 *
 * The shared <Table> wraps its table in a div with overflow-auto of its own.
 * A sticky header sticks to its nearest overflow ancestor, which would be
 * that inner div - one that never scrolls - so the headings would scroll away.
 * [&>div]:overflow-visible hands scrolling to this box instead. minWidth keeps
 * the columns readable on a narrow screen: the box scrolls sideways rather
 * than squeezing every cell.
 */
export function ScrollTable({
  children, maxHeight = "36rem", minWidth = "48rem", className,
}: {
  children: React.ReactNode;
  maxHeight?: string;
  minWidth?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-auto overscroll-contain thin-scroll",
        "[&>div]:overflow-visible [&_table]:min-w-[var(--min-w)]",
        "[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]",
        "[&_th]:text-[10px] [&_th]:font-black [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground [&_th]:whitespace-nowrap",
        "[&_thead_tr]:border-b-0 [&_td]:whitespace-nowrap",
        className,
      )}
      style={{ maxHeight, ["--min-w" as string]: minWidth }}
      tabIndex={0}
      role="region"
    >
      {children}
    </div>
  );
}

/* ── Paging ──────────────────────────────────────────────────────────────── */

export const PAGE_SIZE = 20;

/**
 * Slice a list into pages. Returns to page one whenever `resetKey` changes -
 * a new filter or date - and never leaves the page past the end when the list
 * shrinks under it.
 */
export function usePaged<T>(input: T[] | undefined, size = PAGE_SIZE, resetKey = "") {
  // Anything that is not a list (an error body, a response still loading in
  // another shape) pages as empty rather than taking the screen down.
  const rows = Array.isArray(input) ? input : undefined;
  const [page, setPage] = useState(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setPage(1);
  }, [resetKey]);
  const total = rows?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safe = Math.min(page, totalPages);
  return {
    page: safe,
    setPage,
    totalPages,
    total,
    size,
    start: (safe - 1) * size,
    rows: (rows ?? []).slice((safe - 1) * size, safe * size),
  };
}

export function Pager({
  page, totalPages, onPage, total, size, noun, className,
}: {
  page: number; totalPages: number; onPage: (p: number) => void; total: number; size: number; noun: string; className?: string;
}) {
  if (total === 0) return null;
  const list: (number | "…")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) list.push(i);
    else if (list[list.length - 1] !== "…") list.push("…");
  }
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  const btn = "h-8 w-8 inline-flex items-center justify-center rounded-lg border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none";
  return (
    <div className={cn("flex flex-col items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3 sm:flex-row", className)}>
      <span className="text-xs text-muted-foreground">
        Showing <span className="font-semibold tabular-nums text-foreground">{from}–{to}</span> of{" "}
        <span className="font-semibold tabular-nums text-foreground">{total.toLocaleString("en-GB")}</span> {noun}
        <span className="hidden sm:inline"> · {size} per page</span>
      </span>
      {totalPages > 1 && (
        <nav className="flex items-center gap-1" aria-label={`${noun} pages`}>
          <button type="button" aria-label="First page" title="First page" className={btn} disabled={page === 1} onClick={() => onPage(1)}><ChevronsLeft className="h-4 w-4" /></button>
          <button type="button" aria-label="Previous page" title="Previous page" className={btn} disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></button>
          {list.map((p, i) => p === "…" ? <span key={`g${i}`} className="px-1 text-xs text-muted-foreground">…</span> : (
            <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? "page" : undefined}
              className={cn("h-8 min-w-[32px] rounded-lg px-2 text-xs font-semibold tabular-nums", p === page ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{p}</button>
          ))}
          <button type="button" aria-label="Next page" title="Next page" className={btn} disabled={page === totalPages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></button>
          <button type="button" aria-label="Last page" title="Last page" className={btn} disabled={page === totalPages} onClick={() => onPage(totalPages)}><ChevronsRight className="h-4 w-4" /></button>
        </nav>
      )}
    </div>
  );
}

/* ── Export and print ────────────────────────────────────────────────────── */

/** "Export PDF" and "Print", side by side, for a section's toolbar. */
export function ReportActions({
  onPdf, onPrint, disabled, label = "this section",
}: {
  onPdf: () => Promise<void> | void;
  onPrint: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const pdf = async () => {
    setBusy(true);
    try { await onPdf(); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button" size="sm" onClick={pdf} disabled={disabled || busy}
        className="h-8 gap-1.5 rounded-lg bg-[#ff6700] px-3 text-xs font-bold text-white hover:bg-[#ff6700]/90"
        title={disabled ? "Nothing to export yet" : `Export ${label} to PDF`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
        Export PDF
      </Button>
      <Button
        type="button" size="sm" variant="outline" onClick={onPrint} disabled={disabled}
        className="h-8 gap-1.5 rounded-lg px-3 text-xs font-bold"
        title={disabled ? "Nothing to print yet" : `Print ${label}`}
      >
        <Printer className="h-3.5 w-3.5" /> Print
      </Button>
    </div>
  );
}

/* ── Money direction ─────────────────────────────────────────────────────── */

/**
 * Pay-In or Pay-Out, said three ways at once: an arrow, a word and a colour,
 * so it reads for anyone who cannot tell green from orange.
 */
export function DirectionBadge({ direction, detail }: { direction: "in" | "out"; detail?: string }) {
  const isIn = direction === "in";
  const Icon = isIn ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
          isIn
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
        )}
      >
        <Icon className="h-3 w-3" />
        {isIn ? "Pay-In" : "Pay-Out"}
      </span>
      {detail && <span className="pl-1 text-[10px] text-muted-foreground">{detail}</span>}
    </span>
  );
}

/** A signed amount in the direction's colour: +GH₵ in, −GH₵ out. */
export function SignedAmount({ direction, children, muted }: { direction: "in" | "out"; children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        "font-mono font-bold tabular-nums",
        muted ? "text-muted-foreground" : direction === "in" ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400",
      )}
    >
      {direction === "in" ? "+" : "−"}{children}
    </span>
  );
}

/* ── Stat tile ───────────────────────────────────────────────────────────── */

const TONES = {
  default: { icon: "bg-primary/10 text-primary dark:bg-muted dark:text-foreground", value: "text-foreground" },
  in: { icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", value: "text-emerald-600 dark:text-emerald-400" },
  out: { icon: "bg-orange-500/10 text-orange-600 dark:text-orange-400", value: "text-orange-600 dark:text-orange-400" },
  warn: { icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400", value: "text-amber-600 dark:text-amber-400" },
  bad: { icon: "bg-rose-500/10 text-rose-600 dark:text-rose-400", value: "text-rose-600 dark:text-rose-400" },
  muted: { icon: "bg-muted text-muted-foreground", value: "text-muted-foreground" },
} as const;

export function StatTile({
  label, value, sub, icon: Icon, tone = "default",
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: LucideIcon; tone?: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <div className="min-w-0 rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", t.icon)}><Icon className="h-3.5 w-3.5" /></span>}
      </div>
      <div className={cn("mt-1.5 truncate text-xl font-black tracking-tight tabular-nums", t.value)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
