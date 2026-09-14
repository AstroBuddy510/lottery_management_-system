import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Coins, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total Generated" value={fmtGHS(r?.totalMinted ?? 0)} hint="Units ever created" />
        <Stat label="In Pool" value={fmtGHS(r?.poolBalance ?? 0)} hint="Not yet issued" tone="text-primary" />
        <Stat label="Held by Cashiers" value={fmtGHS(r?.heldByCashiers ?? 0)} hint="Float awaiting sale" />
        <Stat label="Sold to Writers" value={fmtGHS(r?.disbursedToWriters ?? 0)} hint="Disbursed" tone="text-emerald-600" />
      </div>

      {/* The books either balance or they do not; say which. */}
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
            ? "Balanced — generated equals pool plus cashier floats plus units sold."
            : `Out of balance by ${fmtGHS(r?.variance ?? 0)} — a ledger entry is missing.`}
        </span>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
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

          <Card>
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cashier Floats</CardTitle>
          <CardDescription className="text-xs">
            What each cashier holds and has sold on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Float Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.floats ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-sm text-muted-foreground">
                      No cashier has been recharged yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  data!.floats.map((f) => (
                    <TableRow key={f.cashierId}>
                      <TableCell className="font-medium text-sm">{f.cashierName}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmtGHS(f.totalReceived)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmtGHS(f.totalDisbursed)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-bold">{fmtGHS(f.balance)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
