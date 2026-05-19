import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  useListAgents, useGetReserveBalance, useGetUnreadCount,
  useListCalculations, useListPayments, useListGrossEntries,
  useListWinsEntries, useListSales, useListGames,
  getGetUnreadCountQueryKey, getListCalculationsQueryKey,
} from "@workspace/api-client-react";
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

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className={`text-xl font-bold ${accent ? "text-primary" : ""}`}>{value}</div>
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
};

function AgentGridCard({ stat, onClick }: { stat: AgentStat; onClick: () => void }) {
  const { agent, gross, commission, net, wins, reserve, balance, submittedWriters, totalWriters, hasPaid } = stat;
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
            {/* Fallback initials div hidden by default, shown when img errors */}
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
            </div>
          </div>
        </div>

        {/* Financials grid */}
        <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-2.5">
          {[
            ["Gross Sales", gross, false],
            ["Net Gross", net, false],
            ["Commission", commission, false],
            ["Wins", wins, false],
            ["Reserve", reserve, false],
            ["Balance", balance, true],
          ].map(([label, val, isBalance]) => (
            <div key={label as string} className="flex flex-col">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{label as string}</span>
              <span className={`text-sm font-bold font-mono ${isBalance && Number(val) < 0 ? "text-destructive" : isBalance ? "text-primary" : ""}`}>
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
  const { agent, gross, net, balance, submittedWriters, totalWriters, hasPaid } = stat;
  const name = agent.user.fullName;
  return (
    <tr
      className="border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
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
      <td className="py-3 px-3 text-sm font-mono text-right">{fmtGHS(gross)}</td>
      <td className="py-3 px-3 text-sm font-mono text-right">{fmtGHS(net)}</td>
      <td className={`py-3 px-3 text-sm font-mono font-bold text-right ${balance < 0 ? "text-destructive" : "text-primary"}`}>{fmtGHS(balance)}</td>
      <td className="py-3 px-3 text-center text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{submittedWriters}</span>/{totalWriters}
      </td>
      <td className="py-3 px-3">
        <Badge variant={agent.isActive ? "default" : "secondary"} className="text-xs">{agent.isActive ? "Active" : "Inactive"}</Badge>
      </td>
      <td className="py-3 px-3">
        <Badge variant={hasPaid ? "default" : "destructive"} className="text-xs">
          {hasPaid ? "Paid" : "Not Paid"}
        </Badge>
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
    { query: { queryKey: getListCalculationsQueryKey({}) } }
  );
  const { data: payments } = useListPayments({});
  const { data: reserve } = useGetReserveBalance();
  const { data: games } = useListGames();
  const { agentList, allWriters } = useWriterLookup();

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
    const active = gameList.filter(g => g.isActive);
    return active.find(g => g.dayOfWeek === todayDow) ?? active.find(g => g.dayOfWeek == null) ?? null;
  }, [gameList, todayDow]);

  const dateCalcs = useMemo(() =>
    calcList.filter(c => c.calcDate?.startsWith(viewDate)),
    [calcList, viewDate]
  );

  const agentStats: AgentStat[] = useMemo(() =>
    agentList.map(agent => {
      const writerIds = new Set(allWriters.filter(w => w.agentId === agent.id).map(w => w.id));
      const totalWriters = allWriters.filter(w => w.agentId === agent.id && w.isActive).length;
      const agentCalcs = dateCalcs.filter(c => writerIds.has(c.writerId));

      return {
        agent: {
          id: agent.id,
          agentCode: agent.agentCode,
          fullCode: agent.fullCode,
          isActive: agent.isActive,
          user: {
            fullName: agent.user?.fullName ?? agent.fullCode,
            profilePicture: agent.user?.profilePicture,
          },
        },
        gross: agentCalcs.reduce((s, c) => s + Number(c.grossSales), 0),
        commission: agentCalcs.reduce((s, c) => s + Number(c.commissionAmount), 0),
        net: agentCalcs.reduce((s, c) => s + Number(c.netGross), 0),
        reserve: agentCalcs.reduce((s, c) => s + Number(c.reserveAmount), 0),
        wins: agentCalcs.reduce((s, c) => s + Number(c.winsAmount), 0),
        balance: agentCalcs.reduce((s, c) => s + Number(c.writerBalance), 0),
        submittedWriters: agentCalcs.length,
        totalWriters,
        hasPaid: paymentList.some(p => p.agentId === agent.id && !p.isVoided && p.paymentDate?.startsWith(viewDate)),
      };
    }),
    [agentList, allWriters, dateCalcs, paymentList, viewDate]
  );

  const totals = useMemo(() => agentStats.reduce(
    (acc, s) => ({ gross: acc.gross + s.gross, net: acc.net + s.net, reserve: acc.reserve + s.reserve, balance: acc.balance + s.balance }),
    { gross: 0, net: 0, reserve: 0, balance: 0 }
  ), [agentStats]);

  const accumulatedReserve = Number(reserve?.balance ?? 0);

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

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Today's Gross" value={fmtGHS(totals.gross)} />
        <StatCard label="Today's Net" value={fmtGHS(totals.net)} />
        <StatCard label="Today's Reserve" value={fmtGHS(totals.reserve)} />
        <StatCard label="Accumulated Reserve" value={fmtGHS(accumulatedReserve)} accent />
        <StatCard label="Overall Balance" value={fmtGHS(totals.balance)} accent={totals.balance >= 0} />
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

function CashierDashboard() {
  const { data: payments } = useListPayments({});
  const { data: unread } = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });
  const today = new Date().toISOString().split("T")[0];
  const todayPayments = Array.isArray(payments) ? payments.filter(p => p.paymentDate?.startsWith(today) && !p.isVoided) : [];
  const total = todayPayments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      <StatCard label="Payments Today" value={todayPayments.length} />
      <StatCard label="Total Collected Today" value={fmtGHS(total)} accent />
      <StatCard label="Unread Notifications" value={unread?.count ?? 0} />
    </div>
  );
}

function EntryDashboard({ type }: { type: "gross" | "wins" }) {
  const { data: gross } = useListGrossEntries(
    {},
    { query: { queryKey: ["gross-entries-dashboard"], enabled: type === "gross" } }
  );
  const { data: wins } = useListWinsEntries(
    {},
    { query: { queryKey: ["wins-entries-dashboard"], enabled: type === "wins" } }
  );
  const { data: unread } = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });
  const entries = type === "gross" ? gross : wins;
  const today = new Date().toISOString().split("T")[0];
  const todayEntries = Array.isArray(entries) ? entries.filter(e => e.entryDate?.startsWith(today)) : [];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      <StatCard label={`${type === "gross" ? "Gross" : "Wins"} Entries Today`} value={todayEntries.length} />
      <StatCard label="Total Entries" value={Array.isArray(entries) ? entries.length : 0} />
      <StatCard label="Unread Notifications" value={unread?.count ?? 0} />
    </div>
  );
}

function AgentDashboard() {
  const { data: sales } = useListSales({});
  const { data: unread } = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });
  const today = new Date().toISOString().split("T")[0];
  const todaySales = Array.isArray(sales) ? sales.filter(s => s.saleDate?.startsWith(today)) : [];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      <StatCard label="Sales Today" value={todaySales.length} />
      <StatCard label="Total Sales" value={Array.isArray(sales) ? sales.length : 0} />
      <StatCard label="Unread Notifications" value={unread?.count ?? 0} />
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
