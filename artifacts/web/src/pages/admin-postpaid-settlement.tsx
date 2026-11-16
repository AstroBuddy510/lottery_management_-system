import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Clock, AlertTriangle, Banknote, Smartphone, Filter, CheckCircle2, Hourglass, History, Receipt } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions } from "@/components/data-kit";
import { exportReportPdf, printReport, money, type TableReport } from "@/lib/table-report";
import { fmtGHS } from "@/lib/utils";

/**
 * The cashier's postpaid desk: what is still owed, and what has been taken.
 *
 * Both halves are here because a settled ledger leaves the outstanding list
 * the instant it is confirmed. Without the paid half, the money the cashier
 * had just counted went out of sight entirely.
 *
 * Every figure reads the way the money moves: gross sales the writer took,
 * the commission they keep, and the cash that reaches the desk. Wins recorded
 * sit apart and are never part of that sum - the company pays those winners
 * through the agents, so a win does not reduce what a writer hands in.
 */

interface LedgerCore {
  id: string;
  ledgerDate: string;
  totalStakes: string;
  totalWinnings: string;
  commissionPct: string | null;
  commissionAmount: string;
  amountPayable: string;
  settlementStatus: string;
  paymentDeclaredAt: string | null;
  paymentDeclaredMethod: string | null;
  unsettledAtCalculation: string | null;
}

interface OutstandingRow {
  ledger: LedgerCore;
  writer: { fullName: string | null; fullCode: string | null; phone: string | null } | null;
  game: { name: string | null; eventNumber: string | null; status: string | null } | null;
}

interface OutstandingResponse {
  ledgers: OutstandingRow[];
  totals: { grossSales: string; commission: string; payable: string; winsRecorded: string };
}

interface PaymentRow {
  ledgerId: string;
  ledgerDate: string;
  writerId: string;
  writerName: string | null;
  writerCode: string | null;
  gameName: string | null;
  eventNumber: string | null;
  grossSales: string;
  commissionPct: string | null;
  commissionAmount: string;
  amountPaid: string;
  winsRecorded: string;
  settlementMethod: string | null;
  settlementReference: string | null;
  declaredAt: string | null;
  settledAt: string | null;
  settledByName: string | null;
  wasUnsettledAtCalculation: string | null;
  legacy: boolean;
}

interface PaymentsResponse {
  payments: PaymentRow[];
  count: number;
  totals: {
    collected: string;
    grossSales: string;
    commission: string;
    winsRecorded: string;
    cash: string;
    momo: string;
  };
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

function pctText(pct: string | null): string {
  const n = Number(pct);
  if (pct === null || !Number.isFinite(n) || n <= 0) return "—";
  return `${(n * 100).toFixed(2).replace(/\.00$/, "")}%`;
}

function methodBadge(method: string | null) {
  if (method === "momo") {
    return (
      <Badge variant="outline" className="text-[10px] border-sky-400/50 text-sky-700 dark:text-sky-400">
        <Smartphone className="h-3 w-3 mr-1" /> Mobile Money
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] border-emerald-400/50 text-emerald-700 dark:text-emerald-400">
      <Banknote className="h-3 w-3 mr-1" /> Cash
    </Badge>
  );
}

/** One headline figure. */
function StatCard({
  label,
  value,
  sub,
  tone = "",
  accent = "",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  accent?: string;
}) {
  return (
    <div className={`min-w-0 rounded-2xl border border-border/80 bg-card p-4 shadow-sm ${accent}`}>
      <div className="truncate text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1.5 truncate text-xl font-black tracking-tight tabular-nums ${tone}`}>{fmtGHS(value)}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function AdminPostpaidSettlement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<Record<string, string>>({});
  const [filterWriter, setFilterWriter] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const { data: outstanding, isLoading: loadingOutstanding } = useQuery<OutstandingResponse>({
    queryKey: ["/api/postpaid/outstanding"],
    queryFn: async () => {
      const res = await fetch("/api/postpaid/outstanding", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load outstanding ledgers");
      return res.json();
    },
  });

  const historyUrl = useMemo(() => {
    const q = new URLSearchParams();
    if (filterWriter) q.set("writerId", filterWriter);
    if (filterFrom) q.set("from", filterFrom);
    if (filterTo) q.set("to", filterTo);
    const qs = q.toString();
    return `/api/postpaid/settlements${qs ? `?${qs}` : ""}`;
  }, [filterWriter, filterFrom, filterTo]);

  const { data: history, isLoading: loadingHistory } = useQuery<PaymentsResponse>({
    queryKey: [historyUrl],
    queryFn: async () => {
      const res = await fetch(historyUrl, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load payment history");
      return res.json();
    },
  });

  const confirm = useMutation({
    mutationFn: async ({ id, settlementMethod }: { id: string; settlementMethod: string }) => {
      const res = await fetch(`/api/postpaid/confirm/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ settlementMethod }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Receipt confirmed", description: "The payment is now in the history below." });
      queryClient.invalidateQueries({ queryKey: ["/api/postpaid/outstanding"] });
      queryClient.invalidateQueries({ queryKey: [historyUrl] });
    },
    onError: (e) => {
      toast({ title: "Couldn't confirm", description: (e as Error).message, variant: "destructive" });
    },
  });

  const rows = outstanding?.ledgers ?? [];
  const oTotals = outstanding?.totals;
  const payments = history?.payments ?? [];
  const hTotals = history?.totals;

  // Writers who appear anywhere, for the filter.
  const writerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of payments) {
      if (p.writerId) map.set(p.writerId, `${p.writerName ?? "—"} (${p.writerCode ?? ""})`);
    }
    return [...map.entries()];
  }, [payments]);

  const declaredCount = rows.filter((r) => r.ledger.paymentDeclaredAt).length;
  const filtered = !!(filterWriter || filterFrom || filterTo);

  const POSTPAID_PAGE = 15;
  const pOwed = usePaged(rows, POSTPAID_PAGE);
  const pPaid = usePaged(payments, POSTPAID_PAGE, historyUrl);

  const day = (d: string | null) => (d ? format(new Date(d), "d MMM yyyy") : "—");

  /** Both halves of the desk, every row, as one document. */
  const report = (): TableReport => ({
    title: "Postpaid Settlement",
    fileName: `postpaid_settlement_${format(new Date(), "yyyy-MM-dd")}`,
    orientation: "landscape",
    meta: [
      { label: "History Filter", value: filtered ? [filterFrom && `from ${filterFrom}`, filterTo && `to ${filterTo}`, filterWriter && "one writer"].filter(Boolean).join(", ") : "None" },
    ],
    summary: [
      `Cash to collect ${money(oTotals?.payable ?? 0)} across ${rows.length} ledger(s)${declaredCount ? `, ${declaredCount} declared` : ""}`,
      `Cash collected ${money(hTotals?.collected ?? 0)} · Cash ${money(hTotals?.cash ?? 0)} · Mobile Money ${money(hTotals?.momo ?? 0)}`,
    ],
    sections: [
      {
        heading: "Awaiting payment",
        columns: [
          { header: "Date" }, { header: "Writer" }, { header: "Draw" },
          { header: "Gross", align: "right" }, { header: "Commission", align: "right" },
          { header: "Payable", align: "right" }, { header: "Wins", align: "right" }, { header: "Status" },
        ],
        rows: rows.map((r) => [
          day(r.ledger.ledgerDate),
          `${r.writer?.fullName ?? "—"}\n${r.writer?.fullCode ?? ""}`,
          `${r.game?.name ?? "—"}\n${r.game?.eventNumber ?? ""}`,
          money(r.ledger.totalStakes),
          `-${money(r.ledger.commissionAmount)} (${pctText(r.ledger.commissionPct)})`,
          money(r.ledger.amountPayable),
          money(r.ledger.totalWinnings),
          r.ledger.unsettledAtCalculation ? "Unsettled at calculation" : r.ledger.paymentDeclaredAt ? (r.ledger.paymentDeclaredMethod === "momo" ? "MoMo sent" : "Cash declared") : "Awaiting payment",
        ]),
        totals: ["TOTAL", "", "", money(oTotals?.grossSales ?? 0), `-${money(oTotals?.commission ?? 0)}`, money(oTotals?.payable ?? 0), money(oTotals?.winsRecorded ?? 0), ""],
        empty: "Nothing outstanding.",
      },
      {
        heading: "Payment history",
        columns: [
          { header: "Paid" }, { header: "Writer" }, { header: "Draw" },
          { header: "Gross", align: "right" }, { header: "Commission", align: "right" },
          { header: "Amount Paid", align: "right" }, { header: "Wins", align: "right" },
          { header: "Method" }, { header: "Confirmed by" },
        ],
        rows: payments.map((p) => [
          p.settledAt ? format(new Date(p.settledAt), "d MMM yyyy HH:mm") : "—",
          `${p.writerName ?? "—"}\n${p.writerCode ?? ""}`,
          `${p.gameName ?? "—"}\n${p.eventNumber ?? ""}`,
          money(p.grossSales),
          p.legacy ? "—" : `-${money(p.commissionAmount)}`,
          money(p.amountPaid),
          money(p.winsRecorded),
          p.settlementMethod === "momo" ? "Mobile Money" : p.settlementMethod === "token_credit" ? "Token Credit" : "Cash",
          p.settledByName ?? "not recorded",
        ]),
        totals: ["TOTAL", "", "", money(hTotals?.grossSales ?? 0), `-${money(hTotals?.commission ?? 0)}`, money(hTotals?.collected ?? 0), money(hTotals?.winsRecorded ?? 0), "", ""],
        empty: filtered ? "No payments match these filters." : "No payments collected yet.",
      },
    ],
  });

  return (
    <div className="space-y-6">
      {/* ── Section toolbar ── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary dark:border-border dark:bg-muted dark:text-foreground">
            <Receipt className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight">Postpaid Settlement</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">What postpaid writers still owe, and every settlement already collected.</p>
          </div>
        </div>
        <ReportActions
          label="postpaid settlement"
          disabled={loadingOutstanding || loadingHistory || (rows.length === 0 && payments.length === 0)}
          onPdf={() => exportReportPdf(report())}
          onPrint={() => printReport(report())}
        />
      </div>

      {/* ── The numbers that matter, in the order the money moves ── */}
      <div className="grid gap-4 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Cash to collect"
          value={oTotals?.payable ?? "0"}
          sub={`${rows.length} ledger${rows.length === 1 ? "" : "s"} outstanding${declaredCount ? ` · ${declaredCount} declared` : ""}`}
          tone="text-amber-600"
          accent="border-amber-400/40"
        />
        <StatCard
          label="Cash collected"
          value={hTotals?.collected ?? "0"}
          sub={`${history?.count ?? 0} payment${history?.count === 1 ? "" : "s"}${filtered ? " (filtered)" : ""}`}
          tone="text-emerald-600"
          accent="border-emerald-400/40"
        />
        <StatCard
          label="Gross postpaid sales"
          value={hTotals?.grossSales ?? "0"}
          sub="on settled ledgers"
        />
        <StatCard
          label="Writer commission"
          value={hTotals?.commission ?? "0"}
          sub="kept by writers"
          tone="text-emerald-600"
        />
        <StatCard
          label="Wins recorded"
          value={hTotals?.winsRecorded ?? "0"}
          sub="company pays via agents"
          tone="text-muted-foreground"
        />
      </div>

      {/* Split of what was taken, so the drawer can be reconciled. */}
      {hTotals && Number(hTotals.collected) > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-muted/30 px-4 py-2.5 text-xs">
          <span className="font-bold uppercase tracking-wider text-[10px] text-muted-foreground">
            Collected by method
          </span>
          <span className="flex items-center gap-1.5">
            <Banknote className="h-3.5 w-3.5 text-emerald-600" />
            Cash <span className="font-bold tabular-nums">{fmtGHS(hTotals.cash)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Smartphone className="h-3.5 w-3.5 text-sky-600" />
            Mobile Money <span className="font-bold tabular-nums">{fmtGHS(hTotals.momo)}</span>
          </span>
        </div>
      )}

      {/* ── Still owed ── */}
      <Panel
        title="Awaiting payment"
        icon={Hourglass}
        subtitle="Payable is gross sales less the writer's commission at the rate frozen when betting closed. Wins are shown for the record only."
        footer={<Pager page={pOwed.page} totalPages={pOwed.totalPages} onPage={pOwed.setPage} total={pOwed.total} size={pOwed.size} noun="ledgers" />}
      >
          <ScrollTable minWidth="76rem" maxHeight="34rem">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Writer</TableHead>
                  <TableHead>Draw</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Payable</TableHead>
                  <TableHead className="text-right">Wins</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingOutstanding ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-xs text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-xs text-muted-foreground">
                      Nothing outstanding — every postpaid writer has settled.
                    </TableCell>
                  </TableRow>
                ) : (
                  pOwed.rows.map((row) => {
                    const l = row.ledger;
                    const declared = !!l.paymentDeclaredAt;
                    const overdue = !!l.unsettledAtCalculation;
                    return (
                      <TableRow key={l.id} className={overdue ? "bg-destructive/5" : undefined}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {format(new Date(l.ledgerDate), "MMM d")}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs font-medium">{row.writer?.fullName}</div>
                          <div className="text-[10px] text-muted-foreground">{row.writer?.fullCode}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{row.game?.name}</div>
                          <div className="text-[10px] text-muted-foreground">{row.game?.eventNumber}</div>
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtGHS(l.totalStakes)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-emerald-600">
                          −{fmtGHS(l.commissionAmount)}
                          <div className="text-[10px] text-muted-foreground">{pctText(l.commissionPct)}</div>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums font-bold">
                          {fmtGHS(l.amountPayable)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {fmtGHS(l.totalWinnings)}
                        </TableCell>
                        <TableCell>
                          {overdue ? (
                            <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Unsettled at calculation
                            </Badge>
                          ) : declared ? (
                            <Badge variant="outline" className="border-amber-400/60 text-amber-700 text-[10px]">
                              <Clock className="h-3 w-3 mr-1" />
                              {l.paymentDeclaredMethod === "momo" ? "MoMo sent" : "Cash declared"}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Awaiting payment</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={method[l.id] || l.paymentDeclaredMethod || "cash"}
                            onValueChange={(val) => setMethod((p) => ({ ...p, [l.id]: val }))}
                          >
                            <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="momo">Mobile Money</SelectItem>
                              <SelectItem value="token_credit">Token Credit</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={declared ? "default" : "outline"}
                            className="h-8 text-xs"
                            disabled={confirm.isPending}
                            onClick={() =>
                              confirm.mutate({
                                id: l.id,
                                settlementMethod: method[l.id] || l.paymentDeclaredMethod || "cash",
                              })
                            }
                          >
                            {declared ? "Confirm receipt" : "Record payment"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollTable>
      </Panel>

      {/* ── Already paid ── */}
      <Panel
        title="Payment history"
        icon={History}
        subtitle="Every postpaid settlement collected, and which cashier took it."
        footer={<Pager page={pPaid.page} totalPages={pPaid.totalPages} onPage={pPaid.setPage} total={pPaid.total} size={pPaid.size} noun="payments" />}
        actions={
            filtered ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[10px]"
                onClick={() => {
                  setFilterWriter("");
                  setFilterFrom("");
                  setFilterTo("");
                }}
              >
                Clear filters
              </Button>
            ) : undefined
        }
      >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-b bg-muted/20 px-5 py-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground flex items-center gap-1">
                <Filter className="h-3 w-3" /> Writer
              </Label>
              <Select
                value={filterWriter || "_all"}
                onValueChange={(v) => setFilterWriter(v === "_all" ? "" : v)}
              >
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All writers</SelectItem>
                  {writerOptions.map(([id, label]) => (
                    <SelectItem key={id} value={id}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">From</Label>
              <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">To</Label>
              <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-9 text-xs" />
            </div>
          </div>

          <ScrollTable minWidth="72rem" maxHeight="34rem">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paid</TableHead>
                  <TableHead>Writer</TableHead>
                  <TableHead>Draw</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Amount Paid</TableHead>
                  <TableHead className="text-right">Wins</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Confirmed by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingHistory ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-xs text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-xs text-muted-foreground">
                      No payments {filtered ? "match these filters" : "collected yet"}.
                    </TableCell>
                  </TableRow>
                ) : (
                  pPaid.rows.map((p) => (
                    <TableRow key={p.ledgerId}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {p.settledAt ? (
                          <>
                            <div className="font-medium">{format(new Date(p.settledAt), "MMM d, yyyy")}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {format(new Date(p.settledAt), "HH:mm")}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{p.writerName}</div>
                        <div className="text-[10px] text-muted-foreground">{p.writerCode}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{p.gameName}</div>
                        <div className="text-[10px] text-muted-foreground">{p.eventNumber}</div>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtGHS(p.grossSales)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-emerald-600">
                        {p.legacy ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            −{fmtGHS(p.commissionAmount)}
                            <div className="text-[10px] text-muted-foreground">{pctText(p.commissionPct)}</div>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                        {fmtGHS(p.amountPaid)}
                        {p.legacy && (
                          <div className="text-[9px] font-normal text-muted-foreground">
                            before commission
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {fmtGHS(p.winsRecorded)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-start">
                          {methodBadge(p.settlementMethod)}
                          {p.wasUnsettledAtCalculation && (
                            <span className="text-[9px] text-destructive font-semibold">
                              paid late
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.settledByName ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                            {p.settledByName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">not recorded</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollTable>

            {!loadingHistory && payments.length > 0 && (
              <div className="border-t bg-muted/30 px-5 py-3 flex flex-wrap items-center gap-5 text-xs font-bold">
                <span className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected:</span>
                  <span className="tabular-nums text-emerald-600">{fmtGHS(hTotals?.collected ?? "0")}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Commission:</span>
                  <span className="tabular-nums">{fmtGHS(hTotals?.commission ?? "0")}</span>
                </span>
                <span className="ml-auto text-[10px] font-semibold text-muted-foreground">
                  {payments.length} payment{payments.length === 1 ? "" : "s"}
                </span>
              </div>
            )}
      </Panel>
    </div>
  );
}
