import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileDown, CheckCircle2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { fmtGHS } from "@/lib/utils";

/**
 * E-token report: what was generated, who holds it, where it went.
 * Balances are always current; the date range bounds the transaction lists.
 */

interface TokenReport {
  summary: {
    totalMinted: string;
    poolBalance: string;
    heldByCashiers: string;
    disbursedToWriters: string;
    variance: string;
  };
  writerHoldings: { held: string; purchased: string; spent: string };
  floats: Array<{ cashierName: string; balance: string; totalReceived: string; totalDisbursed: string }>;
  poolTransactions: Array<{
    id: string; transactionType: string; amount: string; balanceAfter: string;
    notes: string | null; createdAt: string; byName: string;
  }>;
  cashierTransactions: Array<{
    id: string; transactionType: string; amount: string; balanceAfter: string;
    createdAt: string; cashierName: string; writerName: string | null; writerCode: string | null;
  }>;
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 ${tone ?? ""}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

export function TokenReportView() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(today);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  const { data, isFetching } = useQuery<TokenReport>({
    queryKey: ["/api/reports/tokens", range],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (range?.from) p.set("from", range.from);
      if (range?.to) p.set("to", range.to);
      const res = await fetch(`/api/reports/tokens?${p}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const s = data?.summary;
  const balanced = Number(s?.variance ?? 0) === 0;

  /** Plain CSV so the figures can be reconciled outside the system. */
  const exportCsv = () => {
    if (!data) return;
    const rows: string[][] = [
      ["E-TOKEN REPORT"],
      ["Generated", format(new Date(), "yyyy-MM-dd HH:mm")],
      ["Range", range?.from || "all time", range?.to || today],
      [],
      ["SUMMARY"],
      ["Total generated", s!.totalMinted],
      ["In pool", s!.poolBalance],
      ["Held by cashiers", s!.heldByCashiers],
      ["Sold to writers", s!.disbursedToWriters],
      ["Variance", s!.variance],
      [],
      ["CASHIER FLOATS"],
      ["Cashier", "Received", "Sold", "Balance"],
      ...data.floats.map((f) => [f.cashierName, f.totalReceived, f.totalDisbursed, f.balance]),
      [],
      ["POOL TRANSACTIONS"],
      ["Date", "Type", "Amount", "Balance after", "By", "Notes"],
      ...data.poolTransactions.map((t) => [
        format(new Date(t.createdAt), "yyyy-MM-dd HH:mm"),
        t.transactionType, t.amount, t.balanceAfter, t.byName, t.notes ?? "",
      ]),
      [],
      ["CASHIER TRANSACTIONS"],
      ["Date", "Type", "Cashier", "Writer", "Code", "Amount", "Balance after"],
      ...data.cashierTransactions.map((t) => [
        format(new Date(t.createdAt), "yyyy-MM-dd HH:mm"),
        t.transactionType, t.cashierName, t.writerName ?? "", t.writerCode ?? "", t.amount, t.balanceAfter,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `e-token-report-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">E-Token Report</CardTitle>
          <CardDescription className="text-xs">
            Units generated, held and sold. Balances are current; the dates bound
            the transaction lists below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-semibold">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <Button className="h-9" onClick={() => setRange({ from, to })} disabled={isFetching}>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Generate
          </Button>
          <Button variant="outline" className="h-9" onClick={exportCsv} disabled={!data}>
            <FileDown className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
        </CardContent>
      </Card>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Figure label="Generated" value={fmtGHS(s!.totalMinted)} hint="Ever created" />
            <Figure label="In Pool" value={fmtGHS(s!.poolBalance)} hint="Unissued" tone="text-primary" />
            <Figure label="Cashier Floats" value={fmtGHS(s!.heldByCashiers)} hint="Awaiting sale" />
            <Figure label="Sold to Writers" value={fmtGHS(s!.disbursedToWriters)} tone="text-emerald-600" />
            <Figure
              label="Writers Hold"
              value={fmtGHS(data.writerHoldings.held)}
              hint={`${fmtGHS(data.writerHoldings.spent)} staked`}
            />
          </div>

          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
              balanced
                ? "bg-emerald-500/5 border-emerald-300/50 text-emerald-800 dark:text-emerald-300"
                : "bg-destructive/5 border-destructive/40 text-destructive"
            }`}
          >
            {balanced ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            <span>
              {balanced
                ? "Reconciled — generated equals pool plus floats plus units sold."
                : `Out of balance by ${fmtGHS(s!.variance)}.`}
            </span>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Generation &amp; Recharges</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Pool After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.poolTransactions.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No activity in this range.</TableCell></TableRow>
                    ) : data.poolTransactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(t.createdAt), "d MMM · HH:mm")}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {t.transactionType.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{t.byName}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold">{fmtGHS(t.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{fmtGHS(t.balanceAfter)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Sales to Writers</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Cashier</TableHead>
                      <TableHead>Writer</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Float After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.cashierTransactions.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No activity in this range.</TableCell></TableRow>
                    ) : data.cashierTransactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(t.createdAt), "d MMM · HH:mm")}</TableCell>
                        <TableCell className="text-xs">{t.cashierName}</TableCell>
                        <TableCell className="text-xs">
                          {t.writerName ?? "—"}
                          {t.writerCode && <span className="block font-mono text-[10px] text-muted-foreground">{t.writerCode}</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold">{fmtGHS(t.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{fmtGHS(t.balanceAfter)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
