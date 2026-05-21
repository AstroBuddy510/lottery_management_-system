import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetWriterReport, useGetAgentReport, useGetOrgReport,
  useListAgents, useListWriters,
  getGetWriterReportQueryKey, getGetAgentReportQueryKey, getGetOrgReportQueryKey,
  getListWritersQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: string | number | undefined | null) {
  const n = Number(v ?? 0);
  return n < 0 ? `(GH₵ ${Math.abs(n).toFixed(2)})` : `GH₵ ${n.toFixed(2)}`;
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s.split("T")[0] + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

const todayStr = () => new Date().toISOString().split("T")[0];
const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const firstOfLastMonth = () => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const lastOfLastMonth = () => {
  const d = new Date(); d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const firstOfYear = () => `${new Date().getFullYear()}-01-01`;

// ── Shared UI ─────────────────────────────────────────────────────────────────

type ReportTotals = {
  grossSales: string;
  commissionAmount: string;
  netGross: string;
  winsAmount: string;
  reserveAmount: string;
  writerBalance: string;
};

function AmtCell({ v, dim }: { v: string | number; dim?: boolean }) {
  const n = Number(v);
  return (
    <span className={`font-mono text-sm tabular-nums ${n < 0 ? "text-red-600 dark:text-red-400" : dim ? "text-muted-foreground" : ""}`}>
      {n < 0 ? `(GH₵ ${Math.abs(n).toFixed(2)})` : `GH₵ ${n.toFixed(2)}`}
    </span>
  );
}

function TotalsGrid({ t, label }: { t: ReportTotals; label?: string }) {
  const balance = Number(t.writerBalance);
  const items = [
    { l: "Gross Sales", v: t.grossSales, dim: false, accent: false },
    { l: "Commission", v: t.commissionAmount, dim: true, accent: false },
    { l: "Net Gross", v: t.netGross, dim: false, accent: false },
    { l: "Wins Paid Out", v: t.winsAmount, dim: true, accent: false },
    { l: "Reserve", v: t.reserveAmount, dim: true, accent: false },
    { l: "Net Balance", v: t.writerBalance, dim: false, accent: true },
  ] as const;
  return (
    <div className="rounded-xl border bg-card p-4">
      {label && <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{label}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map(({ l, v, dim, accent }) => (
          <div key={l} className={`rounded-lg px-3 py-2.5 ${accent ? (balance < 0 ? "bg-red-50 dark:bg-red-950/40" : "bg-emerald-50 dark:bg-emerald-950/40") : "bg-muted/40"}`}>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{l}</div>
            <div className={`font-mono font-semibold tabular-nums text-sm ${accent ? (balance < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400") : dim ? "text-muted-foreground" : ""}`}>
              {Number(v) < 0 ? `(GH₵ ${Math.abs(Number(v)).toFixed(2)})` : `GH₵ ${Number(v).toFixed(2)}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportLetterhead({ title, subtitle, dateFrom, dateTo }: { title: string; subtitle?: string; dateFrom?: string; dateTo?: string }) {
  const range = dateFrom || dateTo ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}` : "All periods";
  return (
    <div className="flex items-center gap-4 bg-card border rounded-xl px-5 py-4 mb-1">
      <img src="/company-logo.png" alt="VS2000" className="w-11 h-11 rounded-full object-cover flex-shrink-0 ring-2 ring-border shadow-sm" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">VS2000 Smart Office</div>
        <div className="text-base font-bold text-foreground leading-tight mt-0.5">{title}</div>
        {subtitle && <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      <div className="text-right flex-shrink-0 space-y-0.5">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Period</div>
        <div className="text-xs font-medium">{range}</div>
        <div className="text-[10px] text-muted-foreground">
          {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </div>
      </div>
    </div>
  );
}

function DateShortcuts({ onSelect }: { onSelect: (from: string, to: string) => void }) {
  const shortcuts = [
    { label: "This Month", from: firstOfMonth(), to: todayStr() },
    { label: "Last Month", from: firstOfLastMonth(), to: lastOfLastMonth() },
    { label: "This Year", from: firstOfYear(), to: todayStr() },
    { label: "All Time", from: "", to: "" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {shortcuts.map(s => (
        <button key={s.label} onClick={() => onSelect(s.from, s.to)}
          className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors border">
          {s.label}
        </button>
      ))}
    </div>
  );
}

function ParamPanel({ children, onRun, disabled, loading }: {
  children: React.ReactNode; onRun: () => void; disabled?: boolean; loading?: boolean;
}) {
  return (
    <div className="bg-muted/20 border rounded-xl p-4 space-y-3">
      {children}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">Adjust parameters above, then run.</span>
        <Button size="sm" disabled={disabled || loading} onClick={onRun} className="min-w-[96px]">
          {loading ? "Loading…" : "Run Report"}
        </Button>
      </div>
    </div>
  );
}

function TableFoot({ row }: { row: ReportTotals & { label?: string; count?: number } }) {
  const b = Number(row.writerBalance);
  return (
    <tfoot>
      <tr className="border-t-2 bg-muted/30 text-sm">
        <td className="px-4 py-2.5 text-[11px] font-bold uppercase text-muted-foreground">
          {row.label ?? "Total"}{row.count !== undefined ? ` (${row.count})` : ""}
        </td>
        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{fmt(row.grossSales)}</td>
        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-muted-foreground">{fmt(row.commissionAmount)}</td>
        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">{fmt(row.netGross)}</td>
        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-muted-foreground">{fmt(row.winsAmount)}</td>
        <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-muted-foreground">{fmt(row.reserveAmount)}</td>
        <td className={`px-4 py-2.5 text-right font-mono font-bold tabular-nums ${b < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
          {fmt(row.writerBalance)}
        </td>
      </tr>
    </tfoot>
  );
}

function FinanceTableHead() {
  return (
    <TableHeader>
      <TableRow className="bg-muted/40">
        <TableHead className="text-xs w-[160px]">Name</TableHead>
        <TableHead className="text-right text-xs">Gross Sales</TableHead>
        <TableHead className="text-right text-xs">Commission</TableHead>
        <TableHead className="text-right text-xs">Net Gross</TableHead>
        <TableHead className="text-right text-xs">Wins</TableHead>
        <TableHead className="text-right text-xs">Reserve</TableHead>
        <TableHead className="text-right text-xs">Balance</TableHead>
      </TableRow>
    </TableHeader>
  );
}

// ── Writer Report ─────────────────────────────────────────────────────────────

type PendingInfo = {
  grossEntries: { id: string; entryDate: string; grossAmount: string }[];
  winsEntries: { id: string; entryDate: string; winsAmount: string }[];
  totalGross: string;
  totalWins: string;
};

type WriterReportFull = {
  writer?: { id: string; fullCode: string; fullName: string } | null;
  totals: ReportTotals;
  rows: (ReportTotals & { calcDate?: string })[];
  pending?: PendingInfo;
};

function WriterReportView() {
  const [selectedAgent, setSelectedAgent] = useState("");
  const [writerId, setWriterId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [run, setRun] = useState(false);

  const { data: agents } = useListAgents({});
  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: {
      queryKey: getListWritersQueryKey(selectedAgent, {}),
      enabled: !!selectedAgent,
    },
  });

  const { data: report, isLoading } = useGetWriterReport(
    writerId,
    { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    {
      query: {
        queryKey: getGetWriterReportQueryKey(writerId, { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
        enabled: run && !!writerId,
      },
    },
  );

  const r = report as WriterReportFull | undefined;
  const agentList = Array.isArray(agents) ? agents : [];
  const writerList = Array.isArray(writers) ? writers : [];

  const reset = () => setRun(false);
  const applyDates = (f: string, t: string) => { setDateFrom(f); setDateTo(t); reset(); };

  return (
    <div className="space-y-4 pt-4">
      <ParamPanel onRun={() => setRun(true)} disabled={!writerId} loading={isLoading}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Agent</Label>
            <Select value={selectedAgent || "_none"} onValueChange={v => { setSelectedAgent(v === "_none" ? "" : v); setWriterId(""); reset(); }}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Select agent —</SelectItem>
                {agentList.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Writer</Label>
            <Select value={writerId || "_none"} onValueChange={v => { setWriterId(v === "_none" ? "" : v); reset(); }} disabled={!selectedAgent}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="Select writer…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Select writer —</SelectItem>
                {writerList.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); reset(); }} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); reset(); }} className="h-9 text-sm bg-background" />
          </div>
        </div>
        <DateShortcuts onSelect={applyDates} />
      </ParamPanel>

      {!run && !isLoading && (
        <div className="text-center py-12 text-sm text-muted-foreground">Select a writer and click Run Report.</div>
      )}

      {r && (
        <div className="space-y-4">
          <ReportLetterhead
            title="Writer Performance Report"
            subtitle={`${r.writer?.fullCode ?? "—"} — ${r.writer?.fullName ?? "—"}`}
            dateFrom={dateFrom} dateTo={dateTo}
          />

          <TotalsGrid t={r.totals} label="Calculated Period Totals" />

          {/* Pending entries notice */}
          {r.pending && (Number(r.pending.totalGross) > 0 || Number(r.pending.totalWins) > 0) && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                  Pending Entries — Not Yet Calculated
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase mb-1">
                    Gross Entries ({r.pending.grossEntries.length})
                  </div>
                  <div className="font-mono font-semibold text-amber-800 dark:text-amber-300">
                    GH₵ {Number(r.pending.totalGross).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase mb-1">
                    Wins Entries ({r.pending.winsEntries.length})
                  </div>
                  <div className="font-mono font-semibold text-amber-800 dark:text-amber-300">
                    GH₵ {Number(r.pending.totalWins).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Daily rows table */}
          {r.rows && r.rows.length > 0 ? (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-right text-xs">Gross Sales</TableHead>
                    <TableHead className="text-right text-xs">Commission</TableHead>
                    <TableHead className="text-right text-xs">Net Gross</TableHead>
                    <TableHead className="text-right text-xs">Wins</TableHead>
                    <TableHead className="text-right text-xs">Reserve</TableHead>
                    <TableHead className="text-right text-xs">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.rows.map((row, i) => (
                    <TableRow key={i} className="hover:bg-muted/20">
                      <TableCell className="text-sm font-medium">{fmtDate(row.calcDate)}</TableCell>
                      <TableCell className="text-right"><AmtCell v={row.grossSales} /></TableCell>
                      <TableCell className="text-right"><AmtCell v={row.commissionAmount} dim /></TableCell>
                      <TableCell className="text-right"><AmtCell v={row.netGross} /></TableCell>
                      <TableCell className="text-right"><AmtCell v={row.winsAmount} dim /></TableCell>
                      <TableCell className="text-right"><AmtCell v={row.reserveAmount} dim /></TableCell>
                      <TableCell className="text-right"><AmtCell v={row.writerBalance} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFoot row={{ ...r.totals, label: "Period Total", count: r.rows.length }} />
              </Table>
            </div>
          ) : (
            <div className="text-center py-10 text-sm text-muted-foreground border rounded-xl">
              No calculated entries for this writer in the selected period.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Agent Report ──────────────────────────────────────────────────────────────

type AgentPayment = {
  id: string;
  paymentDate: string;
  amount: string;
  transactionType: string;
  receiptNumber?: string | null;
  notes?: string | null;
};

type WriterSummary = {
  writer: { id: string; fullCode: string; fullName: string };
  totals: ReportTotals;
};

type AgentReportFull = {
  agent?: { id: string; fullCode: string; user?: { fullName?: string } | null } | null;
  totals: ReportTotals;
  writers: WriterSummary[];
  payments?: AgentPayment[];
  totalPaid?: string;
};

function AgentReportView() {
  const [agentId, setAgentId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [run, setRun] = useState(false);
  const [showPayments, setShowPayments] = useState(false);

  const { data: agents } = useListAgents({});
  const { data: report, isLoading } = useGetAgentReport(
    agentId,
    { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    {
      query: {
        queryKey: getGetAgentReportQueryKey(agentId, { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
        enabled: run && !!agentId,
      },
    },
  );

  const r = report as AgentReportFull | undefined;
  const agentList = Array.isArray(agents) ? agents : [];
  const reset = () => setRun(false);
  const applyDates = (f: string, t: string) => { setDateFrom(f); setDateTo(t); reset(); };

  return (
    <div className="space-y-4 pt-4">
      <ParamPanel onRun={() => setRun(true)} disabled={!agentId} loading={isLoading}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Agent</Label>
            <Select value={agentId || "_none"} onValueChange={v => { setAgentId(v === "_none" ? "" : v); reset(); }}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Select agent —</SelectItem>
                {agentList.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); reset(); }} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); reset(); }} className="h-9 text-sm bg-background" />
          </div>
        </div>
        <DateShortcuts onSelect={applyDates} />
      </ParamPanel>

      {!run && !isLoading && (
        <div className="text-center py-12 text-sm text-muted-foreground">Select an agent and click Run Report.</div>
      )}

      {r && (
        <div className="space-y-4">
          <ReportLetterhead
            title="Agent Performance Report"
            subtitle={`${r.agent?.fullCode ?? "—"} — ${r.agent?.user?.fullName ?? "—"}`}
            dateFrom={dateFrom} dateTo={dateTo}
          />

          <TotalsGrid t={r.totals} label="Agent Period Totals" />

          {/* Payments summary */}
          {r.totalPaid !== undefined && (
            <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                  Payments Collected ({r.payments?.length ?? 0})
                </div>
                <div className="font-mono font-bold text-blue-700 dark:text-blue-400">
                  GH₵ {Number(r.totalPaid).toFixed(2)}
                </div>
              </div>
              {(r.payments?.length ?? 0) > 0 && (
                <Button variant="outline" size="sm" onClick={() => setShowPayments(v => !v)}>
                  {showPayments ? "Hide" : "View Payments"}
                </Button>
              )}
            </div>
          )}

          {showPayments && r.payments && r.payments.length > 0 && (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Receipt</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-right text-xs">Amount</TableHead>
                    <TableHead className="text-xs">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.payments.map(p => (
                    <TableRow key={p.id} className="hover:bg-muted/20">
                      <TableCell className="text-sm">{fmtDate(p.paymentDate)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.receiptNumber ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {p.transactionType.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right"><AmtCell v={p.amount} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{p.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Per-writer breakdown */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
              Writer Breakdown
            </div>
            {r.writers && r.writers.length > 0 ? (
              <div className="rounded-xl border overflow-hidden">
                <Table>
                  <FinanceTableHead />
                  <TableBody>
                    {r.writers.filter(ws => ws.writer).map(ws => (
                      <TableRow key={ws.writer.id} className="hover:bg-muted/20">
                        <TableCell>
                          <div className="font-mono text-sm font-semibold">{ws.writer.fullCode}</div>
                          <div className="text-xs text-muted-foreground">{ws.writer.fullName}</div>
                        </TableCell>
                        <TableCell className="text-right"><AmtCell v={ws.totals.grossSales} /></TableCell>
                        <TableCell className="text-right"><AmtCell v={ws.totals.commissionAmount} dim /></TableCell>
                        <TableCell className="text-right"><AmtCell v={ws.totals.netGross} /></TableCell>
                        <TableCell className="text-right"><AmtCell v={ws.totals.winsAmount} dim /></TableCell>
                        <TableCell className="text-right"><AmtCell v={ws.totals.reserveAmount} dim /></TableCell>
                        <TableCell className="text-right"><AmtCell v={ws.totals.writerBalance} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFoot row={{ ...r.totals, label: "Agent Total", count: r.writers.length }} />
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground border rounded-xl">
                No calculated data for this agent in the selected period.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Org Report ────────────────────────────────────────────────────────────────

type OrgAgentSummary = {
  agent: { id: string; fullCode: string; user?: { fullName?: string } | null };
  totals: ReportTotals;
};

type OrgReportFull = {
  totals: ReportTotals;
  agents: OrgAgentSummary[];
};

function OrgReportView() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [run, setRun] = useState(false);

  const { data: report, isLoading } = useGetOrgReport(
    { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    {
      query: {
        queryKey: getGetOrgReportQueryKey({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
        enabled: run,
      },
    },
  );

  const r = report as OrgReportFull | undefined;
  const reset = () => setRun(false);
  const applyDates = (f: string, t: string) => { setDateFrom(f); setDateTo(t); reset(); };

  return (
    <div className="space-y-4 pt-4">
      <ParamPanel onRun={() => setRun(true)} loading={isLoading}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); reset(); }} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); reset(); }} className="h-9 text-sm bg-background" />
          </div>
        </div>
        <DateShortcuts onSelect={applyDates} />
      </ParamPanel>

      {!run && !isLoading && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          Set a date range (optional) and click Run Report.
        </div>
      )}

      {r && (
        <div className="space-y-4">
          <ReportLetterhead title="Organisation Report" dateFrom={dateFrom} dateTo={dateTo} />

          <TotalsGrid t={r.totals} label="Organisation Totals" />

          {r.agents && r.agents.length > 0 ? (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <FinanceTableHead />
                <TableBody>
                  {r.agents.map(a => (
                    <TableRow key={a.agent.id} className="hover:bg-muted/20">
                      <TableCell>
                        <div className="font-mono text-sm font-semibold">{a.agent.fullCode}</div>
                        <div className="text-xs text-muted-foreground">{a.agent.user?.fullName ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-right"><AmtCell v={a.totals.grossSales} /></TableCell>
                      <TableCell className="text-right"><AmtCell v={a.totals.commissionAmount} dim /></TableCell>
                      <TableCell className="text-right"><AmtCell v={a.totals.netGross} /></TableCell>
                      <TableCell className="text-right"><AmtCell v={a.totals.winsAmount} dim /></TableCell>
                      <TableCell className="text-right"><AmtCell v={a.totals.reserveAmount} dim /></TableCell>
                      <TableCell className="text-right"><AmtCell v={a.totals.writerBalance} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFoot row={{ ...r.totals, label: "Organisation Total", count: r.agents.length }} />
              </Table>
            </div>
          ) : (
            <div className="text-center py-10 text-sm text-muted-foreground border rounded-xl">
              No calculated data in this period.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Game Sales Report ─────────────────────────────────────────────────────────

type GameSalesWriter = { id: string; fullCode: string; fullName: string };
type GameSalesByGameType = {
  gameType: string;
  ticketCount: number;
  totalAmount: string;
  pct: number;
  writers: { writer: GameSalesWriter; ticketCount: number; totalAmount: string }[];
};
type GameSalesByWriter = {
  writer: GameSalesWriter;
  ticketCount: number;
  totalAmount: string;
  pct: number;
  byGameType: { gameType: string; ticketCount: number; totalAmount: string }[];
};
type GameSalesEntry = {
  id: string;
  saleDate: string;
  gameType: string;
  ticketAmount: string;
  writerId: string;
  writerCode: string;
  writerFullName: string;
  imageUrl?: string | null;
};
type GameSalesReport = {
  agent: { id: string; fullCode: string; user?: { fullName?: string } | null };
  summary: { totalEntries: number; totalAmount: string; gameTypeCount: number; writerCount: number };
  byGameType: GameSalesByGameType[];
  byWriter: GameSalesByWriter[];
  entries: GameSalesEntry[];
};

const GAME_TYPE_COLOURS: Record<string, string> = {
  Lotto:    "bg-blue-500",
  Lucky5:   "bg-emerald-500",
  Fortune3: "bg-violet-500",
  Banker:   "bg-amber-500",
};
function gameTypeColour(gt: string) { return GAME_TYPE_COLOURS[gt] ?? "bg-gray-400"; }

async function fetchGameSalesReport(agentId: string, dateFrom: string, dateTo: string): Promise<GameSalesReport> {
  const token = localStorage.getItem("accessToken");
  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/reports/agent/${agentId}/game-sales${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<GameSalesReport>;
}

function GameSalesView() {
  const [agentId, setAgentId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [run, setRun] = useState(false);
  const [showWriterBreakdown, setShowWriterBreakdown] = useState(false);
  const [showEntries, setShowEntries] = useState(false);

  const { data: agents } = useListAgents({});
  const agentList = Array.isArray(agents) ? agents : [];

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["game-sales", agentId, dateFrom, dateTo],
    queryFn: () => fetchGameSalesReport(agentId, dateFrom, dateTo),
    enabled: run && !!agentId,
  });

  const reset = () => setRun(false);
  const applyDates = (f: string, t: string) => { setDateFrom(f); setDateTo(t); reset(); };
  const r = report;

  return (
    <div className="space-y-4 pt-4">
      <ParamPanel onRun={() => setRun(true)} disabled={!agentId} loading={isLoading}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Agent</Label>
            <Select value={agentId || "_none"} onValueChange={v => { setAgentId(v === "_none" ? "" : v); reset(); }}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Select agent —</SelectItem>
                {agentList.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); reset(); }} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); reset(); }} className="h-9 text-sm bg-background" />
          </div>
        </div>
        <DateShortcuts onSelect={applyDates} />
      </ParamPanel>

      {!run && !isLoading && (
        <div className="text-center py-12 text-sm text-muted-foreground">Select an agent and click Run Report.</div>
      )}

      {error && (
        <div className="text-center py-8 text-sm text-red-600 border border-red-200 rounded-xl">
          Failed to load report. Please try again.
        </div>
      )}

      {r && (
        <div className="space-y-4">
          <ReportLetterhead
            title="Game Sales Report"
            subtitle={`${r.agent?.fullCode ?? "—"} — ${r.agent?.user?.fullName ?? "—"}`}
            dateFrom={dateFrom} dateTo={dateTo}
          />

          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Sales", value: `GH₵ ${Number(r.summary.totalAmount).toFixed(2)}`, sub: `${r.summary.totalEntries} ticket entries` },
              { label: "Game Types", value: String(r.summary.gameTypeCount), sub: "distinct games" },
              { label: "Active Writers", value: String(r.summary.writerCount), sub: "logged sales" },
              {
                label: "Avg per Entry",
                value: r.summary.totalEntries > 0
                  ? `GH₵ ${(Number(r.summary.totalAmount) / r.summary.totalEntries).toFixed(2)}`
                  : "—",
                sub: "per ticket entry",
              },
            ].map(({ label, value, sub }) => (
              <div key={label} className="rounded-xl border bg-card px-4 py-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
                <div className="font-mono font-bold text-base">{value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
              </div>
            ))}
          </div>

          {/* By game type */}
          {r.byGameType.length > 0 ? (
            <div className="rounded-xl border overflow-hidden">
              <div className="bg-muted/40 px-4 py-2.5 border-b flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sales by Game Type</span>
                <span className="text-xs text-muted-foreground">{r.byGameType.length} games</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20">
                    <TableHead className="text-xs w-[160px]">Game</TableHead>
                    <TableHead className="text-xs">Share</TableHead>
                    <TableHead className="text-right text-xs">Entries</TableHead>
                    <TableHead className="text-right text-xs">Total Sales</TableHead>
                    <TableHead className="text-right text-xs">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.byGameType.map(gt => (
                    <TableRow key={gt.gameType} className="hover:bg-muted/20">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${gameTypeColour(gt.gameType)}`} />
                          <span className="font-semibold text-sm">{gt.gameType}</span>
                        </div>
                      </TableCell>
                      <TableCell className="pr-6 w-[140px]">
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${gameTypeColour(gt.gameType)}`} style={{ width: `${gt.pct}%` }} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{gt.ticketCount}</TableCell>
                      <TableCell className="text-right font-mono font-semibold text-sm">
                        GH₵ {Number(gt.totalAmount).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="font-mono text-xs">{gt.pct.toFixed(1)}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30">
                    <td className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Total</td>
                    <td />
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{r.summary.totalEntries}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">
                      GH₵ {Number(r.summary.totalAmount).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">100%</td>
                  </tr>
                </tfoot>
              </Table>
            </div>
          ) : (
            <div className="text-center py-10 text-sm text-muted-foreground border rounded-xl">
              No game sales recorded for this agent in the selected period.
            </div>
          )}

          {/* By writer breakdown (toggle) */}
          {r.byWriter.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Writer Breakdown ({r.byWriter.length})
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowWriterBreakdown(v => !v)}>
                  {showWriterBreakdown ? "Hide" : "Show Writer Breakdown"}
                </Button>
              </div>
              {showWriterBreakdown && (
                <div className="rounded-xl border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="text-xs">Writer</TableHead>
                        <TableHead className="text-xs">Games</TableHead>
                        <TableHead className="text-right text-xs">Entries</TableHead>
                        <TableHead className="text-right text-xs">Total Sales</TableHead>
                        <TableHead className="text-right text-xs">% Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.byWriter.map(ws => (
                        <TableRow key={ws.writer.id} className="hover:bg-muted/20">
                          <TableCell>
                            <div className="font-mono text-sm font-semibold">{ws.writer.fullCode}</div>
                            <div className="text-xs text-muted-foreground">{ws.writer.fullName}</div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {ws.byGameType.slice(0, 3).map(g => (
                                <span key={g.gameType} className={`inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full text-white ${gameTypeColour(g.gameType)}`}>
                                  {g.gameType}
                                </span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{ws.ticketCount}</TableCell>
                          <TableCell className="text-right font-mono font-semibold text-sm">
                            GH₵ {Number(ws.totalAmount).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="font-mono text-xs">{ws.pct.toFixed(1)}%</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {/* Individual entries (toggle) */}
          {r.entries.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  All Entries ({r.entries.length})
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowEntries(v => !v)}>
                  {showEntries ? "Hide Entries" : "View All Entries"}
                </Button>
              </div>
              {showEntries && (
                <div className="rounded-xl border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">Writer</TableHead>
                        <TableHead className="text-xs">Game</TableHead>
                        <TableHead className="text-right text-xs">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.entries.map(e => (
                        <TableRow key={e.id} className="hover:bg-muted/20">
                          <TableCell className="text-sm">{fmtDate(e.saleDate)}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs font-semibold">{e.writerCode}</span>
                            <span className="text-xs text-muted-foreground ml-1.5">{e.writerFullName}</span>
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full text-white ${gameTypeColour(e.gameType)}`}>
                              {e.gameType}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-sm">
                            GH₵ {Number(e.ticketAmount).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <tfoot>
                      <tr className="border-t-2 bg-muted/30">
                        <td className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground" colSpan={3}>Total</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">
                          GH₵ {Number(r.summary.totalAmount).toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Reports() {
  const { user } = useAuth();
  const isDirectorOrAdmin = user?.role === "director" || user?.role === "administrator";

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <img src="/company-logo.png" alt="VS2000" className="w-10 h-10 rounded-full object-cover ring-2 ring-border shadow" />
        <div>
          <h1 className="text-xl font-bold">Reports</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Accurate performance reports for writers, agents and the organisation
          </p>
        </div>
      </div>

      <Tabs defaultValue="writer">
        <TabsList className="mb-1">
          <TabsTrigger value="writer">Writer</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="gamesales">Game Sales</TabsTrigger>
          {isDirectorOrAdmin && <TabsTrigger value="org">Organisation</TabsTrigger>}
        </TabsList>
        <TabsContent value="writer"><WriterReportView /></TabsContent>
        <TabsContent value="agent"><AgentReportView /></TabsContent>
        <TabsContent value="gamesales"><GameSalesView /></TabsContent>
        {isDirectorOrAdmin && <TabsContent value="org"><OrgReportView /></TabsContent>}
      </Tabs>
    </div>
  );
}
