import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { AgentDashboard } from "@/pages/agent-dashboard";
import {
  useListAgents, useGetReserveBalance, useGetUnreadCount,
  useListCalculations, useListPayments, useListGrossEntries,
  useListWinsEntries, useListSales, useListGames, useListTimeWindows,
  getGetUnreadCountQueryKey, getListCalculationsQueryKey,
  getListGrossEntriesQueryKey, getListWinsEntriesQueryKey,
  getListPaymentsQueryKey, getGetReserveBalanceQueryKey,
  getListTimeWindowsQueryKey,
  useGetSettings, getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import type { TimeWindow } from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtGHS } from "@/lib/utils";

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const PAGE_SIZE_GRID = 6;
const PAGE_SIZE_LIST = 10;

const AVATAR_COLORS = [
  "bg-blue-600","bg-emerald-600","bg-violet-600","bg-orange-500","bg-pink-600","bg-teal-600","bg-cyan-600","bg-rose-600",
];

function AgentAvatar({ name, picture, size = "lg" }: { name: string; picture?: string | null; size?: "sm" | "lg" }) {
  const initials = name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  const sz = size === "lg" ? "w-16 h-16 text-xl" : "w-9 h-9 text-sm";

  if (picture) {
    return (
      <img
        src={picture}
        alt={name}
        className={`${sz} rounded-full object-cover ring-2 ring-border flex-shrink-0`}
        onError={e => {
          const el = e.currentTarget;
          el.style.display = "none";
          const sib = el.nextElementSibling as HTMLElement | null;
          if (sib) sib.style.display = "flex";
        }}
      />
    );
  }
  return (
    <div className={`${sz} rounded-full ${color} flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {initials || "?"}
    </div>
  );
}

function StatCard({ label, value, accent, pending }: { label: string; value: string | number; accent?: boolean; pending?: boolean }) {
  return (
    <Card className={pending ? "border-amber-200 bg-amber-50/30" : ""}>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className={`text-xs font-medium uppercase tracking-wide flex items-center gap-1.5 ${pending ? "text-amber-700/80" : "text-muted-foreground"}`}>
          {label}
          {pending && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block flex-shrink-0" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className={`text-xl font-bold ${accent ? "text-primary" : pending ? "text-amber-800" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-primary" : "text-muted-foreground"}>
      <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
      <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
      <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
    </svg>
  );
}

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-primary" : "text-muted-foreground"}>
      <rect x="1" y="2" width="14" height="2.5" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
      <rect x="1" y="6.75" width="14" height="2.5" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
      <rect x="1" y="11.5" width="14" height="2.5" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
    </svg>
  );
}

type AgentStat = {
  agent: { id: string; agentCode: string; fullCode: string; isActive: boolean; user: { fullName: string; profilePicture?: string | null } };
  gross: number; commission: number; net: number; wins: number; reserve: number; balance: number;
  submittedWriters: number; totalWriters: number; hasPaid: boolean;
  isPending: boolean;
};

function AgentGridCard({ stat, onClick }: { stat: AgentStat; onClick: () => void }) {
  const { agent, gross, commission, net, wins, reserve, balance, submittedWriters, totalWriters, hasPaid, isPending } = stat;
  const name = agent.user.fullName;
  return (
    <Card
      className="cursor-pointer hover:shadow-lg hover:border-primary/40 transition-all duration-200 overflow-hidden"
      onClick={onClick}
    >
      <CardContent className="p-0">
        {/* Header strip */}
        <div className="bg-muted/40 border-b px-5 pt-5 pb-4 flex items-start gap-4">
          <div className="relative">
            <AgentAvatar name={name} picture={agent.user.profilePicture} size="lg" />
            {agent.user.profilePicture && (
              <div
                style={{ display: "none" }}
                className={`w-16 h-16 rounded-full ${AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]} flex items-center justify-center text-white font-bold text-xl flex-shrink-0`}
              >
                {name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base leading-tight truncate">{name}</div>
            <div className="text-xs font-mono text-muted-foreground mt-0.5">{agent.fullCode}</div>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <Badge variant={agent.isActive ? "default" : "secondary"} className="text-xs h-5">
                {agent.isActive ? "Active" : "Inactive"}
              </Badge>
              <Badge variant={hasPaid ? "default" : "destructive"} className="text-xs h-5">
                Reserve: {hasPaid ? "Paid" : "Not Paid"}
              </Badge>
              {isPending && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                  <span className="w-1 h-1 rounded-full bg-amber-500 inline-block animate-pulse" />
                  Est. · Pending Calc
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Financials grid */}
        <div className={`px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-2.5 ${isPending ? "bg-amber-50/30" : ""}`}>
          {[
            ["Gross Sales", gross, false],
            ["Net Gross", net, false],
            ["Commission", commission, false],
            ["Wins", wins, false],
            ["Reserve", reserve, false],
            ["Balance", balance, true],
          ].map(([label, val, isBalance]) => (
            <div key={label as string} className="flex flex-col">
              <span className={`text-[10px] uppercase tracking-wide font-medium ${isPending ? "text-amber-700/70" : "text-muted-foreground"}`}>
                {label as string}{isPending ? " ~" : ""}
              </span>
              <span className={`text-sm font-bold font-mono ${
                isBalance && Number(val) < 0 ? "text-destructive"
                : isBalance ? "text-primary"
                : isPending ? "text-amber-800" : ""
              }`}>
                {fmtGHS(val as number)}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex items-center justify-between bg-muted/20">
          <span className="text-xs text-muted-foreground">
            Writers: <span className="font-semibold text-foreground">{submittedWriters}</span>
            <span className="text-muted-foreground"> / {totalWriters} submitted</span>
          </span>
          <span className="text-xs text-primary font-medium">View details →</span>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentListRow({ stat, onClick }: { stat: AgentStat; onClick: () => void }) {
  const { agent, gross, net, balance, submittedWriters, totalWriters, hasPaid, isPending } = stat;
  const name = agent.user.fullName;
  return (
    <tr
      className={`border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors ${isPending ? "bg-amber-50/20" : ""}`}
      onClick={onClick}
    >
      <td className="py-3 pl-4 pr-2">
        <div className="flex items-center gap-3">
          <AgentAvatar name={name} picture={agent.user.profilePicture} size="sm" />
          <div>
            <div className="font-medium text-sm leading-tight">{name}</div>
            <div className="text-xs font-mono text-muted-foreground">{agent.fullCode}</div>
          </div>
        </div>
      </td>
      <td className={`py-3 px-3 text-sm font-mono text-right ${isPending ? "text-amber-800" : ""}`}>
        {fmtGHS(gross)}{isPending ? <span className="text-[10px] text-amber-600 ml-0.5">~</span> : null}
      </td>
      <td className={`py-3 px-3 text-sm font-mono text-right ${isPending ? "text-amber-800" : ""}`}>
        {fmtGHS(net)}{isPending ? <span className="text-[10px] text-amber-600 ml-0.5">~</span> : null}
      </td>
      <td className={`py-3 px-3 text-sm font-mono font-bold text-right ${balance < 0 ? "text-destructive" : "text-primary"}`}>
        {fmtGHS(balance)}{isPending ? <span className="text-[10px] text-amber-600 ml-0.5">~</span> : null}
      </td>
      <td className="py-3 px-3 text-center text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{submittedWriters}</span>/{totalWriters}
      </td>
      <td className="py-3 px-3">
        <Badge variant={agent.isActive ? "default" : "secondary"} className="text-xs">{agent.isActive ? "Active" : "Inactive"}</Badge>
      </td>
      <td className="py-3 px-3 space-y-0.5">
        <Badge variant={hasPaid ? "default" : "destructive"} className="text-xs">
          {hasPaid ? "Paid" : "Not Paid"}
        </Badge>
        {isPending && (
          <div className="text-[10px] text-amber-600 font-medium">Est. pending calc</div>
        )}
      </td>
      <td className="py-3 pl-2 pr-4 text-xs text-primary font-medium text-right">View →</td>
    </tr>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-2">
      <Button size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={page === 1} onClick={() => onPage(page - 1)}>
        ← Prev
      </Button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
        <Button
          key={p}
          size="sm"
          variant={p === page ? "default" : "outline"}
          className="h-8 w-8 text-xs p-0"
          onClick={() => onPage(p)}
        >
          {p}
        </Button>
      ))}
      <Button size="sm" variant="outline" className="h-8 px-3 text-xs" disabled={page === totalPages} onClick={() => onPage(page + 1)}>
        Next →
      </Button>
    </div>
  );
}

function DirectorDashboard() {
  const [, navigate] = useLocation();
  const today = new Date().toISOString().split("T")[0];
  const todayDow = new Date().getDay();

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);
  const [selectedDate, setSelectedDate] = useState("");

  const { data: allCalcs, isLoading: loadingCalcs } = useListCalculations(
    {},
    { query: { queryKey: getListCalculationsQueryKey({}), refetchInterval: 60_000 } }
  );
  const { data: payments } = useListPayments({}, { query: { queryKey: getListPaymentsQueryKey({}), refetchInterval: 60_000 } });
  const { data: reserve } = useGetReserveBalance({ query: { queryKey: getGetReserveBalanceQueryKey(), refetchInterval: 60_000 } });
  const { data: games } = useListGames();
  const { agentList, allWriters } = useWriterLookup();

  const { data: liveGross } = useListGrossEntries(
    {},
    { query: { queryKey: getListGrossEntriesQueryKey({}), refetchInterval: 30_000 } }
  );
  const { data: liveWins } = useListWinsEntries(
    {},
    { query: { queryKey: getListWinsEntriesQueryKey({}), refetchInterval: 30_000 } }
  );
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });

  const calcList = Array.isArray(allCalcs) ? allCalcs : [];
  const paymentList = Array.isArray(payments) ? payments : [];
  const gameList = Array.isArray(games) ? games : [];

  const mostRecentDate = useMemo(() => {
    if (!calcList.length) return today;
    return calcList.reduce((m, c) => {
      const d = c.calcDate?.split("T")[0] ?? "";
      return d > m ? d : m;
    }, "");
  }, [calcList, today]);

  const viewDate = selectedDate || mostRecentDate;

  const currentGame = useMemo(() => {
    return gameList.find(g => g.status === "live") ?? null;
  }, [gameList]);

  const dateCalcs = useMemo(() =>
    calcList.filter(c => c.calcDate?.startsWith(viewDate)),
    [calcList, viewDate]
  );

  const commPct = Number(settings?.commissionPct ?? 0);
  const resvPct = Number(settings?.reservePct ?? 0);
  const liveGrossList = Array.isArray(liveGross) ? liveGross : [];
  const liveWinsList  = Array.isArray(liveWins)  ? liveWins  : [];

  const agentStats: AgentStat[] = useMemo(() =>
    agentList.map(agent => {
      const writerIds = new Set(allWriters.filter(w => w.agentId === agent.id).map(w => w.id));
      const totalWriters = allWriters.filter(w => w.agentId === agent.id && w.isActive).length;
      const agentCalcs = dateCalcs.filter(c => writerIds.has(c.writerId));

      const hasPaid = paymentList.some(p => p.agentId === agent.id && !p.isVoided && p.paymentDate?.startsWith(viewDate));
      const agentInfo = {
        id: agent.id, agentCode: agent.agentCode, fullCode: agent.fullCode, isActive: agent.isActive,
        user: { fullName: agent.user?.fullName ?? agent.fullCode, profilePicture: agent.user?.profilePicture },
      };

      if (agentCalcs.length > 0) {
        return {
          agent: agentInfo,
          gross:      agentCalcs.reduce((s, c) => s + Number(c.grossSales),      0),
          commission: agentCalcs.reduce((s, c) => s + Number(c.commissionAmount), 0),
          net:        agentCalcs.reduce((s, c) => s + Number(c.netGross),         0),
          reserve:    agentCalcs.reduce((s, c) => s + Number(c.reserveAmount),    0),
          wins:       agentCalcs.reduce((s, c) => s + Number(c.winsAmount),       0),
          balance:    agentCalcs.reduce((s, c) => s + Number(c.writerBalance),    0),
          submittedWriters: agentCalcs.length,
          totalWriters, hasPaid, isPending: false,
        };
      }

      const liveGrossEntries = liveGrossList.filter(e => writerIds.has(e.writerId) && e.entryDate?.startsWith(viewDate));
      const liveWinsEntries  = liveWinsList.filter( e => writerIds.has(e.writerId) && e.entryDate?.startsWith(viewDate));
      const gross      = liveGrossEntries.reduce((s, e) => s + Number(e.grossAmount), 0);
      const wins       = liveWinsEntries.reduce( (s, e) => s + Number(e.winsAmount),  0);
      const commission = gross * commPct;
      const net        = gross - commission;
      const reserve    = net   * resvPct;
      const balance    = net   - wins - reserve;
      const isPending  = gross > 0 || wins > 0;
      const writersWithEntries = new Set([
        ...liveGrossEntries.map(e => e.writerId),
        ...liveWinsEntries.map(e => e.writerId),
      ]);

      return {
        agent: agentInfo,
        gross, commission, net, reserve, wins, balance,
        submittedWriters: writersWithEntries.size,
        totalWriters, hasPaid, isPending,
      };
    }),
    [agentList, allWriters, dateCalcs, paymentList, viewDate, liveGrossList, liveWinsList, commPct, resvPct]
  );

  const totals = useMemo(() => agentStats.reduce(
    (acc, s) => ({
      gross:      acc.gross      + s.gross,
      commission: acc.commission + s.commission,
      net:        acc.net        + s.net,
      wins:       acc.wins       + s.wins,
      reserve:    acc.reserve    + s.reserve,
      balance:    acc.balance    + s.balance,
    }),
    { gross: 0, commission: 0, net: 0, wins: 0, reserve: 0, balance: 0 }
  ), [agentStats]);

  const anyPending = useMemo(() => agentStats.some(s => s.isPending), [agentStats]);

  const accumulatedReserve = Number(reserve?.balance ?? 0);

  const grossToday = useMemo(
    () => (Array.isArray(liveGross) ? liveGross : []).filter(e => e.entryDate?.startsWith(today)),
    [liveGross, today]
  );
  const winsToday = useMemo(
    () => (Array.isArray(liveWins) ? liveWins : []).filter(e => e.entryDate?.startsWith(today)),
    [liveWins, today]
  );
  const grossTodayAmount = useMemo(
    () => grossToday.reduce((s, e) => s + Number(e.grossAmount), 0),
    [grossToday]
  );
  const winsTodayAmount = useMemo(
    () => winsToday.reduce((s, e) => s + Number(e.winsAmount), 0),
    [winsToday]
  );
  const hasCalcToday = useMemo(
    () => calcList.some(c => c.calcDate?.startsWith(today)),
    [calcList, today]
  );

  const pageSize = viewMode === "grid" ? PAGE_SIZE_GRID : PAGE_SIZE_LIST;
  const totalPages = Math.max(1, Math.ceil(agentStats.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedStats = agentStats.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handlePage = (p: number) => setPage(p);
  const handleViewMode = (mode: "grid" | "list") => { setViewMode(mode); setPage(1); };

  return (
    <div className="space-y-6">
      {/* Game banner */}
      <div className={`rounded-xl px-5 py-3 flex items-center gap-3 ${currentGame ? "bg-primary/10 border border-primary/25" : "bg-muted/60 border border-border"}`}>
        <span className="text-lg">🎮</span>
        <div>
          {currentGame ? (
            <>
              <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Today's Game</div>
              <div className="text-base font-bold text-primary leading-tight">{currentGame.name}</div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No active game assigned for {DAY_NAMES[todayDow]}</span>
          )}
        </div>
        <div className="ml-auto text-xs text-muted-foreground font-medium">{DAY_NAMES[todayDow]}</div>
      </div>

      {/* Live Entry Status — real-time, polled every 30s */}
      <div className="rounded-xl border bg-card px-5 py-3 flex items-center gap-5 flex-wrap">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex-shrink-0">
          Live Entries Today
        </div>

        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
          <span className="text-xs text-muted-foreground">Gross:</span>
          <span className="text-sm font-bold">{grossToday.length}</span>
          <span className="text-xs text-muted-foreground">
            {grossToday.length === 1 ? "entry" : "entries"}
          </span>
          <span className="text-xs font-mono font-semibold text-emerald-700">
            {fmtGHS(grossTodayAmount)}
          </span>
        </div>

        <div className="w-px h-4 bg-border flex-shrink-0" />

        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />
          <span className="text-xs text-muted-foreground">Wins:</span>
          <span className="text-sm font-bold">{winsToday.length}</span>
          <span className="text-xs text-muted-foreground">
            {winsToday.length === 1 ? "entry" : "entries"}
          </span>
          <span className="text-xs font-mono font-semibold text-violet-700">
            {fmtGHS(winsTodayAmount)}
          </span>
        </div>

        <div className="ml-auto flex-shrink-0">
          {hasCalcToday ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Calculation run for today
            </span>
          ) : (grossToday.length > 0 || winsToday.length > 0) ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block animate-pulse" />
              Entries pending calculation
            </span>
          ) : (
            <span className="text-xs text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full">
              No entries yet today
            </span>
          )}
        </div>
      </div>

      {/* Summary cards — live or calculated */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard
          label={anyPending ? "Gross (Live ~)" : "Total Gross"}
          value={fmtGHS(totals.gross)}
          pending={anyPending}
        />
        <StatCard
          label={anyPending ? "Wins (Live ~)" : "Total Wins"}
          value={fmtGHS(totals.wins)}
          pending={anyPending}
        />
        <StatCard
          label={anyPending ? "Commission ~" : "Commission"}
          value={fmtGHS(totals.commission)}
          pending={anyPending}
        />
        <StatCard
          label={anyPending ? "Net Gross ~" : "Net Gross"}
          value={fmtGHS(totals.net)}
          pending={anyPending}
        />
        <StatCard label="Reserve Fund" value={fmtGHS(accumulatedReserve)} accent />
        <StatCard
          label={anyPending ? "Est. Balance ~" : "Overall Balance"}
          value={fmtGHS(totals.balance)}
          accent={totals.balance >= 0}
          pending={anyPending}
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Date:</span>
          <Input
            type="date"
            value={viewDate}
            onChange={e => { setSelectedDate(e.target.value); setPage(1); }}
            className="h-8 text-sm w-40"
          />
          {selectedDate && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setSelectedDate(""); setPage(1); }}>
              Reset
            </Button>
          )}
        </div>
        {loadingCalcs && <span className="text-xs text-muted-foreground">Loading…</span>}

        {/* View toggle */}
        <div className="ml-auto flex items-center gap-1 border rounded-md p-0.5 bg-muted/30">
          <button
            onClick={() => handleViewMode("grid")}
            className={`p-1.5 rounded transition-colors ${viewMode === "grid" ? "bg-background shadow-sm" : "hover:bg-background/60"}`}
            title="Grid view"
          >
            <GridIcon active={viewMode === "grid"} />
          </button>
          <button
            onClick={() => handleViewMode("list")}
            className={`p-1.5 rounded transition-colors ${viewMode === "list" ? "bg-background shadow-sm" : "hover:bg-background/60"}`}
            title="List view"
          >
            <ListIcon active={viewMode === "list"} />
          </button>
        </div>

        <span className="text-xs text-muted-foreground">
          {agentStats.length} agent{agentStats.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Agents — Grid */}
      {viewMode === "grid" && (
        agentStats.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No agents found.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {pagedStats.map(stat => (
                <AgentGridCard key={stat.agent.id} stat={stat} onClick={() => navigate(`/agents/${stat.agent.id}/detail`)} />
              ))}
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPage={handlePage} />
          </>
        )
      )}

      {/* Agents — List */}
      {viewMode === "list" && (
        agentStats.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No agents found.</p>
        ) : (
          <>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-2.5 pl-4 pr-2 font-medium">Agent</th>
                    <th className="text-right py-2.5 px-3 font-medium">Gross</th>
                    <th className="text-right py-2.5 px-3 font-medium">Net</th>
                    <th className="text-right py-2.5 px-3 font-medium">Balance</th>
                    <th className="text-center py-2.5 px-3 font-medium">Writers</th>
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    <th className="py-2.5 px-3 font-medium">Reserve</th>
                    <th className="py-2.5 pl-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedStats.map(stat => (
                    <AgentListRow key={stat.agent.id} stat={stat} onClick={() => navigate(`/agents/${stat.agent.id}/detail`)} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPage={handlePage} />
          </>
        )
      )}
    </div>
  );
}

/* ── Cashier window helpers ──────────────────────────────────────────────── */
function cashierWindowStatus(windows: TimeWindow[]) {
  const now   = new Date();
  const dow   = now.getDay();
  const hhmm  = now.toTimeString().slice(0, 5);
  const active = windows.filter(w => w.isActive && w.dayOfWeek === dow);
  const current = active.find(w => w.windowOpen <= hhmm && hhmm <= w.windowClose);
  if (current) return { open: true, window: current, nextTime: null as string | null };
  const upcoming = active
    .filter(w => w.windowOpen > hhmm)
    .sort((a, b) => a.windowOpen.localeCompare(b.windowOpen));
  return { open: false, window: null, nextTime: upcoming[0]?.windowOpen ?? null };
}
function fmtHHMM12(t?: string | null) {
  if (!t) return "—";
  const [h, m] = t.split(":");
  const hr = Number(h);
  return `${hr % 12 || 12}:${m} ${hr < 12 ? "AM" : "PM"}`;
}

function CashierDashboard() {
  const [, navigate] = useLocation();
  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);

  const { data: allPaymentsRaw } = useListPayments({}, { query: { queryKey: getListPaymentsQueryKey({}) } });
  const { data: unread }         = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });
  const { data: allCalcsRaw }    = useListCalculations({}, { query: { queryKey: getListCalculationsQueryKey({}) } });
  const { data: timeWindowsRaw } = useListTimeWindows({ query: { queryKey: getListTimeWindowsQueryKey() } });
  const { allWriters, agentList } = useWriterLookup();

  const allPayments = useMemo(() => Array.isArray(allPaymentsRaw) ? allPaymentsRaw : [], [allPaymentsRaw]);
  const allCalcs    = useMemo(() => Array.isArray(allCalcsRaw) ? allCalcsRaw : [], [allCalcsRaw]);
  const windows     = useMemo(() => Array.isArray(timeWindowsRaw) ? timeWindowsRaw : [], [timeWindowsRaw]);

  /* ── window status ── */
  const ws = useMemo(() => cashierWindowStatus(windows), [windows]);

  /* ── today's cash position ── */
  const todayValid = useMemo(
    () => allPayments.filter(p => p.paymentDate?.startsWith(todayStr) && !p.isVoided),
    [allPayments, todayStr]
  );
  const todayPayIn  = useMemo(() => todayValid.filter(p => p.transactionType === "pay_in").reduce((s, p) => s + Number(p.amount), 0), [todayValid]);
  const todayPayOut = useMemo(() => todayValid.filter(p => p.transactionType === "pay_out").reduce((s, p) => s + Number(p.amount), 0), [todayValid]);
  const netPos      = todayPayIn - todayPayOut;

  /* ── settlement snapshot ── */
  const todayCalcs    = useMemo(() => allCalcs.filter(c => c.calcDate === todayStr), [allCalcs, todayStr]);
  const todayPayments = useMemo(() => allPayments.filter(p => p.paymentDate?.startsWith(todayStr) && !p.isVoided), [allPayments, todayStr]);

  const settlements = useMemo(() => agentList.filter(a => a.isActive).map(a => {
    const ids       = new Set(allWriters.filter(w => w.agentId === a.id).map(w => w.id));
    const calcs     = todayCalcs.filter(c => ids.has(c.writerId));
    const pmts      = todayPayments.filter(p => p.agentId === a.id);
    const balDue    = calcs.reduce((s, c) => s + Number(c.writerBalance), 0);
    const collected = pmts.filter(p => p.transactionType === "pay_in").reduce((s, p) => s + Number(p.amount), 0);
    const paidOut   = pmts.filter(p => p.transactionType === "pay_out").reduce((s, p) => s + Number(p.amount), 0);
    const hasCalc   = calcs.length > 0;
    const shortfall = balDue - (collected - paidOut);
    return { agent: a, balDue, collected, paidOut, hasCalc, shortfall };
  }), [agentList, allWriters, todayCalcs, todayPayments]);

  const settledCount     = settlements.filter(r => r.hasCalc && Math.abs(r.shortfall) < 0.005).length;
  const outstandingCount = settlements.filter(r => r.hasCalc && r.shortfall > 0.005).length;
  const activeWithCalc   = settlements.filter(r => r.hasCalc || r.collected > 0);

  /* ── recent transactions ── */
  const recentTxns = useMemo(
    () => [...todayValid].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()).slice(0, 5),
    [todayValid]
  );

  const agentNameMap = useMemo(
    () => Object.fromEntries(agentList.map(a => [a.id, a.user?.fullName ?? a.fullCode])),
    [agentList]
  );

  const dateStr = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  return (
    <div className="space-y-5">

      {/* ── Time window banner ── */}
      <div className={`rounded-xl border px-5 py-3 flex items-center gap-4 flex-wrap ${ws.open ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${ws.open ? "bg-emerald-100" : "bg-red-100"}`}>
          <svg className={`w-4.5 h-4.5 ${ws.open ? "text-emerald-700" : "text-red-600"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold ${ws.open ? "text-emerald-800" : "text-red-700"}`}>
            Payment Window: {ws.open ? "OPEN" : "CLOSED"}
            {ws.open && ws.window && <span className="font-normal ml-1 text-xs">· closes {fmtHHMM12(ws.window.windowClose)}</span>}
            {!ws.open && ws.nextTime && <span className="font-normal ml-1 text-xs">· opens at {fmtHHMM12(ws.nextTime)}</span>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{dateStr}</div>
        </div>
        <Button
          size="sm"
          onClick={() => navigate("/payments")}
          className={ws.open ? "bg-emerald-700 hover:bg-emerald-800" : ""}
        >
          Go to Cashier Station →
        </Button>
      </div>

      {/* ── Cash position stat cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pay-In Today</div>
          <div className="text-2xl font-bold text-emerald-700">{fmtGHS(todayPayIn)}</div>
          <div className="text-[11px] text-muted-foreground">{todayValid.filter(p => p.transactionType === "pay_in").length} transaction(s)</div>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pay-Out Today</div>
          <div className="text-2xl font-bold text-orange-600">{fmtGHS(todayPayOut)}</div>
          <div className="text-[11px] text-muted-foreground">{todayValid.filter(p => p.transactionType === "pay_out").length} transaction(s)</div>
        </div>
        <div className={`rounded-xl border p-4 space-y-1.5 ${netPos >= 0 ? "bg-primary/5 border-primary/20" : "bg-red-50 border-red-200"}`}>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Net Cash Position</div>
          <div className={`text-2xl font-bold ${netPos >= 0 ? "text-primary" : "text-destructive"}`}>{fmtGHS(netPos)}</div>
          <div className="text-[11px] text-muted-foreground">pay-in minus pay-out</div>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Settlement Today</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-700">{settledCount}</span>
            <span className="text-xs text-muted-foreground">settled</span>
            {outstandingCount > 0 && <><span className="text-lg font-bold text-destructive">{outstandingCount}</span><span className="text-xs text-destructive">outstanding</span></>}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {(unread?.count ?? 0) > 0 && <span className="text-destructive font-medium">{unread!.count} unread notif.</span>}
            {!(unread?.count) && "of agents with calcs"}
          </div>
        </div>
      </div>

      {/* ── Agent settlement snapshot ── */}
      {activeWithCalc.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Agent Settlement — Today</h2>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate("/payments")}>
              Full board →
            </Button>
          </div>
          <div className="border rounded-lg divide-y overflow-hidden">
            {activeWithCalc.map(row => {
              const { agent, balDue, collected, shortfall, hasCalc } = row;
              const isSettled   = hasCalc && Math.abs(shortfall) < 0.005;
              const isOutstand  = hasCalc && shortfall > 0.005;
              const isOverpaid  = hasCalc && shortfall < -0.005;
              return (
                <div key={agent.id} className={`flex items-center gap-3 px-4 py-3 ${isOutstand ? "bg-red-50/40" : isSettled ? "bg-emerald-50/30" : ""}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isSettled ? "bg-emerald-500" : isOutstand ? "bg-red-500 animate-pulse" : isOverpaid ? "bg-amber-500" : "bg-muted-foreground/30"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{agent.user?.fullName ?? agent.fullCode}</div>
                    <div className="text-xs text-muted-foreground font-mono">{agent.fullCode}</div>
                  </div>
                  {hasCalc && (
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Due</div>
                      <div className="text-sm font-mono font-semibold">{fmtGHS(balDue)}</div>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Collected</div>
                    <div className={`text-sm font-mono font-semibold ${collected > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>{fmtGHS(collected)}</div>
                  </div>
                  <div className="w-24 text-right">
                    {isSettled && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Settled ✓</span>}
                    {isOutstand && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-800">Due {fmtGHS(shortfall)}</span>}
                    {isOverpaid && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Overpaid</span>}
                    {!hasCalc && collected > 0 && <span className="text-xs text-muted-foreground">Has txns</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Recent transactions ── */}
      {recentTxns.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent Transactions — Today</h2>
          </div>
          <div className="border rounded-lg divide-y overflow-hidden">
            {recentTxns.map(p => {
              const isIn = p.transactionType === "pay_in";
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${isIn ? "bg-emerald-600" : "bg-orange-500"}`}>
                    {isIn ? "↓" : "↑"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{agentNameMap[p.agentId] ?? "—"}</div>
                    <div className="text-xs text-muted-foreground font-mono">{p.receiptNumber ?? "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-mono font-semibold ${isIn ? "text-emerald-700" : "text-orange-600"}`}>{fmtGHS(Number(p.amount))}</div>
                    <div className="text-xs text-muted-foreground">{isIn ? "Pay-In" : "Pay-Out"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state when no activity */}
      {todayValid.length === 0 && activeWithCalc.length === 0 && (
        <div className="text-center py-12 border rounded-xl border-dashed text-muted-foreground text-sm space-y-2">
          <div className="text-2xl">💼</div>
          <div className="font-medium">No transactions yet today</div>
          <div className="text-xs">Head to the Cashier Station to record payments</div>
          <Button size="sm" className="mt-2" onClick={() => navigate("/payments")}>Open Cashier Station</Button>
        </div>
      )}
    </div>
  );
}

function EntryDashboard({ type }: { type: "gross" | "wins" }) {
  const today = new Date().toISOString().split("T")[0];
  const todayDow = new Date().getDay();
  const isGross = type === "gross";

  const { data: rawGross } = useListGrossEntries(
    {},
    { query: { queryKey: getListGrossEntriesQueryKey({}), enabled: isGross, refetchInterval: 30_000 } }
  );
  const { data: rawWins } = useListWinsEntries(
    {},
    { query: { queryKey: getListWinsEntriesQueryKey({}), enabled: !isGross, refetchInterval: 30_000 } }
  );
  const { data: games } = useListGames();
  const { data: unread } = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });
  const { writerMap } = useWriterLookup();

  const gameList = Array.isArray(games) ? games : [];
  const currentGame = useMemo(() => {
    return gameList.find(g => g.status === "live") ?? null;
  }, [gameList]);

  const grossList = Array.isArray(rawGross) ? rawGross : [];
  const winsList = Array.isArray(rawWins) ? rawWins : [];
  const allEntries = isGross ? grossList : winsList;

  const getAmount = (e: (typeof allEntries)[0]) =>
    isGross ? Number((e as { grossAmount?: string }).grossAmount ?? 0)
            : Number((e as { winsAmount?: string }).winsAmount ?? 0);

  const todayEntries = useMemo(
    () => allEntries.filter(e => e.entryDate?.startsWith(today)),
    [allEntries, today]
  );

  const todayAmount = useMemo(
    () => todayEntries.reduce((s, e) => s + getAmount(e), 0),
    [todayEntries]
  );

  const writersToday = useMemo(
    () => new Set(todayEntries.map(e => e.writerId)).size,
    [todayEntries]
  );

  const openToday  = todayEntries.filter(e => !e.locked).length;
  const lockedToday = todayEntries.filter(e =>  e.locked).length;

  const recentEntries = useMemo(
    () => [...todayEntries]
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, 7),
    [todayEntries]
  );

  const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const weekEntries = allEntries.filter(e => (e.entryDate ?? "") >= weekAgo);
  const weekAmount  = weekEntries.reduce((s, e) => s + getAmount(e), 0);
  const allAmount   = allEntries.reduce((s, e) => s + getAmount(e), 0);

  const dateStr = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date());

  const accentText = isGross ? "text-emerald-700" : "text-violet-700";
  const accentBg   = isGross ? "bg-emerald-50 border-emerald-200" : "bg-violet-50 border-violet-200";
  const accentPill = isGross ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700";
  const dotColor   = isGross ? "bg-emerald-500" : "bg-violet-500";
  const icon       = isGross ? "📊" : "🏆";

  return (
    <div className="space-y-5">

      {/* ── Context banner ── */}
      <div className={`rounded-xl border px-5 py-3.5 flex items-center gap-4 ${accentBg}`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl flex-shrink-0 ${isGross ? "bg-emerald-100" : "bg-violet-100"}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold ${accentText}`}>
            {isGross ? "Gross Entry Portal" : "Wins Entry Portal"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {dateStr}
            {currentGame && <span className="ml-2 font-medium text-foreground">· 🎮 {currentGame.name}</span>}
          </div>
        </div>
        {(unread?.count ?? 0) > 0 && (
          <div className="flex-shrink-0 bg-destructive text-destructive-foreground text-xs font-bold px-2.5 py-1 rounded-full">
            {unread!.count} unread
          </div>
        )}
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">

        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Logged Today</div>
          <div className="text-2xl font-bold">{todayEntries.length}</div>
          <div className="text-[11px] text-muted-foreground">entr{todayEntries.length === 1 ? "y" : "ies"} submitted</div>
        </div>

        <div className={`rounded-xl border p-4 space-y-1 ${accentBg}`}>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {isGross ? "Gross Sales Today" : "Total Wins Today"}
          </div>
          <div className={`text-2xl font-bold ${accentText}`}>{fmtGHS(todayAmount)}</div>
          <div className="text-[11px] text-muted-foreground">sum of today's amounts</div>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Writers Covered</div>
          <div className="text-2xl font-bold">{writersToday}</div>
          <div className="text-[11px] text-muted-foreground">unique writer{writersToday !== 1 ? "s" : ""} today</div>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Entry Status</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-primary">{openToday}</span>
            <span className="text-xs text-muted-foreground">open</span>
            {lockedToday > 0 && (
              <>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-sm font-semibold text-muted-foreground">{lockedToday}</span>
                <span className="text-xs text-muted-foreground">locked</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">of today's entries</div>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Notifications</div>
          <div className={`text-2xl font-bold ${(unread?.count ?? 0) > 0 ? "text-destructive" : ""}`}>
            {unread?.count ?? 0}
          </div>
          <div className="text-[11px] text-muted-foreground">unread message{(unread?.count ?? 0) !== 1 ? "s" : ""}</div>
        </div>

      </div>

      {/* ── Activity + Summaries ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

        {/* Today's entries feed */}
        <div className="lg:col-span-2 rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-3.5 border-b flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Today's Entries</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {todayEntries.length === 0
                  ? "No entries logged yet — start adding entries for today"
                  : `${todayEntries.length} entr${todayEntries.length === 1 ? "y" : "ies"} · most recent first`}
              </div>
            </div>
            {todayEntries.length > 0 && (
              <div className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg ${accentPill}`}>
                {fmtGHS(todayAmount)}
              </div>
            )}
          </div>

          {recentEntries.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center text-2xl">{icon}</div>
              <div>
                <div className="text-sm font-medium">No entries for today yet</div>
                <div className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Use the <span className="font-semibold">Add Entry</span> button in the{" "}
                  {isGross ? "Gross Entries" : "Wins Entries"} page to start recording today's data.
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {recentEntries.map(e => {
                const writer = writerMap[e.writerId];
                const ts = e.createdAt ? new Date(e.createdAt) : null;
                const amount = getAmount(e);
                return (
                  <div
                    key={e.id}
                    className={`px-5 py-3 flex items-center gap-3 transition-colors hover:bg-muted/30 ${e.locked ? "opacity-55" : ""}`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${e.locked ? "bg-muted-foreground/40" : dotColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-mono font-semibold flex-shrink-0">
                          {writer?.fullCode ?? e.writerId.slice(0, 8) + "…"}
                        </span>
                        {writer && (
                          <span className="text-xs text-muted-foreground truncate">{writer.fullName}</span>
                        )}
                      </div>
                    </div>
                    <div className={`text-sm font-mono font-bold flex-shrink-0 ${accentText}`}>
                      {fmtGHS(amount)}
                    </div>
                    <div className="text-xs text-muted-foreground w-12 text-right tabular-nums flex-shrink-0">
                      {ts ? ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </div>
                    <div className="w-14 flex-shrink-0 text-right">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        e.locked ? "bg-muted text-muted-foreground" : accentPill
                      }`}>
                        {e.locked ? "Locked" : "Open"}
                      </span>
                    </div>
                  </div>
                );
              })}
              {todayEntries.length > 7 && (
                <div className="px-5 py-2.5 text-xs text-muted-foreground text-center bg-muted/20">
                  Showing 7 of {todayEntries.length} entries — view all in the Entries page
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Weekly + All-Time summaries */}
        <div className="space-y-4">

          <div className="rounded-xl border bg-card p-5">
            <div className="text-sm font-semibold">7-Day Summary</div>
            <div className="text-xs text-muted-foreground mt-0.5 mb-4">Last 7 days including today</div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total Entries</span>
                <span className="text-sm font-bold">{weekEntries.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{isGross ? "Total Gross" : "Total Wins"}</span>
                <span className={`text-sm font-bold ${accentText}`}>{fmtGHS(weekAmount)}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-2.5">
                <span className="text-xs text-muted-foreground">Daily Avg</span>
                <span className="text-sm font-semibold">{fmtGHS(weekAmount / 7)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5">
            <div className="text-sm font-semibold">All-Time</div>
            <div className="text-xs text-muted-foreground mt-0.5 mb-4">All recorded entries</div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total Entries</span>
                <span className="text-sm font-bold">{allEntries.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{isGross ? "Total Gross" : "Total Wins"}</span>
                <span className={`text-sm font-bold ${accentText}`}>{fmtGHS(allAmount)}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-2.5">
                <span className="text-xs text-muted-foreground">Locked Entries</span>
                <span className="text-sm font-semibold">{allEntries.filter(e => e.locked).length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Open Entries</span>
                <span className="text-sm font-semibold text-primary">{allEntries.filter(e => !e.locked).length}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  director: "Director", administrator: "Administrator", cashier: "Cashier",
  gross_entry: "Gross Entry Team", wins_entry: "Wins Entry Team", agent: "Agent",
};

export function Dashboard() {
  const { user } = useAuth();
  const role = user?.role ?? "";

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Badge variant="secondary" className="text-xs">{ROLE_LABELS[role] ?? role}</Badge>
      </div>

      {(role === "director" || role === "administrator") && <DirectorDashboard />}
      {role === "cashier" && <CashierDashboard />}
      {role === "gross_entry" && <EntryDashboard type="gross" />}
      {role === "wins_entry" && <EntryDashboard type="wins" />}
      {role === "agent" && <AgentDashboard />}
    </div>
  );
}
