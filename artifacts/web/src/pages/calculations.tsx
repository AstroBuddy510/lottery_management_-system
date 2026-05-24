import { useState, useMemo } from "react";
import {
  useListCalculations, useRunCalculations, useListGames,
  getListCalculationsQueryKey,
} from "@workspace/api-client-react";
import type { Game } from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

function fmtGHS(v: number) { return `GH₵ ${v.toFixed(2)}`; }

function gameCloseDate(game: Game) {
  return new Date(game.closeAt).toISOString().split("T")[0];
}

function gameLiveDate(game: Game) {
  return new Date(game.goLiveAt).toISOString().split("T")[0];
}

function StatusBadge({ status }: { status: string }) {
  if (status === "live")
    return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] px-1.5 py-0">LIVE</Badge>;
  if (status === "closed")
    return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Closed</Badge>;
  return <Badge variant="outline" className="text-[10px] px-1.5 py-0">Offline</Badge>;
}

export function Calculations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { writerMap, agentList } = useWriterLookup();

  const [selectedRunGameId, setSelectedRunGameId] = useState("_none");
  const [runDate, setRunDate] = useState(new Date().toISOString().split("T")[0]);

  const [historyGameId, setHistoryGameId] = useState("_all");
  const [filterAgentId, setFilterAgentId] = useState("");

  const runMutation = useRunCalculations();
  const { data: gamesRaw } = useListGames();
  const { data: calculations, isLoading } = useListCalculations(
    {},
    { query: { queryKey: getListCalculationsQueryKey({}) } }
  );

  const gameList = useMemo(() => {
    const g = Array.isArray(gamesRaw) ? gamesRaw : [];
    return [...g].sort((a, b) => b.eventNumber.localeCompare(a.eventNumber));
  }, [gamesRaw]);

  const handleRunGameChange = (id: string) => {
    setSelectedRunGameId(id);
    if (id !== "_none") {
      const g = gameList.find(g => g.id === id);
      if (g) setRunDate(gameCloseDate(g));
    }
  };

  const handleRun = async () => {
    if (!runDate) return;
    const game = selectedRunGameId !== "_none" ? gameList.find(g => g.id === selectedRunGameId) : null;
    const label = game ? `${game.eventNumber} — ${game.name} (${runDate})` : runDate;
    if (!confirm(`Run calculations for ${label}?\n\nThis will lock all gross and wins entries for ${runDate}.`)) return;
    try {
      const result = await runMutation.mutateAsync({ data: { date: runDate } });
      const count = (result as { calculated?: number })?.calculated ?? 0;
      toast({ title: `Calculations complete — ${count} writer${count !== 1 ? "s" : ""} processed` });
      qc.invalidateQueries({ queryKey: getListCalculationsQueryKey({}) });
    } catch {
      toast({ title: "Failed to run calculations", variant: "destructive" });
    }
  };

  const calcList = useMemo(() => Array.isArray(calculations) ? calculations : [], [calculations]);

  const calculatedDates = useMemo(() => {
    const dates = new Set<string>();
    for (const c of calcList) {
      if (c.calcDate) {
        dates.add(c.calcDate.split("T")[0]);
      }
    }
    return dates;
  }, [calcList]);

  const gamesYetToRun = useMemo(() => {
    return gameList.filter(g => !calculatedDates.has(gameCloseDate(g)));
  }, [gameList, calculatedDates]);

  const selectedRunGame = selectedRunGameId !== "_none" ? gameList.find(g => g.id === selectedRunGameId) : null;
  const selectedHistoryGame = historyGameId !== "_all" ? gameList.find(g => g.id === historyGameId) : null;

  const historyCalcs = useMemo(() => {
    if (!selectedHistoryGame) return calcList;
    const from = gameLiveDate(selectedHistoryGame);
    const to   = gameCloseDate(selectedHistoryGame);
    return calcList.filter(c => {
      const d = c.calcDate?.split("T")[0] ?? "";
      return d >= from && d <= to;
    });
  }, [calcList, selectedHistoryGame]);

  const filteredCalcs = useMemo(() =>
    filterAgentId
      ? historyCalcs.filter(c => {
          const w = writerMap[c.writerId];
          if (!w) return false;
          return agentList.find(a => a.fullCode && w.fullCode.startsWith(a.fullCode + "-"))?.id === filterAgentId;
        })
      : historyCalcs,
    [historyCalcs, filterAgentId, writerMap, agentList]
  );

  const totals = useMemo(() => filteredCalcs.reduce(
    (acc, c) => ({
      gross:      acc.gross      + Number(c.grossSales),
      commission: acc.commission + Number(c.commissionAmount),
      net:        acc.net        + Number(c.netGross),
      wins:       acc.wins       + Number(c.winsAmount),
      reserve:    acc.reserve    + Number(c.reserveAmount),
      balance:    acc.balance    + Number(c.writerBalance),
    }),
    { gross: 0, commission: 0, net: 0, wins: 0, reserve: 0, balance: 0 }
  ), [filteredCalcs]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Calculations</h1>

      <Tabs defaultValue="run">
        <TabsList>
          <TabsTrigger value="run">Run Calculations</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ── RUN TAB ── */}
        <TabsContent value="run" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Select Game &amp; Run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs">Game Event</Label>
                  <Select value={selectedRunGameId} onValueChange={handleRunGameChange}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select a game event…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">— No game selected (enter date manually) —</SelectItem>
                      {gamesYetToRun.map(g => (
                        <SelectItem key={g.id} value={g.id}>
                          <span className="font-mono text-xs text-muted-foreground mr-1.5">{g.eventNumber}</span>
                          {g.name}
                          <span className="ml-2 text-xs text-muted-foreground">· {gameCloseDate(g)}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Calculation Date</Label>
                  <Input
                    type="date"
                    value={runDate}
                    onChange={e => { setRunDate(e.target.value); setSelectedRunGameId("_none"); }}
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              {selectedRunGame && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 flex items-center gap-3">
                  <span className="text-sm font-mono font-bold text-primary bg-primary/10 px-2.5 py-1 rounded shrink-0">
                    {selectedRunGame.eventNumber}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{selectedRunGame.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(selectedRunGame.goLiveAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}
                      {" – "}
                      {new Date(selectedRunGame.closeAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}
                    </p>
                  </div>
                  <StatusBadge status={selectedRunGame.status} />
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <Button
                  onClick={handleRun}
                  disabled={runMutation.isPending || !runDate}
                  className="h-9"
                >
                  {runMutation.isPending ? "Running…" : "Run Calculations"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Running locks all gross and wins entries for the selected date.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Quick summary of what will be processed */}
          {selectedRunGame && (
            <div className="rounded-lg border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Note: </span>
              Calculations will process all gross and wins entries entered for{" "}
              <span className="font-semibold text-foreground">{runDate}</span>. Select a different game
              above to automatically jump to that event's date.
            </div>
          )}
        </TabsContent>

        {/* ── HISTORY TAB ── */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <div className="bg-muted/30 border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Filter by Game Event
              </span>
              {(filterAgentId || historyGameId !== "_all") && (
                <Button
                  size="sm" variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setFilterAgentId(""); setHistoryGameId("_all"); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Game Event</Label>
                <Select value={historyGameId} onValueChange={setHistoryGameId}>
                  <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All games</SelectItem>
                    {gameList.map(g => (
                      <SelectItem key={g.id} value={g.id}>
                        <span className="font-mono text-xs text-muted-foreground mr-1.5">{g.eventNumber}</span>
                        {g.name}
                        <span className="ml-2 text-xs text-muted-foreground">· {gameCloseDate(g)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
                <Select value={filterAgentId || "_all"} onValueChange={v => setFilterAgentId(v === "_all" ? "" : v)}>
                  <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All agents</SelectItem>
                    {agentList.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.user?.fullName ?? a.fullCode} ({a.fullCode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedHistoryGame && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                  {selectedHistoryGame.eventNumber}
                </span>
                <span className="text-sm font-medium">{selectedHistoryGame.name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(selectedHistoryGame.goLiveAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}
                  {" – "}
                  {new Date(selectedHistoryGame.closeAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}
                </span>
                <StatusBadge status={selectedHistoryGame.status} />
              </div>
            )}
          </div>

          {/* Summary cards for the selected game */}
          {selectedHistoryGame && filteredCalcs.length > 0 && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {(
                [
                  ["Gross",      totals.gross,      ""],
                  ["Wins",       totals.wins,        "text-destructive"],
                  ["Commission", totals.commission,  "text-muted-foreground"],
                  ["Net Gross",  totals.net,         ""],
                  ["Reserve",    totals.reserve,     "text-muted-foreground"],
                  ["Balance",    totals.balance,     totals.balance >= 0 ? "text-primary" : "text-destructive"],
                ] as [string, number, string][]
              ).map(([label, val, cls]) => (
                <Card key={label}>
                  <CardHeader className="pb-1 pt-3 px-4">
                    <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <p className={`text-sm font-bold font-mono ${cls}`}>{fmtGHS(val)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

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
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell>
                  </TableRow>
                ) : filteredCalcs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                      {selectedHistoryGame
                        ? `No calculations found for ${selectedHistoryGame.name} (${gameLiveDate(selectedHistoryGame)} – ${gameCloseDate(selectedHistoryGame)}).`
                        : "No calculations found."}
                    </TableCell>
                  </TableRow>
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
                        <TableCell className="text-xs text-muted-foreground" colSpan={2}>
                          Totals — {filteredCalcs.length} rows
                          {selectedHistoryGame && ` · ${selectedHistoryGame.eventNumber}`}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">GH₵ {totals.gross.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">GH₵ {totals.commission.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">GH₵ {totals.net.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-destructive">GH₵ {totals.wins.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">GH₵ {totals.reserve.toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${totals.balance < 0 ? "text-destructive" : "text-primary"}`}>
                          GH₵ {totals.balance.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
