import { useState, useMemo } from "react";
import { getServerNow } from "../lib/time-sync";
import {
  useListSales, useCreateSale, useListWriters,
  useGetMyAgent, getGetMyAgentQueryKey,
  getListSalesQueryKey, getListWritersQueryKey,
  useListGrossEntries, useListWinsEntries,
  useGetSettings, useListGames,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { fmtGHS } from "@/lib/utils";

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function relDate(s: string) {
  const today = new Date(getServerNow()).toISOString().split("T")[0];
  const yesterday = new Date(getServerNow().getTime() - 86400000).toISOString().split("T")[0];
  const d = s.split("T")[0];
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function AgentSalesView() {
  const qc = useQueryClient();
  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState("_all");

  const { data: myAgent } = useGetMyAgent({ query: { queryKey: getGetMyAgentQueryKey() } });
  const { data: allWriters } = useListWriters(myAgent?.id ?? "", {}, {
    query: { queryKey: getListWritersQueryKey(myAgent?.id ?? "", {}), enabled: !!myAgent?.id }
  });
  const agentWriters = Array.isArray(allWriters) ? allWriters : [];

  const { data: sales, isLoading } = useListSales({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });
  const salesList = Array.isArray(sales) ? sales : [];

  const { data: games } = useListGames();
  const gameList = useMemo(() => {
    const g = Array.isArray(games) ? games : [];
    return [...g].sort((a, b) => b.eventNumber.localeCompare(a.eventNumber));
  }, [games]);

  const { liveGames, otherGames } = useMemo(() => {
    const live = gameList.filter(x => x.status === "live");
    const other = gameList.filter(x => x.status !== "live");
    return { liveGames: live, otherGames: other };
  }, [gameList]);

  const displayGame = useMemo(() => {
    if (!selectedGameId || selectedGameId === "_all") return null;
    return gameList.find(g => g.id === selectedGameId) ?? null;
  }, [selectedGameId, gameList]);

  const createMutation = useCreateSale();
  const today = useMemo(() => new Date(getServerNow()).toISOString().split("T")[0], []);
  const [form, setForm] = useState({ writerId: "", gameType: "", ticketAmount: "", saleDate: today });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, gameType: form.gameType, ticketAmount: form.ticketAmount, saleDate: form.saleDate } });
      toast.success("Sale logged successfully");
      setOpen(false);
      setForm({ writerId: "", gameType: "", ticketAmount: "", saleDate: today });
      qc.invalidateQueries({ queryKey: ["/api/sales"] });
    } catch {
      toast.error("Failed to log sale");
    }
  };

  const hasFilter = !!(filterWriterId || filterFrom || filterTo);
  const clearFilter = () => { setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); };

  const todaySales = salesList.filter(s => s.saleDate?.startsWith(today));
  const totalAmount = salesList.reduce((s, sale) => s + Number(sale.ticketAmount ?? 0), 0);

  const { data: settings } = useGetSettings();
  const commPct = Number(settings?.commissionPct ?? 0);
  const resvPct = Number(settings?.reservePct ?? 0);

  const entriesParams = useMemo(() => {
    if (displayGame) {
      return {
        writerId: filterWriterId || undefined,
        dateFrom: displayGame.goLiveAt.split("T")[0],
        dateTo: displayGame.closeAt.split("T")[0],
        gameId: displayGame.id,
      };
    }
    return {
      writerId: filterWriterId || undefined,
      dateFrom: filterFrom || today,
      dateTo: filterTo || today,
    };
  }, [displayGame, filterWriterId, filterFrom, filterTo, today]);

  const { data: grossEntries } = useListGrossEntries(entriesParams);
  const { data: winsEntries } = useListWinsEntries(entriesParams);

  const grossList = Array.isArray(grossEntries) ? grossEntries : [];
  const winsList = Array.isArray(winsEntries) ? winsEntries : [];

  const filteredGrossList = useMemo(() => {
    if (!displayGame) return grossList;
    return grossList.filter(e => e.gameId === displayGame.id);
  }, [grossList, displayGame]);

  const filteredWinsList = useMemo(() => {
    if (!displayGame) return winsList;
    return winsList.filter(e => e.gameId === displayGame.id);
  }, [winsList, displayGame]);

  const grossSum = useMemo(() => {
    return filteredGrossList.reduce((s, e) => s + Number(e.grossAmount ?? 0), 0);
  }, [filteredGrossList]);

  const winsSum = useMemo(() => {
    return filteredWinsList.reduce((s, e) => s + Number(e.winsAmount ?? 0), 0);
  }, [filteredWinsList]);

  const commissionSum = useMemo(() => {
    return grossSum * commPct;
  }, [grossSum, commPct]);

  const netGrossSum = useMemo(() => {
    return grossSum - commissionSum;
  }, [grossSum, commissionSum]);

  const reserveSum = useMemo(() => {
    return netGrossSum * resvPct;
  }, [netGrossSum, resvPct]);

  const balanceSum = useMemo(() => {
    return netGrossSum - winsSum - reserveSum;
  }, [netGrossSum, winsSum, reserveSum]);

  const submittedWritersCount = useMemo(() => {
    return new Set(filteredGrossList.map(e => e.writerId)).size;
  }, [filteredGrossList]);

  const totalWritersCount = useMemo(() => {
    return agentWriters.filter(w => w.isActive).length;
  }, [agentWriters]);

  const submitPercentage = totalWritersCount > 0 ? (submittedWritersCount / totalWritersCount) * 100 : 0;

  return (
    <div className="pb-6 relative min-h-screen">
      {/* Background radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-64 bg-gradient-to-b from-blue-500/5 via-transparent to-transparent blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="sticky top-0 bg-background/80 backdrop-blur-md border-b border-border/40 z-20 px-4 py-3.5">
        <div className="flex items-center gap-3 max-w-xl mx-auto md:max-w-2xl">
          <div className="flex-1">
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">Sales Log</h1>
            <p className="text-xs text-muted-foreground mt-0.5 font-medium">{salesList.length} records · <span className="font-semibold text-primary font-mono">{fmtGHS(totalAmount)}</span></p>
          </div>
          <button
            onClick={() => setShowFilter(f => !f)}
            className={`p-2.5 rounded-xl transition-all duration-200 active:scale-95 border ${
              showFilter || hasFilter 
                ? "bg-primary text-primary-foreground border-primary" 
                : "bg-background border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <FilterIcon />
          </button>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold active:scale-95 transition-all shadow-md shadow-blue-500/10 border border-blue-500/15"
          >
            <PlusIcon /> Log Sale
          </button>
        </div>
      </div>

      <div className="px-4 max-w-xl mx-auto md:max-w-2xl">
        {/* Filter panel */}
        {showFilter && (
          <div className="mt-4 bg-card/45 backdrop-blur-md border border-border/50 shadow-sm rounded-3xl p-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">Writer</Label>
              <Select value={filterWriterId || "_all"} onValueChange={v => setFilterWriterId(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20"><SelectValue placeholder="All Writers" /></SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 bg-card/95 backdrop-blur-md">
                  <SelectItem value="_all" className="rounded-lg">All writers</SelectItem>
                  {agentWriters.map(w => <SelectItem key={w.id} value={w.id} className="rounded-lg">{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">From</Label>
                <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">To</Label>
                <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            {hasFilter && (
              <button onClick={clearFilter} className="text-xs text-primary font-semibold hover:underline active:opacity-70 transition-opacity">
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Today summary strip */}
        {!hasFilter && (
          <div className="mt-4 flex items-center justify-between bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/10 rounded-2xl px-4 py-3 shadow-inner">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <div>
                <span className="text-[10px] font-bold text-blue-700/80 dark:text-blue-400/80 uppercase tracking-wider block">Today's Sales count</span>
                <span className="text-sm font-bold text-foreground">{todaySales.length} ticket{todaySales.length !== 1 ? "s" : ""} logged</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-blue-700/80 dark:text-blue-400/80 uppercase tracking-wider block">Total Amount</span>
              <span className="text-sm font-extrabold text-blue-600 dark:text-blue-400 font-mono tabular-nums">
                {fmtGHS(todaySales.reduce((s, sale) => s + Number(sale.ticketAmount ?? 0), 0))}
              </span>
            </div>
          </div>
        )}

        {/* Real-time Transaction Summary Card */}
        <div className="mt-4 bg-gradient-to-br from-card/75 to-card/45 backdrop-blur-md border border-border/50 hover:border-primary/20 hover:shadow-md transition-all duration-300 rounded-3xl overflow-hidden shadow-sm">
          <div className="bg-muted/30 border-b border-border/40 px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="text-primary w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2" />
              </svg>
              <div>
                <h2 className="text-sm font-extrabold text-foreground">Real-time Transaction Summary</h2>
                <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">
                  {displayGame
                    ? `${displayGame.name} (Live: ${displayGame.goLiveAt.split("T")[0]} to Close: ${displayGame.closeAt.split("T")[0]})`
                    : filterFrom || filterTo
                    ? `${filterFrom || "Start"} to ${filterTo || "End"}`
                    : "Today's Live Progress"}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              LIVE
            </span>
          </div>

          {gameList.length > 0 && (
            <div className="px-5 py-3 border-b border-border/45 bg-muted/5 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Game Event</span>
              <Select value={selectedGameId} onValueChange={setSelectedGameId}>
                <SelectTrigger className="h-8 text-xs w-48 bg-background border-border/50 rounded-lg">
                  <SelectValue placeholder="All Games" />
                </SelectTrigger>
                <SelectContent className="rounded-lg border-border/50 max-h-[300px] overflow-y-auto">
                  <SelectItem value="_all" className="text-xs font-semibold">All Games (Combined)</SelectItem>
                  
                  {liveGames.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest px-2 py-1 bg-emerald-500/5 dark:bg-emerald-500/10 rounded my-1 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                        Running / Live Games
                      </SelectLabel>
                      {liveGames.map(g => (
                        <SelectItem key={g.id} value={g.id} className="text-xs pl-3">
                          🟢 {g.name} <span className="font-mono text-[9px] text-muted-foreground">({g.eventNumber})</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {otherGames.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest px-2 py-1 bg-muted/50 rounded my-1">
                        Closed / Offline Games
                      </SelectLabel>
                      {otherGames.map(g => (
                        <SelectItem key={g.id} value={g.id} className="text-xs pl-3">
                          ⚫ {g.name} <span className="font-mono text-[9px] text-muted-foreground">({g.eventNumber})</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="px-5 py-5 grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-4">
            {[
              {
                label: "Gross Sales",
                value: grossSum,
                isBalance: false,
                icon: (
                  <svg className="w-3.5 h-3.5 text-muted-foreground/60 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
                  </svg>
                )
              },
              {
                label: "Net Gross",
                value: netGrossSum,
                isBalance: false,
                icon: (
                  <svg className="w-3.5 h-3.5 text-muted-foreground/60 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="4" width="20" height="16" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
                  </svg>
                )
              },
              {
                label: "Commission",
                value: commissionSum,
                isBalance: false,
                icon: (
                  <svg className="w-3.5 h-3.5 text-muted-foreground/60 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M8 12h8" />
                  </svg>
                )
              },
              {
                label: "Wins Claimed",
                value: winsSum,
                isBalance: false,
                icon: (
                  <svg className="w-3.5 h-3.5 text-muted-foreground/60 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                  </svg>
                )
              },
              {
                label: "Reserve Pool",
                value: reserveSum,
                isBalance: false,
                icon: (
                  <svg className="w-3.5 h-3.5 text-muted-foreground/60 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                )
              },
              {
                label: "Current Balance",
                value: balanceSum,
                isBalance: true,
                icon: (
                  <svg className="w-3.5 h-3.5 text-primary/60 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                )
              },
            ].map(({ label, value, isBalance, icon }) => (
              <div key={label} className="flex flex-col">
                <div className="flex items-center text-[9px] uppercase tracking-wider font-extrabold text-muted-foreground/80">
                  {icon}
                  {label}
                </div>
                <span className={`text-sm font-bold font-mono mt-0.5 ${
                  isBalance && value < 0 ? "text-rose-600 dark:text-rose-400"
                  : isBalance ? "text-primary"
                  : "text-foreground"
                }`}>
                  {fmtGHS(value)}
                </span>
              </div>
            ))}
          </div>

          {/* Writer Submissions Progress Bar */}
          <div className="px-5 pb-4 space-y-1.5 bg-muted/10 border-t border-border/40 pt-3">
            <div className="flex justify-between text-xs font-semibold text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Writer Submissions
              </span>
              <span className="font-mono text-foreground font-bold">{submittedWritersCount}/{totalWritersCount}</span>
            </div>
            <div className="w-full bg-muted/65 dark:bg-muted/20 h-1.5 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  submitPercentage === 100 ? "bg-emerald-500" : "bg-primary animate-pulse"
                }`}
                style={{ width: `${submitPercentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Sale cards list */}
        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Transaction Records</span>
            {salesList.length > 0 && <span className="text-[10px] text-muted-foreground font-semibold">{salesList.length} total logged logs</span>}
          </div>

          {isLoading ? (
            [1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)
          ) : salesList.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground bg-card/30 border border-border/40 rounded-3xl p-6">
              <div className="text-4xl mb-3">🧾</div>
              <div className="font-bold text-sm text-foreground">No sales records logged</div>
              <div className="text-xs mt-1 text-muted-foreground">Tap Log Sale above to record your first ticket entry</div>
            </div>
          ) : salesList.map(s => {
            const writer = agentWriters.find(w => w.id === s.writerId);
            return (
              <div key={s.id} className="bg-card/60 backdrop-blur-sm border border-border/40 hover:border-blue-500/20 hover:shadow-md transition-all duration-300 rounded-2xl px-4 py-4 flex items-center justify-between animate-fade-in">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
                      <rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 7h6M9 11h6M9 15h4" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] px-2 py-0.5 bg-muted rounded font-bold font-mono text-muted-foreground">
                        {writer?.fullCode ?? s.writerId.slice(0, 8)}
                      </span>
                      {writer && <span className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{writer.fullName}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 rounded-md">
                        {s.gameType || "—"}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">·</span>
                      <span className="text-xs text-muted-foreground font-medium">{relDate(s.saleDate ?? "")}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <span className="text-sm font-extrabold font-mono text-foreground tabular-nums">
                    {fmtGHS(Number(s.ticketAmount ?? 0))}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Log Sale Dialog */}
      <Dialog open={open} onOpenChange={o => { if (!o) setForm({ writerId: "", gameType: "", ticketAmount: "", saleDate: today }); setOpen(o); }}>
        <DialogContent className="max-w-md mx-4 rounded-3xl border border-border/50 bg-card/95 backdrop-blur-md shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-extrabold text-lg">
              <svg className="text-blue-500 w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Log Ticket Sale
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Writer *</Label>
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))}>
                <SelectTrigger className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20"><SelectValue placeholder="Select writer…" /></SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 bg-card/95 backdrop-blur-md">
                  {agentWriters.map(w => <SelectItem key={w.id} value={w.id} className="rounded-lg">{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Game Type *</Label>
              <Input value={form.gameType} onChange={e => setForm(f => ({ ...f, gameType: e.target.value }))} required className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" placeholder="e.g. Pick 3, Fortune Draw" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount (GH₵) *</Label>
              <Input type="number" step="0.01" min="0" value={form.ticketAmount} onChange={e => setForm(f => ({ ...f, ticketAmount: e.target.value }))} required className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" placeholder="0.00" inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date *</Label>
              <Input type="date" value={form.saleDate} onChange={e => setForm(f => ({ ...f, saleDate: e.target.value }))} required className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" />
            </div>
            <DialogFooter className="gap-3 pt-3">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl font-semibold border-border" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1 h-11 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/10" disabled={createMutation.isPending || !form.writerId}>
                {createMutation.isPending ? "Logging…" : "Log Sale"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminSalesView() {
  const qc = useQueryClient();
  const { writerMap, agentList, allWriters } = useWriterLookup();

  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showFilter, setShowFilter] = useState(false);

  const { data: filterWriters } = useListWriters(filterAgentId, {}, {
    query: { queryKey: getListWritersQueryKey(filterAgentId, {}), enabled: !!filterAgentId }
  });
  const filterWriterList = Array.isArray(filterWriters) ? filterWriters : [];

  const { data: sales, isLoading } = useListSales({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });
  const salesList = Array.isArray(sales) ? sales : [];

  const [selectedAgent, setSelectedAgent] = useState("");
  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent }
  });
  const writerList = Array.isArray(writers) ? writers : [];

  const createMutation = useCreateSale();
  const today = useMemo(() => new Date(getServerNow()).toISOString().split("T")[0], []);
  const [form, setForm] = useState({ writerId: "", gameType: "", ticketAmount: "", saleDate: today });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, gameType: form.gameType, ticketAmount: form.ticketAmount, saleDate: form.saleDate } });
      toast.success("Sale logged successfully");
      setOpen(false);
      setForm({ writerId: "", gameType: "", ticketAmount: "", saleDate: today });
      qc.invalidateQueries({ queryKey: ["/api/sales"] });
    } catch {
      toast.error("Failed to log sale");
    }
  };

  const hasFilter = !!(filterAgentId || filterWriterId || filterFrom || filterTo);
  const clearFilter = () => { setFilterAgentId(""); setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); };

  const totalAmount = salesList.reduce((s, sale) => s + Number(sale.ticketAmount ?? 0), 0);
  const uniqueWriters = new Set(salesList.map(s => s.writerId)).size;

  const [open, setOpen] = useState(false);

  return (
    <div className="pb-8 relative min-h-screen">
      {/* Background radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-64 bg-gradient-to-b from-blue-500/5 via-transparent to-transparent blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="sticky top-0 bg-background/80 backdrop-blur-md border-b border-border/40 z-20 px-4 py-3.5">
        <div className="flex items-center gap-3 max-w-xl mx-auto md:max-w-4xl">
          <div className="flex-1">
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">Sales Log (Admin)</h1>
            <p className="text-xs text-muted-foreground mt-0.5 font-medium">{salesList.length} records · <span className="font-semibold text-primary font-mono">{fmtGHS(totalAmount)}</span></p>
          </div>
          <button
            onClick={() => setShowFilter(f => !f)}
            className={`p-2.5 rounded-xl transition-all duration-200 active:scale-95 border ${
              showFilter || hasFilter 
                ? "bg-primary text-primary-foreground border-primary" 
                : "bg-background border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <FilterIcon />
          </button>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold active:scale-95 transition-all shadow-md shadow-blue-500/10 border border-blue-500/15"
          >
            <PlusIcon /> Log Sale
          </button>
        </div>
      </div>

      <div className="px-4 max-w-xl mx-auto md:max-w-4xl">
        {/* Filter panel */}
        {showFilter && (
          <div className="mt-4 bg-card/45 backdrop-blur-md border border-border/50 shadow-sm rounded-3xl p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">Agent</Label>
                <Select value={filterAgentId || "_all"} onValueChange={v => { setFilterAgentId(v === "_all" ? "" : v); setFilterWriterId(""); }}>
                  <SelectTrigger className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20"><SelectValue placeholder="All Agents" /></SelectTrigger>
                  <SelectContent className="rounded-xl border-border/50 bg-card/95 backdrop-blur-md">
                    <SelectItem value="_all" className="rounded-lg">All agents</SelectItem>
                    {agentList.map(a => <SelectItem key={a.id} value={a.id} className="rounded-lg">{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">Writer</Label>
                <Select value={filterWriterId || "_all"} onValueChange={v => setFilterWriterId(v === "_all" ? "" : v)} disabled={!filterAgentId}>
                  <SelectTrigger className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20"><SelectValue placeholder="All Writers" /></SelectTrigger>
                  <SelectContent className="rounded-xl border-border/50 bg-card/95 backdrop-blur-md">
                    <SelectItem value="_all" className="rounded-lg">All writers</SelectItem>
                    {filterWriterList.map(w => <SelectItem key={w.id} value={w.id} className="rounded-lg">{w.fullCode} — {w.fullName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">From</Label>
                <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">To</Label>
                <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>

            {hasFilter && (
              <button onClick={clearFilter} className="text-xs text-primary font-semibold hover:underline active:opacity-70 transition-opacity">
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Stats Grid */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 animate-fade-in">
          <div className="bg-gradient-to-br from-card/75 to-card/45 backdrop-blur-md border border-border/50 rounded-2xl p-5 shadow-sm flex items-center gap-4 hover:border-blue-500/20 transition-all duration-300">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
                <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Total Sales</span>
              <span className="text-xl font-extrabold text-foreground font-mono tabular-nums">{fmtGHS(totalAmount)}</span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-card/75 to-card/45 backdrop-blur-md border border-border/50 rounded-2xl p-5 shadow-sm flex items-center gap-4 hover:border-indigo-500/20 transition-all duration-300">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Ticket Count</span>
              <span className="text-xl font-extrabold text-foreground font-mono tabular-nums">{salesList.length} logged</span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-card/75 to-card/45 backdrop-blur-md border border-border/50 rounded-2xl p-5 shadow-sm flex items-center gap-4 hover:border-purple-500/20 transition-all duration-300">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Unique Writers</span>
              <span className="text-xl font-extrabold text-foreground font-mono tabular-nums">{uniqueWriters} writers</span>
            </div>
          </div>
        </div>

        {/* Transaction Records */}
        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Transaction Records</span>
            {salesList.length > 0 && <span className="text-[10px] text-muted-foreground font-semibold">{salesList.length} total logs</span>}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
            </div>
          ) : salesList.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground bg-card/30 border border-border/40 rounded-3xl p-6">
              <div className="text-4xl mb-3">🧾</div>
              <div className="font-bold text-sm text-foreground">No sales records logged</div>
              <div className="text-xs mt-1 text-muted-foreground">Tap Log Sale above to record a ticket entry</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {salesList.map(s => {
                const writer = writerMap[s.writerId];
                const writerObj = allWriters.find(w => w.id === s.writerId);
                const agent = writerObj ? agentList.find(a => a.id === writerObj.agentId) : null;
                return (
                  <div key={s.id} className="bg-card/60 backdrop-blur-sm border border-border/40 hover:border-blue-500/20 hover:shadow-md transition-all duration-300 rounded-2xl p-4 flex items-center justify-between animate-fade-in">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
                          <rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 7h6M9 11h6M9 15h4" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] px-2 py-0.5 bg-muted rounded font-bold font-mono text-muted-foreground">
                            {writer?.fullCode ?? s.writerId.slice(0, 8)}
                          </span>
                          {writer && <span className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{writer.fullName}</span>}
                        </div>
                        {agent && (
                          <span className="text-[10px] text-muted-foreground mt-0.5 block font-medium">
                            Agent: <span className="font-semibold text-foreground">{agent.user?.fullName ?? agent.fullCode}</span>
                          </span>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 rounded-md">
                            {s.gameType || "—"}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">·</span>
                          <span className="text-xs text-muted-foreground font-medium">{relDate(s.saleDate ?? "")}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <span className="text-sm font-extrabold font-mono text-foreground tabular-nums">
                        {fmtGHS(Number(s.ticketAmount ?? 0))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Log Sale Dialog */}
      <Dialog open={open} onOpenChange={o => { if (!o) { setSelectedAgent(""); setForm({ writerId: "", gameType: "", ticketAmount: "", saleDate: today }); } setOpen(o); }}>
        <DialogContent className="max-w-md mx-4 rounded-3xl border border-border/50 bg-card/95 backdrop-blur-md shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-extrabold text-lg">
              <svg className="text-blue-500 w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Log Ticket Sale
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent *</Label>
              <Select value={selectedAgent} onValueChange={v => { setSelectedAgent(v); setForm(f => ({ ...f, writerId: "" })); }}>
                <SelectTrigger className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20"><SelectValue placeholder="Select agent..." /></SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 bg-card/95 backdrop-blur-md">
                  {agentList.map(a => <SelectItem key={a.id} value={a.id} className="rounded-lg">{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Writer *</Label>
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))} disabled={!selectedAgent}>
                <SelectTrigger className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20"><SelectValue placeholder="Select writer…" /></SelectTrigger>
                <SelectContent className="rounded-xl border-border/50 bg-card/95 backdrop-blur-md">
                  {writerList.map(w => <SelectItem key={w.id} value={w.id} className="rounded-lg">{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Game Type *</Label>
              <Input value={form.gameType} onChange={e => setForm(f => ({ ...f, gameType: e.target.value }))} required className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" placeholder="e.g. Pick 3, Fortune Draw" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount (GH₵) *</Label>
              <Input type="number" step="0.01" min="0" value={form.ticketAmount} onChange={e => setForm(f => ({ ...f, ticketAmount: e.target.value }))} required className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" placeholder="0.00" inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date *</Label>
              <Input type="date" value={form.saleDate} onChange={e => setForm(f => ({ ...f, saleDate: e.target.value }))} required className="h-11 text-sm bg-background border-border/60 rounded-xl focus:ring-2 focus:ring-primary/20" />
            </div>
            <DialogFooter className="gap-3 pt-3">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl font-semibold border-border" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1 h-11 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/10" disabled={createMutation.isPending || !form.writerId}>
                {createMutation.isPending ? "Logging…" : "Log Sale"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Sales() {
  const { user } = useAuth();
  if (user?.role === "agent") return <AgentSalesView />;
  return <AdminSalesView />;
}
