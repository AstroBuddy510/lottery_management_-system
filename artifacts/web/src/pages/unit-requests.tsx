import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Loader2, Check, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS } from "@/lib/utils";
import { Wallet } from "lucide-react";

/**
 * Paid unit purchases awaiting a cashier. Paystack confirming the charge
 * marks a request paid; issuing the units is a deliberate human step so
 * there is always a record of who credited betting funds.
 */

interface PurchaseRequest {
  id: string;
  amount: string;
  status: string;
  paystackReference: string | null;
  paidAt: string | null;
  creditedAt: string | null;
  createdAt: string;
  writerName: string;
  writerCode: string;
  writerPhone: string | null;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

export function UnitRequests() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: requests, isLoading } = useQuery<PurchaseRequest[]>({
    queryKey: ["/api/writer-tokens/purchase-requests", "paid"],
    queryFn: async () => {
      const res = await fetch("/api/writer-tokens/purchase-requests?status=paid", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load requests");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const credit = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/writer-tokens/purchase-requests/${id}/credit`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not credit");
      return res.json();
    },
    onSuccess: (r: { balance?: string }) => {
      toast({ title: "Units credited", description: r?.balance ? `New balance ${fmtGHS(r.balance)}` : undefined });
      qc.invalidateQueries({ queryKey: ["/api/writer-tokens/purchase-requests"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // The float is what funds these credits, so show it beside the queue.
  const { data: float } = useQuery<{ wallet: { balance: string; totalDisbursed: string } }>({
    queryKey: ["/api/tokens/my-float"],
    queryFn: async () => {
      const res = await fetch("/api/tokens/my-float", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load float");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const list = requests ?? [];
  const total = list.reduce((s, r) => s + Number(r.amount), 0);
  const floatBalance = Number(float?.wallet?.balance ?? 0);
  const short = floatBalance < total;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-amber-500" /> Unit Requests
          </CardTitle>
          <CardDescription>
            Writers who have paid for e-token units by mobile money. Credit the units to issue them.
          </CardDescription>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1 justify-end">
              <Wallet className="h-3 w-3" /> My Float
            </div>
            <div className={`text-lg font-bold tabular-nums ${short ? "text-destructive" : ""}`}>
              {fmtGHS(floatBalance)}
            </div>
          </div>
          {list.length > 0 && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Awaiting</div>
              <div className="text-lg font-bold tabular-nums">{fmtGHS(total)}</div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {short && list.length > 0 && (
          <p className="text-xs rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-amber-900 dark:text-amber-200">
            Your float does not cover everything queued. Ask an administrator to
            recharge you — units are disbursed from your float, not created here.
          </p>
        )}
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Writer</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>
              ) : list.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No paid requests awaiting credit.</TableCell></TableRow>
              ) : (
                list.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="block text-sm font-medium">{r.writerName}</span>
                      <span className="block text-[11px] font-mono text-muted-foreground">
                        {r.writerCode}{r.writerPhone ? ` · ${r.writerPhone}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.paidAt ? format(new Date(r.paidAt), "d MMM · h:mm a") : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {r.paystackReference ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{fmtGHS(r.amount)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        disabled={credit.isPending}
                        onClick={() => credit.mutate(r.id)}
                      >
                        {credit.isPending && credit.variables === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1.5">Credit Units</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
