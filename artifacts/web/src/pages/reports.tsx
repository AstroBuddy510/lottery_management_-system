import React, { useState, useMemo } from "react";
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
import {
  generateWriterReportPDF,
  generateAgentReportPDF,
  generateOrgReportPDF,
  generateGameSalesByAgencyPDF,
  generatePosWinsReportPDF,
  generateSalesChannelsReportPDF,
  type SalesChannelGroupRow,
} from "@/lib/pdf-generator";
import { TokenReportView } from "@/components/token-report";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: string | number | undefined | null) {
  const n = Number(v ?? 0);
  return n < 0 ? `(GH₵ ${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : `GH₵ ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s.split("T")[0] + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

const todayStr = () => new Date().toISOString().split("T")[0];
const yesterdayStr = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]; };
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
      {n < 0 ? `(GH₵ ${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : `GH₵ ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
              {Number(v) < 0 ? `(GH₵ ${Math.abs(Number(v)).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : `GH₵ ${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportLetterhead({ title, subtitle, dateFrom, dateTo, onExportPDF }: { title: string; subtitle?: string; dateFrom?: string; dateTo?: string; onExportPDF?: () => void }) {
  const range = dateFrom || dateTo ? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}` : "All periods";
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-card border rounded-xl px-5 py-4 mb-1">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center p-1.5 flex-shrink-0">
          <img src="/company-logo-v3.png" alt="VS2000 Logo" className="w-full h-full object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">VS2000 Smart Office</div>
          <div className="text-base font-bold text-foreground leading-tight mt-0.5">{title}</div>
          {subtitle && <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
      </div>
      <div className="flex items-center gap-4 justify-between sm:justify-end flex-shrink-0">
        <div className="text-right space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Period</div>
          <div className="text-xs font-medium">{range}</div>
          <div className="text-[10px] text-muted-foreground">
            {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </div>
        {onExportPDF && (
          <Button onClick={onExportPDF} size="sm" className="bg-[#ff6700] hover:bg-[#ff6700]/90 text-white flex items-center gap-1.5 font-semibold">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export PDF
          </Button>
        )}
      </div>
    </div>
  );
}

function DateShortcuts({ onSelect }: { onSelect: (from: string, to: string) => void }) {
  const shortcuts = [
    { label: "Today", from: todayStr(), to: todayStr() },
    { label: "Yesterday", from: yesterdayStr(), to: yesterdayStr() },
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

function ParamPanel({ children, onRun, disabled, loading, buttonLabel, hint }: {
  children: React.ReactNode; onRun: () => void; disabled?: boolean; loading?: boolean;
  buttonLabel?: string; hint?: string;
}) {
  return (
    <div className="bg-muted/20 border rounded-xl p-4 space-y-3">
      {children}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">{hint ?? "Adjust parameters above, then run."}</span>
        <Button size="sm" disabled={disabled || loading} onClick={onRun} className="min-w-[96px]">
          {loading ? "Loading…" : (buttonLabel ?? "Run Report")}
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
            onExportPDF={() => generateWriterReportPDF(
              r.writer?.fullName ?? "Unknown Writer",
              r.writer?.fullCode ?? "—",
              dateFrom,
              dateTo,
              r.totals,
              r.rows
            )}
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
                    GH₵ {Number(r.pending.totalGross).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase mb-1">
                    Wins Entries ({r.pending.winsEntries.length})
                  </div>
                  <div className="font-mono font-semibold text-amber-800 dark:text-amber-300">
                    GH₵ {Number(r.pending.totalWins).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
            onExportPDF={() => generateAgentReportPDF(
              r.agent?.user?.fullName ?? "Unknown Agent",
              r.agent?.fullCode ?? "—",
              dateFrom,
              dateTo,
              r.totals,
              r.writers,
              r.payments ?? [],
              r.totalPaid ?? "0"
            )}
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
                  GH₵ {Number(r.totalPaid).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
          <ReportLetterhead 
            title="Organisation Report" 
            dateFrom={dateFrom} 
            dateTo={dateTo}
            onExportPDF={() => generateOrgReportPDF(
              dateFrom,
              dateTo,
              r.totals,
              r.agents
            )} 
          />

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
/*
 * One game, over a period, and how each agency sold it.
 *
 * This tab used to ask for an agent and a date range and then show that one
 * agent's sales split by game type - which is the Agent report with a
 * different title, and there was no way to select a game at all. The question
 * the name promises is the other way round: pick the game, see who sold it.
 *
 * A game is chosen by name rather than by draw, because a game runs many
 * times and the period is what decides which of its events count. Picking one
 * draw would make the date range meaningless.
 *
 * Figures come from the locked daily calculations, the same numbers an agency
 * is settled on, so this report and the Agent report cannot disagree about
 * money.
 */

type GameName = { name: string; eventCount: number; firstEventAt: string; lastEventAt: string };

type GameEvent = {
  id: string; eventNumber: string; name: string;
  goLiveAt: string; closeAt: string; status: string;
};

type AgencyMoney = {
  gross: string; commission: string; netGross: string;
  wins: string; reserve: string; balance: string;
};

type GameSalesWriterRow = AgencyMoney & {
  writer: { id: string; fullCode: string; fullName: string };
  eventCount: number;
};

type GameSalesAgencyRow = AgencyMoney & {
  agent: { id: string; fullCode: string; agencyName: string | null; agentName: string };
  pct: number;
  writerCount: number;
  eventCount: number;
  writers: GameSalesWriterRow[];
};

type GameSalesReport = {
  game: { name: string; eventCount: number; events: GameEvent[] };
  summary: AgencyMoney & { agencyCount: number; writerCount: number };
  byAgent: GameSalesAgencyRow[];
};

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("accessToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function fetchGameNames(): Promise<GameName[]> {
  const res = await fetch("/api/reports/game-names", { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchGameSalesReport(
  gameName: string, dateFrom: string, dateTo: string, agentId: string,
): Promise<GameSalesReport> {
  const params = new URLSearchParams({ gameName });
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (agentId) params.set("agentId", agentId);
  const res = await fetch(`/api/reports/game-sales?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const ghs = (v: string | number) =>
  `GH₵ ${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function GameSalesView() {
  const [gameName, setGameName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [agentId, setAgentId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: agents } = useListAgents({});
  const agentList = Array.isArray(agents) ? agents : [];

  const { data: gameNames } = useQuery({ queryKey: ["game-names"], queryFn: fetchGameNames });
  const nameList: GameName[] = Array.isArray(gameNames) ? gameNames : [];

  const { data: report, isLoading, error, refetch } = useQuery({
    queryKey: ["game-sales", gameName, dateFrom, dateTo, agentId],
    queryFn: () => fetchGameSalesReport(gameName, dateFrom, dateTo, agentId),
    enabled: !!gameName,
  });

  const r = report;
  const applyDates = (f: string, t: string) => { setDateFrom(f); setDateTo(t); };

  return (
    <div className="space-y-4 pt-4">
      <ParamPanel
        onRun={() => void refetch()}
        disabled={!gameName}
        loading={isLoading}
        buttonLabel="Refresh"
        hint="Choose a game and a period. Every agency that sold it is ranked by gross."
      >
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Game</Label>
            <Select value={gameName || "_none"} onValueChange={v => setGameName(v === "_none" ? "" : v)}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="Select game…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Select game —</SelectItem>
                {nameList.map(g => (
                  <SelectItem key={g.name} value={g.name}>
                    {g.name} ({g.eventCount} event{g.eventCount === 1 ? "" : "s"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Agency (optional)</Label>
            <Select value={agentId || "_all"} onValueChange={v => setAgentId(v === "_all" ? "" : v)}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="All agencies" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All agencies</SelectItem>
                {agentList.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.agencyName ?? a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DateShortcuts onSelect={applyDates} />
      </ParamPanel>

      {!gameName && !isLoading && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          Select a game above to see how each agency sold it.
        </div>
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
            subtitle={`${r.game.name} — ${r.game.eventCount} event${r.game.eventCount === 1 ? "" : "s"} in period`}
            dateFrom={dateFrom} dateTo={dateTo}
            onExportPDF={() => generateGameSalesByAgencyPDF(
              r.game.name, r.game.eventCount, dateFrom, dateTo, r.summary, r.byAgent,
            )}
          />

          {/* No draws of this game in the range is a different answer from no
              sales, and saying so saves an operator doubting the report. */}
          {r.game.eventCount === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
              No <strong>{r.game.name}</strong> events fall in this period. Widen the dates, or
              check the game ran at all in that range.
            </div>
          ) : r.byAgent.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
              {r.game.eventCount} {r.game.name} event{r.game.eventCount === 1 ? "" : "s"} ran in this
              period, but no calculated sales are recorded against {agentId ? "that agency" : "any agency"} yet.
              Figures appear once the daily calculation has been run for those events.
            </div>
          ) : null}

          {/* Period totals */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Gross Sales", value: ghs(r.summary.gross), cls: "" },
              { label: "Commission", value: ghs(r.summary.commission), cls: "text-amber-600 dark:text-amber-400" },
              { label: "Net Gross", value: ghs(r.summary.netGross), cls: "text-teal-600 dark:text-teal-400" },
              { label: "Wins Paid", value: ghs(r.summary.wins), cls: "text-rose-600 dark:text-rose-400" },
              { label: "Reserve", value: ghs(r.summary.reserve), cls: "text-indigo-600 dark:text-indigo-400" },
              {
                label: "Net Balance", value: ghs(r.summary.balance),
                cls: Number(r.summary.balance) < 0 ? "text-rose-600 dark:text-rose-400" : "text-green-600 dark:text-green-400",
              },
            ].map(({ label, value, cls }) => (
              <div key={label} className="rounded-xl border bg-card px-3 py-2.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
                <div className={`font-mono font-bold text-sm ${cls}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* The draws being counted, named, so the totals can be checked. */}
          {r.game.events.length > 0 && (
            <div className="rounded-xl border px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                Events counted ({r.game.events.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.game.events.map(e => (
                  <Badge key={e.id} variant="outline" className="font-mono text-[10px]">
                    #{e.eventNumber} · {new Date(e.goLiveAt).toLocaleDateString("en-GB")}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* The league table */}
          {r.byAgent.length > 0 && (
            <div className="rounded-xl border overflow-hidden">
              <div className="bg-muted/40 px-4 py-2.5 border-b flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sales by Agency
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.summary.agencyCount} agenc{r.summary.agencyCount === 1 ? "y" : "ies"} · {r.summary.writerCount} writer{r.summary.writerCount === 1 ? "" : "s"}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20">
                    <TableHead className="text-xs">Agency</TableHead>
                    <TableHead className="text-xs w-[120px]">Share</TableHead>
                    <TableHead className="text-right text-xs">Gross Sales</TableHead>
                    <TableHead className="text-right text-xs">Commission</TableHead>
                    <TableHead className="text-right text-xs">Net Gross</TableHead>
                    <TableHead className="text-right text-xs">Wins</TableHead>
                    <TableHead className="text-right text-xs">Reserve</TableHead>
                    <TableHead className="text-right text-xs">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.byAgent.map(a => (
                    <React.Fragment key={a.agent.id}>
                      <TableRow
                        className="hover:bg-muted/20 cursor-pointer"
                        onClick={() => setExpanded(expanded === a.agent.id ? null : a.agent.id)}
                      >
                        <TableCell>
                          <div className="font-semibold text-sm">{a.agent.agencyName ?? a.agent.agentName}</div>
                          <div className="text-[10px] font-mono text-muted-foreground">
                            {a.agent.fullCode} · {a.writerCount} writer{a.writerCount === 1 ? "" : "s"} · {expanded === a.agent.id ? "hide" : "show"} writers
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${a.pct}%` }} />
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{a.pct.toFixed(1)}%</div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">{ghs(a.gross)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-amber-600 dark:text-amber-400">{ghs(a.commission)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-teal-600 dark:text-teal-400">{ghs(a.netGross)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-rose-600 dark:text-rose-400">{ghs(a.wins)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-indigo-600 dark:text-indigo-400">{ghs(a.reserve)}</TableCell>
                        <TableCell className={`text-right font-mono text-sm font-bold ${Number(a.balance) < 0 ? "text-rose-600 dark:text-rose-400" : "text-green-600 dark:text-green-400"}`}>
                          {ghs(a.balance)}
                        </TableCell>
                      </TableRow>
                      {expanded === a.agent.id && a.writers.map(w => (
                        <TableRow key={w.writer.id} className="bg-muted/20">
                          <TableCell className="pl-8">
                            <div className="text-xs">{w.writer.fullName}</div>
                            <div className="text-[10px] font-mono text-muted-foreground">{w.writer.fullCode}</div>
                          </TableCell>
                          <TableCell />
                          <TableCell className="text-right font-mono text-xs">{ghs(w.gross)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{ghs(w.commission)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{ghs(w.netGross)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{ghs(w.wins)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{ghs(w.reserve)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{ghs(w.balance)}</TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                  ))}
                </TableBody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30">
                    <td className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground" colSpan={2}>Total</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-bold">{ghs(r.summary.gross)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm">{ghs(r.summary.commission)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm">{ghs(r.summary.netGross)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm">{ghs(r.summary.wins)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm">{ghs(r.summary.reserve)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-bold">{ghs(r.summary.balance)}</td>
                  </tr>
                </tfoot>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── POS Wins Report ───────────────────────────────────────────────────────────
/*
 * What was paid out on portal tickets, and what is still on its way.
 *
 * Only tickets sold through a writer's POS can appear here - a payout request
 * exists for nothing else. Wins an agent typed in by hand stay in the Agent
 * and Organisation reports. That is the separation this tab exists to show:
 * every cedi on it was verified by the system against a ticket it issued,
 * approved by a cashier, and confirmed by Paystack.
 */

type PosWinsReport = {
  paid: { count: number; total: string };
  byAgency: Array<{ agentCode: string; agencyName: string | null; count: number; total: string }>;
  byCashier: Array<{ cashierName: string; count: number; total: string }>;
  pipeline: Partial<Record<string, { count: number; total: string }>>;
  wallet: { available: string; held: string };
  disbursements: Array<{
    payoutId: string; paidAt: string | null; amount: string; transferReference: string | null;
    payeeMomoNumber: string | null; ticketNumber: string; gameName: string; eventNumber: string;
    writerCode: string; writerName: string; agentCode: string; agencyName: string | null; cashierName: string | null;
  }>;
};

function PosWinsReportView() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: r, isLoading, error, refetch } = useQuery<PosWinsReport>({
    queryKey: ["pos-wins-report", dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const res = await fetch(`/api/reports/pos-wins?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const stage = (key: string) => r?.pipeline[key] ?? { count: 0, total: "0" };
  const unclaimed = { count: stage("pending").count + stage("approved").count, total: Number(stage("pending").total) + Number(stage("approved").total) };

  return (
    <div className="space-y-4 pt-4">
      <ParamPanel onRun={() => void refetch()} loading={isLoading} buttonLabel="Refresh" hint="Payouts confirmed by Paystack in the period. The pipeline figures below are as of now.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm bg-background" />
          </div>
        </div>
        <DateShortcuts onSelect={(f, t) => { setDateFrom(f); setDateTo(t); }} />
      </ParamPanel>

      {error && (
        <div className="text-center py-8 text-sm text-red-600 border border-red-200 rounded-xl">
          Failed to load report. Please try again.
        </div>
      )}

      {r && (
        <div className="space-y-4">
          <ReportLetterhead
            title="POS Wins Payment Report"
            subtitle="Portal tickets only — verified, cashier-approved, paid by Paystack"
            dateFrom={dateFrom} dateTo={dateTo}
            onExportPDF={() => generatePosWinsReportPDF(dateFrom, dateTo, r.paid, r.byAgency, r.byCashier, r.disbursements, r.wallet)}
          />

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: "Paid in period", value: ghs(r.paid.total), sub: `${r.paid.count} payout${r.paid.count === 1 ? "" : "s"}`, cls: "text-green-600 dark:text-green-400" },
              { label: "Awaiting claim", value: ghs(unclaimed.total), sub: `${unclaimed.count} winning ticket${unclaimed.count === 1 ? "" : "s"} not yet scanned`, cls: "" },
              { label: "With cashier", value: ghs(Number(stage("verified").total) + Number(stage("processing").total)), sub: `${stage("verified").count + stage("processing").count} in payment`, cls: "text-blue-600 dark:text-blue-400" },
              { label: "Awaiting funds", value: ghs(stage("awaiting_funds").total), sub: `${stage("awaiting_funds").count} not yet covered`, cls: stage("awaiting_funds").count ? "text-amber-600" : "" },
              { label: "Flagged / withheld", value: ghs(Number(stage("rejected").total) + Number(stage("withheld").total)), sub: `${stage("rejected").count} in review · ${stage("withheld").count} withheld`, cls: stage("rejected").count ? "text-rose-600" : "" },
            ].map(({ label, value, sub, cls }) => (
              <div key={label} className="rounded-xl border bg-card px-3 py-2.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
                <div className={`font-mono font-bold text-sm ${cls}`}>{value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[
              { title: "By agency", rows: r.byAgency.map(a => ({ key: a.agentCode, name: a.agencyName ?? a.agentCode, sub: a.agentCode, count: a.count, total: a.total })) },
              { title: "By approving cashier", rows: r.byCashier.map(c => ({ key: c.cashierName, name: c.cashierName, sub: "", count: c.count, total: c.total })) },
            ].map(block => (
              <div key={block.title} className="rounded-xl border overflow-hidden">
                <div className="bg-muted/40 px-4 py-2.5 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground">{block.title}</div>
                <Table>
                  <TableBody>
                    {block.rows.length === 0 ? (
                      <TableRow><TableCell className="text-sm text-muted-foreground text-center py-6">Nothing paid in this period.</TableCell></TableRow>
                    ) : block.rows.map(row => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <div className="text-sm font-semibold">{row.name}</div>
                          {row.sub && <div className="text-[10px] font-mono text-muted-foreground">{row.sub}</div>}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{row.count} payout{row.count === 1 ? "" : "s"}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">{ghs(row.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>

          <div className="rounded-xl border overflow-hidden">
            <div className="bg-muted/40 px-4 py-2.5 border-b flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Disbursements</span>
              <span className="text-xs text-muted-foreground">{r.disbursements.length} in period</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/20">
                  <TableHead className="text-xs">Paid</TableHead>
                  <TableHead className="text-xs">Ticket</TableHead>
                  <TableHead className="text-xs">Writer</TableHead>
                  <TableHead className="text-xs">MoMo wallet</TableHead>
                  <TableHead className="text-xs">Approved by</TableHead>
                  <TableHead className="text-xs">Paystack reference</TableHead>
                  <TableHead className="text-right text-xs">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.disbursements.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground text-center py-8">No POS wins were paid in this period.</TableCell></TableRow>
                ) : r.disbursements.map(d => (
                  <TableRow key={d.payoutId} className="hover:bg-muted/20">
                    <TableCell className="text-xs whitespace-nowrap">{d.paidAt ? new Date(d.paidAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"}</TableCell>
                    <TableCell>
                      <div className="font-mono text-xs font-semibold">{d.ticketNumber}</div>
                      <div className="text-[10px] text-muted-foreground">{d.gameName} #{d.eventNumber}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">{d.writerName}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{d.writerCode} · {d.agentCode}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.payeeMomoNumber ?? "—"}</TableCell>
                    <TableCell className="text-xs">{d.cashierName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">{d.transferReference}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">{ghs(d.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <tr className="border-t-2 bg-muted/30">
                  <td className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground" colSpan={6}>Total paid</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-bold">{ghs(r.paid.total)}</td>
                </tr>
              </tfoot>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sales Channels ────────────────────────────────────────────────────────────

type SalesChannelRow = {
  writerId: string; writerCode: string; writerName: string;
  agentId: string | null; agentCode: string; agencyName: string | null;
  gameName: string;
  prepaid: string; prepaidTickets: number;
  postpaid: string; postpaidTickets: number;
  manual: string; manualEntries: number;
  total: string;
  unconfirmed: string; unconfirmedEntries: number;
  postpaidCommission: string; postpaidPayable: string; postpaidCollected: string;
  postpaidOutstanding: string; postpaidNotYetDue: string;
};

type SalesChannelsReport = {
  period: { dateFrom: string | null; dateTo: string | null };
  summary: {
    prepaid: { amount: string; tickets: number };
    postpaid: { amount: string; tickets: number };
    manual: { amount: string; entries: number };
    total: string;
    unconfirmedLate: { amount: string; entries: number };
    postpaidCollection: { commission: string; payable: string; collected: string; outstanding: string; notYetDue: string };
    writerCount: number;
    agencyCount: number;
  };
  rows: SalesChannelRow[];
};

type ChannelGrouping = "agency" | "writer" | "game";

const CHANNEL_COLORS = {
  prepaid: "bg-sky-500",
  postpaid: "bg-amber-500",
  manual: "bg-violet-500",
} as const;

/**
 * Roll the writer x game rows up to the chosen grouping. Summed in pesewas so
 * the totals in the table foot equal the cards above it to the pesewa.
 */
function groupChannelRows(rows: SalesChannelRow[], by: ChannelGrouping): SalesChannelGroupRow[] {
  const p = (v: string) => Math.round(Number(v) * 100);
  const groups = new Map<string, SalesChannelGroupRow & { _p: Record<string, number> }>();
  for (const r of rows) {
    const key = by === "agency" ? (r.agentId ?? r.agentCode) : by === "writer" ? r.writerId : r.gameName;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: by === "agency" ? (r.agencyName ?? r.agentCode) : by === "writer" ? r.writerName : r.gameName,
        sub: by === "agency" ? r.agentCode : by === "writer" ? `${r.writerCode} · ${r.agentCode}` : "",
        prepaid: "0", prepaidTickets: 0, postpaid: "0", postpaidTickets: 0, manual: "0", manualEntries: 0, total: "0",
        payable: "0", collected: "0", outstanding: "0", notYetDue: "0",
        _p: { prepaid: 0, postpaid: 0, manual: 0, payable: 0, collected: 0, outstanding: 0, notYetDue: 0 },
      };
      groups.set(key, g);
    }
    g._p.prepaid += p(r.prepaid); g._p.postpaid += p(r.postpaid); g._p.manual += p(r.manual);
    g._p.payable += p(r.postpaidPayable); g._p.collected += p(r.postpaidCollected);
    g._p.outstanding += p(r.postpaidOutstanding); g._p.notYetDue += p(r.postpaidNotYetDue);
    g.prepaidTickets += r.prepaidTickets; g.postpaidTickets += r.postpaidTickets; g.manualEntries += r.manualEntries;
  }
  const c = (n: number) => (n / 100).toFixed(2);
  return [...groups.values()]
    .map(({ _p, ...g }) => ({
      ...g,
      prepaid: c(_p.prepaid), postpaid: c(_p.postpaid), manual: c(_p.manual),
      total: c(_p.prepaid + _p.postpaid + _p.manual),
      payable: c(_p.payable), collected: c(_p.collected), outstanding: c(_p.outstanding), notYetDue: c(_p.notYetDue),
    }))
    // Rows with only unconfirmed late entries carry no counted sales.
    .filter(g => [g.total, g.payable, g.collected, g.notYetDue].some(v => Number(v) !== 0))
    .sort((a, b) => Number(b.total) - Number(a.total) || a.name.localeCompare(b.name));
}

function ChannelMix({ prepaid, postpaid, manual }: { prepaid: number; postpaid: number; manual: number }) {
  const total = prepaid + postpaid + manual;
  if (total <= 0) return <div className="h-1.5 rounded-full bg-muted" />;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-muted" title={`Prepaid ${Math.round(prepaid / total * 100)}% · Postpaid ${Math.round(postpaid / total * 100)}% · Manual ${Math.round(manual / total * 100)}%`}>
      {prepaid > 0 && <div className={CHANNEL_COLORS.prepaid} style={{ width: `${prepaid / total * 100}%` }} />}
      {postpaid > 0 && <div className={CHANNEL_COLORS.postpaid} style={{ width: `${postpaid / total * 100}%` }} />}
      {manual > 0 && <div className={CHANNEL_COLORS.manual} style={{ width: `${manual / total * 100}%` }} />}
    </div>
  );
}

function SalesChannelsView() {
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(todayStr());
  const [agentId, setAgentId] = useState("");
  const [groupBy, setGroupBy] = useState<ChannelGrouping>("agency");

  const { data: agents } = useListAgents({});
  const agentList = Array.isArray(agents) ? agents : [];

  const { data: r, isLoading, isFetching, error, refetch } = useQuery<SalesChannelsReport>({
    queryKey: ["sales-channels", dateFrom, dateTo, agentId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (agentId) params.set("agentId", agentId);
      const res = await fetch(`/api/reports/sales-channels?${params}`, { headers: authHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body;
    },
  });

  const grouped = useMemo(() => (r ? groupChannelRows(r.rows, groupBy) : []), [r, groupBy]);
  const s = r?.summary;
  const total = Number(s?.total ?? 0);
  const share = (v: string | undefined) => (total > 0 ? `${Math.round(Number(v ?? 0) / total * 100)}%` : "—");
  const agencyLabel = agentId ? (() => { const a = agentList.find(x => x.id === agentId); return a ? `${a.agencyName ?? a.user?.fullName ?? a.fullCode} (${a.fullCode})` : ""; })() : "";
  const groupLabel = { agency: "Agency", writer: "Writer", game: "Game" }[groupBy];

  return (
    <div className="space-y-4 pt-4">
      <ParamPanel onRun={() => void refetch()} loading={isLoading || isFetching} buttonLabel="Refresh"
        hint="POS prepaid, POS postpaid and agent-keyed sales for the period. Cancelled and void tickets are not counted.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label className="text-xs text-muted-foreground">Agency (optional)</Label>
            <Select value={agentId || "_all"} onValueChange={v => setAgentId(v === "_all" ? "" : v)}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="All agencies" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All agencies</SelectItem>
                {agentList.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.agencyName ?? a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DateShortcuts onSelect={(f, t) => { setDateFrom(f); setDateTo(t); }} />
      </ParamPanel>

      {error && (
        <div className="text-center py-8 text-sm text-red-600 border border-red-200 rounded-xl">
          {(error as Error).message || "Failed to load report. Please try again."}
        </div>
      )}

      {r && s && (
        <div className="space-y-4">
          <ReportLetterhead
            title="Sales by Channel"
            subtitle={agencyLabel ? `${agencyLabel} · by ${groupLabel.toLowerCase()}` : `All agencies · by ${groupLabel.toLowerCase()}`}
            dateFrom={dateFrom} dateTo={dateTo}
            onExportPDF={() => generateSalesChannelsReportPDF({ dateFrom, dateTo, agencyLabel, groupLabel, summary: s, rows: grouped })}
          />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Total sales", value: ghs(s.total), sub: `${s.writerCount} writer${s.writerCount === 1 ? "" : "s"} · ${s.agencyCount} agenc${s.agencyCount === 1 ? "y" : "ies"}`, dot: "" },
              { label: "POS prepaid", value: ghs(s.prepaid.amount), sub: `${share(s.prepaid.amount)} · ${s.prepaid.tickets.toLocaleString()} ticket${s.prepaid.tickets === 1 ? "" : "s"} · e-tokens`, dot: CHANNEL_COLORS.prepaid },
              { label: "POS postpaid", value: ghs(s.postpaid.amount), sub: `${share(s.postpaid.amount)} · ${s.postpaid.tickets.toLocaleString()} ticket${s.postpaid.tickets === 1 ? "" : "s"} · on credit`, dot: CHANNEL_COLORS.postpaid },
              { label: "Manual (agent entry)", value: ghs(s.manual.amount), sub: `${share(s.manual.amount)} · ${s.manual.entries.toLocaleString()} entr${s.manual.entries === 1 ? "y" : "ies"}`, dot: CHANNEL_COLORS.manual },
            ].map(({ label, value, sub, dot }) => (
              <div key={label} className="rounded-xl border bg-card px-3 py-2.5 min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                  {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}{label}
                </div>
                <div className="font-mono font-bold text-sm truncate">{value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border bg-card px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
              <span className={`w-2 h-2 rounded-full ${CHANNEL_COLORS.postpaid}`} />Postpaid collection
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Writers' commission", value: s.postpaidCollection.commission, cls: "text-muted-foreground" },
                { label: "Payable to company", value: s.postpaidCollection.payable, cls: "" },
                { label: "Collected", value: s.postpaidCollection.collected, cls: "text-emerald-700 dark:text-emerald-400" },
                { label: "Outstanding", value: s.postpaidCollection.outstanding, cls: Number(s.postpaidCollection.outstanding) > 0 ? "text-red-600 dark:text-red-400" : "" },
                { label: "Not yet due", value: s.postpaidCollection.notYetDue, cls: "text-muted-foreground" },
              ].map(x => (
                <div key={x.label} className="min-w-0">
                  <div className="text-[10px] text-muted-foreground">{x.label}</div>
                  <div className={`font-mono text-sm font-semibold truncate ${x.cls}`}>{ghs(x.value)}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">"Not yet due" is postpaid selling on draws whose betting has not closed, so nothing is owed on it yet.</p>
          </div>

          {s.unconfirmedLate.entries > 0 && (
            <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              {s.unconfirmedLate.entries} late manual entr{s.unconfirmedLate.entries === 1 ? "y" : "ies"} worth {ghs(s.unconfirmedLate.amount)} {s.unconfirmedLate.entries === 1 ? "is" : "are"} waiting for an administrator to confirm and {s.unconfirmedLate.entries === 1 ? "is" : "are"} not counted above.
            </div>
          )}

          <div className="rounded-xl border overflow-hidden">
            <div className="bg-muted/40 px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">By {groupLabel.toLowerCase()} · {grouped.length}</span>
              <div className="inline-flex rounded-lg border bg-background p-0.5">
                {(["agency", "writer", "game"] as const).map(g => (
                  <button key={g} onClick={() => setGroupBy(g)}
                    className={`text-[11px] font-semibold px-3 py-1 rounded-md transition-colors ${groupBy === g ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                    {{ agency: "Agency", writer: "Writer", game: "Game" }[g]}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20">
                    <TableHead className="text-xs">{groupLabel}</TableHead>
                    <TableHead className="text-right text-xs"><span className="inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${CHANNEL_COLORS.prepaid}`} />Prepaid</span></TableHead>
                    <TableHead className="text-right text-xs"><span className="inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${CHANNEL_COLORS.postpaid}`} />Postpaid</span></TableHead>
                    <TableHead className="text-right text-xs"><span className="inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${CHANNEL_COLORS.manual}`} />Manual</span></TableHead>
                    <TableHead className="text-right text-xs">Total</TableHead>
                    <TableHead className="text-right text-xs whitespace-nowrap">Postpaid payable</TableHead>
                    <TableHead className="text-right text-xs">Collected</TableHead>
                    <TableHead className="text-right text-xs">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-sm text-muted-foreground text-center py-8">No sales in this period.</TableCell></TableRow>
                  ) : grouped.map(g => (
                    <TableRow key={g.key} className="hover:bg-muted/20">
                      <TableCell className="min-w-[160px]">
                        <div className="text-sm font-semibold">{g.name}</div>
                        {g.sub && <div className="text-[10px] font-mono text-muted-foreground">{g.sub}</div>}
                        <div className="mt-1.5 w-28"><ChannelMix prepaid={Number(g.prepaid)} postpaid={Number(g.postpaid)} manual={Number(g.manual)} /></div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="font-mono text-sm">{ghs(g.prepaid)}</div>
                        <div className="text-[10px] text-muted-foreground">{g.prepaidTickets} tkt</div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="font-mono text-sm">{ghs(g.postpaid)}</div>
                        <div className="text-[10px] text-muted-foreground">{g.postpaidTickets} tkt</div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="font-mono text-sm">{ghs(g.manual)}</div>
                        <div className="text-[10px] text-muted-foreground">{g.manualEntries} entr{g.manualEntries === 1 ? "y" : "ies"}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold whitespace-nowrap">{ghs(g.total)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground whitespace-nowrap">{ghs(g.payable)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-emerald-700 dark:text-emerald-400 whitespace-nowrap">{ghs(g.collected)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm whitespace-nowrap ${Number(g.outstanding) > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground"}`}>{ghs(g.outstanding)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30">
                    <td className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Total</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold whitespace-nowrap">{ghs(s.prepaid.amount)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold whitespace-nowrap">{ghs(s.postpaid.amount)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold whitespace-nowrap">{ghs(s.manual.amount)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-bold whitespace-nowrap">{ghs(s.total)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold whitespace-nowrap">{ghs(s.postpaidCollection.payable)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold whitespace-nowrap">{ghs(s.postpaidCollection.collected)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold whitespace-nowrap">{ghs(s.postpaidCollection.outstanding)}</td>
                  </tr>
                </tfoot>
              </Table>
            </div>
          </div>
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
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex items-center gap-3.5">
        <div className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center p-1.5 flex-shrink-0">
          <img src="/company-logo-v3.png" alt="VS2000 Logo" className="w-full h-full object-contain" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Reports</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Accurate performance reports for writers, agents and the organisation
          </p>
        </div>
      </div>

      <Tabs defaultValue="writer">
        <TabsList className="mb-1 h-auto flex-wrap justify-start">
          <TabsTrigger value="writer">Writer</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="gamesales">Game Sales</TabsTrigger>
          <TabsTrigger value="poswins">POS Wins</TabsTrigger>
          <TabsTrigger value="channels">Sales Channels</TabsTrigger>
          {isDirectorOrAdmin && <TabsTrigger value="org">Organisation</TabsTrigger>}
          {isDirectorOrAdmin && <TabsTrigger value="tokens">E-Tokens</TabsTrigger>}
        </TabsList>
        <TabsContent value="writer"><WriterReportView /></TabsContent>
        <TabsContent value="agent"><AgentReportView /></TabsContent>
        <TabsContent value="gamesales"><GameSalesView /></TabsContent>
        <TabsContent value="poswins"><PosWinsReportView /></TabsContent>
        <TabsContent value="channels"><SalesChannelsView /></TabsContent>
        {isDirectorOrAdmin && <TabsContent value="org"><OrgReportView /></TabsContent>}
        {isDirectorOrAdmin && <TabsContent value="tokens"><TokenReportView /></TabsContent>}
      </Tabs>
    </div>
  );
}
