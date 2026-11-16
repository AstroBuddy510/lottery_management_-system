import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getServerNow } from "../lib/time-sync";
import { LiveSalesSection } from "@/components/live-sales";
import { useAuth } from "@/lib/auth";
import { AgentDashboard } from "@/pages/agent-dashboard";
import { CountdownTimer } from "@/pages/games";
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtGHS } from "@/lib/utils";

// Lucide icons for premium styling
import {
  Wallet, Trophy, Percent, TrendingUp, Shield, DollarSign,
  Search, LayoutGrid, List, ChevronRight, ArrowRight,
  Clock, Activity, FileText, AlertCircle, RefreshCw,
  ArrowUpRight, ArrowDownRight, Users, Sparkles, Building, ChevronLeft, CheckCircle2, ChevronsLeft, ChevronsRight,
} from "lucide-react";

// Recharts charting library for premium business analytics
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as ChartTooltip, Legend as ChartLegend
} from "recharts";


const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
/** Six agencies a page, whether shown as cards or as table rows. */
const AGENCIES_PER_PAGE = 6;

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
  agent: { id: string; agentCode: string; fullCode: string; isActive: boolean; agencyName?: string | null; user: { fullName: string; profilePicture?: string | null } };
  gross: number; commission: number; net: number; wins: number; reserve: number; balance: number;
  submittedWriters: number; totalWriters: number; hasPaid: boolean;
  isPending: boolean;
  /** Where this agent's gross came from, for the source breakdown. */
  entryGross?: number; ticketGross?: number; ticketCount?: number;
};

function AgentGridCard({ stat, onClick }: { stat: AgentStat; onClick: () => void }) {
  const { agent, gross, commission, net, wins, reserve, balance, submittedWriters, totalWriters, hasPaid, isPending } = stat;
  const entryGross = stat.entryGross ?? 0;
  const ticketGross = stat.ticketGross ?? 0;
  const ticketCount = stat.ticketCount ?? 0;
  const name = agent.user.fullName;
  const submitPct = totalWriters > 0 ? Math.min(100, (submittedWriters / totalWriters) * 100) : 0;
  const winRate = gross > 0 ? Math.min(100, (wins / gross) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-left rounded-2xl border bg-card shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex flex-col overflow-hidden ${isPending ? "border-amber-500/40" : ""}`}
    >
      <div className="flex items-center gap-3 px-4 pt-4">
        <div className={`rounded-full p-0.5 ${agent.isActive ? "ring-2 ring-emerald-500/60" : "ring-2 ring-muted-foreground/25"}`}>
          <AgentAvatar name={name} picture={agent.user.profilePicture} size="sm" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{agent.agencyName || name}</div>
          <div className="text-[11px] text-muted-foreground truncate"><span className="font-mono">{agent.fullCode}</span>{agent.agencyName ? ` · ${name}` : ""}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${hasPaid ? "bg-sky-500/10 text-sky-700 dark:text-sky-400" : "bg-rose-500/10 text-rose-700 dark:text-rose-400"}`}>
            {hasPaid ? "Reserve paid" : "Reserve due"}
          </span>
          {isPending && <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Estimate</span>}
        </div>
      </div>

      <div className="px-4 pt-3 pb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Balance</div>
          <div className={`font-mono text-xl font-black truncate ${balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{fmtGHS(balance)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Gross</div>
          <div className="font-mono text-sm font-bold">{fmtGHS(gross)}</div>
        </div>
      </div>

      <div className="mx-4 grid grid-cols-4 gap-px rounded-xl overflow-hidden bg-border/60 text-center">
        {[
          ["Comm.", commission], ["Net", net], ["Reserve", reserve], ["Wins", wins],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-muted/40 px-1 py-1.5 min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{l as string}</div>
            <div className="font-mono text-[11px] font-semibold truncate">{fmtGHS(v as number)}</div>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 space-y-2 mt-auto">
        {(entryGross > 0 || ticketGross > 0) && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 mr-1" />Entries {fmtGHS(entryGross)}</span>
              <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500 mr-1" />POS {fmtGHS(ticketGross)}{ticketCount ? ` · ${ticketCount}` : ""}</span>
            </div>
            <div className="flex h-1 rounded-full overflow-hidden bg-muted">
              <div className="bg-sky-500" style={{ width: `${gross > 0 ? (entryGross / gross) * 100 : 0}%` }} />
              <div className="bg-violet-500" style={{ width: `${gross > 0 ? (ticketGross / gross) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>Writers reporting</span><span className="font-mono font-semibold text-foreground">{submittedWriters}/{totalWriters}</span></div>
            <div className="h-1 rounded-full bg-muted overflow-hidden"><div className={`h-full ${submitPct === 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${submitPct}%` }} /></div>
          </div>
          <div className="w-16 space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>Wins</span><span className="font-mono font-semibold text-foreground">{Math.round(winRate)}%</span></div>
            <div className="h-1 rounded-full bg-muted overflow-hidden"><div className={`h-full ${winRate > 80 ? "bg-rose-500" : winRate > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${winRate}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="border-t px-4 py-2 flex items-center justify-between text-[11px] bg-muted/20">
        <span className="text-muted-foreground">{agent.isActive ? "Active agency" : "Inactive agency"}</span>
        <span className="font-semibold text-primary inline-flex items-center gap-0.5 group-hover:gap-1.5 transition-all">Open <ChevronRight className="w-3 h-3" /></span>
      </div>
    </button>
  );
}

function AgentListRow({ stat, onClick }: { stat: AgentStat; onClick: () => void }) {
  const { agent, gross, net, wins, balance, submittedWriters, totalWriters, hasPaid, isPending } = stat;
  const name = agent.user.fullName;
  const submitPct = totalWriters > 0 ? Math.min(100, (submittedWriters / totalWriters) * 100) : 0;
  return (
    <tr className={`border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors ${isPending ? "bg-amber-500/[0.03]" : ""}`} onClick={onClick}>
      <td className="py-3 pl-4 pr-2">
        <div className="flex items-center gap-3">
          <div className={`rounded-full p-0.5 ${agent.isActive ? "ring-2 ring-emerald-500/60" : "ring-2 ring-muted-foreground/25"}`}>
            <AgentAvatar name={name} picture={agent.user.profilePicture} size="sm" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{agent.agencyName || name}</div>
            <div className="text-[11px] text-muted-foreground truncate"><span className="font-mono">{agent.fullCode}</span>{agent.agencyName ? ` · ${name}` : ""}</div>
          </div>
        </div>
      </td>
      <td className="py-3 px-3 text-right font-mono text-sm whitespace-nowrap">{fmtGHS(gross)}</td>
      <td className="py-3 px-3 text-right font-mono text-sm whitespace-nowrap">{fmtGHS(net)}</td>
      <td className="py-3 px-3 text-right font-mono text-sm whitespace-nowrap text-violet-600 dark:text-violet-400">{fmtGHS(wins)}</td>
      <td className={`py-3 px-3 text-right font-mono text-sm font-bold whitespace-nowrap ${balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
        {fmtGHS(balance)}{isPending && <span className="ml-1 text-[9px] font-bold text-amber-600 align-super">EST</span>}
      </td>
      <td className="py-3 px-3">
        <div className="w-24 space-y-1">
          <div className="text-[11px] font-mono font-semibold text-right">{submittedWriters}/{totalWriters}</div>
          <div className="h-1 rounded-full bg-muted overflow-hidden"><div className={`h-full ${submitPct === 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${submitPct}%` }} /></div>
        </div>
      </td>
      <td className="py-3 px-3">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${hasPaid ? "bg-sky-500/10 text-sky-700 dark:text-sky-400" : "bg-rose-500/10 text-rose-700 dark:text-rose-400"}`}>{hasPaid ? "Paid" : "Due"}</span>
      </td>
      <td className="py-3 pl-2 pr-4 text-right"><ChevronRight className="w-4 h-4 text-muted-foreground inline" /></td>
    </tr>
  );
}

function Pagination({ page, totalPages, onPage, total, pageSize, noun }: {
  page: number; totalPages: number; onPage: (p: number) => void; total: number; pageSize: number; noun: string;
}) {
  if (total === 0) return null;
  const list: (number | "…")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) list.push(i);
    else if (list[list.length - 1] !== "…") list.push("…");
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = "h-8 w-8 inline-flex items-center justify-center rounded-lg border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none";
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t pt-4">
      <span className="text-xs text-muted-foreground">
        Showing <span className="font-semibold text-foreground">{from}–{to}</span> of <span className="font-semibold text-foreground">{total}</span> {noun}
        <span className="hidden sm:inline"> · {pageSize} per page</span>
      </span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="First page" title="First page" className={btn} disabled={page === 1} onClick={() => onPage(1)}><ChevronsLeft className="w-4 h-4" /></button>
        <button type="button" aria-label="Previous page" title="Previous page" className={btn} disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft className="w-4 h-4" /></button>
        {list.map((n, i) => n === "…" ? <span key={`g${i}`} className="px-1 text-xs text-muted-foreground">…</span> : (
          <button key={n} type="button" onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined}
            className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-semibold ${n === page ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{n}</button>
        ))}
        <button type="button" aria-label="Next page" title="Next page" className={btn} disabled={page === totalPages} onClick={() => onPage(page + 1)}><ChevronRight className="w-4 h-4" /></button>
        <button type="button" aria-label="Last page" title="Last page" className={btn} disabled={page === totalPages} onClick={() => onPage(totalPages)}><ChevronsRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

/** A dashboard section: a titled panel that every block on the page shares. */
function Panel({ title, subtitle, icon, right, children, className = "" }: {
  title: string; subtitle?: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border bg-card shadow-sm flex flex-col min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3 border-b">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-tight">{title}</h2>
            {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      <div className="p-5 flex-1 min-h-0">{children}</div>
    </section>
  );
}

const compactGhs = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}m` : a >= 1_000 ? `${(a / 1_000).toFixed(1)}k` : a.toFixed(0);
  return `${v < 0 ? "−" : ""}₵${s}`;
};

/**
 * Platform totals for the displayed draw, unified across agent entries and
 * writer-portal sales. Computed server-side with the same calculateWriter the
 * daily run uses, so these cards cannot drift from the committed figures.
 */
function useUnifiedSummary(gameId: string | undefined, date: string | undefined) {
  return useQuery<{
    calcDate: string;
    isPending: boolean;
    totals: {
      gross: number; commission: number; netBeforeDeduction: number;
      reserve: number; netAfterReserve: number; wins: number; profitOrDeficit: number;
    };
    sourceSplit: { entryGross: number; ticketGross: number; entryWins: number; ticketWins: number; ticketCount: number };
    breakdown: Array<{
      agentId: string; agentCode: string; agentName: string; agencyName: string | null;
      gross: number; commission: number; netBeforeDeduction: number; reserve: number;
      netAfterReserve: number; wins: number; profitOrDeficit: number;
      writerCount: number; ticketCount: number; isPending: boolean;
      entryGross: number; ticketGross: number; entryWins: number; ticketWins: number;
    }>;
  }>({
    queryKey: ["/api/dashboard/unified-summary", gameId, date],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gameId) params.set("gameId", gameId);
      if (date) params.set("date", date);
      const res = await fetch(`/api/dashboard/unified-summary?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("Failed to load summary");
      return res.json();
    },
    refetchInterval: 15_000,
  });
}

function DirectorDashboard() {
  const [, navigate] = useLocation();
  const today = new Date(getServerNow()).toISOString().split("T")[0];
  const todayDow = new Date(getServerNow()).getDay();

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

  const liveGames = useMemo(() => {
    return gameList.filter(g => g.status === "live");
  }, [gameList]);

  const otherGames = useMemo(() => {
    return gameList.filter(g => g.status !== "live");
  }, [gameList]);

  // Most recent draw first, by when it closed rather than by event number.
  const closedGamesNewestFirst = useMemo(
    () => [...otherGames].sort((a, b) => new Date(b.closeAt).getTime() - new Date(a.closeAt).getTime()),
    [otherGames],
  );

  const currentGame = useMemo(() => {
    return liveGames[0] ?? null;
  }, [liveGames]);

  const displayGame = useMemo(() => {
    if (!selectedGameId || selectedGameId === "_live" || selectedGameId === "_none") return currentGame;
    return gameList.find(g => g.id === selectedGameId) ?? currentGame;
  }, [selectedGameId, gameList, currentGame]);

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

  const mostRecentDate = useMemo(() => {
    if (!calcList.length) return today;
    return calcList.reduce((m, c) => {
      const d = c.calcDate?.split("T")[0] ?? "";
      return d > m ? d : m;
    }, "");
  }, [calcList, today]);

  const viewDate = selectedDate || (displayGame ? new Date(displayGame.closeAt).toISOString().split("T")[0] : mostRecentDate);

  const dateCalcs = useMemo(() =>
    calcList.filter(c => c.calcDate?.startsWith(viewDate) && (!displayGame || c.gameId === displayGame.id)),
    [calcList, viewDate, displayGame]
  );

  const commPct = Number(settings?.commissionPct ?? 0);
  const resvPct = Number(settings?.reservePct ?? 0);
  const liveGrossList = Array.isArray(liveGross) ? liveGross : [];
  const liveWinsList  = Array.isArray(liveWins)  ? liveWins  : [];

  // Platform totals come from the server, which unifies agent-entered figures
  // with writer-portal ticket sales and applies the same calculateWriter the
  // daily run uses. The per-agent table below still drives its own rows.
  const { data: unified } = useUnifiedSummary(displayGame?.id, viewDate);

  // Per-agent figures from the server, unified across both submission routes.
  const unifiedByAgent = useMemo(() => {
    const map = new Map<string, NonNullable<typeof unified>["breakdown"][number]>();
    for (const row of unified?.breakdown ?? []) map.set(row.agentId, row);
    return map;
  }, [unified]);

  const agentStats: AgentStat[] = useMemo(() =>
    agentList.map(agent => {
      const writerIds = new Set(allWriters.filter(w => w.agentId === agent.id).map(w => w.id));
      const totalWriters = allWriters.filter(w => w.agentId === agent.id && w.isActive).length;
      const agentCalcs = dateCalcs.filter(c => writerIds.has(c.writerId));

      const hasPaid = paymentList.some(p => p.agentId === agent.id && !p.isVoided && p.paymentDate?.startsWith(viewDate));
      const agentInfo = {
        id: agent.id, agentCode: agent.agentCode, fullCode: agent.fullCode, isActive: agent.isActive,
        agencyName: agent.agencyName ?? null,
        user: { fullName: agent.user?.fullName ?? agent.fullCode, profilePicture: agent.user?.profilePicture },
      };

      const server = unifiedByAgent.get(agent.id);

      // Prefer the server's unified figures - they include writer-portal
      // sales, which neither the stored rows below nor the local live
      // fallback account for on their own.
      if (server) {
        return {
          agent: agentInfo,
          gross:      server.gross,
          commission: server.commission,
          net:        server.netBeforeDeduction,
          reserve:    server.reserve,
          wins:       server.wins,
          balance:    server.profitOrDeficit,
          submittedWriters: server.writerCount,
          totalWriters, hasPaid,
          isPending: server.isPending,
          entryGross: server.entryGross,
          ticketGross: server.ticketGross,
          ticketCount: server.ticketCount,
        };
      }

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

      const liveGrossEntries = liveGrossList.filter(e => writerIds.has(e.writerId) && e.entryDate?.startsWith(viewDate) && (!displayGame || e.gameId === displayGame.id));
      const liveWinsEntries  = liveWinsList.filter( e => writerIds.has(e.writerId) && e.entryDate?.startsWith(viewDate) && (!displayGame || e.gameId === displayGame.id));
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
    [agentList, allWriters, dateCalcs, paymentList, viewDate, liveGrossList, liveWinsList, commPct, resvPct, displayGame, unifiedByAgent]
  );

  const localTotals = useMemo(() => agentStats.reduce(
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

  // Fall back to the entry-only figures if the summary hasn't loaded yet.
  const totals = unified
    ? {
        gross:      unified.totals.gross,
        commission: unified.totals.commission,
        net:        unified.totals.netBeforeDeduction,
        wins:       unified.totals.wins,
        reserve:    unified.totals.reserve,
        balance:    unified.totals.profitOrDeficit,
      }
    : localTotals;

  const portalTicketCount = unified?.sourceSplit.ticketCount ?? 0;
  const portalGross = unified?.sourceSplit.ticketGross ?? 0;
  const entryGross = unified?.sourceSplit.entryGross ?? 0;

  const anyPending = unified
    ? unified.isPending
    : agentStats.some(s => s.isPending);

  const accumulatedReserve = Number(reserve?.balance ?? 0);

  const grossToday = useMemo(
    () => (Array.isArray(liveGross) ? liveGross : []).filter(e => e.entryDate?.startsWith(viewDate) && (!displayGame || e.gameId === displayGame.id)),
    [liveGross, viewDate, displayGame]
  );
  const winsToday = useMemo(
    () => (Array.isArray(liveWins) ? liveWins : []).filter(e => e.entryDate?.startsWith(viewDate) && (!displayGame || e.gameId === displayGame.id)),
    [liveWins, viewDate, displayGame]
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
    () => calcList.some(c => c.calcDate?.startsWith(viewDate) && (!displayGame || c.gameId === displayGame.id)),
    [calcList, viewDate, displayGame]
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
      (s.agent.agencyName ?? "").toLowerCase().includes(q) ||
      s.agent.fullCode.toLowerCase().includes(q)
    );
  }, [agentStats, search]);

  const pageSize = AGENCIES_PER_PAGE;
  const totalPages = Math.max(1, Math.ceil(filteredAgentStats.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedStats = filteredAgentStats.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handlePage = (p: number) => setPage(p);
  // Same six a page in both views, so switching keeps your place.
  const handleViewMode = (mode: "grid" | "list") => { setViewMode(mode); };

  const isLiveView = !selectedGameId || selectedGameId === "_live" || selectedGameId === "_none";
  const winShare = totals.gross > 0 ? (totals.wins / totals.gross) * 100 : 0;
  const netAfterReserve = totals.net - totals.reserve;
  const cashPosition = totals.balance - totalExpensesAmount;
  const viewDateLabel = viewDate
    ? new Date(`${viewDate}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "";

  return (
    <div className="space-y-5">
      {/* ── Draw context: which game, which day, how far along ── */}
      <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
        <div className="flex flex-col xl:flex-row xl:items-center gap-4 p-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${displayGame?.status === "live" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              <Activity className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{isLiveView ? "Current draw" : "Viewing draw"} · {viewDateLabel}</div>
              {displayGame ? (
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <span className="text-base font-black tracking-tight truncate">{displayGame.name}</span>
                  <span className="font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">#{displayGame.eventNumber}</span>
                  {displayGame.status === "live" ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500 text-white"><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />LIVE</span>
                      <CountdownTimer closeAt={displayGame.closeAt} status={displayGame.status} className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full" />
                    </>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase">{displayGame.status}</span>
                  )}
                </div>
              ) : (
                <div className="text-sm font-semibold text-muted-foreground mt-0.5">No game is live for {DAY_NAMES[todayDow]}</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedGameId || "_live"} onValueChange={handleGameSelect}>
              <SelectTrigger className="h-9 text-xs w-[220px] bg-background"><SelectValue placeholder="Select game…" /></SelectTrigger>
              {/* A long season of draws: the menu has a fixed height and a visible
                  scrollbar, and the current event stays pinned at the top while
                  the closed and offline draws scroll beneath it. */}
              <SelectContent align="end" className="select-scroll w-[300px] max-h-[min(22rem,var(--radix-select-content-available-height))]">
                <SelectItem value="_live" className="sticky top-0 z-10 bg-popover font-semibold border-b rounded-none mb-1">
                  {currentGame ? (
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="truncate">Current: {currentGame.name}</span>
                      <span className="font-mono text-[10px] opacity-70 shrink-0">#{currentGame.eventNumber}</span>
                    </span>
                  ) : "Current game (none live)"}
                </SelectItem>
                {liveGames.length > 1 && (
                  <SelectGroup>
                    <SelectLabel className="text-[10px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">Live · {liveGames.length}</SelectLabel>
                    {liveGames.map(g => <SelectItem key={g.id} value={g.id}><span className="font-mono text-xs text-muted-foreground mr-1.5">#{g.eventNumber}</span>{g.name}</SelectItem>)}
                  </SelectGroup>
                )}
                {closedGamesNewestFirst.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Closed / offline · {closedGamesNewestFirst.length}</SelectLabel>
                    {closedGamesNewestFirst.map(g => (
                      <SelectItem key={g.id} value={g.id}>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{g.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">#{g.eventNumber}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">· {new Date(g.closeAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            <Input type="date" value={viewDate} onChange={e => { setSelectedDate(e.target.value); setPage(1); }} className="h-9 text-xs w-[150px] bg-background" aria-label="Day" />
            {(!isLiveView || selectedDate) && (
              <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => { handleGameSelect("_live"); setSelectedDate(""); }}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Back to live
              </Button>
            )}
          </div>
        </div>

        <div className="border-t bg-muted/30 px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {liveGames.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {liveGames.map(g => (
                <button key={g.id} type="button" onClick={() => handleGameSelect(g.id)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors ${displayGame?.id === g.id ? "bg-foreground text-background border-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                  {g.name}
                </button>
              ))}
            </div>
          )}
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-500" /><span className="text-muted-foreground">Gross entries</span><span className="font-bold">{grossToday.length}</span><span className="font-mono font-semibold">{fmtGHS(grossTodayAmount)}</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-500" /><span className="text-muted-foreground">Wins entries</span><span className="font-bold">{winsToday.length}</span><span className="font-mono font-semibold">{fmtGHS(winsTodayAmount)}</span></span>
          {portalTicketCount > 0 && (
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-muted-foreground">POS tickets</span><span className="font-bold">{portalTicketCount}</span><span className="font-mono font-semibold">{fmtGHS(portalGross)}</span></span>
          )}
          <span className="ml-auto">
            {hasCalcToday ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Draw calculated</span>
            ) : (grossToday.length > 0 || winsToday.length > 0 || portalTicketCount > 0) ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400"><Clock className="w-3.5 h-3.5" /> Figures are estimates until Run Draws</span>
            ) : (
              <span className="text-muted-foreground">Nothing recorded for this draw yet</span>
            )}
          </span>
        </div>
      </div>

      {/* ── Headline figures ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <HeroCard label="Gross sales" value={fmtGHS(totals.gross)} icon={<Wallet className="w-4 h-4" />} edge="border-l-sky-500" estimate={anyPending}
          footer={(entryGross > 0 || portalGross > 0) ? (
            <div className="space-y-1">
              <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                <div className="bg-sky-500" style={{ width: `${totals.gross > 0 ? (entryGross / totals.gross) * 100 : 0}%` }} />
                <div className="bg-violet-500" style={{ width: `${totals.gross > 0 ? (portalGross / totals.gross) * 100 : 0}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>Entries {compactGhs(entryGross)}</span><span>POS {compactGhs(portalGross)}</span></div>
            </div>
          ) : <span className="text-[10px] text-muted-foreground">Agent entries and POS sales together</span>} />
        <HeroCard label="Wins" value={fmtGHS(totals.wins)} icon={<Trophy className="w-4 h-4" />} edge="border-l-violet-500" estimate={anyPending}
          footer={<div className="space-y-1">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className={`h-full ${winShare > 80 ? "bg-rose-500" : winShare > 50 ? "bg-amber-500" : "bg-violet-500"}`} style={{ width: `${Math.min(100, winShare)}%` }} /></div>
            <div className="text-[10px] text-muted-foreground">{winShare.toFixed(1)}% of gross paid back</div>
          </div>} />
        <HeroCard label="Reserve set aside" value={fmtGHS(totals.reserve)} icon={<Shield className="w-4 h-4" />} edge="border-l-amber-500" estimate={anyPending}
          footer={<div className="text-[10px] text-muted-foreground">Fund balance <span className="font-mono font-semibold text-foreground">{fmtGHS(accumulatedReserve)}</span></div>} />
        <HeroCard label={totals.balance >= 0 ? "Profit" : "Deficit"} value={fmtGHS(totals.balance)} icon={<DollarSign className="w-4 h-4" />}
          edge={totals.balance >= 0 ? "border-l-emerald-500" : "border-l-rose-500"} estimate={anyPending}
          valueClass={totals.balance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
          footer={<div className="text-[10px] text-muted-foreground">{totals.gross > 0 ? `${((totals.balance / totals.gross) * 100).toFixed(1)}% margin on gross` : "No sales yet"}</div>} />
      </div>

      {/* ── How the draw adds up ── */}
      <div className="rounded-2xl border bg-card shadow-sm px-4 py-3 overflow-x-auto">
        <div className="flex items-stretch gap-1 min-w-[1000px] xl:min-w-0">
          {[
            { label: "Gross", value: totals.gross, cls: "" },
            { op: "−", label: "Commission", value: totals.commission, cls: "text-muted-foreground" },
            { op: "=", label: "Net before reserve", value: totals.net, cls: "" },
            { op: "−", label: "Reserve", value: totals.reserve, cls: "text-amber-600 dark:text-amber-400" },
            { op: "=", label: "Net after reserve", value: netAfterReserve, cls: "" },
            { op: "−", label: "Wins", value: totals.wins, cls: "text-violet-600 dark:text-violet-400" },
            { op: "=", label: totals.balance >= 0 ? "Profit" : "Deficit", value: totals.balance, cls: totals.balance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400", strong: true },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-1 flex-1 min-w-0">
              {step.op && <span className="text-sm font-bold text-muted-foreground/60 w-4 text-center shrink-0">{step.op}</span>}
              <div className={`flex-1 min-w-0 rounded-xl px-3 py-2 ${step.strong ? "bg-muted/60" : ""}`}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">{step.label}</div>
                <div className={`font-mono text-sm font-bold truncate ${step.cls}`}>{fmtGHS(step.value)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Trend + cash ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <Panel className="xl:col-span-8" title="Sales and profitability" subtitle="The last seven calculated days" icon={<TrendingUp className="w-4 h-4" />}>
          {chartData.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-muted-foreground text-xs border border-dashed rounded-xl">
              <FileText className="w-8 h-8 mb-2 opacity-40" />
              No calculated days to plot yet.
            </div>
          ) : (
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dGross" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25} /><stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} /></linearGradient>
                    <linearGradient id="dWins" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient>
                    <linearGradient id="dNet" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.2} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} />
                  <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => compactGhs(v)} />
                  <ChartTooltip
                    contentStyle={{ background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 11 }}
                    labelFormatter={(d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                    formatter={(value: number, name: string) => [fmtGHS(Number(value)), name]}
                  />
                  <ChartLegend verticalAlign="top" height={30} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Area name="Gross" type="monotone" dataKey="gross" stroke="#0ea5e9" strokeWidth={2} fill="url(#dGross)" />
                  <Area name="Wins" type="monotone" dataKey="wins" stroke="#8b5cf6" strokeWidth={2} fill="url(#dWins)" />
                  <Area name="Balance" type="monotone" dataKey="balance" stroke="#10b981" strokeWidth={2} fill="url(#dNet)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel className="xl:col-span-4" title="Cash position" subtitle={`For ${viewDateLabel}`} icon={<Building className="w-4 h-4" />}
          right={<Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => navigate("/company-expenses")}>Expenses <ArrowRight className="w-3 h-3 ml-1" /></Button>}>
          <div className="space-y-4">
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Draw {totals.balance >= 0 ? "profit" : "deficit"}</span><span className={`font-mono font-semibold ${totals.balance < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{fmtGHS(totals.balance)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Company expenses</span><span className="font-mono font-semibold text-rose-600 dark:text-rose-400">−{fmtGHS(totalExpensesAmount)}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="font-semibold">Net cash position</span><span className={`font-mono text-base font-black ${cashPosition >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{fmtGHS(cashPosition)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Reserve fund balance</span><span className="font-mono">{fmtGHS(accumulatedReserve)}</span></div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-2">Expenses this day · {dateExpenses.length}</div>
              {loadingExpenses ? (
                <div className="h-16 rounded-xl bg-muted animate-pulse" />
              ) : dateExpenses.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-xl">No expenses recorded.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {dateExpenses.map(exp => (
                    <div key={exp.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{exp.description}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{exp.payeeName} · {exp.type}</div>
                      </div>
                      <div className="font-mono font-semibold text-rose-600 dark:text-rose-400 shrink-0">−{fmtGHS(Number(exp.amount))}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Live POS sales ── */}
      <LiveSalesSection title="Live POS sales" />

      {/* ── Agencies ── */}
      <Panel title="Agency performance" icon={<Users className="w-4 h-4" />}
        subtitle={`${filteredAgentStats.length === agentStats.length ? agentStats.length : `${filteredAgentStats.length} of ${agentStats.length}`} agencies · ${viewDateLabel}`}
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input type="search" placeholder="Agency name or code" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-8 pl-8 pr-3 text-xs md:text-xs w-[240px] placeholder:text-center" />
            </div>
            <div className="flex items-center rounded-lg border p-0.5 bg-muted/40">
              <button type="button" onClick={() => handleViewMode("grid")} title="Cards" className={`p-1.5 rounded-md ${viewMode === "grid" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => handleViewMode("list")} title="Table" className={`p-1.5 rounded-md ${viewMode === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}><List className="w-3.5 h-3.5" /></button>
            </div>
            {loadingCalcs && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          </div>
        }>
        {filteredAgentStats.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">{agentStats.length === 0 ? "No agencies yet." : "No agency matches that search."}</p>
        ) : viewMode === "grid" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
              {pagedStats.map(stat => <AgentGridCard key={stat.agent.id} stat={stat} onClick={() => navigate(`/agents/${stat.agent.id}/detail`)} />)}
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPage={handlePage} total={filteredAgentStats.length} pageSize={pageSize} noun="agencies" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-[10px] text-muted-foreground uppercase tracking-wider">
                    <th className="text-left py-2.5 pl-4 pr-2 font-bold">Agency</th>
                    <th className="text-right py-2.5 px-3 font-bold">Gross</th>
                    <th className="text-right py-2.5 px-3 font-bold">Net</th>
                    <th className="text-right py-2.5 px-3 font-bold">Wins</th>
                    <th className="text-right py-2.5 px-3 font-bold">Balance</th>
                    <th className="text-right py-2.5 px-3 font-bold">Writers</th>
                    <th className="py-2.5 px-3 font-bold text-left">Reserve</th>
                    <th className="py-2.5 pl-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {pagedStats.map(stat => <AgentListRow key={stat.agent.id} stat={stat} onClick={() => navigate(`/agents/${stat.agent.id}/detail`)} />)}
                </tbody>
              </table>
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPage={handlePage} total={filteredAgentStats.length} pageSize={pageSize} noun="agencies" />
          </div>
        )}
      </Panel>
    </div>
  );
}

function HeroCard({ label, value, icon, edge, footer, estimate, valueClass = "" }: {
  label: string; value: string; icon: React.ReactNode; edge: string; footer?: React.ReactNode; estimate?: boolean; valueClass?: string;
}) {
  return (
    <div className={`bg-card border border-border border-l-4 ${edge} rounded-2xl p-4 shadow-sm flex flex-col gap-2 min-w-0`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">
          {label}{estimate && <span className="ml-1.5 normal-case tracking-normal font-bold text-amber-600 dark:text-amber-400">est.</span>}
        </div>
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">{icon}</div>
      </div>
      <div className={`font-mono text-xl sm:text-2xl font-black tracking-tight truncate ${valueClass}`}>{value}</div>
      <div className="mt-auto">{footer}</div>
    </div>
  );
}

/* ── Cashier window helpers ──────────────────────────────────────────────── */
function cashierWindowStatus(windows: TimeWindow[]) {
  const now   = getServerNow();
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
  const todayStr = useMemo(() => new Date(getServerNow()).toISOString().split("T")[0], []);

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

  const dateStr = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(getServerNow());

  return (
    <div className="space-y-6 relative z-10">

      {/* ── Time window banner ── */}
      <div className={`relative overflow-hidden rounded-2xl border px-5 py-4 flex items-center gap-4 flex-wrap backdrop-blur-md transition-all duration-300 ${
        ws.open 
          ? "bg-emerald-500/10 dark:bg-emerald-500/5 border-emerald-500/20 dark:border-emerald-500/10 text-emerald-800 dark:text-emerald-300 shadow-sm shadow-emerald-500/5" 
          : "bg-rose-500/10 dark:bg-rose-500/5 border-rose-500/20 dark:border-rose-500/10 text-rose-800 dark:text-rose-300 shadow-sm shadow-rose-500/5"
      }`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border transition-all ${
          ws.open 
            ? "bg-emerald-500/20 dark:bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400" 
            : "bg-rose-500/20 dark:bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
        }`}>
          <Clock className="w-5 h-5 animate-pulse" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-extrabold tracking-tight flex items-center gap-1.5">
            Payment Window: {ws.open ? "OPEN" : "CLOSED"}
            {ws.open && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
            {ws.open && ws.window && <span className="font-semibold text-xs text-muted-foreground/80 ml-1">· closes {fmtHHMM12(ws.window.windowClose)}</span>}
            {!ws.open && ws.nextTime && <span className="font-semibold text-xs text-muted-foreground/80 ml-1">· opens at {fmtHHMM12(ws.nextTime)}</span>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 font-medium">{dateStr}</div>
        </div>
        <Button
          size="sm"
          onClick={() => navigate("/payments")}
          className={`gap-2 rounded-xl text-xs font-bold shadow-md hover:-translate-y-0.5 transition-all duration-300 ${
            ws.open 
              ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white" 
              : "bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 text-white"
          }`}
        >
          Go to Cashier Station <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* ── Cash position stat cards ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Pay-In Today */}
        <div className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-emerald-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden p-4 flex flex-col justify-between min-h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Pay-In Today</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="text-xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">{fmtGHS(todayPayIn)}</div>
            <div className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">{todayValid.filter(p => p.transactionType === "pay_in").length} transaction(s)</div>
          </div>
        </div>

        {/* Pay-Out Today */}
        <div className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-orange-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden p-4 flex flex-col justify-between min-h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Pay-Out Today</span>
            <div className="p-1.5 rounded-lg bg-orange-500/10 dark:bg-orange-500/5 text-orange-600 dark:text-orange-400 border border-orange-500/25">
              <ArrowDownRight className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="text-xl font-bold font-mono tracking-tight text-orange-600 dark:text-orange-400">{fmtGHS(todayPayOut)}</div>
            <div className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">{todayValid.filter(p => p.transactionType === "pay_out").length} transaction(s)</div>
          </div>
        </div>

        {/* Net Cash Position */}
        <div className={`bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden p-4 flex flex-col justify-between min-h-[110px] ${
          netPos >= 0 ? "hover:border-indigo-500/20" : "hover:border-rose-500/20"
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Net Cash Position</span>
            <div className={`p-1.5 rounded-lg border ${
              netPos >= 0 
                ? "bg-indigo-500/10 dark:bg-indigo-500/5 text-indigo-600 dark:text-indigo-400 border-indigo-500/25" 
                : "bg-rose-500/10 dark:bg-rose-500/5 text-rose-600 dark:text-rose-400 border-rose-500/25"
            }`}>
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className={`text-xl font-bold font-mono tracking-tight ${netPos >= 0 ? "text-indigo-600 dark:text-indigo-400" : "text-rose-600 dark:text-rose-400"}`}>{fmtGHS(netPos)}</div>
            <div className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">Pay-In minus Pay-Out</div>
          </div>
        </div>

        {/* Settlement Today */}
        <div className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-primary/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden p-4 flex flex-col justify-between min-h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Settlement Today</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">{settledCount}</span>
              <span className="text-[10px] text-muted-foreground/70 font-semibold mr-1.5">settled</span>
              {outstandingCount > 0 && (
                <>
                  <span className="text-lg font-bold font-mono tracking-tight text-rose-600 dark:text-rose-400">{outstandingCount}</span>
                  <span className="text-[10px] text-rose-500 font-semibold">due</span>
                </>
              )}
            </div>
            <div className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">
              {(unread?.count ?? 0) > 0 ? (
                <span className="text-rose-500 font-bold">{unread!.count} unread notifications</span>
              ) : (
                "of active agents"
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Agent settlement snapshot ── */}
      {activeWithCalc.length > 0 && (
        <Card className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 px-5 pt-5 flex flex-row items-center justify-between space-y-0 border-b border-border/40">
            <div>
              <CardTitle className="text-sm font-bold text-foreground">Agent Settlement — Today</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Snapshot of agent balances and due outlays for current game session.</CardDescription>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10" onClick={() => navigate("/payments")}>
              Full Board →
            </Button>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/40">
            {activeWithCalc.map(row => {
              const { agent, balDue, collected, shortfall, hasCalc } = row;
              const isSettled   = hasCalc && Math.abs(shortfall) < 0.005;
              const isOutstand  = hasCalc && shortfall > 0.005;
              const isOverpaid  = hasCalc && shortfall < -0.005;

              const rowClass = isSettled
                ? "flex items-center gap-4 px-5 py-3.5 bg-emerald-500/[0.01] border-l-2 border-l-emerald-500 hover:bg-muted/5 transition-colors"
                : isOutstand
                  ? "flex items-center gap-4 px-5 py-3.5 bg-rose-500/[0.01] border-l-2 border-l-rose-500 hover:bg-muted/5 transition-colors"
                  : isOverpaid
                    ? "flex items-center gap-4 px-5 py-3.5 bg-amber-500/[0.01] border-l-2 border-l-amber-500 hover:bg-muted/5 transition-colors"
                    : "flex items-center gap-4 px-5 py-3.5 hover:bg-muted/5 transition-colors";

              return (
                <div key={agent.id} className={rowClass}>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-foreground truncate">{agent.user?.fullName ?? agent.fullCode}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{agent.fullCode}</div>
                  </div>
                  {hasCalc && (
                    <div className="text-right shrink-0">
                      <div className="text-[9px] text-muted-foreground/80 uppercase font-extrabold tracking-wider">Due</div>
                      <div className="text-xs font-mono font-bold text-foreground mt-0.5">{fmtGHS(balDue)}</div>
                    </div>
                  )}
                  <div className="text-right shrink-0 ml-4">
                    <div className="text-[9px] text-muted-foreground/80 uppercase font-extrabold tracking-wider">Collected</div>
                    <div className={`text-xs font-mono font-bold mt-0.5 ${collected > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{fmtGHS(collected)}</div>
                  </div>
                  <div className="w-28 text-right shrink-0 ml-4">
                    {isSettled && <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-400 shadow-xs">Settled ✓</span>}
                    {isOutstand && <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-700 dark:text-rose-400 shadow-xs">Due {fmtGHS(shortfall)}</span>}
                    {isOverpaid && <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400 shadow-xs">Overpaid</span>}
                    {!hasCalc && collected > 0 && <span className="text-[9.5px] text-muted-foreground font-semibold">Has txns</span>}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Recent transactions ── */}
      {recentTxns.length > 0 && (
        <Card className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden">
          <CardHeader className="pb-3 px-5 pt-5 border-b border-border/40">
            <CardTitle className="text-sm font-bold text-foreground">Recent Transactions — Today</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">Most recent payment logs recorded by cashier desk today.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/40">
            {recentTxns.map(p => {
              const isIn = p.transactionType === "pay_in";
              return (
                <div key={p.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/5 transition-colors">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-black shadow-sm ${
                    isIn ? "bg-gradient-to-br from-emerald-500 to-teal-600" : "bg-gradient-to-br from-orange-500 to-amber-600"
                  }`}>
                    {isIn ? "↓" : "↑"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-foreground truncate">{agentNameMap[p.agentId] ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{p.receiptNumber ?? "—"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xs font-mono font-bold ${isIn ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}>{fmtGHS(Number(p.amount))}</div>
                    <div className="text-[9.5px] text-muted-foreground mt-0.5 font-semibold">{isIn ? "Pay-In (Collection)" : "Pay-Out (Wins payout)"}</div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Empty state when no activity */}
      {todayValid.length === 0 && activeWithCalc.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-border/60 bg-card/45 backdrop-blur-md rounded-2xl text-muted-foreground text-xs space-y-3 max-w-lg mx-auto shadow-sm">
          <div className="text-3xl">💼</div>
          <div className="font-bold text-foreground">No transactions yet today</div>
          <div className="text-muted-foreground font-medium">Head to the Cashier Station to record payments</div>
          <Button size="sm" className="mt-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl shadow-md transition-all duration-300" onClick={() => navigate("/payments")}>
            Open Cashier Station
          </Button>
        </div>
      )}
    </div>
  );
}

function EntryDashboard({ type }: { type: "gross" | "wins" }) {
  const today = new Date(getServerNow()).toISOString().split("T")[0];
  const todayDow = new Date(getServerNow()).getDay();
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
  const liveGames = useMemo(() => {
    return gameList.filter(g => g.status === "live");
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
  }).format(getServerNow());

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
            {liveGames.length > 0 && (
              <span className="ml-2 font-medium text-foreground">
                · 🎮 {liveGames.map(g => g.name).join(", ")}
              </span>
            )}
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

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function Dashboard() {
  const { user } = useAuth();
  const role = user?.role ?? "";

  if (role === "agent") {
    return <AgentDashboard />;
  }

  const now = new Date(getServerNow());
  const firstName = (user?.fullName ?? "").split(" ")[0];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
          <h1 className="text-2xl font-black tracking-tight mt-0.5">{greeting(now)}{firstName ? `, ${firstName}` : ""}</h1>
          <p className="text-xs text-muted-foreground font-medium mt-1">Here is how today's draw is going.</p>
        </div>
        <span className="self-start sm:self-auto text-[11px] font-bold px-3 py-1 rounded-full border bg-card shadow-sm">{ROLE_LABELS[role] ?? role}</span>
      </div>

      {(role === "director" || role === "administrator") && <DirectorDashboard />}
      {role === "cashier" && <CashierDashboard />}
      {role === "gross_entry" && <EntryDashboard type="gross" />}
      {role === "wins_entry" && <EntryDashboard type="wins" />}
    </div>
  );
}
