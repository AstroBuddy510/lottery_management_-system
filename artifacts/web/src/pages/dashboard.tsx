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
  useListCompanyExpenses, getListCompanyExpensesQueryKey,
} from "@workspace/api-client-react";
import type { TimeWindow } from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtGHS } from "@/lib/utils";

// Lucide icons for premium styling
import {
  Wallet, Trophy, Percent, TrendingUp, Shield, DollarSign,
  Search, LayoutGrid, List, ChevronRight, ArrowRight,
  Clock, Activity, FileText, AlertCircle, RefreshCw,
  ArrowUpRight, ArrowDownRight, Users, Sparkles, Building
} from "lucide-react";

// Recharts charting library for premium business analytics
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as ChartTooltip, Legend as ChartLegend
} from "recharts";


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

function StatCard({
  label,
  value,
  accent,
  pending,
  icon,
  description,
  colorClass = "text-primary"
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  pending?: boolean;
  icon?: React.ReactNode;
  description?: string;
  colorClass?: string;
}) {
  return (
    <Card
      className={`relative overflow-hidden border backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${
        pending
          ? "border-amber-200 bg-amber-50/45 dark:border-amber-900/30 dark:bg-amber-950/10"
          : accent
          ? "border-emerald-200 bg-emerald-50/20 dark:border-emerald-950/20 dark:bg-emerald-950/5"
          : "border-border/60 bg-card/60"
      }`}
    >
      {/* Background glow overlay */}
      <div className="absolute -right-6 -top-6 w-20 h-20 bg-primary/5 rounded-full blur-xl pointer-events-none" />

      <CardHeader className="pb-1.5 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
        <CardTitle className={`text-xs font-semibold uppercase tracking-wider ${
          pending ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
        }`}>
          {label}
        </CardTitle>
        {icon && <div className={`p-1.5 rounded-lg bg-muted/60 dark:bg-muted/20 ${colorClass}`}>{icon}</div>}
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className={`text-xl font-extrabold font-mono tracking-tight ${
          accent ? "text-emerald-700 dark:text-emerald-400" : pending ? "text-amber-800 dark:text-amber-300" : "text-foreground"
        }`}>
          {value}
        </div>
        {description && (
          <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1 font-medium truncate">
            {pending && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block flex-shrink-0" />}
            {description}
          </p>
        )}
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
  const submitPercentage = totalWriters > 0 ? (submittedWriters / totalWriters) * 100 : 0;

  return (
    <Card
      className="cursor-pointer border border-border/60 hover:border-primary/35 hover:-translate-y-1.5 hover:shadow-lg transition-all duration-300 overflow-hidden bg-card/65 backdrop-blur-sm shadow-sm flex flex-col justify-between"
      onClick={onClick}
    >
      <CardContent className="p-0 flex-1 flex flex-col justify-between">
        {/* Header strip with Avatar */}
        <div className="bg-muted/30 border-b border-border/40 px-5 pt-5 pb-4 flex items-start gap-4">
          <div className="relative">
            <div className={`rounded-full p-0.5 ${
              agent.isActive ? "ring-2 ring-emerald-500/70" : "ring-2 ring-muted-foreground/30"
            }`}>
              <AgentAvatar name={name} picture={agent.user.profilePicture} size="lg" />
            </div>
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
            <div className="font-bold text-base tracking-tight leading-tight truncate text-foreground">{name}</div>
            <div className="text-xs font-mono text-muted-foreground font-medium mt-0.5">{agent.fullCode}</div>
            <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
              <Badge className={`text-[10px] h-5 font-bold border-none shadow-sm ${
                agent.isActive 
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" 
                  : "bg-muted text-muted-foreground"
              }`}>
                {agent.isActive ? "Active" : "Inactive"}
              </Badge>
              <Badge className={`text-[10px] h-5 font-bold border-none shadow-sm ${
                hasPaid 
                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" 
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              }`}>
                Reserve: {hasPaid ? "Paid" : "Not Paid"}
              </Badge>
              {isPending && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 px-1.5 py-0.5 rounded shadow-sm">
                  <span className="w-1 h-1 rounded-full bg-amber-500 inline-block animate-pulse" />
                  PENDING CALC
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Financials grid */}
        <div className={`px-5 py-4.5 grid grid-cols-2 gap-x-6 gap-y-3.5 flex-1 ${isPending ? "bg-amber-50/15 dark:bg-amber-950/5" : ""}`}>
          {[
            ["Gross Sales", gross, false],
            ["Net Gross", net, false],
            ["Commission", commission, false],
            ["Wins Claimed", wins, false],
            ["Reserve Pool", reserve, false],
            ["Current Balance", balance, true],
          ].map(([label, val, isBalance]) => (
            <div key={label as string} className="flex flex-col">
              <span className={`text-[9px] uppercase tracking-wider font-bold ${
                isPending ? "text-amber-700/80" : "text-muted-foreground/80"
              }`}>
                {label as string}{isPending ? " ~" : ""}
              </span>
              <span className={`text-sm font-bold font-mono mt-0.5 ${
                isBalance && Number(val) < 0 ? "text-destructive"
                : isBalance ? "text-primary"
                : isPending ? "text-amber-800 dark:text-amber-300" : "text-foreground"
              }`}>
                {fmtGHS(val as number)}
              </span>
            </div>
          ))}
        </div>

        {/* Writer Submissions Progress Bar */}
        <div className="px-5 pb-4 space-y-1.5 bg-muted/5 border-t border-border/40 pt-3">
          <div className="flex justify-between text-xs font-semibold text-muted-foreground">
            <span>Writer Submissions</span>
            <span className="font-mono text-foreground font-bold">{submittedWriters}/{totalWriters}</span>
          </div>
          <div className="w-full bg-muted/65 dark:bg-muted/20 h-1.5 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                submitPercentage === 100 ? "bg-emerald-500" : "bg-primary"
              }`}
              style={{ width: `${submitPercentage}%` }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border/40 px-5 py-3 flex items-center justify-between bg-muted/20">
          <span className="text-[11px] text-muted-foreground font-medium">
            {submitPercentage === 100 ? "All writers submitted ✓" : "Submissions in progress..."}
          </span>
          <span className="text-[11px] text-primary font-bold flex items-center gap-0.5">
            View details 
            <ChevronRight className="w-3 h-3" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentListRow({ stat, onClick }: { stat: AgentStat; onClick: () => void }) {
  const { agent, gross, net, balance, submittedWriters, totalWriters, hasPaid, isPending } = stat;
  const name = agent.user.fullName;
  const submitPercentage = totalWriters > 0 ? (submittedWriters / totalWriters) * 100 : 0;

  return (
    <tr
      className={`border-b border-border/40 last:border-0 hover:bg-muted/40 cursor-pointer transition-colors ${
        isPending ? "bg-amber-50/10 dark:bg-amber-950/5" : ""
      }`}
      onClick={onClick}
    >
      <td className="py-3.5 pl-4 pr-2">
        <div className="flex items-center gap-3">
          <div className={`rounded-full p-0.5 ${
            agent.isActive ? "ring-2 ring-emerald-500/70" : "ring-2 ring-muted-foreground/30"
          }`}>
            <AgentAvatar name={name} picture={agent.user.profilePicture} size="sm" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight text-foreground">{name}</div>
            <div className="text-xs font-mono text-muted-foreground mt-0.5">{agent.fullCode}</div>
          </div>
        </div>
      </td>
      <td className={`py-3.5 px-3 text-sm font-mono text-right font-semibold ${isPending ? "text-amber-800 dark:text-amber-300" : "text-foreground"}`}>
        {fmtGHS(gross)}{isPending ? <span className="text-[10px] text-amber-600 ml-0.5">~</span> : null}
      </td>
      <td className={`py-3.5 px-3 text-sm font-mono text-right font-semibold ${isPending ? "text-amber-800 dark:text-amber-300" : "text-foreground"}`}>
        {fmtGHS(net)}{isPending ? <span className="text-[10px] text-amber-600 ml-0.5">~</span> : null}
      </td>
      <td className={`py-3.5 px-3 text-sm font-mono font-extrabold text-right ${balance < 0 ? "text-destructive" : "text-primary"}`}>
        {fmtGHS(balance)}{isPending ? <span className="text-[10px] text-amber-600 ml-0.5">~</span> : null}
      </td>
      <td className="py-3.5 px-3 text-center">
        <div className="inline-flex flex-col items-center gap-1">
          <span className="text-xs font-bold text-foreground">{submittedWriters}/{totalWriters}</span>
          <div className="w-16 bg-muted/65 dark:bg-muted/20 h-1 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full ${submitPercentage === 100 ? "bg-emerald-500" : "bg-primary"}`}
              style={{ width: `${submitPercentage}%` }}
            />
          </div>
        </div>
      </td>
      <td className="py-3.5 px-3">
        <Badge className={`text-[10px] font-bold border-none shadow-sm ${
          agent.isActive 
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" 
            : "bg-muted text-muted-foreground"
        }`}>
          {agent.isActive ? "Active" : "Inactive"}
        </Badge>
      </td>
      <td className="py-3.5 px-3 space-y-0.5">
        <Badge className={`text-[10px] font-bold border-none shadow-sm ${
          hasPaid 
            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" 
            : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
        }`}>
          {hasPaid ? "Paid" : "Not Paid"}
        </Badge>
        {isPending && (
          <div className="text-[9px] text-amber-600 font-bold uppercase tracking-wide">Est. pending</div>
        )}
      </td>
      <td className="py-3.5 pl-2 pr-4 text-xs text-primary font-bold text-right">
        <div className="flex items-center justify-end gap-0.5">
          View 
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </td>
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
  const [selectedGameId, setSelectedGameId] = useState("");
  const [search, setSearch] = useState("");

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
  
  // Fetch company expenses for overview widget
  const { data: rawExpenses, isLoading: loadingExpenses } = useListCompanyExpenses(
    {},
    { query: { queryKey: getListCompanyExpensesQueryKey({}), refetchInterval: 60_000 } }
  );

  const calcList = Array.isArray(allCalcs) ? allCalcs : [];
  const paymentList = Array.isArray(payments) ? payments : [];
  const gameList = Array.isArray(games) ? games : [];
  const expensesList = Array.isArray(rawExpenses) ? rawExpenses : [];

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

  const handleGameSelect = (id: string) => {
    setSelectedGameId(id);
    setPage(1);
    if (id === "_live" || id === "_none") {
      setSelectedDate("");
    } else {
      const g = gameList.find(g => g.id === id);
      if (g) setSelectedDate(new Date(g.closeAt).toISOString().split("T")[0]);
    }
  };

  const displayGame = useMemo(() => {
    if (!selectedGameId || selectedGameId === "_live" || selectedGameId === "_none") return currentGame;
    return gameList.find(g => g.id === selectedGameId) ?? currentGame;
  }, [selectedGameId, gameList, currentGame]);

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

  // Operations & Expenses calculations for the selected viewDate
  const dateExpenses = useMemo(() => {
    return expensesList.filter(e => e.createdAt?.startsWith(viewDate));
  }, [expensesList, viewDate]);

  const totalExpensesAmount = useMemo(() => {
    return dateExpenses.reduce((s, e) => s + Number(e.amount), 0);
  }, [dateExpenses]);

  // Aggregate calculations by date for the Recharts AreaChart
  const chartData = useMemo(() => {
    const grouped: Record<string, { date: string; gross: number; wins: number; net: number; balance: number }> = {};
    calcList.forEach(c => {
      const dateStr = c.calcDate?.split("T")[0] ?? "";
      if (!dateStr) return;
      if (!grouped[dateStr]) {
        grouped[dateStr] = {
          date: dateStr,
          gross: 0,
          wins: 0,
          net: 0,
          balance: 0
        };
      }
      grouped[dateStr].gross += Number(c.grossSales ?? 0);
      grouped[dateStr].wins += Number(c.winsAmount ?? 0);
      grouped[dateStr].net += Number(c.netGross ?? 0);
      grouped[dateStr].balance += Number(c.writerBalance ?? 0);
    });
    const sorted = Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
    return sorted.slice(-7);
  }, [calcList]);

  // Filter agents by search query (name or agent code)
  const filteredAgentStats = useMemo(() => {
    if (!search) return agentStats;
    const q = search.toLowerCase().trim();
    return agentStats.filter(s =>
      s.agent.user.fullName.toLowerCase().includes(q) ||
      s.agent.fullCode.toLowerCase().includes(q)
    );
  }, [agentStats, search]);

  const pageSize = viewMode === "grid" ? PAGE_SIZE_GRID : PAGE_SIZE_LIST;
  const totalPages = Math.max(1, Math.ceil(filteredAgentStats.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedStats = filteredAgentStats.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handlePage = (p: number) => setPage(p);
  const handleViewMode = (mode: "grid" | "list") => { setViewMode(mode); setPage(1); };

  return (
    <div className="space-y-6">
      {/* Game banner — interactive game selector */}
      <div className={`relative overflow-hidden rounded-xl px-5 py-3.5 flex items-center gap-4 flex-wrap border shadow-sm transition-all duration-300 ${
        displayGame 
          ? "bg-slate-900 border-primary/30 text-white" 
          : "bg-muted/60 border-border"
      }`}>
        {/* Decorative corner glows */}
        {displayGame && (
          <div className="absolute right-0 top-0 w-24 h-24 bg-primary/10 rounded-full blur-xl pointer-events-none" />
        )}
        
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
          displayGame ? "bg-primary/20 text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}>
          🎮
        </div>
        
        <div className="flex-1 min-w-0">
          {displayGame ? (
            <>
              <div className="text-[10px] text-primary-foreground/75 font-bold uppercase tracking-wider">
                {(!selectedGameId || selectedGameId === "_live" || selectedGameId === "_none") ? "Active Game Event" : "Viewing Game Event"}
              </div>
              <div className="flex items-center gap-2.5 flex-wrap mt-0.5">
                <span className="text-sm font-mono font-bold text-accent px-1.5 py-0.5 rounded bg-white/10">{displayGame.eventNumber}</span>
                <span className="text-base font-extrabold tracking-tight leading-tight">{displayGame.name}</span>
                {displayGame.status === "live" && (
                  <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold border-none text-[10px] px-2 py-0.5 shadow-sm shadow-emerald-500/20">LIVE</Badge>
                )}
                {displayGame.status === "closed" && (
                  <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-white/15 text-white border-none">Closed</Badge>
                )}
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground font-medium">No active game for {DAY_NAMES[todayDow]}</span>
          )}
        </div>
        
        <div className="flex items-center gap-2.5 shrink-0">
          <Select
            value={selectedGameId || "_live"}
            onValueChange={handleGameSelect}
          >
            <SelectTrigger className={`h-9 text-xs w-52 border ${
              displayGame ? "bg-white/10 text-white border-white/20 focus:ring-white/30" : "bg-background/80"
            }`}>
              <SelectValue placeholder="Select game…" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="_live">
                {currentGame ? `Current: ${currentGame.eventNumber}` : "Current game (live)"}
              </SelectItem>
              {gameList
                .filter(g => g.status !== "live")
                .sort((a, b) => b.eventNumber.localeCompare(a.eventNumber))
                .map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    <span className="font-mono text-xs text-muted-foreground mr-1.5">{g.eventNumber}</span>
                    {g.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {selectedGameId && selectedGameId !== "_live" && selectedGameId !== "_none" && (
            <Button 
              size="sm" 
              variant="ghost" 
              className={`h-9 text-xs px-3 ${displayGame ? "text-blue-300 hover:text-white hover:bg-white/10" : ""}`}
              onClick={() => handleGameSelect("_live")}
            >
              Back to live
            </Button>
          )}
        </div>
      </div>

      {/* Live Entry Status — real-time glassmorphic status block */}
      <div className="rounded-xl border border-border/60 bg-card/45 backdrop-blur-md px-5 py-3.5 flex items-center gap-5 flex-wrap shadow-sm">
        <div className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 flex-shrink-0">
          <Activity className="w-3.5 h-3.5 text-primary animate-pulse" />
          Realtime entries today
        </div>

        <div className="h-4 w-px bg-border flex-shrink-0 hidden md:block" />

        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/30 flex-shrink-0" />
          <span className="text-xs text-muted-foreground font-semibold">Gross:</span>
          <span className="text-sm font-extrabold">{grossToday.length}</span>
          <span className="text-xs text-muted-foreground">
            {grossToday.length === 1 ? "entry" : "entries"}
          </span>
          <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-1.5 py-0.5 rounded">
            {fmtGHS(grossTodayAmount)}
          </span>
        </div>

        <div className="w-px h-4 bg-border flex-shrink-0" />

        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-sm shadow-purple-500/30 flex-shrink-0" />
          <span className="text-xs text-muted-foreground font-semibold">Wins:</span>
          <span className="text-sm font-extrabold">{winsToday.length}</span>
          <span className="text-xs text-muted-foreground">
            {winsToday.length === 1 ? "entry" : "entries"}
          </span>
          <span className="text-xs font-mono font-bold text-purple-600 bg-purple-50 dark:bg-purple-950/20 px-1.5 py-0.5 rounded">
            {fmtGHS(winsTodayAmount)}
          </span>
        </div>

        <div className="ml-auto flex-shrink-0">
          {hasCalcToday ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full font-bold shadow-sm shadow-emerald-500/5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Calculated for today
            </span>
          ) : (grossToday.length > 0 || winsToday.length > 0) ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full font-bold shadow-sm shadow-amber-500/5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block animate-pulse" />
              Entries pending calculation
            </span>
          ) : (
            <span className="text-xs text-muted-foreground bg-muted/60 px-3 py-1 rounded-full font-medium">
              No entries logged today
            </span>
          )}
        </div>
      </div>

      {/* Redesigned Summary cards — 6 KPI Grid with custom accent colors & icons */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={anyPending ? "Gross (Live)" : "Total Gross"}
          value={fmtGHS(totals.gross)}
          pending={anyPending}
          icon={<Wallet className="w-4 h-4" />}
          colorClass="text-blue-500 bg-blue-50 dark:bg-blue-950/30"
          description={anyPending ? "Live compiled sales" : "Calculated sales volume"}
        />
        <StatCard
          label={anyPending ? "Wins (Live)" : "Total Wins"}
          value={fmtGHS(totals.wins)}
          pending={anyPending}
          icon={<Trophy className="w-4 h-4" />}
          colorClass="text-purple-500 bg-purple-50 dark:bg-purple-950/30"
          description={anyPending ? "Est. pending claims" : "Finalized payouts"}
        />
        <StatCard
          label={anyPending ? "Commission ~" : "Commission"}
          value={fmtGHS(totals.commission)}
          pending={anyPending}
          icon={<Percent className="w-4 h-4" />}
          colorClass="text-amber-500 bg-amber-50 dark:bg-amber-950/30"
          description="Total agent deductions"
        />
        <StatCard
          label={anyPending ? "Net Gross ~" : "Net Gross"}
          value={fmtGHS(totals.net)}
          pending={anyPending}
          icon={<TrendingUp className="w-4 h-4" />}
          colorClass="text-teal-500 bg-teal-50 dark:bg-teal-950/30"
          description="Gross minus commission"
        />
        <StatCard 
          label="Reserve Fund" 
          value={fmtGHS(accumulatedReserve)} 
          accent 
          icon={<Shield className="w-4 h-4" />}
          colorClass="text-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
          description="Aggregated safety pool"
        />
        <StatCard
          label={anyPending ? "Est. Balance" : "Operational Bal"}
          value={fmtGHS(totals.balance)}
          accent={totals.balance >= 0}
          pending={anyPending}
          icon={<DollarSign className="w-4 h-4" />}
          colorClass={totals.balance >= 0 ? "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "text-rose-500 bg-rose-50 dark:bg-rose-950/30"}
          description={anyPending ? "Estimated daily yield" : "Net calculated balance"}
        />
      </div>

      {/* Analytics & Company Expenses Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart Column (2/3 span) */}
        <Card className="lg:col-span-2 border border-border/60 bg-card/50 backdrop-blur-md">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Sales & Profitability Trends
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Visualizing performance for the last 7 calculation days
                </p>
              </div>
              <Sparkles className="w-4 h-4 text-accent animate-pulse" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {chartData.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground text-xs border border-dashed rounded-lg">
                <FileText className="w-8 h-8 mb-2 opacity-50" />
                No historical calculations found to plot.
              </div>
            ) : (
              <div className="w-full h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorGross" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorWins" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#7c3aed" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/40" />
                    <XAxis 
                      dataKey="date" 
                      tickLine={false} 
                      axisLine={false} 
                      className="text-[10px] fill-muted-foreground font-medium" 
                    />
                    <YAxis 
                      tickLine={false} 
                      axisLine={false} 
                      className="text-[10px] fill-muted-foreground font-medium" 
                      tickFormatter={(val) => `GH₵${val}`}
                    />
                    <ChartTooltip 
                      contentStyle={{ 
                        background: "rgba(255, 255, 255, 0.95)",
                        border: "1px solid rgba(0, 0, 0, 0.1)",
                        borderRadius: "8px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                        fontSize: "11px"
                      }}
                      formatter={(value: any) => [fmtGHS(Number(value)), ""]}
                    />
                    <ChartLegend verticalAlign="top" height={36} className="text-xs" />
                    <Area 
                      name="Gross Sales" 
                      type="monotone" 
                      dataKey="gross" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorGross)" 
                    />
                    <Area 
                      name="Wins Claimed" 
                      type="monotone" 
                      dataKey="wins" 
                      stroke="#7c3aed" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorWins)" 
                    />
                    <Area 
                      name="Net Yield" 
                      type="monotone" 
                      dataKey="balance" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorNet)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expenses Widget (1/3 span) */}
        <Card className="border border-border/60 bg-card/50 backdrop-blur-md flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Building className="w-4 h-4 text-accent" />
              Company Expense Hub
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Financial health for {viewDate}
            </p>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col space-y-4 justify-between">
            {/* Expense details summary */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs text-muted-foreground">Reserve Cash Pool</span>
                <span className="text-sm font-bold font-mono text-primary">{fmtGHS(accumulatedReserve)}</span>
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs text-muted-foreground">Outlays recorded today</span>
                <span className="text-sm font-bold font-mono text-destructive">{fmtGHS(totalExpensesAmount)}</span>
              </div>
              
              {/* Calculated Cash Position */}
              <div className="rounded-lg bg-muted/40 p-2.5 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Net Cashflow Position
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">
                    Operational Balance - Expenses
                  </div>
                </div>
                <div className={`text-base font-extrabold font-mono ${
                  (totals.balance - totalExpensesAmount) >= 0 ? "text-emerald-600" : "text-destructive"
                }`}>
                  {fmtGHS(totals.balance - totalExpensesAmount)}
                </div>
              </div>
            </div>

            {/* List of recent expenses */}
            <div className="space-y-2 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">
                Recent Outlays
              </div>
              {dateExpenses.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                  No company expenses recorded on this date.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {dateExpenses.slice(0, 3).map(exp => (
                    <div key={exp.id} className="flex items-center justify-between bg-muted/20 hover:bg-muted/40 p-2 rounded text-xs transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate text-foreground">{exp.description}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          Payee: {exp.payeeName}
                        </div>
                      </div>
                      <div className="text-right pl-2">
                        <div className="font-bold font-mono text-destructive">-{fmtGHS(Number(exp.amount))}</div>
                        <div className="text-[9px] text-muted-foreground uppercase">{exp.type}</div>
                      </div>
                    </div>
                  ))}
                  {dateExpenses.length > 3 && (
                    <div className="text-[10px] text-center text-primary font-medium">
                      + {dateExpenses.length - 3} more items
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Manage Expenses link button */}
            <Button 
              size="sm" 
              variant="outline" 
              className="w-full text-xs font-semibold mt-2 h-9 flex items-center justify-center gap-1.5"
              onClick={() => navigate("/company-expenses")}
            >
              <FileText className="w-3.5 h-3.5" />
              Manage Company Expenses
              <ArrowRight className="w-3 h-3 ml-0.5" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Redesigned Controls & Search Toolbar */}
      <div className="border border-border/60 bg-card/45 backdrop-blur-md px-4 py-2.5 rounded-xl flex items-center justify-between gap-4 flex-wrap shadow-sm">
        <div className="flex items-center gap-3 flex-wrap flex-1">
          {/* Date Picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Period:</span>
            <Input
              type="date"
              value={viewDate}
              onChange={e => { setSelectedDate(e.target.value); setPage(1); }}
              className="h-8.5 text-xs w-36 bg-background/60 border-border/50"
            />
            {selectedDate && (
              <Button size="sm" variant="ghost" className="h-8 text-xs px-2" onClick={() => { setSelectedDate(""); setPage(1); }}>
                Reset
              </Button>
            )}
          </div>
          
          <div className="h-4 w-px bg-border/65 hidden sm:block" />

          {/* Search Input */}
          <div className="relative flex-1 max-w-xs min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/75" />
            <Input
              type="search"
              placeholder="Search agent name or code..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="h-8.5 pl-8 text-xs bg-background/60 border-border/50 placeholder:text-muted-foreground/60 focus:bg-background transition-all"
            />
          </div>
          
          {loadingCalcs && <span className="text-xs text-muted-foreground/70 animate-pulse">Syncing...</span>}
        </div>

        {/* View toggle & counts */}
        <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
          <span className="text-xs text-muted-foreground/80 font-medium">
            {filteredAgentStats.length === agentStats.length ? (
              <>Showing {agentStats.length} agent{agentStats.length !== 1 ? "s" : ""}</>
            ) : (
              <>Found {filteredAgentStats.length} of {agentStats.length} agent{agentStats.length !== 1 ? "s" : ""}</>
            )}
          </span>

          <div className="flex items-center gap-1 border border-border/50 rounded-lg p-0.5 bg-muted/40">
            <button
              onClick={() => handleViewMode("grid")}
              className={`p-1.5 rounded-md transition-all duration-200 ${
                viewMode === "grid" 
                  ? "bg-background text-primary shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              }`}
              title="Grid view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleViewMode("list")}
              className={`p-1.5 rounded-md transition-all duration-200 ${
                viewMode === "list" 
                  ? "bg-background text-primary shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              }`}
              title="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
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
