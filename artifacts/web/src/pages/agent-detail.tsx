import { useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import {
  useListCalculations, useListPayments, useListAgents, useListWriters,
  useListGrossEntries, useListWinsEntries, useGetSettings,
  useListAgentDebtReductions,
  getListCalculationsQueryKey, getListWritersQueryKey,
  getListGrossEntriesQueryKey, getListWinsEntriesQueryKey,
  getGetSettingsQueryKey, getListAgentDebtReductionsQueryKey,
} from "@workspace/api-client-react";
import { WriterManager } from "@/components/writer-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtGHS } from "@/lib/utils";

type TabId = "overview" | "writers" | "entries" | "debt";

function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
      <span className="text-[10px] font-semibold text-emerald-700">LIVE</span>
    </span>
  );
}

export function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);

  const { data: agents } = useListAgents({});
  const { data: writers } = useListWriters(agentId, {}, {
    query: { queryKey: getListWritersQueryKey(agentId, {}), enabled: !!agentId }
  });
  const { data: debtReductions } = useListAgentDebtReductions(agentId ?? "", {
    query: { queryKey: getListAgentDebtReductionsQueryKey(agentId ?? ""), enabled: !!agentId, refetchInterval: 30_000 }
  });
  const { data: allCalcs } = useListCalculations(
    {},
    { query: { queryKey: getListCalculationsQueryKey({}) } }
  );
  const { data: payments } = useListPayments({});
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });

  // Live entries — poll every 30s
  const { data: rawGross } = useListGrossEntries(
    { dateFrom: selectedDate, dateTo: selectedDate },
    { query: { queryKey: getListGrossEntriesQueryKey({ dateFrom: selectedDate, dateTo: selectedDate }), refetchInterval: 30_000 } }
  );
  const { data: rawWins } = useListWinsEntries(
    { dateFrom: selectedDate, dateTo: selectedDate },
    { query: { queryKey: getListWinsEntriesQueryKey({ dateFrom: selectedDate, dateTo: selectedDate }), refetchInterval: 30_000 } }
  );

  const agentList = Array.isArray(agents) ? agents : [];
  const writerList = Array.isArray(writers) ? writers : [];
  const calcList = Array.isArray(allCalcs) ? allCalcs : [];
  const paymentList = Array.isArray(payments) ? payments : [];

  const commPct = Number(settings?.commissionPct ?? 0);
  const resvPct = Number(settings?.reservePct ?? 0);

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

  // Per-writer live entries (for Entries tab)
  const grossEntries = useMemo(
    () => (Array.isArray(rawGross) ? rawGross : []).filter(e => writerIds.has(e.writerId)),
    [rawGross, writerIds]
  );
  const winsEntries = useMemo(
    () => (Array.isArray(rawWins) ? rawWins : []).filter(e => writerIds.has(e.writerId)),
    [rawWins, writerIds]
  );

  // Build per-writer entry rows
  const entryRows = useMemo(() => {
    const map: Record<string, { writerId: string; gross: number; wins: number; grossAt: string; winsAt: string }> = {};
    for (const e of grossEntries) {
      if (!map[e.writerId]) map[e.writerId] = { writerId: e.writerId, gross: 0, wins: 0, grossAt: "", winsAt: "" };
      map[e.writerId].gross += Number(e.grossAmount ?? 0);
      map[e.writerId].grossAt = e.createdAt ?? "";
    }
    for (const e of winsEntries) {
      if (!map[e.writerId]) map[e.writerId] = { writerId: e.writerId, gross: 0, wins: 0, grossAt: "", winsAt: "" };
      map[e.writerId].wins += Number(e.winsAmount ?? 0);
      map[e.writerId].winsAt = e.createdAt ?? "";
    }
    return Object.values(map).sort((a, b) => {
      const wa = writerMap[a.writerId]?.fullCode ?? "";
      const wb = writerMap[b.writerId]?.fullCode ?? "";
      return wa.localeCompare(wb);
    });
  }, [grossEntries, winsEntries, writerMap]);

  const liveTotals = useMemo(() => {
    const gross = entryRows.reduce((s, r) => s + r.gross, 0);
    const wins  = entryRows.reduce((s, r) => s + r.wins,  0);
    const commission = gross * commPct;
    const net   = gross - commission;
    const reserve = net * resvPct;
    const balance = net - wins - reserve;
    return { gross, wins, commission, net, reserve, balance };
  }, [entryRows, commPct, resvPct]);

  const hasCalcForDate = dateCalcs.length > 0;

  const debtReductionList = Array.isArray(debtReductions) ? debtReductions : [];
  const currentDebt = parseFloat(agent?.outstandingDebt ?? "0");

  const TABS: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "writers",  label: `Writers (${writerList.length})` },
    { id: "entries",  label: `Live Entries${entryRows.length > 0 ? ` (${entryRows.length})` : ""}` },
    { id: "debt",     label: currentDebt > 0 
        ? `Company owes Agent — GH₵ ${currentDebt.toLocaleString("en-GH", { minimumFractionDigits: 2 })}` 
        : currentDebt < 0 
          ? `Agent owes Company — GH₵ ${Math.abs(currentDebt).toLocaleString("en-GH", { minimumFractionDigits: 2 })}` 
          : "Balance Clear"
    },
  ];

  const fmtTime = (ts: string) =>
    ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

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

      {/* Date picker (shared across all tabs) */}
      <div className="flex items-center gap-3">
        <Label className="text-xs text-muted-foreground">Date</Label>
        <Input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="h-8 text-sm w-40"
        />
        {selectedDate !== today && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedDate(today)}>
            Today
          </Button>
        )}
        <Badge variant={hasPaid ? "default" : "destructive"} className="text-sm px-3 py-1 ml-auto">
          Reserve: {hasPaid ? "Paid" : "Not Paid"}
        </Badge>
      </div>

      {/* Tabs */}
      <div className="flex border-b gap-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.id === "entries" && entryRows.length > 0 && activeTab !== "entries" && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
            )}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
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
      )}

      {/* ── Debt tab ── */}
      {activeTab === "debt" && (
        <div className="space-y-6">
          {/* Balance summary cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className={currentDebt < 0 ? "border-amber-300 bg-amber-50/40" : "border-emerald-300 bg-emerald-50/30"}>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground">
                  {currentDebt > 0 ? "Company owes Agent" : currentDebt < 0 ? "Agent owes Company" : "Clear Balance"}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className={`text-2xl font-bold font-mono ${currentDebt < 0 ? "text-amber-700" : "text-emerald-600"}`}>
                  {fmtGHS(Math.abs(currentDebt))}
                </div>
                {agent?.debtSince && currentDebt < 0 && (
                  <p className="text-xs text-amber-600 mt-1">
                    Since {new Date(agent.debtSince).toLocaleDateString("en-GH", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
                {currentDebt === 0 && (
                  <p className="text-xs text-emerald-600 mt-1 font-medium">Balance Clear</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground">Total Reduced (All Time)</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-bold font-mono text-primary">
                  {fmtGHS(debtReductionList.reduce((s, r) => s + parseFloat(r.reductionAmount), 0))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Across {debtReductionList.length} calculation{debtReductionList.length !== 1 ? "s" : ""}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground">Latest Reduction</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {debtReductionList.length > 0 ? (
                  <>
                    <div className="text-2xl font-bold font-mono text-primary">
                      {fmtGHS(debtReductionList[0].reductionAmount)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{debtReductionList[0].calcDate}</p>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground pt-1">No reductions yet</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* How it works notice */}
          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3">
            <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-xs text-blue-700">
              <strong>Automated balance adjustment</strong> — each time daily calculations are run, the agent's daily net balance (profit/loss) is automatically subtracted from their outstanding balance, netting out correctly. If they make a profit, it increases what they owe the company; if they make a loss, it increases what the company owes them. Cashier payments (pay-in and pay-out) directly reconcile these balances.
            </p>
          </div>

          {/* Reduction history table */}
          <div>
            <h2 className="text-base font-semibold mb-3">Reduction History</h2>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Calc Date</TableHead>
                    <TableHead className="text-right">Agent Net Gross</TableHead>
                    <TableHead className="text-right">Reduction Applied</TableHead>
                    <TableHead className="text-right">Debt Before</TableHead>
                    <TableHead className="text-right">Debt After</TableHead>
                    <TableHead className="text-right">Surplus</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {debtReductionList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                        No automated debt reductions have been recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : debtReductionList.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm font-medium">{r.calcDate}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtGHS(r.netGrossAmount)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold text-emerald-700">
                        − {fmtGHS(r.reductionAmount)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-amber-700">{fmtGHS(r.debtBefore)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-semibold ${parseFloat(r.debtAfter) === 0 ? "text-emerald-600" : "text-amber-700"}`}>
                        {fmtGHS(r.debtAfter)}
                        {parseFloat(r.debtAfter) === 0 && (
                          <span className="ml-1.5 text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full font-semibold">Cleared</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {r.surplus && parseFloat(r.surplus) > 0 ? fmtGHS(r.surplus) : <span className="text-slate-300">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* ── Writers tab ── */}
      {activeTab === "writers" && agentId && agent && (
        <WriterManager agentId={agentId} agentFullCode={agent.fullCode} />
      )}

      {/* ── Live Entries tab ── */}
      {activeTab === "entries" && (
        <div className="space-y-5">

          {/* Status banner */}
          <div className={`rounded-xl border px-5 py-3 flex items-center gap-4 flex-wrap ${hasCalcForDate ? "bg-emerald-50 border-emerald-200" : "bg-amber-50/60 border-amber-200"}`}>
            {hasCalcForDate ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                Calculations run for {selectedDate} — figures locked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 font-semibold">
                <span className="w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse" />
                Live entries — estimates until calculation is run · auto-refreshing every 30s
              </span>
            )}
            <LiveDot />
          </div>

          {/* Live summary cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {[
              { label: "Agent Gross", value: liveTotals.gross, color: "" },
              { label: `Commission (${(commPct * 100).toFixed(1)}%)`, value: liveTotals.commission, color: "text-muted-foreground" },
              { label: "Company Net", value: liveTotals.net, color: "" },
              { label: "Total Wins", value: liveTotals.wins, color: "text-destructive" },
              { label: `Reserve (${(resvPct * 100).toFixed(1)}%)`, value: liveTotals.reserve, color: "text-muted-foreground" },
              { label: "Est. Balance", value: liveTotals.balance, color: liveTotals.balance < 0 ? "text-destructive" : "text-primary" },
            ].map(({ label, value, color }) => (
              <Card key={label} className={hasCalcForDate ? "" : "border-amber-200 bg-amber-50/30"}>
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs text-muted-foreground">
                    {label}{!hasCalcForDate ? " ~" : ""}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className={`text-base font-bold font-mono ${color}`}>
                    {fmtGHS(value)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Per-writer entries table */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-semibold">Entry History</h2>
              <span className="text-sm text-muted-foreground">
                {entryRows.length} writer{entryRows.length !== 1 ? "s" : ""} with entries
              </span>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Writer</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Wins</TableHead>
                    <TableHead className="text-right">Commission~</TableHead>
                    <TableHead className="text-right">Net~</TableHead>
                    <TableHead className="text-right">Reserve~</TableHead>
                    <TableHead className="text-right">Balance~</TableHead>
                    <TableHead>Gross At</TableHead>
                    <TableHead>Wins At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entryRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-muted-foreground text-sm">
                        No entries for {selectedDate} yet.
                      </TableCell>
                    </TableRow>
                  ) : entryRows.map(row => {
                    const writer = writerMap[row.writerId];
                    const comm = row.gross * commPct;
                    const net  = row.gross - comm;
                    const resv = net * resvPct;
                    const bal  = net - row.wins - resv;
                    return (
                      <TableRow key={row.writerId}>
                        <TableCell className="text-sm">
                          <div className="font-mono font-medium">{writer?.fullCode ?? row.writerId.slice(0, 8)}</div>
                          {writer && <div className="text-xs text-muted-foreground">{writer.fullName}</div>}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono">
                          {row.gross > 0 ? fmtGHS(row.gross) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono text-destructive">
                          {row.wins > 0 ? fmtGHS(row.wins) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmtGHS(comm)}</TableCell>
                        <TableCell className="text-sm text-right font-mono">{fmtGHS(net)}</TableCell>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmtGHS(resv)}</TableCell>
                        <TableCell className={`text-sm text-right font-mono font-semibold ${bal < 0 ? "text-destructive" : "text-primary"}`}>
                          {fmtGHS(bal)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {row.grossAt ? fmtTime(row.grossAt) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {row.winsAt ? fmtTime(row.winsAt) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Writers with no entries yet */}
          {(() => {
            const enteredIds = new Set(entryRows.map(r => r.writerId));
            const missing = writerList.filter(w => w.isActive && !enteredIds.has(w.id));
            if (!missing.length) return null;
            return (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  No entries yet ({missing.length} writer{missing.length !== 1 ? "s" : ""})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {missing.map(w => (
                    <Badge key={w.id} variant="outline" className="text-xs font-mono">
                      {w.fullCode} — {w.fullName}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
