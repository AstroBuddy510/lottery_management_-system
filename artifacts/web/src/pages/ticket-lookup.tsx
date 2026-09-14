import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, ScanLine, ShieldAlert, History, Receipt } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { cn, fmtGHS } from "@/lib/utils";
import { TicketReceiptView, type TicketReceipt } from "@/components/ticket-receipt";
import {
  TicketAuditTimeline,
  AnomalyBadge,
  anomalyLabel,
  type Anomaly,
  type TicketEvent,
} from "@/components/ticket-audit-timeline";

/**
 * Ticket review for admins, cashiers and agents.
 *
 * Two ways in, and the difference matters. Searching or scanning is an act of
 * VALIDATION - it is what a cashier does before handing over money - so it is
 * recorded against the ticket. Browsing the categories and clicking a row is
 * not: an admin reading the book should not leave footprints that later read
 * as repeated claim attempts.
 */

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "won", label: "Won" },
  { key: "redeemed", label: "Redeemed" },
  { key: "lost", label: "Lost" },
  { key: "voided", label: "Voided" },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"] | "flagged";

interface BrowseTicket {
  id: string;
  ticketNumber: string;
  numbers: string;
  stakeAmount: string;
  potentialPayout: string;
  winAmount: string;
  status: string;
  isWinner: boolean;
  createdAt: string;
  writerName: string;
  writerCode: string;
  agentCode: string;
  agencyName: string | null;
  gameName: string;
  eventNumber: string;
  betTypeName: string;
  payoutStatus: string | null;
  payoutPaidAt: string | null;
}

interface BrowseResponse {
  category: string;
  tickets: BrowseTicket[];
  counts: Record<string, number>;
}

interface FraudResponse {
  days: number;
  ticketsScanned: number;
  bySeverity: { critical: number; high: number; medium: number };
  byCode: Record<string, number>;
  anomalies: Anomaly[];
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
  return res.json();
}

function statusTone(t: BrowseTicket): string {
  if (t.payoutStatus === "paid") return "bg-emerald-500/10 text-emerald-700 border-emerald-300/50";
  if (t.status === "won") return "bg-amber-400/10 text-amber-700 border-amber-300/60";
  if (t.status === "active") return "bg-blue-500/10 text-blue-700 border-blue-300/50";
  if (t.status === "void" || t.status === "cancelled")
    return "bg-red-500/10 text-red-700 border-red-300/50";
  return "bg-slate-500/10 text-slate-600 border-slate-300/50";
}

function statusLabel(t: BrowseTicket): string {
  if (t.payoutStatus === "paid") return "REDEEMED";
  return t.status.toUpperCase();
}

export function TicketLookup() {
  const { user } = useAuth();
  const canSeeFraud = user?.role === "administrator" || user?.role === "director";

  const [category, setCategory] = useState<CategoryKey>("all");
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const [scanQuery, setScanQuery] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const browse = useQuery<BrowseResponse>({
    queryKey: ["/api/tickets/browse", category, filter],
    queryFn: () =>
      getJson<BrowseResponse>(
        `/api/tickets/browse?category=${category}&q=${encodeURIComponent(filter)}`,
      ),
    enabled: category !== "flagged",
  });

  const fraud = useQuery<FraudResponse>({
    queryKey: ["/api/tickets/fraud"],
    queryFn: () => getJson<FraudResponse>("/api/tickets/fraud?days=30"),
    enabled: category === "flagged" && canSeeFraud,
  });

  // The scan/search path. This one is logged against the ticket.
  const scan = useQuery<TicketReceipt>({
    queryKey: ["/api/tickets/lookup", scanQuery],
    queryFn: () => getJson<TicketReceipt>(`/api/tickets/lookup?q=${encodeURIComponent(scanQuery!)}`),
    enabled: !!scanQuery,
    retry: false,
  });

  useEffect(() => {
    if (scan.data) setSelectedId(scan.data.ticket.id);
  }, [scan.data]);

  // Reading a row. Deliberately NOT logged.
  const receipt = useQuery<TicketReceipt>({
    queryKey: ["/api/tickets/receipt", selectedId],
    queryFn: () => getJson<TicketReceipt>(`/api/tickets/${selectedId}/receipt`),
    enabled: !!selectedId,
  });

  const history = useQuery<{ events: TicketEvent[]; anomalies: Anomaly[] }>({
    queryKey: ["/api/tickets/events", selectedId],
    queryFn: () => getJson(`/api/tickets/${selectedId}/events`),
    enabled: !!selectedId,
  });

  /** A scanned QR arrives as the JSON payload we encoded. */
  const normalise = (raw: string): string => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return parsed.n ?? parsed.t ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = normalise(input);
    if (!q) return;
    setScanQuery(q);
    setFilter(q);
  };

  const counts = browse.data?.counts ?? {};
  const flaggedCount = fraud.data
    ? fraud.data.bySeverity.critical + fraud.data.bySeverity.high + fraud.data.bySeverity.medium
    : undefined;

  const tickets = browse.data?.tickets ?? [];

  const selectedAnomalies = useMemo(() => history.data?.anomalies ?? [], [history.data]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ticket Lookup</h1>
        <p className="text-muted-foreground text-sm">
          Scan or search a ticket to validate it, or browse by category. Every state change is
          kept, so a ticket's full history is one click away.
        </p>
      </div>

      {/* ---- Category navigation ------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-1.5 border-b pb-px">
        {CATEGORIES.map((c) => (
          <CategoryTab
            key={c.key}
            label={c.label}
            count={counts[c.key]}
            active={category === c.key}
            onClick={() => setCategory(c.key)}
          />
        ))}
        {canSeeFraud && (
          <CategoryTab
            label="Flagged"
            count={flaggedCount}
            active={category === "flagged"}
            danger
            onClick={() => setCategory("flagged")}
          />
        )}
      </div>

      {/* ---- Search -------------------------------------------------------- */}
      <form onSubmit={submit} className="flex max-w-2xl gap-2">
        <div className="relative flex-1">
          <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Scan a QR, or type a ticket number, writer or numbers"
            className="pl-9 font-mono"
          />
        </div>
        <Button type="submit" disabled={!input.trim() || scan.isFetching}>
          {scan.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="ml-2 hidden sm:inline">Validate</span>
        </Button>
        {(filter || scanQuery) && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setInput("");
              setFilter("");
              setScanQuery(null);
            }}
          >
            Clear
          </Button>
        )}
      </form>
      {scan.isError && (
        <p className="-mt-3 text-sm text-destructive">{(scan.error as Error).message}</p>
      )}

      {category === "flagged" ? (
        <FraudPanel
          data={fraud.data}
          isLoading={fraud.isLoading}
          onOpen={(ticketId) => {
            setCategory("all");
            setSelectedId(ticketId);
          }}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] xl:items-start">
          {/* ---- List ------------------------------------------------------ */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {CATEGORIES.find((c) => c.key === category)?.label} tickets
              </CardTitle>
              <CardDescription className="text-xs">
                {browse.isLoading
                  ? "Loading…"
                  : `${tickets.length} shown${filter ? ` matching "${filter}"` : ""}. Newest first.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticket</TableHead>
                      <TableHead>Numbers</TableHead>
                      <TableHead>Writer</TableHead>
                      <TableHead className="text-right">Stake</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sold</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {browse.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : tickets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                          No tickets in this category.
                        </TableCell>
                      </TableRow>
                    ) : (
                      tickets.map((t) => (
                        <TableRow
                          key={t.id}
                          onClick={() => setSelectedId(t.id)}
                          className={cn(
                            "cursor-pointer",
                            selectedId === t.id && "bg-primary/5 hover:bg-primary/5",
                          )}
                        >
                          <TableCell>
                            <div className="font-mono text-xs font-semibold">{t.ticketNumber}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {t.gameName} · {t.betTypeName}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">{t.numbers}</TableCell>
                          <TableCell>
                            <div className="text-xs">{t.writerName}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{t.writerCode}</div>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {fmtGHS(t.stakeAmount)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[9px] font-bold", statusTone(t))}>
                              {statusLabel(t)}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                            {format(new Date(t.createdAt), "d MMM HH:mm")}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ---- Detail ---------------------------------------------------- */}
          <div className="space-y-6">
            {!selectedId ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Receipt className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-medium">No ticket selected</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Scan or pick a row to see its details, receipt and full history.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {selectedAnomalies.length > 0 && (
                  <Card className="border-red-300/60 bg-red-500/[0.04] dark:border-red-500/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base text-red-700 dark:text-red-300">
                        <ShieldAlert className="h-4 w-4" />
                        {selectedAnomalies.length} flag
                        {selectedAnomalies.length === 1 ? "" : "s"} on this ticket
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {selectedAnomalies.map((a, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <AnomalyBadge severity={a.severity}>{anomalyLabel(a.code)}</AnomalyBadge>
                          <span className="text-xs">{a.detail}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <History className="h-4 w-4" />
                      Audit trail
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {receipt.data
                        ? `${receipt.data.ticket.ticketNumber} · ${receipt.data.game.name}`
                        : "Loading…"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {history.isLoading ? (
                      <div className="py-6 text-center">
                        <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <TicketAuditTimeline
                        events={history.data?.events ?? []}
                        anomalies={selectedAnomalies}
                      />
                    )}
                  </CardContent>
                </Card>

                {receipt.data && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Receipt</CardTitle>
                      <CardDescription className="text-xs">
                        Sold by {receipt.data.writer.name} ({receipt.data.writer.code})
                        {receipt.data.agent.name ? ` · ${receipt.data.agent.name}` : ""}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <TicketReceiptView data={receipt.data} />
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryTab({
  label,
  count,
  active,
  danger,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative -mb-px rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold transition-colors",
        active
          ? danger
            ? "border-red-500 text-red-600 dark:text-red-400"
            : "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            danger && count > 0
              ? "bg-red-500/15 text-red-700 dark:text-red-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function FraudPanel({
  data,
  isLoading,
  onOpen,
}: {
  data?: FraudResponse;
  isLoading: boolean;
  onOpen: (ticketId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Scanning ticket history…
      </div>
    );
  }
  if (!data) return null;

  const total = data.bySeverity.critical + data.bySeverity.high + data.bySeverity.medium;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Critical" value={data.bySeverity.critical} tone="danger" />
        <StatTile label="High" value={data.bySeverity.high} tone="warning" />
        <StatTile label="Medium" value={data.bySeverity.medium} />
        <StatTile label="Tickets scanned" value={data.ticketsScanned} hint={`Last ${data.days} days`} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-red-500" />
            Flagged activity
          </CardTitle>
          <CardDescription className="text-xs">
            Ordering and multiplicity checks over the last {data.days} days — a ticket checked
            before it was sold, paid before the draw, or claimed more than once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {total === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing flagged across {data.ticketsScanned} tickets.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Flag</TableHead>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Writer</TableHead>
                    <TableHead>What happened</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.anomalies.map((a, i) => (
                    <TableRow
                      key={i}
                      className="cursor-pointer"
                      onClick={() => onOpen(a.ticketId)}
                    >
                      <TableCell>
                        <AnomalyBadge severity={a.severity}>{anomalyLabel(a.code)}</AnomalyBadge>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs font-semibold">{a.ticketNumber}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {a.gameName ?? ""} {a.eventNumber ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {a.writerName ?? "—"}
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {a.writerCode ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[320px] text-[11px]">{a.detail}</TableCell>
                      <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {a.at ? format(new Date(a.at), "d MMM HH:mm:ss") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "danger" | "warning";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 text-2xl font-bold tabular-nums",
          tone === "danger" && value > 0 && "text-red-600 dark:text-red-400",
          tone === "warning" && value > 0 && "text-orange-600 dark:text-orange-400",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
