import { useState, useMemo } from "react";
import { useGetWinsDebtReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function fmt(n: string | undefined | null) {
  if (!n) return "GHS 0.00";
  return `GHS ${parseFloat(n).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(part: number, total: number) {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

const URGENCY_CFG = {
  ok:       { label: "Fresh",    bg: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  warning:  { label: "Overdue",  bg: "bg-amber-100 text-amber-800",     bar: "bg-amber-500",   dot: "bg-amber-500" },
  critical: { label: "Critical", bg: "bg-rose-100 text-rose-800",       bar: "bg-rose-500",    dot: "bg-rose-600" },
};

const CLEARED_CFG = {
  agent_net: { label: "Agent Net",     bg: "bg-emerald-100 text-emerald-800" },
  reserve:   { label: "Reserve Fund",  bg: "bg-violet-100 text-violet-800" },
  deficit:   { label: "Still Deficit", bg: "bg-rose-100 text-rose-800" },
};

function AgingBar({ label, count, amount, color, total }: { label: string; count: number; amount: string; color: string; total: number }) {
  const width = pct(parseFloat(amount), total);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{count} entries</span>
          <span>{fmt(amount)}</span>
        </div>
      </div>
      <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.max(width, count > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold ${accent}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-xl ${accent.replace("text-", "bg-").replace("-700", "-100").replace("-600", "-100")}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WinsDebt() {
  const { data, isLoading } = useGetWinsDebtReport();
  const [queueFilter, setQueueFilter] = useState<"all" | "ok" | "warning" | "critical">("all");

  const filteredQueue = useMemo(() => {
    if (!data?.queue) return [];
    if (queueFilter === "all") return data.queue;
    return data.queue.filter((q) => q.urgency === queueFilter);
  }, [data?.queue, queueFilter]);

  const totalPendingAmount = useMemo(() => {
    if (!data?.aging) return 1;
    return (
      parseFloat(data.aging.under7Days.amount) +
      parseFloat(data.aging.days7to14.amount) +
      parseFloat(data.aging.days14to30.amount) +
      parseFloat(data.aging.over30Days.amount)
    ) || 1;
  }, [data?.aging]);

  const queueLIFOFlag = useMemo(() => {
    if (!data?.queue) return false;
    const critical = data.queue.filter((q) => q.urgency === "critical").length;
    const ok = data.queue.filter((q) => q.urgency === "ok").length;
    return critical > 0 && ok > 0;
  }, [data?.queue]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-muted-foreground text-sm">Failed to load wins debt data.</p>
      </div>
    );
  }

  const { summary, aging, paymentSpeed, queue, history } = data;
  const totalWins = parseFloat(summary.totalWinsRecorded);
  const cleared = parseFloat(summary.clearedByAgentNet) + parseFloat(summary.clearedByReserve);
  const clearanceRate = pct(cleared, totalWins);

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Wins Debt Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Bird's-eye view of all recorded wins, clearance status, aging queue and payment performance.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-slate-50 border rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          {clearanceRate}% overall clearance rate
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="Total Wins Recorded"
          value={fmt(summary.totalWinsRecorded)}
          sub={`${summary.calculatedCount + summary.pendingCount} entries`}
          accent="text-slate-700"
          icon={<svg className="w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
        />
        <StatCard
          label="Cleared — Agent Net"
          value={fmt(summary.clearedByAgentNet)}
          sub="Covered by writer surplus"
          accent="text-emerald-700"
          icon={<svg className="w-5 h-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="20 6 9 17 4 12"/></svg>}
        />
        <StatCard
          label="Cleared — Reserve Fund"
          value={fmt(summary.clearedByReserve)}
          sub="Drawn from reserve"
          accent="text-violet-700"
          icon={<svg className="w-5 h-5 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>}
        />
        <StatCard
          label="Remaining Deficit"
          value={fmt(summary.remainingDeficit)}
          sub="Not yet covered"
          accent={parseFloat(summary.remainingDeficit) > 0 ? "text-rose-700" : "text-emerald-700"}
          icon={<svg className="w-5 h-5 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
        />
        <StatCard
          label="Pending (Uncalculated)"
          value={fmt(summary.totalPending)}
          sub={`${summary.pendingCount} entries awaiting run`}
          accent="text-amber-700"
          icon={<svg className="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
        />
        <StatCard
          label="Avg. Days to Clear"
          value={paymentSpeed.avgDaysToCalculate != null ? `${paymentSpeed.avgDaysToCalculate}d` : "—"}
          sub={
            paymentSpeed.fastestDays != null
              ? `Best: ${paymentSpeed.fastestDays}d · Worst: ${paymentSpeed.slowestDays}d`
              : "No history yet"
          }
          accent="text-blue-700"
          icon={<svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
        />
      </div>

      {/* ── Clearance Breakdown Bar ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Total Wins Clearance Breakdown</CardTitle>
          <CardDescription className="text-xs">How all recorded wins have been (or will be) covered</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 mb-3">
            <div className="flex h-5 w-full rounded-full overflow-hidden gap-px">
              {[
                { val: parseFloat(summary.clearedByAgentNet), color: "bg-emerald-500" },
                { val: parseFloat(summary.clearedByReserve), color: "bg-violet-500" },
                { val: parseFloat(summary.totalPending), color: "bg-amber-400" },
                { val: parseFloat(summary.remainingDeficit), color: "bg-rose-500" },
              ].map((seg, i) => {
                const w = pct(seg.val, totalWins || 1);
                return w > 0 ? (
                  <div key={i} className={`${seg.color} h-full transition-all`} style={{ width: `${w}%` }} />
                ) : null;
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            {[
              { label: "Agent Net", color: "bg-emerald-500", value: summary.clearedByAgentNet },
              { label: "Reserve Fund", color: "bg-violet-500", value: summary.clearedByReserve },
              { label: "Pending", color: "bg-amber-400", value: summary.totalPending },
              { label: "Deficit", color: "bg-rose-500", value: summary.remainingDeficit },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded-sm ${item.color}`} />
                <span className="text-muted-foreground">{item.label}:</span>
                <span className="font-medium">{fmt(item.value)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Aging Buckets ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Pending Queue — Aging Analysis</CardTitle>
            <CardDescription className="text-xs">How long wins entries have been waiting to be calculated</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary.pendingCount === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No pending wins entries.</p>
            ) : (
              <>
                <AgingBar label="Under 7 days" count={aging.under7Days.count} amount={aging.under7Days.amount} color="bg-emerald-500" total={totalPendingAmount} />
                <AgingBar label="7 – 14 days" count={aging.days7to14.count} amount={aging.days7to14.amount} color="bg-amber-400" total={totalPendingAmount} />
                <AgingBar label="14 – 30 days" count={aging.days14to30.count} amount={aging.days14to30.amount} color="bg-orange-500" total={totalPendingAmount} />
                <AgingBar label="Over 30 days" count={aging.over30Days.count} amount={aging.over30Days.amount} color="bg-rose-600" total={totalPendingAmount} />
                <p className="text-xs text-muted-foreground pt-1 border-t">
                  Total pending: <span className="font-semibold text-foreground">{fmt(summary.totalPending)}</span> across <span className="font-semibold text-foreground">{summary.pendingCount}</span> entries
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Payment Speed ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Clearance Speed — Historical</CardTitle>
            <CardDescription className="text-xs">Time from wins entry date to calculation date</CardDescription>
          </CardHeader>
          <CardContent>
            {paymentSpeed.avgDaysToCalculate == null ? (
              <p className="text-sm text-muted-foreground text-center py-6">No calculated entries yet.</p>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Average", value: `${paymentSpeed.avgDaysToCalculate}d`, color: "text-blue-700", bg: "bg-blue-50" },
                    { label: "Fastest", value: `${paymentSpeed.fastestDays}d`, color: "text-emerald-700", bg: "bg-emerald-50" },
                    { label: "Slowest", value: `${paymentSpeed.slowestDays}d`, color: "text-rose-700", bg: "bg-rose-50" },
                  ].map((m) => (
                    <div key={m.label} className={`${m.bg} rounded-xl p-4 text-center`}>
                      <div className={`text-3xl font-bold ${m.color}`}>{m.value}</div>
                      <div className="text-xs text-muted-foreground mt-1">{m.label}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-slate-700">Performance Guide</p>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />Same-day (0 days) — Excellent performance</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />1–7 days — Acceptable. Monitor closely.</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-rose-600 flex-shrink-0" />Over 7 days — Debt accumulation risk. Act now.</div>
                  </div>
                </div>
                <div className="border rounded-lg p-3 bg-slate-50 text-xs text-slate-600 space-y-1">
                  <p className="font-medium text-slate-700">What this tells you:</p>
                  <p>Average clearance of <strong>{paymentSpeed.avgDaysToCalculate} days</strong> means wins recorded today are
                  {(paymentSpeed.avgDaysToCalculate ?? 0) <= 1 ? " typically cleared same-day — strong debt management." :
                   (paymentSpeed.avgDaysToCalculate ?? 0) <= 7 ? " cleared within a week. Acceptable, but reduce further." :
                   " taking too long to process. Review calculation run frequency."}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── FIFO/LIFO Warning ── */}
      {queueLIFOFlag && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <svg className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-rose-800">LIFO Behaviour Detected</p>
            <p className="text-xs text-rose-700">
              You have <strong>critical-age entries</strong> sitting in the queue while newer entries are also pending. This suggests wins may not be being processed in first-in-first-out order. Older wins debts should be prioritised for the next calculation run to prevent further aging.
            </p>
          </div>
        </div>
      )}
      {!queueLIFOFlag && queue.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-emerald-800">FIFO Order — Queue is healthy</p>
            <p className="text-xs text-emerald-700">All pending entries are within acceptable age thresholds. No signs of older debts being skipped over.</p>
          </div>
        </div>
      )}

      {/* ── Tabs: Queue + History ── */}
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">
            Pending Queue
            {summary.pendingCount > 0 && (
              <span className="ml-1.5 text-xs bg-amber-100 text-amber-800 rounded-full px-1.5 py-0.5 font-medium">{summary.pendingCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            Clearance History
            {summary.calculatedCount > 0 && (
              <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-800 rounded-full px-1.5 py-0.5 font-medium">{summary.calculatedCount}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Queue Tab ── */}
        <TabsContent value="queue" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-sm font-semibold">Wins Pending Calculation (FIFO Order)</CardTitle>
                  <CardDescription className="text-xs mt-0.5">Oldest first — entries at the top should be calculated next</CardDescription>
                </div>
                <div className="flex gap-1">
                  {(["all", "ok", "warning", "critical"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setQueueFilter(f)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        queueFilter === f
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {f === "all" ? "All" : URGENCY_CFG[f].label}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredQueue.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  {summary.pendingCount === 0 ? "No pending wins entries — queue is clear." : "No entries match this filter."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-4 pl-4" />
                        <TableHead>Writer</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Entry Date</TableHead>
                        <TableHead className="text-right">Wins Amount</TableHead>
                        <TableHead className="text-center">Days in Queue</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredQueue.map((item, idx) => {
                        const cfg = URGENCY_CFG[item.urgency];
                        return (
                          <TableRow key={item.id} className="hover:bg-slate-50/50">
                            <TableCell className="pl-4 pr-0">
                              <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                                {idx + 1}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-sm">{item.writerName}</div>
                              <div className="text-xs text-muted-foreground font-mono">{item.writerCode}</div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{item.agentName}</div>
                              <div className="text-xs text-muted-foreground font-mono">{item.agentCode}</div>
                            </TableCell>
                            <TableCell className="text-sm">{item.entryDate}</TableCell>
                            <TableCell className="text-right font-semibold text-sm">{fmt(item.winsAmount)}</TableCell>
                            <TableCell className="text-center">
                              <span className={`text-sm font-bold ${item.urgency === "critical" ? "text-rose-700" : item.urgency === "warning" ? "text-amber-700" : "text-emerald-700"}`}>
                                {item.daysInQueue}d
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs ${cfg.bg}`} variant="outline">
                                {cfg.label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── History Tab ── */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Clearance History</CardTitle>
              <CardDescription className="text-xs mt-0.5">Most recent 100 calculated wins entries — how each was cleared and how long it took</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No calculation history yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Writer</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Wins</TableHead>
                        <TableHead className="text-right">Reserve Used</TableHead>
                        <TableHead className="text-right">Writer Balance</TableHead>
                        <TableHead className="text-center">Days Taken</TableHead>
                        <TableHead>Cleared By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((item, i) => {
                        const cfg = CLEARED_CFG[item.clearedBy];
                        const slow = item.daysToCalculate > 7;
                        return (
                          <TableRow key={`${item.writerId}-${item.calcDate}-${i}`} className="hover:bg-slate-50/50">
                            <TableCell>
                              <div className="font-medium text-sm">{item.writerName}</div>
                              <div className="text-xs text-muted-foreground font-mono">{item.writerCode}</div>
                            </TableCell>
                            <TableCell className="text-sm">{item.agentName}</TableCell>
                            <TableCell className="text-sm">{item.calcDate}</TableCell>
                            <TableCell className="text-right font-semibold text-sm">{fmt(item.winsAmount)}</TableCell>
                            <TableCell className="text-right text-sm">
                              {parseFloat(item.reserveDrawn) > 0 ? (
                                <span className="text-violet-700 font-medium">{fmt(item.reserveDrawn)}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              <span className={parseFloat(item.writerBalance) < 0 ? "text-rose-700 font-semibold" : "text-emerald-700 font-semibold"}>
                                {fmt(item.writerBalance)}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={`text-sm font-bold ${slow ? "text-rose-700" : item.daysToCalculate > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                                {item.daysToCalculate === 0 ? "Same day" : `${item.daysToCalculate}d`}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs ${cfg.bg}`} variant="outline">{cfg.label}</Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
