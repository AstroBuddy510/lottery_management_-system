import { useAuth } from "@/lib/auth";
import {
  useListUsers, useListAgents, useGetReserveBalance, useGetUnreadCount,
  useListCalculations, useListPayments, useListGrossEntries, useListWinsEntries, useListSales,
  getGetUnreadCountQueryKey, getListGrossEntriesQueryKey, getListWinsEntriesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-2xl font-bold text-foreground">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function DirectorDashboard() {
  const { data: users } = useListUsers({});
  const { data: agents } = useListAgents({});
  const { data: reserve } = useGetReserveBalance();
  const { data: unread } = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });
  const { data: calcs } = useListCalculations({});

  const activeUsers = Array.isArray(users) ? users.filter(u => u.isActive).length : 0;
  const activeAgents = Array.isArray(agents) ? agents.filter(a => a.isActive).length : 0;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard label="Active Users" value={activeUsers} sub={`of ${Array.isArray(users) ? users.length : 0} total`} />
      <StatCard label="Active Agents" value={activeAgents} />
      <StatCard label="Reserve Balance" value={reserve ? `$${Number(reserve.balance).toFixed(2)}` : "—"} />
      <StatCard label="Unread Notifications" value={unread?.count ?? 0} />
      <StatCard label="Calculations Run" value={Array.isArray(calcs) ? calcs.length : 0} sub="all time" />
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
      <StatCard label="Total Collected Today" value={`$${total.toFixed(2)}`} />
      <StatCard label="Unread Notifications" value={unread?.count ?? 0} />
    </div>
  );
}

function EntryDashboard({ type }: { type: "gross" | "wins" }) {
  const { data: gross } = useListGrossEntries(
    {},
    { query: { queryKey: getListGrossEntriesQueryKey({}), enabled: type === "gross" } }
  );
  const { data: wins } = useListWinsEntries(
    {},
    { query: { queryKey: getListWinsEntriesQueryKey({}), enabled: type === "wins" } }
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
