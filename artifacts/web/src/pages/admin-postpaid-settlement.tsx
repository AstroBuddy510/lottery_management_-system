import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Clock, AlertTriangle } from "lucide-react";
import { fmtGHS } from "@/lib/utils";

/**
 * The cashier's postpaid desk.
 *
 * Reads left to right the way the money moves: gross sales the writer took,
 * the commission they keep, and the cash she should receive. Wins recorded sit
 * in their own column and are never part of that sum - the company pays those
 * winners through the agents, so a win does not reduce what a writer hands in.
 */

interface LedgerRow {
  ledger: {
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
  };
  writer: { fullName: string | null; fullCode: string | null; phone: string | null } | null;
  game: { name: string | null; eventNumber: string | null; status: string | null } | null;
}

interface OutstandingResponse {
  ledgers: LedgerRow[];
  totals: { grossSales: string; commission: string; payable: string; winsRecorded: string };
}

export function AdminPostpaidSettlement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<OutstandingResponse>({
    queryKey: ["/api/postpaid/outstanding"],
    queryFn: async () => {
      const res = await fetch("/api/postpaid/outstanding", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("Failed to load outstanding ledgers");
      return res.json();
    },
  });

  const confirm = useMutation({
    mutationFn: async ({ id, settlementMethod }: { id: string; settlementMethod: string }) => {
      const res = await fetch(`/api/postpaid/confirm/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
        },
        body: JSON.stringify({ settlementMethod }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Receipt confirmed", description: "The writer's account is settled." });
      queryClient.invalidateQueries({ queryKey: ["/api/postpaid/outstanding"] });
    },
    onError: (e) => {
      toast({ title: "Couldn't confirm", description: (e as Error).message, variant: "destructive" });
    },
  });

  const rows = data?.ledgers ?? [];
  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Postpaid Settlement</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What postpaid writers owe on closed draws, and what they have handed in.
        </p>
      </div>

      {/* The day's account, so it needn't be added up by hand. */}
      {totals && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Gross postpaid sales", value: totals.grossSales, tone: "" },
            { label: "Writer commission", value: totals.commission, tone: "text-emerald-600" },
            { label: "Cash you should receive", value: totals.payable, tone: "text-amber-600 font-extrabold" },
            { label: "Wins recorded (company pays)", value: totals.winsRecorded, tone: "text-muted-foreground" },
          ].map((t) => (
            <Card key={t.label}>
              <CardContent className="pt-5">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t.label}</div>
                <div className={`text-xl font-bold tabular-nums mt-1 ${t.tone}`}>{fmtGHS(t.value)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Outstanding Postpaid Ledgers</CardTitle>
          <CardDescription>
            Payable is gross sales less the writer's commission at the rate set when betting closed.
            Wins are shown for the record only.
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
                  <TableHead className="text-right">Gross Sales</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Payable</TableHead>
                  <TableHead className="text-right">Wins Recorded</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      Nothing outstanding
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const l = row.ledger;
                    const declared = !!l.paymentDeclaredAt;
                    const overdue = !!l.unsettledAtCalculation;
                    const pctText =
                      l.commissionPct && Number(l.commissionPct) > 0
                        ? `${(Number(l.commissionPct) * 100).toFixed(2).replace(/\.00$/, "")}%`
                        : "—";

                    return (
                      <TableRow key={l.id} className={overdue ? "bg-destructive/5" : undefined}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {format(new Date(l.ledgerDate), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{row.writer?.fullName}</div>
                          <div className="text-xs text-muted-foreground">{row.writer?.fullCode}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{row.game?.name}</div>
                          <div className="text-muted-foreground">{row.game?.eventNumber}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtGHS(l.totalStakes)}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">
                          −{fmtGHS(l.commissionAmount)}
                          <div className="text-[10px] text-muted-foreground">{pctText}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-bold">
                          {fmtGHS(l.amountPayable)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtGHS(l.totalWinnings)}
                        </TableCell>
                        <TableCell>
                          {overdue ? (
                            <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Unsettled at calculation
                            </Badge>
                          ) : declared ? (
                            <Badge variant="outline" className="border-amber-400/60 text-amber-700 text-[10px]">
                              <Clock className="h-3 w-3 mr-1" />
                              {l.paymentDeclaredMethod === "momo" ? "MoMo sent" : "Cash declared"}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              Awaiting payment
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={method[l.id] || l.paymentDeclaredMethod || "cash"}
                            onValueChange={(val) => setMethod((p) => ({ ...p, [l.id]: val }))}
                          >
                            <SelectTrigger className="w-[130px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="momo">Mobile Money</SelectItem>
                              <SelectItem value="token_credit">Token Credit</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={declared ? "default" : "outline"}
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
    </div>
  );
}
