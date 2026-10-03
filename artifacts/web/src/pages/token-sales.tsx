import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Coins, ArrowDownCircle, ArrowUpCircle, Users, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { cn, fmtGHS } from "@/lib/utils";

/**
 * E-token transaction history.
 *
 * A cashier sees her own float and nothing else: her job is to reconcile what
 * she was given against what she issued, and another cashier's figures would
 * only get in the way. Administrators and directors see every cashier, which
 * is the whole of unit sales - mobile money does not credit anyone by itself,
 * so every token that reached a writer left some cashier's float.
 */

const BUSINESS_TZ = "Africa/Accra";

function accraToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysAgo(n: number): string {
  const d = new Date(`${accraToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthStart(): string {
  return `${accraToday().slice(0, 7)}-01`;
}

interface Txn {
  id: string;
  transactionType: "receipt" | "disbursement" | "reversal";
  amount: string;
  balanceAfter: string;
  notes: string | null;
  createdAt: string;
  cashierId: string;
  cashierName: string;
  writerId: string | null;
  writerName: string | null;
  writerCode: string | null;
  agentId: string | null;
  agentCode: string | null;
  agencyName: string | null;
  paymentMethod: string | null;
  paystackReference: string | null;
}

interface SalesResponse {
  scope: "own-float" | "all-cashiers";
  summary: {
    issued: string;
    received: string;
    reversed: string;
    movements: number;
    writersServed: number;
  };
  transactions: Txn[];
  truncated: boolean;
}

interface FilterOptions {
  agents: { id: string; code: string; name: string | null }[];
  writers: { id: string; code: string; name: string; agentId: string }[];
  cashiers: { id: string; name: string }[];
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
  return res.json();
}

const RANGES = [
  { key: "today", label: "Today", from: () => accraToday(), to: () => accraToday() },
  { key: "7d", label: "Last 7 days", from: () => daysAgo(6), to: () => accraToday() },
  { key: "month", label: "This month", from: () => monthStart(), to: () => accraToday() },
  { key: "all", label: "All time", from: () => "", to: () => "" },
] as const;

/**
 * The ledger itself, without page chrome.
 *
 * Lives apart from the route so the Payments page can host it as a tab beside
 * E-Token Supply, where an administrator reading the supply chain wants it,
 * without the two growing separate copies that drift.
 */
export function TokenSalesPanel({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const isCashier = user?.role === "cashier";

  // Opens on today: a cashier's first question in the morning is what moved
  // through her float since she last balanced it.
  const [from, setFrom] = useState(accraToday);
  const [to, setTo] = useState(accraToday);
  const [agentId, setAgentId] = useState("all");
  const [writerId, setWriterId] = useState("all");
  const [cashierId, setCashierId] = useState("all");

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (agentId !== "all") p.set("agentId", agentId);
    if (writerId !== "all") p.set("writerId", writerId);
    if (!isCashier && cashierId !== "all") p.set("cashierId", cashierId);
    return p.toString();
  }, [from, to, agentId, writerId, cashierId, isCashier]);

  const sales = useQuery<SalesResponse>({
    queryKey: ["/api/tokens/sales", query],
    queryFn: () => getJson<SalesResponse>(`/api/tokens/sales?${query}`),
  });

  const options = useQuery<FilterOptions>({
    queryKey: ["/api/tokens/sales/filters"],
    queryFn: () => getJson<FilterOptions>("/api/tokens/sales/filters"),
  });

  // Picking an agency narrows the writer list to that agency's writers, so the
  // two filters cannot be set to a combination that returns nothing.
  const writerChoices = useMemo(() => {
    const all = options.data?.writers ?? [];
    return agentId === "all" ? all : all.filter((w) => w.agentId === agentId);
  }, [options.data, agentId]);

  const activeRange = RANGES.find((r) => r.from() === from && r.to() === to)?.key;
  // Filtering by agency or writer excludes float receipts by construction.
  const narrowedToParty = agentId !== "all" || writerId !== "all";
  const rows = sales.data?.transactions ?? [];
  const s = sales.data?.summary;

  return (
    <div className={embedded ? "space-y-6" : "p-6 space-y-6"}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold tracking-tight">E-Token Transactions</h1>
          <p className="text-muted-foreground text-sm">
            {isCashier
              ? "Every unit that moved through your float — what you received from the company and what you issued to writers."
              : "Every unit issued to a writer, across all cashiers. Mobile money does not credit a writer by itself, so this is the whole of unit sales."}
          </p>
        </div>
      )}
      {embedded && (
        <p className="text-muted-foreground text-xs">
          {isCashier
            ? "Every unit that moved through your float — what you received from the company and what you issued to writers."
            : "Every unit issued to a writer, across all cashiers. Mobile money does not credit a writer by itself, so this is the whole of unit sales."}
        </p>
      )}

      {/* ---- Totals, over the whole filtered set rather than the page ------ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={isCashier ? "Issued to writers" : "Issued to writers"}
          value={s ? fmtGHS(s.issued) : "—"}
          icon={ArrowUpCircle}
          tone="out"
        />
        {/* A float receipt comes from the company pool and has no writer, so it
            belongs to no agency. Narrowing to one would always report zero,
            which reads as a bug rather than as "not applicable" - so say so. */}
        <Stat
          label={isCashier ? "Received from company" : "Issued to cashiers"}
          value={narrowedToParty ? "—" : s ? fmtGHS(s.received) : "—"}
          icon={ArrowDownCircle}
          tone="in"
          hint={narrowedToParty ? "Not attributable to an agency or writer" : undefined}
        />
        <Stat label="Writers served" value={s ? String(s.writersServed) : "—"} icon={Users} />
        <Stat
          label="Movements"
          value={s ? String(s.movements) : "—"}
          icon={Coins}
          hint={s && Number(s.reversed) > 0 ? `${fmtGHS(s.reversed)} reversed` : undefined}
        />
      </div>

      {/* ---- Filters ------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {RANGES.map((r) => (
              <Button
                key={r.key}
                type="button"
                size="sm"
                variant={activeRange === r.key ? "default" : "outline"}
                onClick={() => {
                  setFrom(r.from());
                  setTo(r.to());
                }}
              >
                {r.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="From">
              <Input
                type="date"
                value={from}
                max={to || accraToday()}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 w-[150px]"
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={to}
                min={from || undefined}
                max={accraToday()}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 w-[150px]"
              />
            </Field>

            <Field label="Agency">
              <Select
                value={agentId}
                onValueChange={(v) => {
                  setAgentId(v);
                  setWriterId("all");
                }}
              >
                <SelectTrigger className="h-9 w-[200px]">
                  <SelectValue placeholder="All agencies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agencies</SelectItem>
                  {(options.data?.agents ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code}
                      {a.name ? ` · ${a.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Writer">
              <Select value={writerId} onValueChange={setWriterId}>
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue placeholder="All writers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {agentId === "all" ? "All writers" : "All writers in this agency"}
                  </SelectItem>
                  {writerChoices.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} · {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {!isCashier && (
              <Field label="Cashier">
                <Select value={cashierId} onValueChange={setCashierId}>
                  <SelectTrigger className="h-9 w-[180px]">
                    <SelectValue placeholder="All cashiers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All cashiers</SelectItem>
                    {(options.data?.cashiers ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {(agentId !== "all" || writerId !== "all" || cashierId !== "all") && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAgentId("all");
                  setWriterId("all");
                  setCashierId("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- The ledger ---------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Transactions</CardTitle>
          <CardDescription className="text-xs">
            {sales.isLoading
              ? "Loading…"
              : `${rows.length} shown${
                  sales.data?.truncated ? " (most recent — narrow the dates to see the rest)" : ""
                }. Newest first.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sales.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              {(sales.error as Error).message}
            </p>
          )}
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead>Writer</TableHead>
                  <TableHead>Agency</TableHead>
                  <TableHead>Paid by</TableHead>
                  {!isCashier && <TableHead>Cashier</TableHead>}
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Float after</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={isCashier ? 7 : 8} className="py-10 text-center">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={isCashier ? 7 : 8}
                      className="py-10 text-center text-xs text-muted-foreground"
                    >
                      No e-token movements for this selection.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((t) => <Row key={t.id} t={t} showCashier={!isCashier} />)
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** The standalone route. Kept so existing links and bookmarks still resolve. */
export function TokenSales() {
  return <TokenSalesPanel />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
        {label}
      </span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: string;
  icon: any;
  tone?: "in" | "out";
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "in" && "text-emerald-600 dark:text-emerald-400",
            tone === "out" && "text-blue-600 dark:text-blue-400",
          )}
        />
        {label}
      </div>
      <div className="mt-1.5 text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{hint}</div>}
    </div>
  );
}

const MOVEMENT: Record<string, { label: string; tone: string; icon: any }> = {
  disbursement: {
    label: "Issued to writer",
    tone: "bg-blue-500/10 text-blue-700 border-blue-300/50 dark:text-blue-300",
    icon: ArrowUpCircle,
  },
  receipt: {
    label: "Received from company",
    tone: "bg-emerald-500/10 text-emerald-700 border-emerald-300/50 dark:text-emerald-300",
    icon: ArrowDownCircle,
  },
  reversal: {
    label: "Reversal",
    tone: "bg-amber-500/10 text-amber-700 border-amber-300/60 dark:text-amber-300",
    icon: RotateCcw,
  },
};

function Row({ t, showCashier }: { t: Txn; showCashier: boolean }) {
  const m = MOVEMENT[t.transactionType] ?? MOVEMENT["disbursement"]!;
  const Icon = m.icon;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
        {format(new Date(t.createdAt), "d MMM yyyy")}
        <div className="font-mono text-[10px]">{format(new Date(t.createdAt), "HH:mm")}</div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={cn("gap-1 text-[9px] font-bold", m.tone)}>
          <Icon className="h-3 w-3" />
          {m.label}
        </Badge>
      </TableCell>
      <TableCell>
        {t.writerName ? (
          <>
            <div className="text-xs">{t.writerName}</div>
            <div className="font-mono text-[10px] text-muted-foreground">{t.writerCode}</div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-xs">
        {t.agentCode ? (
          <>
            <div className="font-mono text-[10px]">{t.agentCode}</div>
            {t.agencyName && (
              <div className="text-[10px] text-muted-foreground">{t.agencyName}</div>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {t.paymentMethod ? (
          <Badge variant="outline" className="text-[9px] font-semibold uppercase">
            {t.paymentMethod === "momo" ? "Mobile money" : t.paymentMethod}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      {showCashier && <TableCell className="text-xs">{t.cashierName}</TableCell>}
      <TableCell className="text-right text-xs font-semibold tabular-nums">
        {fmtGHS(t.amount)}
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
        {fmtGHS(t.balanceAfter)}
      </TableCell>
    </TableRow>
  );
}
