import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Coins, Send, AlertTriangle, CheckCircle2, Layers, Warehouse, Users, ArrowUpRight, Wallet } from "lucide-react";
import { Panel, ScrollTable, ReportActions, StatTile } from "@/components/data-kit";
import { exportReportPdf, printReport, money, type TableReport } from "@/lib/table-report";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

/**
 * E-token supply. Tokens exist only once minted into the pool; after that
 * every movement is a transfer, so the totals reconcile:
 *   minted = pool + held by cashiers + disbursed to writers
 */

interface Supply {
  pool: { balance: string; totalMinted: string; totalIssued: string };
  floats: Array<{
    cashierId: string;
    cashierName: string;
    balance: string;
    totalReceived: string;
    totalDisbursed: string;
  }>;
  cashiers: Array<{ id: string; fullName: string; role: string }>;
  reconciliation: {
    totalMinted: string;
    poolBalance: string;
    heldByCashiers: string;
    disbursedToWriters: string;
    variance: string;
  };
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
  };
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-1 ${tone ?? ""}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

export function TokenSupply() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === "director" || user?.role === "administrator";

  const [mintAmount, setMintAmount] = useState("");
  const [issueAmount, setIssueAmount] = useState("");
  const [issueTo, setIssueTo] = useState("");

  const { data, isLoading } = useQuery<Supply>({
    queryKey: ["/api/tokens/supply"],
    queryFn: async () => {
      const res = await fetch("/api/tokens/supply", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load supply");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const mint = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tokens/pool/mint", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ amount: Number(mintAmount) }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || "Could not generate units");
      return b;
    },
    onSuccess: () => {
      toast({ title: "Units generated into the pool" });
      setMintAmount("");
      qc.invalidateQueries({ queryKey: ["/api/tokens/supply"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const issue = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tokens/pool/issue", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ amount: Number(issueAmount), cashierId: issueTo }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || "Could not recharge");
      return b;
    },
    onSuccess: (r: { cashier?: string }) => {
      toast({ title: `Recharged ${r?.cashier ?? "cashier"}` });
      setIssueAmount("");
      qc.invalidateQueries({ queryKey: ["/api/tokens/supply"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="py-12 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>;
  }

  const r = data?.reconciliation;
  const balanced = Number(r?.variance ?? 0) === 0;
  const floats = data?.floats ?? [];

  const report = (): TableReport => ({
    title: "E-Token Supply",
    fileName: `etoken_supply_${new Date().toISOString().slice(0, 10)}`,
    summary: [
      `Generated ${money(r?.totalMinted ?? 0)} · In pool ${money(r?.poolBalance ?? 0)}`,
      `Held by cashiers ${money(r?.heldByCashiers ?? 0)} · Sold to writers ${money(r?.disbursedToWriters ?? 0)}`,
      balanced ? "Books balanced" : `Out of balance by ${money(r?.variance ?? 0)}`,
    ],
    sections: [{
      heading: "Cashier floats",
      columns: [{ header: "Cashier" }, { header: "Received", align: "right" }, { header: "Sold", align: "right" }, { header: "Float Balance", align: "right" }],
      rows: floats.map((f) => [f.cashierName, money(f.totalReceived), money(f.totalDisbursed), money(f.balance)]),
      totals: ["TOTAL",
        money(floats.reduce((t, f) => t + Number(f.totalReceived), 0)),
        money(floats.reduce((t, f) => t + Number(f.totalDisbursed), 0)),
        money(floats.reduce((t, f) => t + Number(f.balance), 0))],
      empty: "No cashier has been recharged yet.",
    }],
  });

  return (
    <div className="space-y-6">
      {/* ── Section toolbar ── */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary dark:border-border dark:bg-muted dark:text-foreground">
            <Layers className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight">E-Token Supply</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Generated = pool + cashier floats + units sold to writers.</p>
          </div>
        </div>
        <ReportActions label="the e-token supply" disabled={!data} onPdf={() => exportReportPdf(report())} onPrint={() => printReport(report())} />
      </div>

      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total generated" value={fmtGHS(r?.totalMinted ?? 0)} sub="Units ever created" icon={Coins} />
        <StatTile label="In pool" value={fmtGHS(r?.poolBalance ?? 0)} sub="Not yet issued" icon={Warehouse} />
        <StatTile label="Held by cashiers" value={fmtGHS(r?.heldByCashiers ?? 0)} sub="Float awaiting sale" icon={Wallet} tone="warn" />
        <StatTile label="Sold to writers" value={fmtGHS(r?.disbursedToWriters ?? 0)} sub="Disbursed" icon={ArrowUpRight} tone="in" />
      </div>

      {/* The books either balance or they do not; say which. */}
      <div
        className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-xs font-semibold ${
          balanced
            ? "bg-emerald-500/5 border-emerald-300/50 text-emerald-800 dark:text-emerald-300"
            : "bg-destructive/5 border-destructive/40 text-destructive"
        }`}
      >
        {balanced ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
        <span>
          {balanced
            ? "Balanced — generated equals pool plus cashier floats plus units sold."
            : `Out of balance by ${fmtGHS(r?.variance ?? 0)} — a ledger entry is missing.`}
        </span>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="rounded-2xl border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Coins className="h-4 w-4 text-amber-500" /> Generate Units
              </CardTitle>
              <CardDescription className="text-xs">
                Creates new supply in the company pool. This is the only action that
                brings units into existence.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input
                type="number"
                min="1"
                step="1"
                placeholder="Amount (GHS)"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                className="h-10"
              />
              <Button
                className="h-10 shrink-0"
                disabled={!(Number(mintAmount) > 0) || mint.isPending}
                onClick={() => mint.mutate()}
              >
                {mint.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                Generate
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/80 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4 text-indigo-500" /> Recharge Cashier
              </CardTitle>
              <CardDescription className="text-xs">
                Moves units from the pool into a cashier's float, which is what they
                disburse to writers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={issueTo || undefined} onValueChange={setIssueTo}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Select cashier" /></SelectTrigger>
                <SelectContent>
                  {(data?.cashiers ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.fullName} · {c.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Amount (GHS)"
                  value={issueAmount}
                  onChange={(e) => setIssueAmount(e.target.value)}
                  className="h-10"
                />
                <Button
                  className="h-10 shrink-0"
                  disabled={!issueTo || !(Number(issueAmount) > 0) || issue.isPending}
                  onClick={() => issue.mutate()}
                >
                  {issue.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  Recharge
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Panel title="Cashier floats" icon={Users} subtitle="What each cashier holds and has sold on.">
        <ScrollTable minWidth="36rem" maxHeight="28rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Cashier</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="pr-5 text-right">Float Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {floats.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">No cashier has been recharged yet.</TableCell>
                </TableRow>
              ) : (
                floats.map((f) => (
                  <TableRow key={f.cashierId} className="hover:bg-muted/30">
                    <TableCell className="py-3 pl-5 text-sm font-semibold">{f.cashierName}</TableCell>
                    <TableCell className="py-3 text-right font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">{fmtGHS(f.totalReceived)}</TableCell>
                    <TableCell className="py-3 text-right font-mono text-xs tabular-nums text-orange-600 dark:text-orange-400">{fmtGHS(f.totalDisbursed)}</TableCell>
                    <TableCell className="py-3 pr-5 text-right font-mono text-sm font-black tabular-nums">{fmtGHS(f.balance)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollTable>
      </Panel>
    </div>
  );
}
