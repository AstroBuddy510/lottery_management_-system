import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetReserveBalance,
  useListReserveAllocations,
  useListReserveDebts,
  useApplyReserveAllocation,
  useListReserveReceipts,
  useDeleteReserveReceipt,
  getGetReserveBalanceQueryKey,
  getListReserveAllocationsQueryKey,
  getListReserveDebtsQueryKey,
  getListReserveReceiptsQueryKey,
  useGetSettings,
  getGetSettingsQueryKey,
  type ReserveAllocation,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Printer, PiggyBank, LayoutDashboard, Scale, BookOpen, Wallet, TrendingUp, TrendingDown, AlertTriangle,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, CalendarRange, FileText,
} from "lucide-react";
import { generateAgentLedgerPDF, generateSmartDebtSimulationPDF, generateReserveAllocationsPDF } from "@/lib/pdf-generator";

const GHS = (v: number | string) =>
  `GH₵ ${Number(v).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (v: number) =>
  `${v.toLocaleString("en-GH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

type Strategy = "fifo" | "lifo" | "best_performer";

const STRATEGIES: { id: Strategy; label: string; tag: string; color: string; description: string; principle: string }[] = [
  {
    id: "fifo",
    label: "FIFO",
    tag: "First In, First Out",
    color: "blue",
    description: "Oldest debts are serviced first. Prevents accumulation of aged obligations and maintains chronological accountability.",
    principle: "Accounting principle: aligns with accrual basis — earliest liabilities settled first to avoid escalation.",
  },
  {
    id: "lifo",
    label: "LIFO",
    tag: "Last In, First Out",
    color: "purple",
    description: "Most recent debts are cleared first. Useful when recent events are more operationally urgent than older records.",
    principle: "Managerial principle: prioritises current-period liquidity issues before historical carry-overs.",
  },
  {
    id: "best_performer",
    label: "Best Performer",
    tag: "Performance-Weighted",
    color: "emerald",
    description: "Reserve funds are directed toward agents with the highest cumulative gross sales volume — agents who generate the most value get prioritised.",
    principle: "Strategic principle: protect and incentivise high-value agents, maximising expected future contribution to the reserve fund.",
  },
];

const fmtDay = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function SectionTitle({ accent, title, subtitle, right }: { accent: string; title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-2.5 h-6 rounded-full shrink-0 ${accent}`} />
        <div className="min-w-0">
          <h2 className="text-base font-bold text-foreground">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

const ACCENT = {
  green: { edge: "border-l-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  red: { edge: "border-l-rose-500", text: "text-rose-600 dark:text-rose-400" },
  amber: { edge: "border-l-amber-500", text: "text-amber-600 dark:text-amber-400" },
  blue: { edge: "border-l-sky-500", text: "text-sky-600 dark:text-sky-400" },
} as const;

function KpiCard({ label, value, sub, accent = "blue", icon }: {
  label: string; value: string; sub?: string; accent?: keyof typeof ACCENT; icon: React.ReactNode;
}) {
  const a = ACCENT[accent];
  return (
    <div className={`bg-card border border-border border-l-4 ${a.edge} rounded-2xl p-4 shadow-sm flex flex-col justify-between min-h-[7rem] min-w-0`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">{label}</div>
        <div className="text-muted-foreground/70 shrink-0">{icon}</div>
      </div>
      <div className={`font-mono text-xl sm:text-2xl font-black tracking-tight mt-1 truncate ${a.text}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground font-medium mt-1">{sub}</div>}
    </div>
  );
}

/**
 * Allocation history, filtered by date on the server and paged here.
 *
 * Every draw on the reserve is one row, so the list only grows; it used to be
 * a single table of all of them. Dates go to the API (it filters on the
 * allocation date), search and paging happen in the browser over what came
 * back.
 */
function AllocationHistory() {
  const today = isoDay(new Date());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "auto" | "manual">("all");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const params = { ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) };
  const { data, isLoading, isFetching } = useListReserveAllocations(params, {
    query: { queryKey: getListReserveAllocationsQueryKey(params), refetchInterval: 30_000 },
  });

  const isAuto = (a: ReserveAllocation) => (a.reason ?? "").toLowerCase().includes("auto-draw");
  const rows = useMemo(() => {
    let list = Array.isArray(data) ? [...data] : [];
    // Newest first, and stable within a day.
    list.sort((a, b) => b.allocationDate.localeCompare(a.allocationDate) || b.createdAt.localeCompare(a.createdAt));
    if (kind !== "all") list = list.filter(a => (kind === "auto") === isAuto(a));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(a => [a.writerFullCode, a.writerFullName, a.reason].some(v => (v ?? "").toLowerCase().includes(q)));
    return list;
  }, [data, search, kind]);

  useEffect(() => { setPage(1); }, [dateFrom, dateTo, search, kind, pageSize]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * pageSize, current * pageSize);
  const total = rows.reduce((s, a) => s + Number(a.amountDrawn), 0);
  const writers = new Set(rows.map(a => a.writerId)).size;

  const ranges = [
    { label: "Today", from: today, to: today },
    { label: "Last 7 days", from: isoDay(new Date(Date.now() - 6 * 86_400_000)), to: today },
    { label: "This month", from: `${today.slice(0, 8)}01`, to: today },
    { label: "Last 30 days", from: isoDay(new Date(Date.now() - 29 * 86_400_000)), to: today },
    { label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
    { label: "All time", from: "", to: "" },
  ];
  const activeRange = ranges.find(r => r.from === dateFrom && r.to === dateTo)?.label;

  // Page buttons: first, last, and a window around the current page.
  const pageList = useMemo(() => {
    const out: (number | "…")[] = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - current) <= 1) out.push(i);
      else if (out[out.length - 1] !== "…") out.push("…");
    }
    return out;
  }, [pages, current]);

  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-6 shadow-sm space-y-4 min-w-0">
      <SectionTitle accent="bg-rose-500" title="Allocation history" subtitle="Every draw on the reserve to cover a writer's deficit"
        right={
          <Button variant="outline" size="sm" className="gap-1.5 font-semibold" disabled={rows.length === 0}
            onClick={() => generateReserveAllocationsPDF(rows, dateFrom, dateTo, total)}>
            <FileText className="w-4 h-4" /> Export PDF
          </Button>
        } />

      {/* Filters */}
      <div className="rounded-2xl border bg-muted/30 p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><CalendarRange className="w-3 h-3" /> From</label>
            <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} className="h-9 w-[150px] text-sm bg-background" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">To</label>
            <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} className="h-9 w-[150px] text-sm bg-background" />
          </div>
          <div className="inline-flex rounded-lg border bg-background p-0.5 h-9 items-center">
            {(["all", "auto", "manual"] as const).map(k => (
              <button key={k} onClick={() => setKind(k)}
                className={`text-[11px] font-semibold px-3 h-7 rounded-md transition-colors ${kind === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                {k === "all" ? "All draws" : k === "auto" ? "Automatic" : "Manual"}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Writer or reason…" className="pl-9 h-9 text-sm bg-background" />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ranges.map(r => (
            <button key={r.label} onClick={() => { setDateFrom(r.from); setDateTo(r.to); }}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${activeRange === r.label ? "bg-foreground text-background border-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
        <span className="text-muted-foreground">{dateFrom || dateTo ? `${fmtDay(dateFrom || null)} – ${fmtDay(dateTo || today)}` : "All time"}</span>
        <span><span className="font-bold">{rows.length.toLocaleString()}</span> <span className="text-muted-foreground">draw{rows.length === 1 ? "" : "s"}</span></span>
        <span><span className="font-bold">{writers}</span> <span className="text-muted-foreground">writer{writers === 1 ? "" : "s"}</span></span>
        <span><span className="text-muted-foreground">drawn</span> <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{GHS(total)}</span></span>
        {isFetching && !isLoading && <span className="text-muted-foreground">updating…</span>}
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-hidden">
        <div className="overflow-auto max-h-[560px]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs whitespace-nowrap">Date</TableHead>
                <TableHead className="text-xs">Writer</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
                <TableHead className="text-xs text-right">Drawn</TableHead>
                <TableHead className="text-xs text-right whitespace-nowrap">Balance after</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4].map(i => (
                  <TableRow key={i}><TableCell colSpan={5}><div className="h-6 rounded bg-muted animate-pulse" /></TableCell></TableRow>
                ))
              ) : shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-14">
                    <p className="text-sm font-semibold">{(Array.isArray(data) && data.length > 0) || dateFrom || dateTo || search || kind !== "all" ? "No draws match these filters" : "No draws on the reserve yet"}</p>
                    <p className="text-xs text-muted-foreground mt-1">{dateFrom || dateTo || search || kind !== "all" ? "Widen the dates or clear the search." : "Draws appear here when a deficit is covered from the reserve."}</p>
                  </TableCell>
                </TableRow>
              ) : shown.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm whitespace-nowrap">{fmtDay(a.allocationDate)}</TableCell>
                  <TableCell className="min-w-[140px]">
                    <div className="font-mono text-xs font-bold">{a.writerFullCode ?? `${a.writerId.slice(0, 8)}…`}</div>
                    {a.writerFullName && <div className="text-[11px] text-muted-foreground">{a.writerFullName}</div>}
                  </TableCell>
                  <TableCell className="max-w-[320px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${isAuto(a) ? "text-sky-700 dark:text-sky-400 border-sky-500/30 bg-sky-500/10" : "text-violet-700 dark:text-violet-400 border-violet-500/30 bg-violet-500/10"}`}>
                        {isAuto(a) ? "Auto" : "Manual"}
                      </span>
                      <span className="text-xs text-muted-foreground truncate" title={a.reason ?? ""}>{a.reason ?? "Reserve allocation"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold text-rose-600 dark:text-rose-400 whitespace-nowrap">−{GHS(a.amountDrawn)}</TableCell>
                  <TableCell className="text-right font-mono text-sm whitespace-nowrap">{GHS(a.reserveBalanceAfter)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pager */}
        {rows.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Showing <span className="font-semibold text-foreground">{(current - 1) * pageSize + 1}–{Math.min(current * pageSize, rows.length)}</span> of <span className="font-semibold text-foreground">{rows.length}</span></span>
              <span className="text-border">|</span>
              <label className="flex items-center gap-1.5">Rows
                <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                  className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground">
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-1">
              <PagerButton label="First page" disabled={current === 1} onClick={() => setPage(1)}><ChevronsLeft className="w-4 h-4" /></PagerButton>
              <PagerButton label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft className="w-4 h-4" /></PagerButton>
              {pageList.map((n, i) => n === "…" ? (
                <span key={`gap${i}`} className="px-1 text-xs text-muted-foreground">…</span>
              ) : (
                <button key={n} onClick={() => setPage(n)} aria-current={n === current ? "page" : undefined}
                  className={`min-w-[30px] h-8 px-2 rounded-lg text-xs font-semibold transition-colors ${n === current ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  {n}
                </button>
              ))}
              <PagerButton label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)}><ChevronRight className="w-4 h-4" /></PagerButton>
              <PagerButton label="Last page" disabled={current === pages} onClick={() => setPage(pages)}><ChevronsRight className="w-4 h-4" /></PagerButton>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PagerButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="h-8 w-8 inline-flex items-center justify-center rounded-lg border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none">
      {children}
    </button>
  );
}

export function Reserve() {
  const [tab, setTab] = useState<"overview" | "debt" | "ledger">("overview");
  const [strategy, setStrategy] = useState<Strategy>("fifo");
  const [maxAmount, setMaxAmount] = useState<string>("");
  const [simResult, setSimResult] = useState<null | { items: { agentId: string; amountApplied: string; outstanding: string }[]; totalAllocated: string; newBalance: string; allocatedCount: number }>(null);
  const [applying, setApplying] = useState(false);
  const [ledgerDateFrom, setLedgerDateFrom] = useState<string>("");
  const [ledgerDateTo, setLedgerDateTo] = useState<string>("");
  const [ledgerDeleting, setLedgerDeleting] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data: balance, isLoading: loadingBalance } = useGetReserveBalance({
    query: { queryKey: getGetReserveBalanceQueryKey(), refetchInterval: 30_000 },
  });
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const { data: debts, isLoading: loadingDebts } = useListReserveDebts({
    query: { queryKey: getListReserveDebtsQueryKey(), refetchInterval: 30_000 },
  });

  const { mutateAsync: applyAllocation } = useApplyReserveAllocation();
  const { mutateAsync: deleteReceiptMutation } = useDeleteReserveReceipt();

  const ledgerParams = {
    ...(ledgerDateFrom ? { dateFrom: ledgerDateFrom } : {}),
    ...(ledgerDateTo ? { dateTo: ledgerDateTo } : {}),
  };
  const { data: receipts, isLoading: loadingReceipts } = useListReserveReceipts(
    ledgerParams,
    { query: { queryKey: getListReserveReceiptsQueryKey(ledgerParams), refetchInterval: 30_000 } },
  );

  const debtList = Array.isArray(debts) ? debts : [];

  const reserveBalance = Number(balance?.balance ?? 0);
  const totalContributed = Number(balance?.totalContributed ?? 0);
  const totalAllocated = Number(balance?.totalAllocated ?? 0);
  const pctUsed = totalContributed > 0 ? (totalAllocated / totalContributed) * 100 : 0;

  const totalOutstanding = debtList.reduce((s, d) => s + Number(d.outstandingAmount), 0);
  const coverageRatio = totalOutstanding > 0 ? Math.min(100, (reserveBalance / totalOutstanding) * 100) : 100;

  const sortedDebts = useMemo(() => {
    const d = [...debtList];
    if (strategy === "fifo") d.sort((a, b) => a.calcDate.localeCompare(b.calcDate));
    else if (strategy === "lifo") d.sort((a, b) => b.calcDate.localeCompare(a.calcDate));
    else d.sort((a, b) => Number(b.agentTotalGross) - Number(a.agentTotalGross));
    return d;
  }, [debtList, strategy]);

  const simulation = useMemo(() => {
    const cap = maxAmount && Number(maxAmount) > 0 ? Number(maxAmount) : reserveBalance;
    let rem = Math.min(reserveBalance, cap);
    return sortedDebts.map((d) => {
      const outstanding = Number(d.outstandingAmount);
      const toApply = Math.min(outstanding, Math.max(0, rem));
      rem -= toApply;
      return { ...d, toApply, remaining: Math.max(0, outstanding - toApply) };
    });
  }, [sortedDebts, reserveBalance, maxAmount]);

  const simTotalApplied = simulation.reduce((s, d) => s + d.toApply, 0);
  const simNewBalance = reserveBalance - simTotalApplied;

  async function handleApply() {
    setApplying(true);
    try {
      const result = await applyAllocation({
        data: {
          strategy,
          ...(maxAmount && Number(maxAmount) > 0 ? { maxAmount: Number(maxAmount) } : {}),
        },
      });
      setSimResult(result);
      toast.success(`Applied ${result.allocatedCount} allocation(s) — GH₵ ${Number(result.totalAllocated).toFixed(2)} disbursed`);
      await queryClient.invalidateQueries({ queryKey: getGetReserveBalanceQueryKey() });
      // Every filtered view of the history, not just the unfiltered one.
      await queryClient.invalidateQueries({ queryKey: getListReserveAllocationsQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListReserveDebtsQueryKey() });
    } catch {
      toast.error("Failed to apply allocation. Please try again.");
    } finally {
      setApplying(false);
    }
  }

  const strategyColors: Record<Strategy, string> = {
    fifo: "border-blue-500 bg-blue-500/10 ring-blue-500/30",
    lifo: "border-purple-500 bg-purple-500/10 ring-purple-500/30",
    best_performer: "border-emerald-500 bg-emerald-500/10 ring-emerald-500/30",
  };

  const utilColor = pctUsed < 50 ? "bg-emerald-500" : pctUsed < 80 ? "bg-amber-500" : "bg-rose-500";
  const periods = balance?.periods ?? [];
  const reserveRate = settings?.reservePct != null ? Number(settings.reservePct) * 100 : null;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Treasury</div>
          <h1 className="text-2xl font-black tracking-tight text-foreground mt-0.5">Reserve Fund</h1>
          <p className="text-xs text-muted-foreground mt-1 font-medium">The safety net that covers writer deficits — what came in, what was drawn, and what is still owed.</p>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border bg-card px-5 py-3 shadow-sm self-start lg:self-auto">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><PiggyBank className="w-5 h-5" /></div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Available balance</div>
            <div className={`font-mono text-2xl font-black ${reserveBalance < 0 ? "text-rose-600 dark:text-rose-400" : reserveBalance < 100 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {loadingBalance ? "—" : GHS(reserveBalance)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex bg-muted/80 border p-1 rounded-2xl gap-1 w-fit max-w-full overflow-x-auto">
        {([
          { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
          { id: "debt", label: "Smart Debt Management", icon: <Scale className="w-3.5 h-3.5" /> },
          { id: "ledger", label: "Agent Ledger", icon: <BookOpen className="w-3.5 h-3.5" /> },
        ] as { id: "overview" | "debt" | "ledger"; label: string; icon: React.ReactNode }[]).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all ${tab === t.id ? "bg-background text-foreground shadow-sm border border-border/40" : "text-muted-foreground hover:text-foreground"}`}>
            {t.icon}{t.label}
            {t.id === "debt" && debtList.length > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold inline-flex items-center justify-center">{debtList.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {/* ── OVERVIEW TAB ─────────────────────────────────────────── */}
        {tab === "overview" && (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard label="Current balance" value={loadingBalance ? "—" : GHS(reserveBalance)} sub="Available for allocation"
                accent={reserveBalance < 0 ? "red" : reserveBalance < totalContributed * 0.2 ? "amber" : "green"} icon={<Wallet className="w-4 h-4" />} />
              <KpiCard label="Total contributed" value={loadingBalance ? "—" : GHS(totalContributed)} sub="Cumulative reserve income"
                accent="blue" icon={<TrendingUp className="w-4 h-4" />} />
              <KpiCard label="Total allocated" value={loadingBalance ? "—" : GHS(totalAllocated)} sub="Drawn to cover deficits"
                accent={totalAllocated === 0 ? "blue" : "red"} icon={<TrendingDown className="w-4 h-4" />} />
              <KpiCard label="Outstanding debt" value={loadingDebts ? "—" : GHS(totalOutstanding)} sub={`${debtList.length} obligation${debtList.length !== 1 ? "s" : ""} pending`}
                accent={totalOutstanding === 0 ? "green" : totalOutstanding > reserveBalance ? "red" : "amber"} icon={<AlertTriangle className="w-4 h-4" />} />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Health */}
              <section className="lg:col-span-5 rounded-3xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
                <SectionTitle accent="bg-emerald-500" title="Reserve health" subtitle="How much of everything contributed has been drawn" />
                <div className="space-y-2">
                  <div className="flex items-end justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Utilisation</span>
                    <span className={`font-mono text-2xl font-black ${pctUsed < 50 ? "text-emerald-600 dark:text-emerald-400" : pctUsed < 80 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{pct(Math.min(100, pctUsed))}</span>
                  </div>
                  <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-700 ${utilColor}`} style={{ width: `${Math.min(100, pctUsed)}%` }} />
                    <div className="absolute inset-y-0 left-1/2 w-px bg-background/80" />
                    <div className="absolute inset-y-0 left-[80%] w-px bg-background/80" />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground"><span>0%</span><span>50% caution</span><span>80% critical</span><span>100%</span></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Contribution rate", value: reserveRate == null ? "—" : `${reserveRate.toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`, hint: "of net gross" },
                    { label: "Debt coverage", value: pct(coverageRatio), hint: "of what is owed" },
                    { label: "Periods", value: String(periods.length), hint: "tracked" },
                  ].map((x) => (
                    <div key={x.label} className="rounded-xl bg-muted/40 p-3 text-center min-w-0">
                      <div className="font-mono text-lg font-black truncate">{x.value}</div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{x.label}</div>
                      <div className="text-[10px] text-muted-foreground">{x.hint}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Periods */}
              <section className="lg:col-span-7 rounded-3xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
                <SectionTitle accent="bg-sky-500" title="Contributions by period" subtitle="What each period put in, and what is left of it" />
                {!periods.length ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No period data yet.</p>
                ) : (
                  <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                    {periods.map((p) => {
                      const contrib = Number(p.totalContributed);
                      const alloc = Number(p.totalAllocated);
                      const bal = Number(p.balance);
                      return (
                        <div key={p.id} className="space-y-1">
                          <div className="flex items-center justify-between text-xs gap-2">
                            <span className="font-semibold">{fmtDay(p.periodDate)}</span>
                            <span className="text-muted-foreground font-mono truncate">
                              in {GHS(contrib)}{alloc > 0 && <span className="text-rose-600 dark:text-rose-400"> · drawn {GHS(alloc)}</span>} · <span className="text-foreground font-semibold">left {GHS(bal)}</span>
                            </span>
                          </div>
                          <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                            <div className="bg-emerald-500" style={{ width: `${contrib > 0 ? Math.max(0, Math.min(100, (bal / contrib) * 100)) : 0}%` }} />
                            <div className="bg-rose-400" style={{ width: `${contrib > 0 ? Math.min(100, (alloc / contrib) * 100) : 0}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <AllocationHistory />
          </>
        )}

        {/* ── SMART DEBT MANAGEMENT TAB ───────────────────────────── */}
        {tab === "debt" && (
          <>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-card p-5 rounded-xl border shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-foreground">Smart Debt Repayment Plan</h2>
                <p className="text-xs text-muted-foreground">Configure strategies and caps, preview distributions, and export summaries.</p>
              </div>
              <Button
                onClick={() => generateSmartDebtSimulationPDF(simulation, strategy, maxAmount, reserveBalance, totalOutstanding, simTotalApplied, simNewBalance)}
                className="flex items-center gap-2 font-semibold"
                variant="outline"
                disabled={debtList.length === 0}
              >
                <Printer className="w-4 h-4" />
                Export Simulation PDF
              </Button>
            </div>

            {/* Explainer Banner */}
            <div className="bg-card border border-border rounded-xl p-5 flex gap-4 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">Smart Debt Management Engine</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Debts arise when an agent's wins exceed their net gross for a calculation period, creating a negative writer balance.
                  Select a repayment strategy, review the simulation, then apply the allocation plan to direct reserve funds toward outstanding obligations.
                  All decisions are recorded as immutable allocation entries for full auditability.
                </p>
              </div>
            </div>

            {/* Snapshot */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Reserve Available", value: GHS(reserveBalance), color: reserveBalance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400", bg: "bg-emerald-500/10" },
                { label: "Total Outstanding", value: GHS(totalOutstanding), color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10" },
                { label: "Debt Coverage", value: pct(coverageRatio), color: coverageRatio >= 100 ? "text-emerald-600 dark:text-emerald-400" : coverageRatio >= 50 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400", bg: "bg-muted/40" },
              ].map((s) => (
                <div key={s.label} className={`${s.bg} rounded-xl p-4 border border-border`}>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mb-1">{s.label}</p>
                  <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
              {/* Strategy Selector */}
              <div className="xl:col-span-2 space-y-4">
                <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b bg-muted/40">
                    <p className="font-semibold text-foreground text-sm">Repayment Strategy</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Select a debt-servicing methodology</p>
                  </div>
                  <div className="p-4 space-y-3">
                    {STRATEGIES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStrategy(s.id)}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-150 ${
                          strategy === s.id
                            ? `${strategyColors[s.id]} ring-2`
                            : "border-border bg-card hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-2 h-2 rounded-full ${strategy === s.id ? (s.color === "blue" ? "bg-blue-500" : s.color === "purple" ? "bg-purple-500" : "bg-emerald-500") : "bg-slate-300"}`} />
                          <span className="text-xs font-bold tracking-wider text-foreground">{s.label}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            s.color === "blue" ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                            : s.color === "purple" ? "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          }`}>{s.tag}</span>
                        </div>
                        <p className="text-xs text-foreground/80 leading-relaxed">{s.description}</p>
                        {strategy === s.id && (
                          <p className="text-[11px] text-muted-foreground mt-2 italic border-t border-current border-opacity-10 pt-2">{s.principle}</p>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Cap input */}
                  <div className="px-5 pb-5 pt-1">
                    <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Allocation Cap (optional)
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground font-medium">GH₵</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder={`Max ${reserveBalance.toFixed(2)}`}
                        value={maxAmount}
                        onChange={(e) => setMaxAmount(e.target.value)}
                        className="flex-1 border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Leave blank to use the full available balance</p>
                  </div>
                </div>

                {/* Apply button */}
                {debtList.length > 0 && (
                  <Button
                    className="w-full font-semibold"
                    size="lg"
                    disabled={applying || reserveBalance <= 0 || totalOutstanding === 0}
                    onClick={handleApply}
                  >
                    {applying ? "Applying Allocation…" : `Apply ${STRATEGIES.find(s => s.id === strategy)?.label} Plan`}
                  </Button>
                )}

                {simResult && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-2">Plan Executed Successfully</p>
                    <div className="space-y-1 text-xs text-emerald-700 dark:text-emerald-400">
                      <div className="flex justify-between"><span>Allocations applied</span><span className="font-bold">{simResult.allocatedCount}</span></div>
                      <div className="flex justify-between"><span>Total disbursed</span><span className="font-bold font-mono">{GHS(simResult.totalAllocated)}</span></div>
                      <div className="flex justify-between"><span>Remaining balance</span><span className="font-bold font-mono">{GHS(simResult.newBalance)}</span></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Debt Queue + Simulation */}
              <div className="xl:col-span-3 space-y-4">
                {/* Simulation preview */}
                {debtList.length > 0 && (
                  <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b bg-muted/40 flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-foreground text-sm">Allocation Simulation</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Preview of fund distribution using {STRATEGIES.find(s => s.id === strategy)?.label}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Projected disbursement</p>
                        <p className="text-lg font-bold font-mono text-foreground">{GHS(simTotalApplied)}</p>
                      </div>
                    </div>

                    <div className="divide-y divide-border">
                      {simulation.map((d, i) => {
                        const covered = d.toApply > 0;
                        const partial = covered && d.remaining > 0;
                        const fullySettled = covered && d.remaining === 0;
                        return (
                          <div key={d.id} className={`px-5 py-3 flex items-center gap-3 ${!covered ? "opacity-50" : ""}`}>
                            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold bg-muted text-muted-foreground">
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-xs font-semibold text-foreground/80">{d.writerFullCode}</span>
                                <span className="text-xs text-muted-foreground">{d.writerFullName}</span>
                                <span className="text-[10px] text-muted-foreground">·</span>
                                <span className="text-[10px] text-muted-foreground font-mono">{d.agentFullCode}</span>
                                <span className="text-[10px] text-muted-foreground">·</span>
                                <span className="text-[10px] font-mono text-muted-foreground">{d.calcDate}</span>
                              </div>
                              <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${fullySettled ? "bg-emerald-500" : partial ? "bg-amber-500" : "bg-slate-300"}`}
                                  style={{ width: `${Number(d.outstandingAmount) > 0 ? (d.toApply / Number(d.outstandingAmount)) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">+{GHS(d.toApply)}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">Rem: {GHS(d.remaining)}</div>
                            </div>
                            <div className="flex-shrink-0">
                              {fullySettled && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold">Settled</span>}
                              {partial && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold">Partial</span>}
                              {!covered && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Deferred</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="px-5 py-3 bg-muted/40 border-t flex justify-between items-center">
                      <span className="text-xs text-muted-foreground font-medium">Projected reserve balance after application</span>
                      <span className={`font-mono font-bold text-sm ${simNewBalance < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
                        {GHS(simNewBalance)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Full Debt Queue */}
                <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b bg-muted/40 flex items-center justify-between">
                    <p className="font-semibold text-foreground text-sm">Outstanding Debt Queue</p>
                    <Badge variant={debtList.length === 0 ? "default" : "destructive"} className="text-xs">
                      {debtList.length === 0 ? "All Clear" : `${debtList.length} pending`}
                    </Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="pl-5 text-[11px] text-muted-foreground uppercase tracking-wide">#</TableHead>
                        <TableHead className="text-[11px] text-muted-foreground uppercase tracking-wide">Agent · Writer</TableHead>
                        <TableHead className="text-[11px] text-muted-foreground uppercase tracking-wide">Date</TableHead>
                        <TableHead className="text-[11px] text-muted-foreground uppercase tracking-wide text-right">Gross Sales</TableHead>
                        <TableHead className="text-[11px] text-muted-foreground uppercase tracking-wide text-right">Wins</TableHead>
                        <TableHead className="text-[11px] text-muted-foreground uppercase tracking-wide text-right">Deficit</TableHead>
                        <TableHead className="text-[11px] text-muted-foreground uppercase tracking-wide text-right">Covered</TableHead>
                        <TableHead className="text-[11px] text-muted-foreground uppercase tracking-wide text-right pr-5">Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingDebts ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">Loading debt records…</TableCell>
                        </TableRow>
                      ) : sortedDebts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-10">
                            <div className="flex flex-col items-center gap-1">
                              <svg className="w-8 h-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                              <p className="text-sm font-semibold text-foreground/80">No outstanding debts</p>
                              <p className="text-xs text-muted-foreground">All calculation periods are in good standing</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedDebts.map((d, i) => (
                          <TableRow key={d.id} className="hover:bg-muted/40">
                            <TableCell className="pl-5 text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                            <TableCell>
                              <div className="text-xs font-mono font-semibold text-foreground/80">{d.agentFullCode} · {d.writerFullCode}</div>
                              <div className="text-[10px] text-muted-foreground">{d.agentName} / {d.writerFullName}</div>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-foreground/80">{d.calcDate}</TableCell>
                            <TableCell className="text-xs font-mono text-right text-emerald-700 dark:text-emerald-400">{GHS(d.grossSales)}</TableCell>
                            <TableCell className="text-xs font-mono text-right text-rose-600 dark:text-rose-400">{GHS(d.winsAmount)}</TableCell>
                            <TableCell className="text-xs font-mono text-right font-semibold text-rose-600 dark:text-rose-400">−{GHS(d.deficitAmount)}</TableCell>
                            <TableCell className="text-xs font-mono text-right text-emerald-600 dark:text-emerald-400">
                              {Number(d.amountCovered) > 0 ? GHS(d.amountCovered) : <span className="text-muted-foreground/50">—</span>}
                            </TableCell>
                            <TableCell className="pr-5 text-right">
                              <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400">{GHS(d.outstandingAmount)}</span>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {sortedDebts.length > 0 && (
                    <div className="px-5 py-3 bg-rose-500/5 border-t flex justify-between items-center">
                      <span className="text-xs text-muted-foreground font-medium">Total outstanding obligation</span>
                      <span className="font-mono font-bold text-sm text-rose-600 dark:text-rose-400">{GHS(totalOutstanding)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── AGENT LEDGER TAB ─────────────────────────────────────── */}
        {tab === "ledger" && (
          <AgentLedgerTab
            dateFrom={ledgerDateFrom}
            dateTo={ledgerDateTo}
            onDateFromChange={setLedgerDateFrom}
            onDateToChange={setLedgerDateTo}
            receipts={Array.isArray(receipts) ? receipts : []}
            loading={loadingReceipts}
            deleting={ledgerDeleting}
            onDelete={async (id) => {
              setLedgerDeleting(id);
              try {
                await deleteReceiptMutation({ id });
                toast.success("Receipt removed.");
                await queryClient.invalidateQueries({ queryKey: getListReserveReceiptsQueryKey(ledgerParams) });
              } catch {
                toast.error("Failed to remove receipt.");
              } finally {
                setLedgerDeleting(null);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

type ReceiptRow = {
  id: string;
  agentId: string;
  agentFullCode?: string | null;
  agentName?: string | null;
  calcDate: string;
  amountDue: string;
  amountPaid: string;
  markedBy: string;
  markedByName?: string | null;
  markedAt: string;
  notes?: string | null;
};

function AgentLedgerTab({
  dateFrom, dateTo, onDateFromChange, onDateToChange,
  receipts, loading, deleting, onDelete,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  receipts: ReceiptRow[];
  loading: boolean;
  deleting: string | null;
  onDelete: (id: string) => void;
}) {
  const [agentFilter, setAgentFilter] = useState<string>("");

  const filtered = agentFilter.trim()
    ? receipts.filter(
        (r) =>
          (r.agentFullCode ?? "").toLowerCase().includes(agentFilter.toLowerCase()) ||
          (r.agentName ?? "").toLowerCase().includes(agentFilter.toLowerCase()),
      )
    : receipts;

  // Group by agent
  const byAgent = useMemo(() => {
    const map = new Map<string, { agentId: string; agentFullCode: string; agentName: string | null; rows: ReceiptRow[] }>();
    for (const r of filtered) {
      const key = r.agentId;
      if (!map.has(key)) {
        map.set(key, { agentId: r.agentId, agentFullCode: r.agentFullCode ?? r.agentId.slice(0, 8), agentName: r.agentName ?? null, rows: [] });
      }
      map.get(key)!.rows.push(r);
    }
    return [...map.values()].sort((a, b) => a.agentFullCode.localeCompare(b.agentFullCode));
  }, [filtered]);

  const totalDue = filtered.reduce((s, r) => s + Number(r.amountDue), 0);
  const totalPaid = filtered.reduce((s, r) => s + Number(r.amountPaid), 0);
  const totalGap = totalDue - totalPaid;
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  function toggleAgent(agentId: string) {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-card p-5 rounded-xl border shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-foreground">Agent Ledger Records</h2>
          <p className="text-xs text-muted-foreground">View and export receipts, payment statuses, and outstanding balance summaries.</p>
        </div>
        <Button
          onClick={() => generateAgentLedgerPDF(filtered, dateFrom, dateTo)}
          className="flex items-center gap-2 font-semibold"
          variant="outline"
          disabled={filtered.length === 0}
        >
          <Printer className="w-4 h-4" />
          Export Ledger PDF
        </Button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-card p-4 rounded-xl border shadow-sm items-end">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-bold">From Date</label>
          <Input 
            type="date" 
            value={dateFrom} 
            onChange={(e) => onDateFromChange(e.target.value)} 
            className="h-9 text-sm w-full rounded-lg border-border bg-card" 
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-bold">To Date</label>
          <Input 
            type="date" 
            value={dateTo} 
            onChange={(e) => onDateToChange(e.target.value)} 
            className="h-9 text-sm w-full rounded-lg border-border bg-card" 
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-bold">Search Agent</label>
          <Input
            placeholder="Filter by agent code or name…"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="h-9 text-sm w-full rounded-lg border-border bg-card"
          />
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: "Total Receipts", value: filtered.length, color: "bg-muted text-foreground/80" },
          { label: "Total Due", value: GHS(totalDue), color: "bg-muted text-foreground/80" },
          { label: "Total Paid", value: GHS(totalPaid), color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30" },
          { label: "Shortfall", value: GHS(Math.max(0, totalGap)), color: totalGap > 0 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30" : "bg-muted text-muted-foreground" },
        ].map((c) => (
          <div key={c.label} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${c.color}`}>
            {c.label}: <span className="font-bold">{c.value}</span>
          </div>
        ))}
      </div>

      {/* Per-agent accordion */}
      {loading ? (
        <Card className="border shadow-sm bg-card rounded-2xl">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">Loading receipts…</CardContent>
        </Card>
      ) : byAgent.length === 0 ? (
        <Card className="border shadow-sm bg-card rounded-2xl">
          <CardContent className="py-12 text-center">
            <svg className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            <p className="text-sm text-muted-foreground">No receipts found</p>
            <p className="text-xs text-muted-foreground mt-1">Use the date filters above, or record payments via the Cashier's Reserve Receipts page</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {byAgent.map((agent) => {
            const agentDue = agent.rows.reduce((s, r) => s + Number(r.amountDue), 0);
            const agentPaid = agent.rows.reduce((s, r) => s + Number(r.amountPaid), 0);
            const agentGap = agentDue - agentPaid;
            const expanded = expandedAgents.has(agent.agentId);
            return (
              <Card key={agent.agentId} className="border shadow-sm bg-card rounded-2xl overflow-hidden">
                <button
                  className="w-full text-left"
                  onClick={() => toggleAgent(agent.agentId)}
                >
                  <div className="px-5 py-4 flex items-center gap-4 hover:bg-muted/40 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-foreground">{agent.agentFullCode}</span>
                        {agent.agentName && <span className="text-xs text-muted-foreground">{agent.agentName}</span>}
                        <Badge variant="outline" className="text-xs ml-1">{agent.rows.length} payment{agent.rows.length !== 1 ? "s" : ""}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-right flex-shrink-0">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Due</p>
                        <p className="text-sm font-mono font-semibold text-foreground/80">{GHS(agentDue)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Paid</p>
                        <p className="text-sm font-mono font-semibold text-emerald-600 dark:text-emerald-400">{GHS(agentPaid)}</p>
                      </div>
                      {agentGap > 0.005 && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Shortfall</p>
                          <p className="text-sm font-mono font-semibold text-amber-600 dark:text-amber-400">{GHS(agentGap)}</p>
                        </div>
                      )}
                      <svg
                        className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>
                </button>

                {expanded && (
                  <div className="border-t">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="pl-5 text-xs text-muted-foreground">Date</TableHead>
                          <TableHead className="text-xs text-muted-foreground text-right">Amount Due</TableHead>
                          <TableHead className="text-xs text-muted-foreground text-right">Amount Paid</TableHead>
                          <TableHead className="text-xs text-muted-foreground">Notes</TableHead>
                          <TableHead className="text-xs text-muted-foreground">Marked By</TableHead>
                          <TableHead className="text-xs text-muted-foreground">Marked At</TableHead>
                          <TableHead className="text-xs text-muted-foreground pr-5 text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agent.rows.map((r) => (
                          <TableRow key={r.id} className="hover:bg-muted/30">
                            <TableCell className="pl-5 font-mono text-sm text-foreground/80">{r.calcDate}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-foreground/80">{GHS(r.amountDue)}</TableCell>
                            <TableCell className="text-right font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">{GHS(r.amountPaid)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{r.notes ?? <span className="text-muted-foreground/50">—</span>}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.markedByName ?? r.markedBy.slice(0, 8) + "…"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{new Date(r.markedAt).toLocaleString("en-GH", { dateStyle: "short", timeStyle: "short" })}</TableCell>
                            <TableCell className="pr-5 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-rose-600 dark:text-rose-400 hover:text-red-700 hover:bg-rose-500/10"
                                disabled={deleting === r.id}
                                onClick={() => onDelete(r.id)}
                              >
                                {deleting === r.id ? "Removing…" : "Remove"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

