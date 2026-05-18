import {
  useGetReserveBalance, useListReserveAllocations,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function Reserve() {
  const { data: balance, isLoading: loadingBalance } = useGetReserveBalance();
  const { data: allocations, isLoading: loadingAllocs } = useListReserveAllocations();
  const { writerMap } = useWriterLookup();

  const allocationList = Array.isArray(allocations) ? allocations : [];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Reserve Fund</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Current Balance</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {loadingBalance ? <span className="text-muted-foreground text-sm">Loading...</span> : (
              <div className={`text-2xl font-bold ${Number(balance?.balance ?? 0) < 0 ? "text-destructive" : "text-primary"}`}>
                ${Number(balance?.balance ?? 0).toFixed(2)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Total Contributed</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {loadingBalance ? <span className="text-muted-foreground text-sm">Loading...</span> : (
              <div className="text-2xl font-bold">${Number(balance?.totalContributed ?? 0).toFixed(2)}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Total Allocated</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {loadingBalance ? <span className="text-muted-foreground text-sm">Loading...</span> : (
              <div className="text-2xl font-bold text-destructive">${Number(balance?.totalAllocated ?? 0).toFixed(2)}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-base font-medium mb-4">Allocation History</h2>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Writer</TableHead>
                <TableHead className="text-right">Amount Drawn</TableHead>
                <TableHead className="text-right">Balance After</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingAllocs ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
              ) : allocationList.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No allocations yet.</TableCell></TableRow>
              ) : allocationList.map(a => {
                const writer = writerMap[a.writerId];
                return (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{a.allocationDate?.split("T")[0]}</TableCell>
                    <TableCell className="text-sm">
                      <span className="font-mono">{writer?.fullCode ?? a.writerId.slice(0, 8) + "…"}</span>
                      {writer && <span className="text-muted-foreground ml-1.5 text-xs">{writer.fullName}</span>}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono text-destructive">${Number(a.amountDrawn).toFixed(2)}</TableCell>
                    <TableCell className="text-sm text-right font-mono">${Number(a.reserveBalanceAfter).toFixed(2)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.reason ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
