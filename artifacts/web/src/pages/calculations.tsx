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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Calculator, History, Play, AlertCircle, TrendingUp, Trophy, Percent, Wallet, Shield, Coins, Search, Filter, X, RefreshCw
} from "lucide-react";

function fmtGHS(v: number, bold = true) {
  return (
    <span className="font-mono whitespace-nowrap">
      <span className="text-muted-foreground/70 font-normal mr-0.5">GH₵</span>
      <span className={bold ? "font-semibold" : "font-normal"}>{v.toFixed(2)}</span>
    </span>
  );
}

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
  const [winningNumbers, setWinningNumbers] = useState<string[]>(["", "", "", "", ""]);
  const [machineNumbers, setMachineNumbers] = useState<string[]>(["", "", "", "", ""]);

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

  const handleNumberChange = (type: "winning" | "machine", index: number, value: string) => {
    const cleanValue = value.replace(/\D/g, "").slice(0, 2);
    if (cleanValue) {
      const num = parseInt(cleanValue, 10);
      if (num > 90) return;
    }
    if (type === "winning") {
      const copy = [...winningNumbers];
      copy[index] = cleanValue;
      setWinningNumbers(copy);
    } else {
      const copy = [...machineNumbers];
      copy[index] = cleanValue;
      setMachineNumbers(copy);
    }
  };

  const isDrawNumbersValid = useMemo(() => {
    const isValid = (val: string) => {
      const num = parseInt(val, 10);
      return !isNaN(num) && num >= 1 && num <= 90 && /^\d+$/.test(val);
    };
    return winningNumbers.every(isValid) && machineNumbers.every(isValid);
  }, [winningNumbers, machineNumbers]);

  const gamesClosedOnDate = useMemo(() => {
    return gameList.filter(g => gameCloseDate(g) === runDate);
  }, [gameList, runDate]);

  const handleRunGameChange = (id: string) => {
    setSelectedRunGameId(id);
    setWinningNumbers(["", "", "", "", ""]);
    setMachineNumbers(["", "", "", "", ""]);
    if (id !== "_none") {
      const g = gameList.find(g => g.id === id);
      if (g) setRunDate(gameCloseDate(g));
    }
  };

  const handleRun = async () => {
    if (!runDate) return;
    const game = selectedRunGameId !== "_none" ? gameList.find(g => g.id === selectedRunGameId) : null;
    if (!game) {
      toast({ title: "Please select a game event to run calculations", variant: "destructive" });
      return;
    }
    if (!isDrawNumbersValid) {
      toast({ title: "Please enter 5 winning and 5 machine numbers between 1 and 90", variant: "destructive" });
      return;
    }

    const label = `${game.eventNumber} — ${game.name} (${runDate})`;
    if (!confirm(`Run calculations for ${label}?\n\nThis will lock all gross and wins entries for ${runDate}.`)) return;
    try {
      const result = await runMutation.mutateAsync({
        data: {
          date: runDate,
          gameId: game.id,
          winningNumbers: winningNumbers.join(","),
          machineNumbers: machineNumbers.join(","),
        }
      });
      const count = (result as { calculated?: number })?.calculated ?? 0;
      toast({ title: `Calculations complete — ${count} writer${count !== 1 ? "s" : ""} processed` });
      qc.invalidateQueries({ queryKey: getListCalculationsQueryKey({}) });
      setWinningNumbers(["", "", "", "", ""]);
      setMachineNumbers(["", "", "", "", ""]);
      setSelectedRunGameId("_none");
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Calculations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Process daily agent balances, claim payouts, and reserve allocations.
          </p>
        </div>
        <Badge variant="outline" className="border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 font-mono px-3 py-1 font-bold text-xs uppercase tracking-wide">
          Settlement Engine
        </Badge>
      </div>

      <Tabs defaultValue="run" className="space-y-6">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 bg-muted/40 p-1 rounded-xl">
          <TabsTrigger value="run" className="flex items-center gap-2 rounded-lg text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Calculator className="w-4 h-4" />
            Run Calculations
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2 rounded-lg text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <History className="w-4 h-4" />
            History Ledger
          </TabsTrigger>
        </TabsList>

        {/* ── RUN TAB ── */}
        <TabsContent value="run" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 border-border/40 bg-card/60 backdrop-blur-sm shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-semibold">Select Game &amp; Run</CardTitle>
                <CardDescription className="text-xs">
                  Choose a game event from the calendar schedule to load its calculation properties.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                  <div className="sm:col-span-2 space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Game Event</Label>
                    <Select value={selectedRunGameId} onValueChange={handleRunGameChange}>
                      <SelectTrigger className="h-10 text-sm bg-background border-border/50 focus:ring-2 focus:ring-primary/20 rounded-xl">
                        <SelectValue placeholder="Select a game event…" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border/55">
                        <SelectItem value="_none" className="text-xs font-medium text-amber-600 dark:text-amber-400">
                          — Select a game event closed on this date —
                        </SelectItem>
                        {gamesClosedOnDate.map(g => (
                          <SelectItem key={g.id} value={g.id} className="text-xs">
                            <span className="font-mono font-bold text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded mr-2">
                              {g.eventNumber}
                            </span>
                            {g.name}
                            <span className="ml-2 text-[10px] text-muted-foreground font-mono">({gameCloseDate(g)})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Calculation Date</Label>
                    <Input
                      type="date"
                      value={runDate}
                      onChange={e => {
                        setRunDate(e.target.value);
                        setSelectedRunGameId("_none");
                        setWinningNumbers(["", "", "", "", ""]);
                        setMachineNumbers(["", "", "", "", ""]);
                      }}
                      className="h-10 text-sm bg-background border-border/50 focus:ring-2 focus:ring-primary/20 rounded-xl"
                    />
                  </div>
                </div>

                {selectedRunGame && (
                  <div className="space-y-5 border-t border-border/40 pt-5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div>
                      <h4 className="text-xs font-bold text-indigo-950 dark:text-indigo-300 uppercase tracking-wide flex items-center gap-1.5">
                        NLA Declared Draw Entry
                      </h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Please enter the declared winning and machine numbers drawn by the NLA for this event to proceed.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2.5">
                        <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Trophy className="w-3.5 h-3.5 text-amber-500" />
                          Winning Numbers (Top 5)
                        </Label>
                        <div className="flex items-center gap-2">
                          {winningNumbers.map((num, idx) => (
                            <Input
                              key={`winning-${idx}`}
                              type="text"
                              inputMode="numeric"
                              maxLength={2}
                              placeholder={`#${idx + 1}`}
                              value={num}
                              onChange={e => handleNumberChange("winning", idx, e.target.value)}
                              className="h-10 w-12 text-center font-bold text-sm bg-background border-border/50 focus:ring-2 focus:ring-primary/20 focus:border-primary rounded-xl"
                            />
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Calculator className="w-3.5 h-3.5 text-indigo-500" />
                          Machine Numbers (Bottom 5)
                        </Label>
                        <div className="flex items-center gap-2">
                          {machineNumbers.map((num, idx) => (
                            <Input
                              key={`machine-${idx}`}
                              type="text"
                              inputMode="numeric"
                              maxLength={2}
                              placeholder={`#${idx + 1}`}
                              value={num}
                              onChange={e => handleNumberChange("machine", idx, e.target.value)}
                              className="h-10 w-12 text-center font-bold text-sm bg-background border-border/50 focus:ring-2 focus:ring-primary/20 focus:border-primary rounded-xl"
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-4 pt-3 border-t border-border/40">
                  <Button
                    onClick={handleRun}
                    disabled={runMutation.isPending || selectedRunGameId === "_none" || !runDate || !isDrawNumbersValid}
                    className="h-10 rounded-xl px-5 font-semibold text-sm bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-600/90 hover:to-violet-600/90 text-white shadow-md shadow-indigo-200 dark:shadow-none hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {runMutation.isPending ? (
                      <span className="flex items-center gap-1.5">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Running...
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Play className="w-4.5 h-4.5 fill-current" />
                        Run Calculations
                      </span>
                    )}
                  </Button>
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground leading-normal max-w-sm">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p>
                      Running will lock all gross entries and winning submissions entered for <strong className="text-foreground font-mono">{runDate}</strong>.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Selected Game Preview Column */}
            <Card className="border border-indigo-100/50 dark:border-indigo-950/30 bg-indigo-50/10 dark:bg-indigo-950/5 backdrop-blur-md relative overflow-hidden flex flex-col justify-between shadow-sm rounded-xl">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl -mr-6 -mt-6 pointer-events-none" />
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="text-xs font-semibold text-indigo-900/60 dark:text-indigo-300/60 uppercase tracking-wider">Selected Event Preview</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-center py-4">
                {selectedRunGame ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      {selectedRunGame.logoUrl ? (
                        <img src={selectedRunGame.logoUrl} alt={selectedRunGame.name} className="w-12 h-12 object-contain rounded-xl bg-background border p-1 shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm shadow shrink-0">
                          {selectedRunGame.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-600 dark:text-indigo-400 font-mono">
                          Event #{selectedRunGame.eventNumber}
                        </span>
                        <h3 className="font-bold text-sm truncate leading-tight text-foreground">{selectedRunGame.name}</h3>
                      </div>
                    </div>
                    <div className="space-y-2.5 border-t border-border/40 pt-3 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-medium">Goes Live:</span>
                        <span className="font-semibold text-foreground font-mono">{new Date(selectedRunGame.goLiveAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-medium">Closes At:</span>
                        <span className="font-semibold text-foreground font-mono">{new Date(selectedRunGame.closeAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}</span>
                      </div>
                      <div className="flex justify-between items-center border-t border-border/40 pt-2.5 mt-2">
                        <span className="text-muted-foreground font-medium">Status:</span>
                        <StatusBadge status={selectedRunGame.status} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground space-y-2.5">
                    <Calculator className="w-8 h-8 mx-auto text-muted-foreground/30 animate-pulse" />
                    <p className="text-xs max-w-[200px] mx-auto leading-relaxed">
                      Select a scheduled game event from the dropdown to preview event parameters.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick summary of what will be processed */}
          {selectedRunGame && (
            <div className="rounded-xl border border-border/40 bg-muted/20 px-4 py-3.5 text-xs text-muted-foreground flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
              <span>
                Calculations will process all gross and wins entries entered for <span className="font-semibold text-foreground font-mono">{runDate}</span>. Select a different game above to automatically jump to that event's date.
              </span>
            </div>
          )}
        </TabsContent>

        {/* ── HISTORY TAB ── */}
        <TabsContent value="history" className="mt-4 space-y-6">
          <Card className="border-border/40 bg-card/60 backdrop-blur-sm shadow-sm rounded-xl">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm font-semibold">Ledger History Filters</CardTitle>
                <CardDescription className="text-[11px]">Filter game calculation archives by specific event schedules or agent targets.</CardDescription>
              </div>
              {(filterAgentId || historyGameId !== "_all") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20 rounded-xl"
                  onClick={() => { setFilterAgentId(""); setHistoryGameId("_all"); }}
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Clear filters
                </Button>
              )}
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5" />
                    Game Event
                  </Label>
                  <Select value={historyGameId} onValueChange={setHistoryGameId}>
                    <SelectTrigger className="h-9 text-sm bg-background border-border/50 rounded-xl">
                      <SelectValue placeholder="All game events" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border/55">
                      <SelectItem value="_all" className="text-xs">All games</SelectItem>
                      {gameList.map(g => (
                        <SelectItem key={g.id} value={g.id} className="text-xs">
                          <span className="font-mono font-bold text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-1 py-0.5 rounded mr-1.5">
                            {g.eventNumber}
                          </span>
                          {g.name}
                          <span className="ml-2 text-[10px] text-muted-foreground font-mono">({gameCloseDate(g)})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5" />
                    Agent Owner
                  </Label>
                  <Select value={filterAgentId || "_all"} onValueChange={v => setFilterAgentId(v === "_all" ? "" : v)}>
                    <SelectTrigger className="h-9 text-sm bg-background border-border/50 rounded-xl">
                      <SelectValue placeholder="All agents" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border/55">
                      <SelectItem value="_all" className="text-xs">All agents</SelectItem>
                      {agentList.map(a => (
                        <SelectItem key={a.id} value={a.id} className="text-xs">
                          {a.user?.fullName ?? a.fullCode} <span className="font-mono text-[10px] text-muted-foreground ml-1">({a.fullCode})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedHistoryGame && (
                <div className="mt-4 flex items-center gap-2 flex-wrap border-t border-border/40 pt-3 text-xs">
                  <Badge variant="outline" className="font-mono font-bold bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400">
                    {selectedHistoryGame.eventNumber}
                  </Badge>
                  <span className="font-semibold text-foreground">{selectedHistoryGame.name}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    {new Date(selectedHistoryGame.goLiveAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}
                    {" – "}
                    {new Date(selectedHistoryGame.closeAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <StatusBadge status={selectedHistoryGame.status} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary cards for the selected game */}
          {selectedHistoryGame && filteredCalcs.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {(
                [
                  ["Gross Sales", totals.gross, <TrendingUp className="w-3.5 h-3.5" />, "text-blue-600 dark:text-blue-400", "bg-blue-50/20 dark:bg-blue-950/10 border-blue-100/50 dark:border-blue-900/30", "Gross sales revenue"],
                  ["Commission", totals.commission, <Percent className="w-3.5 h-3.5" />, "text-amber-600 dark:text-amber-400", "bg-amber-50/20 dark:bg-amber-950/10 border-amber-100/50 dark:border-amber-900/30", "Less commission paid (-)"],
                  ["Net Gross", totals.net, <Wallet className="w-3.5 h-3.5" />, "text-indigo-600 dark:text-indigo-400", "bg-indigo-50/20 dark:bg-indigo-950/10 border-indigo-100/50 dark:border-indigo-900/30", "Net before reserves (=)"],
                  ["Reserve Fund", totals.reserve, <Shield className="w-3.5 h-3.5" />, "text-purple-600 dark:text-purple-400", "bg-purple-50/20 dark:bg-purple-950/10 border-purple-100/50 dark:border-purple-900/30", "Less reserve allocation (-)"],
                  ["Claims Wins", totals.wins, <Trophy className="w-3.5 h-3.5" />, "text-rose-600 dark:text-rose-400", "bg-rose-50/20 dark:bg-rose-950/10 border-rose-100/50 dark:border-rose-900/30", "Less claimed wins (-)"],
                  ["Net Profit", totals.balance, <Coins className="w-3.5 h-3.5" />, totals.balance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400", totals.balance >= 0 ? "bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-100/50 dark:border-emerald-900/30" : "bg-rose-50/20 dark:bg-rose-950/10 border-rose-100/50 dark:border-rose-900/30", totals.balance >= 0 ? "Settlement surplus (=)" : "Settlement deficit (=)"],
                ] as [string, number, React.ReactNode, string, string, string][]
              ).map(([label, val, icon, color, bg, math]) => (
                <Card key={label} className={`border ${bg} shadow-sm overflow-hidden relative group hover:shadow transition-shadow rounded-xl`}>
                  <CardHeader className="pb-1 pt-3 px-3 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
                    <span className={`${color} p-1 rounded-lg bg-background/50 border border-border/20`}>{icon}</span>
                  </CardHeader>
                  <CardContent className="px-3 pb-2.5">
                    <div className={`text-base font-bold`}>{fmtGHS(val)}</div>
                    <p className="text-[9px] text-muted-foreground mt-0.5 font-medium italic">{math}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card className="border border-border/40 shadow-sm rounded-xl overflow-hidden bg-card/65 backdrop-blur-sm">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Date</TableHead>
                    <TableHead className="text-xs font-semibold">Writer</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Gross</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Commission</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Net Gross</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Wins</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Reserve</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-muted-foreground/50" />
                        Loading ledger history...
                      </TableCell>
                    </TableRow>
                  ) : filteredCalcs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
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
                          <TableRow key={c.id} className="hover:bg-muted/20 border-b border-border/40 transition-colors">
                            <TableCell className="text-xs font-mono text-muted-foreground">{c.calcDate?.split("T")[0]}</TableCell>
                            <TableCell className="text-xs">
                              <span className="font-mono bg-muted/45 px-1.5 py-0.5 rounded text-foreground font-semibold border border-border/30">
                                {writer?.fullCode ?? c.writerId.slice(0, 8) + "…"}
                              </span>
                              {writer && <span className="text-muted-foreground/80 ml-1.5 text-xs font-medium">{writer.fullName}</span>}
                            </TableCell>
                            <TableCell className="text-sm text-right font-mono">{fmtGHS(Number(c.grossSales), false)}</TableCell>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmtGHS(Number(c.commissionAmount), false)}</TableCell>
                            <TableCell className="text-sm text-right font-mono">{fmtGHS(Number(c.netGross), false)}</TableCell>
                            <TableCell className="text-sm text-right font-mono text-destructive">{fmtGHS(Number(c.winsAmount), false)}</TableCell>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmtGHS(Number(c.reserveAmount), false)}</TableCell>
                            <TableCell className="text-sm text-right font-mono">
                              <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${Number(c.writerBalance) < 0 ? "bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-100/50" : "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100/50"}`}>
                                {fmtGHS(Number(c.writerBalance), true)}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredCalcs.length > 1 && (
                        <TableRow className="bg-muted/30 font-semibold border-t border-border">
                          <TableCell className="text-xs text-muted-foreground" colSpan={2}>
                            Totals — {filteredCalcs.length} rows
                            {selectedHistoryGame && ` · ${selectedHistoryGame.eventNumber}`}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmtGHS(totals.gross, true)}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmtGHS(totals.commission, false)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmtGHS(totals.net, true)}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-destructive">{fmtGHS(totals.wins, true)}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmtGHS(totals.reserve, false)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            <span className={`px-2 py-1 rounded-lg text-xs font-bold ${totals.balance < 0 ? "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400" : "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"}`}>
                              {fmtGHS(totals.balance, true)}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
