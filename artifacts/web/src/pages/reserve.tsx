import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetReserveBalance,
  useListReserveAllocations,
  useListReserveDebts,
  useApplyReserveAllocation,
  getGetReserveBalanceQueryKey,
  getListReserveAllocationsQueryKey,
  getListReserveDebtsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

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

function KpiCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "red" | "amber" | "blue";
  icon: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    green: "text-emerald-600",
    red: "text-red-500",
    amber: "text-amber-500",
    blue: "text-blue-600",
  };
  return (
    <Card className="relative overflow-hidden border-0 shadow-sm bg-white">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono leading-tight ${accent ? colors[accent] : "text-slate-800"}`}>
              {value}
            </p>
            {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-xl ${accent === "green" ? "bg-emerald-50" : accent === "red" ? "bg-red-50" : accent === "amber" ? "bg-amber-50" : "bg-blue-50"}`}>
            <span className={`w-5 h-5 block ${accent ? colors[accent] : "text-blue-600"}`}>{icon}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HealthGauge({ pctUsed }: { pctUsed: number }) {
  const clamped = Math.max(0, Math.min(100, pctUsed));
  const color = clamped < 50 ? "bg-emerald-500" : clamped < 80 ? "bg-amber-500" : "bg-red-500";
  const label = clamped < 50 ? "Healthy" : clamped < 80 ? "Moderate" : "Critical";
  const labelColor = clamped < 50 ? "text-emerald-600" : clamped < 80 ? "text-amber-600" : "text-red-600";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500 font-medium">Reserve Utilisation</span>
        <span className={`font-bold ${labelColor}`}>{pct(clamped)} — {label}</span>
      </div>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>0%</span>
        <span>50% — Warning</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export function Reserve() {
  const [tab, setTab] = useState<"overview" | "debt">("overview");
  const [strategy, setStrategy] = useState<Strategy>("fifo");
  const [maxAmount, setMaxAmount] = useState<string>("");
  const [simResult, setSimResult] = useState<null | { items: { agentId: string; amountApplied: string; outstanding: string }[]; totalAllocated: string; newBalance: string; allocatedCount: number }>(null);
  const [applying, setApplying] = useState(false);

  const queryClient = useQueryClient();

  const { data: balance, isLoading: loadingBalance } = useGetReserveBalance({
    query: { queryKey: getGetReserveBalanceQueryKey(), refetchInterval: 30_000 },
  });
  const { data: allocations, isLoading: loadingAllocs } = useListReserveAllocations({}, {
    query: { queryKey: getListReserveAllocationsQueryKey({}), refetchInterval: 30_000 },
  });
  const { data: debts, isLoading: loadingDebts } = useListReserveDebts({
    query: { queryKey: getListReserveDebtsQueryKey(), refetchInterval: 30_000 },
  });

  const { mutateAsync: applyAllocation } = useApplyReserveAllocation();

  const allocationList = Array.isArray(allocations) ? allocations : [];
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
      await queryClient.invalidateQueries({ queryKey: getListReserveAllocationsQueryKey({}) });
      await queryClient.invalidateQueries({ queryKey: getListReserveDebtsQueryKey() });
    } catch {
      toast.error("Failed to apply allocation. Please try again.");
    } finally {
      setApplying(false);
    }
  }

  const strategyColors: Record<Strategy, string> = {
    fifo: "border-blue-500 bg-blue-50 ring-blue-200",
    lifo: "border-purple-500 bg-purple-50 ring-purple-200",
    best_performer: "border-emerald-500 bg-emerald-50 ring-emerald-200",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page Header */}
      <div className="bg-white border-b px-6 pt-6 pb-0">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-slate-400 text-xs font-medium uppercase tracking-widest">Treasury</span>
              <span className="text-slate-300">›</span>
              <span className="text-slate-600 text-xs font-medium">Reserve Fund</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 leading-tight">Reserve Fund Management</h1>
            <p className="text-sm text-slate-500 mt-0.5">Financial safety net tracking, debt servicing and reserve optimisation</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide font-medium">Available Balance</p>
            <p className={`text-3xl font-bold font-mono ${reserveBalance < 0 ? "text-red-500" : reserveBalance < 100 ? "text-amber-600" : "text-emerald-600"}`}>
              {loadingBalance ? "—" : GHS(reserveBalance)}
            </p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-1">
          {([
            { id: "overview", label: "Overview" },
            { id: "debt", label: "Smart Debt Management" },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
              {t.id === "debt" && debtList.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold">
                  {debtList.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* ── OVERVIEW TAB ─────────────────────────────────────────── */}
        {tab === "overview" && (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <KpiCard
                label="Current Balance"
                value={loadingBalance ? "—" : GHS(reserveBalance)}
                sub="Available for allocation"
                accent={reserveBalance < 0 ? "red" : reserveBalance < totalContributed * 0.2 ? "amber" : "green"}
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>}
              />
              <KpiCard
                label="Total Contributed"
                value={loadingBalance ? "—" : GHS(totalContributed)}
                sub="Cumulative reserve income"
                accent="blue"
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>}
              />
              <KpiCard
                label="Total Allocated"
                value={loadingBalance ? "—" : GHS(totalAllocated)}
                sub="Disbursed to cover deficits"
                accent={totalAllocated === 0 ? "blue" : "red"}
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>}
              />
              <KpiCard
                label="Outstanding Debt"
                value={loadingDebts ? "—" : GHS(totalOutstanding)}
                sub={`${debtList.length} obligation${debtList.length !== 1 ? "s" : ""} pending`}
                accent={totalOutstanding === 0 ? "green" : totalOutstanding > reserveBalance ? "red" : "amber"}
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
              />
            </div>

            {/* Health + Coverage */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card className="border-0 shadow-sm bg-white">
                <CardHeader className="pb-3 pt-5 px-5">
                  <CardTitle className="text-sm font-semibold text-slate-700">Reserve Health</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-4">
                  <HealthGauge pctUsed={pctUsed} />
                  <div className="grid grid-cols-3 gap-3 pt-1">
                    {[
                      { label: "Contribution Rate", value: `${Number(balance?.periods?.[0] ? "10" : "0")}%`, hint: "of Net Gross" },
                      { label: "Periods Tracked", value: String(balance?.periods?.length ?? 0), hint: "monthly entries" },
                      { label: "Debt Coverage", value: pct(coverageRatio), hint: "of total debt" },
                    ].map((s) => (
                      <div key={s.label} className="bg-slate-50 rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-slate-800">{s.value}</p>
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{s.label}</p>
                        <p className="text-[10px] text-slate-400">{s.hint}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm bg-white">
                <CardHeader className="pb-3 pt-5 px-5">
                  <CardTitle className="text-sm font-semibold text-slate-700">Period Contributions</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {!balance?.periods?.length ? (
                    <p className="text-sm text-slate-400 py-4 text-center">No period data available</p>
                  ) : (
                    <div className="space-y-2.5">
                      {balance.periods.map((p) => {
                        const contrib = Number(p.totalContributed);
                        const alloc = Number(p.totalAllocated);
                        const bal = Number(p.balance);
                        return (
                          <div key={p.id} className="flex items-center gap-3">
                            <span className="text-xs font-mono text-slate-500 w-20 flex-shrink-0">{p.periodDate}</span>
                            <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${contrib > 0 ? Math.min(100, (bal / contrib) * 100) : 0}%` }}
                              />
                            </div>
                            <span className="text-xs font-mono font-semibold text-slate-700 w-24 text-right">{GHS(bal)}</span>
                            {alloc > 0 && (
                              <span className="text-[10px] text-red-500 font-mono w-20 text-right">−{GHS(alloc)}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Allocation History */}
            <Card className="border-0 shadow-sm bg-white">
              <CardHeader className="pb-2 pt-5 px-5 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-semibold text-slate-700">Allocation History</CardTitle>
                <span className="text-xs text-slate-400">{allocationList.length} record{allocationList.length !== 1 ? "s" : ""}</span>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-t bg-slate-50/80">
                      <TableHead className="pl-5 text-xs text-slate-500">Date</TableHead>
                      <TableHead className="text-xs text-slate-500">Writer</TableHead>
                      <TableHead className="text-xs text-slate-500">Reason</TableHead>
                      <TableHead className="text-xs text-slate-500 text-right">Drawn</TableHead>
                      <TableHead className="text-xs text-slate-500 text-right pr-5">Balance After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingAllocs ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-slate-400 text-sm">Loading allocation history…</TableCell>
                      </TableRow>
                    ) : allocationList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10">
                          <div className="flex flex-col items-center gap-1">
                            <svg className="w-8 h-8 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                            <p className="text-sm text-slate-400">No allocations recorded yet</p>
                            <p className="text-xs text-slate-400">Use Smart Debt Management to service outstanding obligations</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      allocationList.map((a) => (
                        <TableRow key={a.id} className="hover:bg-slate-50/60">
                          <TableCell className="pl-5 text-sm font-mono text-slate-600">{a.allocationDate}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs font-semibold text-slate-700">{a.writerFullCode ?? a.writerId.slice(0, 8) + "…"}</span>
                            {a.writerFullName && <span className="text-xs text-slate-400 ml-1.5">{a.writerFullName}</span>}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 max-w-[220px] truncate">{a.reason ?? "Reserve allocation"}</TableCell>
                          <TableCell className="text-sm font-mono font-semibold text-red-500 text-right">−{GHS(a.amountDrawn)}</TableCell>
                          <TableCell className="text-sm font-mono text-slate-700 text-right pr-5">{GHS(a.reserveBalanceAfter)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}

        {/* ── SMART DEBT MANAGEMENT TAB ───────────────────────────── */}
        {tab === "debt" && (
          <>
            {/* Explainer Banner */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex gap-4 shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">Smart Debt Management Engine</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Debts arise when an agent's wins exceed their net gross for a calculation period, creating a negative writer balance.
                  Select a repayment strategy, review the simulation, then apply the allocation plan to direct reserve funds toward outstanding obligations.
                  All decisions are recorded as immutable allocation entries for full auditability.
                </p>
              </div>
            </div>

            {/* Snapshot */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Reserve Available", value: GHS(reserveBalance), color: reserveBalance > 0 ? "text-emerald-600" : "text-red-500", bg: "bg-emerald-50" },
                { label: "Total Outstanding", value: GHS(totalOutstanding), color: "text-red-500", bg: "bg-red-50" },
                { label: "Debt Coverage", value: pct(coverageRatio), color: coverageRatio >= 100 ? "text-emerald-600" : coverageRatio >= 50 ? "text-amber-600" : "text-red-500", bg: "bg-slate-50" },
              ].map((s) => (
                <div key={s.label} className={`${s.bg} rounded-xl p-4 border border-slate-200`}>
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest mb-1">{s.label}</p>
                  <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
              {/* Strategy Selector */}
              <div className="xl:col-span-2 space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b bg-slate-50/60">
                    <p className="font-semibold text-slate-800 text-sm">Repayment Strategy</p>
                    <p className="text-xs text-slate-400 mt-0.5">Select a debt-servicing methodology</p>
                  </div>
                  <div className="p-4 space-y-3">
                    {STRATEGIES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStrategy(s.id)}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-150 ${
                          strategy === s.id
                            ? `${strategyColors[s.id]} ring-2`
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-2 h-2 rounded-full ${strategy === s.id ? (s.color === "blue" ? "bg-blue-500" : s.color === "purple" ? "bg-purple-500" : "bg-emerald-500") : "bg-slate-300"}`} />
                          <span className="text-xs font-bold tracking-wider text-slate-800">{s.label}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            s.color === "blue" ? "bg-blue-100 text-blue-700"
                            : s.color === "purple" ? "bg-purple-100 text-purple-700"
                            : "bg-emerald-100 text-emerald-700"
                          }`}>{s.tag}</span>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">{s.description}</p>
                        {strategy === s.id && (
                          <p className="text-[11px] text-slate-400 mt-2 italic border-t border-current border-opacity-10 pt-2">{s.principle}</p>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Cap input */}
                  <div className="px-5 pb-5 pt-1">
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Allocation Cap (optional)
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500 font-medium">GH₵</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder={`Max ${reserveBalance.toFixed(2)}`}
                        value={maxAmount}
                        onChange={(e) => setMaxAmount(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">Leave blank to use the full available balance</p>
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
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <p className="text-sm font-semibold text-emerald-800 mb-2">Plan Executed Successfully</p>
                    <div className="space-y-1 text-xs text-emerald-700">
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
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b bg-slate-50/60 flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">Allocation Simulation</p>
                        <p className="text-xs text-slate-400 mt-0.5">Preview of fund distribution using {STRATEGIES.find(s => s.id === strategy)?.label}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Projected disbursement</p>
                        <p className="text-lg font-bold font-mono text-slate-800">{GHS(simTotalApplied)}</p>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {simulation.map((d, i) => {
                        const covered = d.toApply > 0;
                        const partial = covered && d.remaining > 0;
                        const fullySettled = covered && d.remaining === 0;
                        return (
                          <div key={d.id} className={`px-5 py-3 flex items-center gap-3 ${!covered ? "opacity-50" : ""}`}>
                            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold bg-slate-100 text-slate-500">
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-xs font-semibold text-slate-700">{d.writerFullCode}</span>
                                <span className="text-xs text-slate-400">{d.writerFullName}</span>
                                <span className="text-[10px] text-slate-400">·</span>
                                <span className="text-[10px] text-slate-400 font-mono">{d.agentFullCode}</span>
                                <span className="text-[10px] text-slate-400">·</span>
                                <span className="text-[10px] font-mono text-slate-400">{d.calcDate}</span>
                              </div>
                              <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${fullySettled ? "bg-emerald-500" : partial ? "bg-amber-500" : "bg-slate-300"}`}
                                  style={{ width: `${Number(d.outstandingAmount) > 0 ? (d.toApply / Number(d.outstandingAmount)) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-xs font-mono font-semibold text-emerald-600">+{GHS(d.toApply)}</div>
                              <div className="text-[10px] text-slate-400 font-mono">Rem: {GHS(d.remaining)}</div>
                            </div>
                            <div className="flex-shrink-0">
                              {fullySettled && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">Settled</span>}
                              {partial && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Partial</span>}
                              {!covered && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">Deferred</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="px-5 py-3 bg-slate-50 border-t flex justify-between items-center">
                      <span className="text-xs text-slate-500 font-medium">Projected reserve balance after application</span>
                      <span className={`font-mono font-bold text-sm ${simNewBalance < 0 ? "text-red-500" : "text-slate-800"}`}>
                        {GHS(simNewBalance)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Full Debt Queue */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b bg-slate-50/60 flex items-center justify-between">
                    <p className="font-semibold text-slate-800 text-sm">Outstanding Debt Queue</p>
                    <Badge variant={debtList.length === 0 ? "default" : "destructive"} className="text-xs">
                      {debtList.length === 0 ? "All Clear" : `${debtList.length} pending`}
                    </Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/60">
                        <TableHead className="pl-5 text-[11px] text-slate-400 uppercase tracking-wide">#</TableHead>
                        <TableHead className="text-[11px] text-slate-400 uppercase tracking-wide">Agent · Writer</TableHead>
                        <TableHead className="text-[11px] text-slate-400 uppercase tracking-wide">Date</TableHead>
                        <TableHead className="text-[11px] text-slate-400 uppercase tracking-wide text-right">Gross Sales</TableHead>
                        <TableHead className="text-[11px] text-slate-400 uppercase tracking-wide text-right">Wins</TableHead>
                        <TableHead className="text-[11px] text-slate-400 uppercase tracking-wide text-right">Deficit</TableHead>
                        <TableHead className="text-[11px] text-slate-400 uppercase tracking-wide text-right">Covered</TableHead>
                        <TableHead className="text-[11px] text-slate-400 uppercase tracking-wide text-right pr-5">Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingDebts ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-slate-400 text-sm">Loading debt records…</TableCell>
                        </TableRow>
                      ) : sortedDebts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-10">
                            <div className="flex flex-col items-center gap-1">
                              <svg className="w-8 h-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                              <p className="text-sm font-semibold text-slate-600">No outstanding debts</p>
                              <p className="text-xs text-slate-400">All calculation periods are in good standing</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedDebts.map((d, i) => (
                          <TableRow key={d.id} className="hover:bg-slate-50/60">
                            <TableCell className="pl-5 text-xs text-slate-400 font-mono">{i + 1}</TableCell>
                            <TableCell>
                              <div className="text-xs font-mono font-semibold text-slate-700">{d.agentFullCode} · {d.writerFullCode}</div>
                              <div className="text-[10px] text-slate-400">{d.agentName} / {d.writerFullName}</div>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-600">{d.calcDate}</TableCell>
                            <TableCell className="text-xs font-mono text-right text-emerald-700">{GHS(d.grossSales)}</TableCell>
                            <TableCell className="text-xs font-mono text-right text-red-500">{GHS(d.winsAmount)}</TableCell>
                            <TableCell className="text-xs font-mono text-right font-semibold text-red-600">−{GHS(d.deficitAmount)}</TableCell>
                            <TableCell className="text-xs font-mono text-right text-emerald-600">
                              {Number(d.amountCovered) > 0 ? GHS(d.amountCovered) : <span className="text-slate-300">—</span>}
                            </TableCell>
                            <TableCell className="pr-5 text-right">
                              <span className="text-xs font-mono font-bold text-red-600">{GHS(d.outstandingAmount)}</span>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {sortedDebts.length > 0 && (
                    <div className="px-5 py-3 bg-red-50/40 border-t flex justify-between items-center">
                      <span className="text-xs text-slate-500 font-medium">Total outstanding obligation</span>
                      <span className="font-mono font-bold text-sm text-red-600">{GHS(totalOutstanding)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const strategyColors: Record<Strategy, string> = {
  fifo: "border-blue-500 bg-blue-50 ring-blue-200",
  lifo: "border-purple-500 bg-purple-50 ring-purple-200",
  best_performer: "border-emerald-500 bg-emerald-50 ring-emerald-200",
};
