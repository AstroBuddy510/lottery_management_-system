import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

export function AdminPostpaidSettlement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<Record<string, string>>({});

  const { data: ledgers, isLoading } = useQuery({
    queryKey: ["/api/postpaid/outstanding"],
    queryFn: async () => {
      const res = await fetch("/api/postpaid/outstanding", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    }
  });

  const settleMutation = useMutation({
    mutationFn: async ({ id, settlementMethod }: { id: string, settlementMethod: string }) => {
      const res = await fetch(`/api/postpaid/settle/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
        body: JSON.stringify({ settlementMethod, settlementReference: "Admin Settle" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ledger settled" });
      queryClient.invalidateQueries({ queryKey: ["/api/postpaid/outstanding"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Postpaid Settlement</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Outstanding Postpaid Ledgers</CardTitle>
          <CardDescription>Daily net balances for writers on the Postpaid model.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Writer</TableHead>
                  <TableHead className="text-right">Total Stakes</TableHead>
                  <TableHead className="text-right">Total Winnings</TableHead>
                  <TableHead className="text-right">Net Balance</TableHead>
                  <TableHead>Settlement Method</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center">Loading...</TableCell></TableRow>
                ) : ledgers?.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No outstanding ledgers</TableCell></TableRow>
                ) : (
                  ledgers?.map((row: any) => {
                    const net = parseFloat(row.ledger.netBalance);
                    return (
                      <TableRow key={row.ledger.id}>
                        <TableCell className="text-xs">{format(new Date(row.ledger.ledgerDate), "MMM d, yyyy")}</TableCell>
                        <TableCell>
                          <div className="font-medium">{row.writer?.fullName}</div>
                          <div className="text-xs text-muted-foreground">{row.writer?.fullCode}</div>
                        </TableCell>
                        <TableCell className="text-right">GHS {row.ledger.totalStakes}</TableCell>
                        <TableCell className="text-right text-green-600">GHS {row.ledger.totalWinnings}</TableCell>
                        <TableCell className={`text-right font-bold ${net > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {net > 0 ? `Writer Owes: ${net.toFixed(2)}` : `Owe Writer: ${Math.abs(net).toFixed(2)}`}
                        </TableCell>
                        <TableCell>
                          <Select value={method[row.ledger.id] || "momo"} onValueChange={(val) => setMethod(p => ({ ...p, [row.ledger.id]: val }))}>
                            <SelectTrigger className="w-[120px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="momo">Mobile Money</SelectItem>
                              <SelectItem value="cashier">Cash (Cashier)</SelectItem>
                              <SelectItem value="token_credit">Token Credit</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                           <Button 
                             size="sm" 
                             onClick={() => settleMutation.mutate({ id: row.ledger.id, settlementMethod: method[row.ledger.id] || "momo" })}
                             disabled={settleMutation.isPending}
                           >
                             Mark Settled
                           </Button>
                        </TableCell>
                      </TableRow>
                    )
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
