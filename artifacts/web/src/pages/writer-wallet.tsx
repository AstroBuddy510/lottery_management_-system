import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { Wallet, ArrowDownLeft, ArrowUpRight, Plus, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function WriterWallet() {
  const { user } = useAuth();
  
  const { data: balanceData, isLoading: loadingBalance } = useQuery({
    queryKey: ["/api/writer-tokens/balance"],
    queryFn: async () => {
      const res = await fetch("/api/writer-tokens/balance", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    },
    enabled: user?.operationModel === "prepaid"
  });

  const { data: transactions, isLoading: loadingTransactions } = useQuery({
    queryKey: ["/api/writer-tokens/transactions"],
    queryFn: async () => {
      const res = await fetch("/api/writer-tokens/transactions", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    },
    enabled: user?.operationModel === "prepaid"
  });

  const { data: ledgers, isLoading: loadingLedgers } = useQuery({
    queryKey: ["/api/postpaid/ledger"],
    queryFn: async () => {
      const res = await fetch("/api/postpaid/ledger", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    },
    enabled: user?.operationModel === "postpaid"
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Wallet & Ledger</h1>
        {user?.operationModel === "prepaid" && (
          <Button variant="outline" size="sm" onClick={() => alert("Fund via Paystack (Integration coming soon)")}>
            <Plus className="mr-2 h-4 w-4" /> Add Funds
          </Button>
        )}
      </div>

      {user?.operationModel === "prepaid" ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-primary">Available Balance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">GHS {balanceData?.balance || "0.00"}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Purchased</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">GHS {balanceData?.totalPurchased || "0.00"}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Spent</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">GHS {balanceData?.totalSpent || "0.00"}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingTransactions ? (
                      <TableRow><TableCell colSpan={5} className="text-center">Loading...</TableCell></TableRow>
                    ) : transactions?.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No transactions</TableCell></TableRow>
                    ) : (
                      transactions?.map((tx: any) => (
                        <TableRow key={tx.id}>
                          <TableCell>{format(new Date(tx.createdAt), "MMM d, yyyy h:mm a")}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {tx.transactionType.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>{tx.description}</TableCell>
                          <TableCell className={`text-right font-medium ${parseFloat(tx.amount) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {parseFloat(tx.amount) > 0 ? '+' : ''}{tx.amount}
                          </TableCell>
                          <TableCell className="text-right font-mono">GHS {tx.balanceAfter}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Daily Postpaid Ledger</CardTitle>
              <CardDescription>Your daily stakes and winnings, settled at the end of the day.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total Stakes</TableHead>
                      <TableHead className="text-right">Total Winnings</TableHead>
                      <TableHead className="text-right">Net Balance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingLedgers ? (
                      <TableRow><TableCell colSpan={5} className="text-center">Loading...</TableCell></TableRow>
                    ) : ledgers?.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No ledger entries found</TableCell></TableRow>
                    ) : (
                      ledgers?.map((ledger: any) => {
                        const net = parseFloat(ledger.totalStakes) - parseFloat(ledger.totalWinnings);
                        return (
                          <TableRow key={ledger.id}>
                            <TableCell>{format(new Date(ledger.ledgerDate), "MMM d, yyyy")}</TableCell>
                            <TableCell className="text-right">GHS {ledger.totalStakes}</TableCell>
                            <TableCell className="text-right text-green-600">GHS {ledger.totalWinnings}</TableCell>
                            <TableCell className={`text-right font-bold ${net > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {net > 0 ? `Owe: GHS ${net.toFixed(2)}` : `Receive: GHS ${Math.abs(net).toFixed(2)}`}
                            </TableCell>
                            <TableCell>
                              <Badge variant={ledger.settlementStatus === 'settled' ? 'default' : 'secondary'} className="capitalize">
                                {ledger.settlementStatus}
                              </Badge>
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
        </>
      )}
    </div>
  );
}
