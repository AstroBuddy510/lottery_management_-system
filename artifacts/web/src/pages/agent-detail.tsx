import { useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import {
  useListCalculations, useListPayments, useListAgents, useListWriters,
  getListCalculationsQueryKey, getListWritersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtGHS } from "@/lib/utils";

export function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const [, navigate] = useLocation();

  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: agents } = useListAgents({});
  const { data: writers } = useListWriters(agentId, {}, {
    query: { queryKey: getListWritersQueryKey(agentId, {}), enabled: !!agentId }
  });
  const { data: allCalcs } = useListCalculations(
    {},
    { query: { queryKey: getListCalculationsQueryKey({}) } }
  );
  const { data: payments } = useListPayments({});

  const agentList = Array.isArray(agents) ? agents : [];
  const writerList = Array.isArray(writers) ? writers : [];
  const calcList = Array.isArray(allCalcs) ? allCalcs : [];
  const paymentList = Array.isArray(payments) ? payments : [];

  const agent = agentList.find(a => a.id === agentId);

  const writerMap: Record<string, { fullCode: string; fullName: string }> = useMemo(() =>
    Object.fromEntries(writerList.map(w => [w.id, { fullCode: w.fullCode, fullName: w.fullName }])),
    [writerList]
  );

  const writerIds = useMemo(() => new Set(writerList.map(w => w.id)), [writerList]);

  const dateCalcs = useMemo(() =>
    calcList.filter(c => c.calcDate?.startsWith(selectedDate) && writerIds.has(c.writerId)),
    [calcList, selectedDate, writerIds]
  );

  const hasPaid = useMemo(() =>
    paymentList.some(p => p.agentId === agentId && !p.isVoided && p.paymentDate?.startsWith(selectedDate)),
    [paymentList, agentId, selectedDate]
  );

  const totals = useMemo(() => dateCalcs.reduce(
    (acc, c) => ({
      gross: acc.gross + Number(c.grossSales),
      commission: acc.commission + Number(c.commissionAmount),
      net: acc.net + Number(c.netGross),
      wins: acc.wins + Number(c.winsAmount),
      reserve: acc.reserve + Number(c.reserveAmount),
      balance: acc.balance + Number(c.writerBalance),
    }),
    { gross: 0, commission: 0, net: 0, wins: 0, reserve: 0, balance: 0 }
  ), [dateCalcs]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => navigate("/dashboard")}>
          ← Dashboard
        </Button>
        <div className="h-4 w-px bg-border" />
        <div>
          <h1 className="text-xl font-semibold">{agent?.user?.fullName ?? "Agent"}</h1>
          <span className="text-sm font-mono text-muted-foreground">{agent?.fullCode}</span>
        </div>
        <Badge variant={agent?.isActive ? "default" : "secondary"} className="ml-auto">
          {agent?.isActive ? "Active" : "Inactive"}
        </Badge>
      </div>

      {/* Date picker + payment status */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="h-8 text-sm w-40"
          />
        </div>
        <Badge variant={hasPaid ? "default" : "destructive"} className="text-sm px-3 py-1">
          Reserve Payment: {hasPaid ? "Paid" : "Not Paid"}
        </Badge>
      </div>

      {/* Agent summary cards */}
      {dateCalcs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {[
            ["Agent Gross", totals.gross],
            ["Commission", totals.commission],
            ["Company Net", totals.net],
            ["Total Wins", totals.wins],
            ["Reserve", totals.reserve],
            ["Final Balance", totals.balance],
          ].map(([label, value]) => (
            <Card key={label as string}>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className={`text-base font-bold font-mono ${label === "Final Balance" && Number(value) < 0 ? "text-destructive" : label === "Final Balance" ? "text-primary" : ""}`}>
                  {fmtGHS(value as number)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Writer breakdown table */}
      <div>
        <h2 className="text-base font-semibold mb-3">
          Writer Breakdown
          <span className="text-sm font-normal text-muted-foreground ml-2">
            {dateCalcs.length} of {writerList.filter(w => w.isActive).length} writers submitted
          </span>
        </h2>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Writer</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Wins</TableHead>
                <TableHead className="text-right">Reserve</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dateCalcs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                    No calculations for {selectedDate}. Run calculations first.
                  </TableCell>
                </TableRow>
              ) : dateCalcs.map(c => {
                const writer = writerMap[c.writerId];
                const calcTime = c.calculatedAt
                  ? new Date(c.calculatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : "—";
                return (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">
                      <div className="font-mono font-medium">{writer?.fullCode ?? c.writerId.slice(0, 8) + "…"}</div>
                      {writer && <div className="text-xs text-muted-foreground">{writer.fullName}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{calcTime}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{fmtGHS(c.grossSales)}</TableCell>
                    <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmtGHS(c.commissionAmount)}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{fmtGHS(c.netGross)}</TableCell>
                    <TableCell className="text-sm text-right font-mono text-destructive">{fmtGHS(c.winsAmount)}</TableCell>
                    <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmtGHS(c.reserveAmount)}</TableCell>
                    <TableCell className={`text-sm text-right font-mono font-semibold ${Number(c.writerBalance) < 0 ? "text-destructive" : "text-primary"}`}>
                      {fmtGHS(c.writerBalance)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={hasPaid ? "default" : "destructive"} className="text-xs">
                        {hasPaid ? "Paid" : "Not Paid"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Writers not yet submitted */}
      {writerList.filter(w => w.isActive && !dateCalcs.some(c => c.writerId === w.id)).length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Not yet submitted</h3>
          <div className="flex flex-wrap gap-2">
            {writerList
              .filter(w => w.isActive && !dateCalcs.some(c => c.writerId === w.id))
              .map(w => (
                <Badge key={w.id} variant="outline" className="text-xs font-mono">
                  {w.fullCode} — {w.fullName}
                </Badge>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
