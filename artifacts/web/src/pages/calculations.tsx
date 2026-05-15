import { useState } from "react";
import {
  useListCalculations, useRunCalculations,
  getListCalculationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

export function Calculations() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [runDate, setRunDate] = useState(new Date().toISOString().split("T")[0]);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const runMutation = useRunCalculations();

  const { data: calculations, isLoading } = useListCalculations({
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });

  const handleRun = async () => {
    if (!runDate) return;
    if (!confirm(`Run calculations for ${runDate}? This will lock all entries for that date.`)) return;
    try {
      const result = await runMutation.mutateAsync({ data: { date: runDate } });
      toast({ title: `Calculations complete — ${(result as { processed?: number })?.processed ?? 0} records processed` });
      qc.invalidateQueries({ queryKey: getListCalculationsQueryKey({}) });
    } catch {
      toast({ title: "Failed to run calculations", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Calculations</h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run Calculations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={runDate} onChange={e => setRunDate(e.target.value)} className="h-9 text-sm w-44" />
            </div>
            <Button onClick={handleRun} disabled={runMutation.isPending || !runDate} className="h-9">
              {runMutation.isPending ? "Running..." : "Run Calculations"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Running calculations will lock all gross and wins entries for the selected date.</p>
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-base font-medium">Results</h2>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">From:</Label>
            <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-7 text-xs w-36" />
            <Label className="text-xs text-muted-foreground">To:</Label>
            <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-7 text-xs w-36" />
            {(filterFrom || filterTo) && <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setFilterFrom(""); setFilterTo(""); }}>Clear</Button>}
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Writer</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Net Gross</TableHead>
                <TableHead className="text-right">Wins</TableHead>
                <TableHead className="text-right">Reserve</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
              ) : !Array.isArray(calculations) || calculations.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">No calculations found.</TableCell></TableRow>
              ) : calculations.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="text-sm">{c.calcDate?.split("T")[0]}</TableCell>
                  <TableCell className="text-sm font-mono">{c.writerId}</TableCell>
                  <TableCell className="text-sm text-right font-mono">${Number(c.grossSales).toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-right font-mono text-muted-foreground">${Number(c.commissionAmount).toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-right font-mono">${Number(c.netGross).toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-right font-mono text-destructive">${Number(c.winsAmount).toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-right font-mono text-muted-foreground">${Number(c.reserveAmount).toFixed(2)}</TableCell>
                  <TableCell className={`text-sm text-right font-mono font-semibold ${Number(c.writerBalance) < 0 ? "text-destructive" : "text-primary"}`}>
                    ${Number(c.writerBalance).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
