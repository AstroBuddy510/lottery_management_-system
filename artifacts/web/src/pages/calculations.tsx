import { useState } from "react";
import {
  useListCalculations, useRunCalculations,
  getListCalculationsQueryKey,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

export function Calculations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { writerMap, agentList } = useWriterLookup();

  const [runDate, setRunDate] = useState(new Date().toISOString().split("T")[0]);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterAgentId, setFilterAgentId] = useState("");
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

  const calcList = Array.isArray(calculations) ? calculations : [];

  const filteredCalcs = filterAgentId
    ? calcList.filter(c => {
        const w = writerMap[c.writerId];
        if (!w) return false;
        return agentList.find(a => a.fullCode && w.fullCode.startsWith(a.fullCode + "-"))?.id === filterAgentId;
      })
    : calcList;

  const totals = filteredCalcs.reduce(
    (acc, c) => ({
      gross: acc.gross + Number(c.grossSales),
      commission: acc.commission + Number(c.commissionAmount),
      net: acc.net + Number(c.netGross),
      wins: acc.wins + Number(c.winsAmount),
      reserve: acc.reserve + Number(c.reserveAmount),
      balance: acc.balance + Number(c.writerBalance),
    }),
    { gross: 0, commission: 0, net: 0, wins: 0, reserve: 0, balance: 0 }
  );

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
              {runMutation.isPending ? "Running…" : "Run Calculations"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Running calculations locks all gross and wins entries for the selected date.</p>
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <h2 className="text-base font-medium">Results</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={filterAgentId || "_all"} onValueChange={v => setFilterAgentId(v === "_all" ? "" : v)}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All agents</SelectItem>
                {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.fullCode}</SelectItem>)}
              </SelectContent>
            </Select>
            <Label className="text-xs text-muted-foreground">From:</Label>
            <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-7 text-xs w-36" />
            <Label className="text-xs text-muted-foreground">To:</Label>
            <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-7 text-xs w-36" />
            {(filterFrom || filterTo || filterAgentId) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterAgentId(""); }}>Clear</Button>
            )}
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
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
              ) : filteredCalcs.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">No calculations found.</TableCell></TableRow>
              ) : (
                <>
                  {filteredCalcs.map(c => {
                    const writer = writerMap[c.writerId];
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm">{c.calcDate?.split("T")[0]}</TableCell>
                        <TableCell className="text-sm">
                          <span className="font-mono">{writer?.fullCode ?? c.writerId.slice(0, 8) + "…"}</span>
                          {writer && <span className="text-muted-foreground ml-1.5 text-xs">{writer.fullName}</span>}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono">GH₵ {Number(c.grossSales).toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground">GH₵ {Number(c.commissionAmount).toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-right font-mono">GH₵ {Number(c.netGross).toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-right font-mono text-destructive">GH₵ {Number(c.winsAmount).toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground">GH₵ {Number(c.reserveAmount).toFixed(2)}</TableCell>
                        <TableCell className={`text-sm text-right font-mono font-semibold ${Number(c.writerBalance) < 0 ? "text-destructive" : "text-primary"}`}>
                          GH₵ {Number(c.writerBalance).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredCalcs.length > 1 && (
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell className="text-xs text-muted-foreground" colSpan={2}>Totals ({filteredCalcs.length} rows)</TableCell>
                      <TableCell className="text-right font-mono text-sm">GH₵ {totals.gross.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">GH₵ {totals.commission.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">GH₵ {totals.net.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-destructive">GH₵ {totals.wins.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">GH₵ {totals.reserve.toFixed(2)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm ${totals.balance < 0 ? "text-destructive" : "text-primary"}`}>GH₵ {totals.balance.toFixed(2)}</TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
