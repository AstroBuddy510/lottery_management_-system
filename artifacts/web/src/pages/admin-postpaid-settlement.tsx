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
import { Clock, AlertTriangle, Banknote, Smartphone, Filter, CheckCircle2 } from "lucide-react";
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
    <Card className={accent}>
      <CardContent className="pt-5 pb-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{label}</div>
        <div className={`text-2xl font-bold tabular-nums mt-1 ${tone}`}>{fmtGHS(value)}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
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

  return (
    <div className="space-y-6">
      {/* ── The numbers that matter, in the order the money moves ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Awaiting payment</CardTitle>
          <CardDescription className="text-xs">
            Payable is gross sales less the writer's commission at the rate frozen when betting
            closed. Wins are shown for the record only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
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
                  rows.map((row) => {
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
          </div>
        </CardContent>
      </Card>

      {/* ── Already paid ── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Payment history</CardTitle>
              <CardDescription className="text-xs">
                Every postpaid settlement collected, and which cashier took it.
              </CardDescription>
            </div>
            {filtered && (
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
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border bg-muted/20 p-3">
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

          <div className="rounded-md border overflow-x-auto">
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
                  payments.map((p) => (
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

            {!loadingHistory && payments.length > 0 && (
              <div className="border-t bg-muted/40 px-4 py-3 flex flex-wrap items-center gap-5 text-xs font-bold">
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
