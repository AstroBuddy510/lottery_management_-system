import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  useListAgents, useGetReserveBalance, useGetUnreadCount,
  useListCalculations, useListPayments, useListGrossEntries, useListWinsEntries,
  useListSales, useListGames,
  getGetUnreadCountQueryKey, getListCalculationsQueryKey,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtGHS } from "@/lib/utils";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className={`text-xl font-bold ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function AgentAvatar({ name, code }: { name: string; code: string }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const colors = ["bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-orange-500", "bg-pink-600", "bg-teal-600"];
  const color = colors[code.charCodeAt(code.length - 1) % colors.length];
  return (
    <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
      {initials}
    </div>
  );
}

function DirectorDashboard() {
  const [, navigate] = useLocation();
  const today = new Date().toISOString().split("T")[0];
  const todayDow = new Date().getDay();

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

  const [selectedDate, setSelectedDate] = useState("");
  const viewDate = selectedDate || mostRecentDate;

  const currentGame = useMemo(() => {
    const active = gameList.filter(g => g.isActive);
    return active.find(g => g.dayOfWeek === todayDow)
      ?? active.find(g => g.dayOfWeek == null)
      ?? null;
  }, [gameList, todayDow]);

  const dateCalcs = useMemo(() =>
    calcList.filter(c => c.calcDate?.startsWith(viewDate)),
    [calcList, viewDate]
  );

  const agentStats = useMemo(() => {
    return agentList.map(agent => {
      const writerIds = new Set(allWriters.filter(w => w.agentId === agent.id).map(w => w.id));
      const totalWriters = allWriters.filter(w => w.agentId === agent.id && w.isActive).length;
      const agentCalcs = dateCalcs.filter(c => writerIds.has(c.writerId));

      const gross = agentCalcs.reduce((s, c) => s + Number(c.grossSales), 0);
      const commission = agentCalcs.reduce((s, c) => s + Number(c.commissionAmount), 0);
      const net = agentCalcs.reduce((s, c) => s + Number(c.netGross), 0);
      const reserve = agentCalcs.reduce((s, c) => s + Number(c.reserveAmount), 0);
      const wins = agentCalcs.reduce((s, c) => s + Number(c.winsAmount), 0);
      const balance = agentCalcs.reduce((s, c) => s + Number(c.writerBalance), 0);
      const submittedWriters = agentCalcs.length;

      const hasPaid = paymentList.some(
        p => p.agentId === agent.id && !p.isVoided && p.paymentDate?.startsWith(viewDate)
      );

      return { agent, gross, commission, net, reserve, wins, balance, submittedWriters, totalWriters, hasPaid };
    });
  }, [agentList, allWriters, dateCalcs, paymentList, viewDate]);

  const totals = useMemo(() => agentStats.reduce(
    (acc, s) => ({
      gross: acc.gross + s.gross,
      net: acc.net + s.net,
      reserve: acc.reserve + s.reserve,
      wins: acc.wins + s.wins,
      balance: acc.balance + s.balance,
    }),
    { gross: 0, net: 0, reserve: 0, wins: 0, balance: 0 }
  ), [agentStats]);

  const accumulatedReserve = Number(reserve?.balance ?? 0);

  return (
    <div className="space-y-6">
      {/* Game banner */}
      <div className={`rounded-xl px-5 py-3 flex items-center gap-3 ${currentGame ? "bg-primary/10 border border-primary/25" : "bg-muted/60 border border-border"}`}>
        <div className="text-lg">🎮</div>
        <div>
          {currentGame ? (
            <>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Today's Game</span>
              <div className="text-base font-bold text-primary leading-tight">{currentGame.name}</div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No active game assigned for {DAY_NAMES[todayDow]}</span>
          )}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">{DAY_NAMES[todayDow]}</div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Today's Gross" value={fmtGHS(totals.gross)} />
        <StatCard label="Today's Net" value={fmtGHS(totals.net)} />
        <StatCard label="Today's Reserve" value={fmtGHS(totals.reserve)} />
        <StatCard label="Accumulated Reserve" value={fmtGHS(accumulatedReserve)} accent />
        <StatCard label="Overall Balance" value={fmtGHS(totals.balance)} accent={totals.balance >= 0} />
      </div>

      {/* Date selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Viewing date:</span>
        <Input
          type="date"
          value={viewDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="h-8 text-sm w-40"
        />
        {selectedDate && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedDate("")}>
            Reset
          </Button>
        )}
        {loadingCalcs && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {/* Agent cards */}
      {agentList.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agentStats.map(({ agent, gross, commission, net, reserve, wins, balance, submittedWriters, totalWriters, hasPaid }) => (
            <Card
              key={agent.id}
              className="cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
              onClick={() => navigate(`/agents/${agent.id}/detail`)}
            >
              <CardContent className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <AgentAvatar name={agent.user?.fullName ?? agent.fullCode} code={agent.fullCode} />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{agent.user?.fullName ?? "—"}</div>
                    <div className="text-xs font-mono text-muted-foreground">{agent.fullCode}</div>
                  </div>
                  <Badge variant={agent.isActive ? "default" : "secondary"} className="ml-auto text-xs">
                    {agent.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>

                {/* Financials */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm border rounded-lg p-3 bg-muted/30">
                  {[
                    ["Gross", gross],
                    ["Commission", commission],
                    ["Net", net],
                    ["Wins", wins],
                    ["Reserve", reserve],
                    ["Balance", balance],
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex justify-between gap-1">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className={`text-xs font-mono font-medium ${label === "Balance" && Number(val) < 0 ? "text-destructive" : label === "Balance" ? "text-primary" : ""}`}>
                        {fmtGHS(val as number)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    Writers: <span className="font-semibold text-foreground">{submittedWriters}/{totalWriters}</span> submitted
                  </span>
                  <Badge
                    variant={hasPaid ? "default" : "destructive"}
                    className="text-xs"
                  >
                    Reserve: {hasPaid ? "Paid" : "Not Paid"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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

export function Dashboard() {
  const { user } = useAuth();
  const role = user?.role ?? "";

  const ROLE_LABELS: Record<string, string> = {
    director: "Director",
    administrator: "Administrator",
    cashier: "Cashier",
    gross_entry: "Gross Entry Team",
    wins_entry: "Wins Entry Team",
    agent: "Agent",
  };

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
