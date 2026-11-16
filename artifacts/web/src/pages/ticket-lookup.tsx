import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2,
  Search,
  ScanLine,
  ShieldAlert,
  History,
  Receipt,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { cn, fmtGHS } from "@/lib/utils";
import { TicketReceiptView, type TicketReceipt } from "@/components/ticket-receipt";
import { FlaggedClaimsQueue } from "@/components/flagged-claims-queue";
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
  date: string | null;
  tickets: BrowseTicket[];
  counts: Record<string, number>;
  /** Matching tickets in all, for paging. Absent from older servers. */
  total?: number;
  offset?: number;
  limit?: number;
}

/**
 * The trading day as the office means it. Pinned to Accra rather than read off
 * the browser, so a laptop left on the wrong timezone - or an admin checking in
 * from abroad - still sees the same "today" the writers are selling into.
 */
const BUSINESS_TZ = "Africa/Accra";

function todayInAccra(): string {
  // en-CA renders as YYYY-MM-DD, which is what <input type="date"> wants.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The Accra calendar day an instant falls on. */
function accraDayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function describeDay(date: string): string {
  if (!date) return "all dates";
  const today = todayInAccra();
  if (date === today) return "today";
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return "yesterday";
  return format(d, "d MMM yyyy");
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

/** A won ticket that has been claimed and is somewhere in the payment queue. */
const IN_PAYMENT = ["verified", "awaiting_funds", "processing"];

function statusTone(t: BrowseTicket): string {
  if (t.payoutStatus === "paid") return "bg-emerald-500/10 text-emerald-700 border-emerald-300/50";
  if (t.payoutStatus === "rejected") return "bg-red-500/10 text-red-700 border-red-300/50";
  if (t.payoutStatus === "withheld") return "bg-slate-500/10 text-slate-600 border-slate-300/50";
  if (IN_PAYMENT.includes(t.payoutStatus ?? "")) return "bg-indigo-500/10 text-indigo-700 border-indigo-300/50";
  if (t.status === "won") return "bg-amber-400/10 text-amber-700 border-amber-300/60";
  if (t.status === "active") return "bg-blue-500/10 text-blue-700 border-blue-300/50";
  if (t.status === "void" || t.status === "cancelled")
    return "bg-red-500/10 text-red-700 border-red-300/50";
  return "bg-slate-500/10 text-slate-600 border-slate-300/50";
}

function statusLabel(t: BrowseTicket): string {
  if (t.payoutStatus === "paid") return "REDEEMED";
  // A cashier refused its payout; it is waiting on an administrator.
  if (t.payoutStatus === "rejected") return "FLAGGED";
  if (t.payoutStatus === "withheld") return "WITHHELD";
  if (IN_PAYMENT.includes(t.payoutStatus ?? "")) return "WON · CLAIMED";
  return t.status.toUpperCase();
}

const PAGE_SIZES = [25, 50, 100] as const;

export function TicketLookup() {
  const { user } = useAuth();
  const canSeeFraud = user?.role === "administrator" || user?.role === "director";

  // Risk Management links straight to the flagged queue with ?tab=flagged.
  const [category, setCategory] = useState<CategoryKey>(() =>
    new URLSearchParams(window.location.search).get("tab") === "flagged" ? "flagged" : "all",
  );
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const [scanQuery, setScanQuery] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Opens on today's trading day; "" means the operator asked for every date.
  const [date, setDate] = useState<string>(() => todayInAccra());
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(1);
  const [detailTab, setDetailTab] = useState<"receipt" | "history">("receipt");

  // Any change to what is being listed starts again at the first page.
  useEffect(() => { setPage(1); }, [category, filter, date, pageSize]);

  const browse = useQuery<BrowseResponse>({
    queryKey: ["/api/tickets/browse", category, filter, date, pageSize, page],
    queryFn: () =>
      getJson<BrowseResponse>(
        `/api/tickets/browse?category=${category}&q=${encodeURIComponent(filter)}` +
          (date ? `&date=${date}` : "") +
          `&limit=${pageSize}&offset=${(page - 1) * pageSize}`,
      ),
    enabled: category !== "flagged",
    // Keep the current page on screen while the next one loads.
    placeholderData: (prev) => prev,
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
    if (!scan.data) return;
    setSelectedId(scan.data.ticket.id);
    // A cashier scanning a ticket from an earlier day should not be told there
    // are no tickets - follow the ticket to its own day instead.
    const soldOn = accraDayOf(scan.data.ticket.saleDate);
    if (soldOn && date && soldOn !== date) setDate(soldOn);
  }, [scan.data, date]);

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
  // Payouts a cashier rejected count as flagged too, and are known without
  // opening the tab - the queue shares this query, so it costs nothing extra.
  const rejectedClaims = useQuery<{ requests: unknown[] }>({
    queryKey: ["/api/pos-wins/flagged"],
    queryFn: () => getJson("/api/pos-wins/flagged"),
    enabled: canSeeFraud,
    refetchInterval: 60_000,
  });
  const rejectedCount = rejectedClaims.data?.requests.length ?? 0;
  const flaggedCount = fraud.data
    ? fraud.data.bySeverity.critical + fraud.data.bySeverity.high + fraud.data.bySeverity.medium + rejectedCount
    : rejectedCount || undefined;

  const tickets = browse.data?.tickets ?? [];
  const total = browse.data?.total ?? tickets.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Read the range off the response, so the label always describes the rows
  // actually on screen - including while the next page is still loading.
  const shownFrom = browse.data?.offset ?? (page - 1) * pageSize;
  const firstShown = tickets.length === 0 ? 0 : shownFrom + 1;
  const lastShown = shownFrom + tickets.length;

  const selectedAnomalies = useMemo(() => history.data?.anomalies ?? [], [history.data]);
  const selectedRow = tickets.find((t) => t.id === selectedId) ?? null;

  // Show the receipt first for each new ticket; flags pull the history forward.
  useEffect(() => { setDetailTab("receipt"); }, [selectedId]);

  // ↑ / ↓ walk the list (and across pages) while the detail stays put.
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const pendingEdge = useRef<"first" | "last" | null>(null);
  const select = (id: string) => {
    setSelectedId(id);
    // On a phone the detail sits under the list; bring it into view.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };
  const step = (dir: 1 | -1) => {
    if (tickets.length === 0) return;
    const i = tickets.findIndex((t) => t.id === selectedId);
    const next = i === -1 ? (dir === 1 ? 0 : tickets.length - 1) : i + dir;
    if (next >= 0 && next < tickets.length) {
      setSelectedId(tickets[next]!.id);
    } else if (next >= tickets.length && page < pages) {
      pendingEdge.current = "first";
      setPage(page + 1);
    } else if (next < 0 && page > 1) {
      pendingEdge.current = "last";
      setPage(page - 1);
    }
  };
  // After paging by keyboard, land on the matching end of the new page.
  useEffect(() => {
    if (!pendingEdge.current || browse.isPlaceholderData || tickets.length === 0) return;
    setSelectedId(pendingEdge.current === "first" ? tickets[0]!.id : tickets[tickets.length - 1]!.id);
    pendingEdge.current = null;
  }, [tickets, browse.isPlaceholderData]);
  // Keep the selected row visible inside the list's own scroll.
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-ticket="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, tickets]);
  // A new page starts at the top of the list.
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [page, category, date, filter]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); step(-1); }
    else if (e.key === "PageDown" && page < pages) { e.preventDefault(); setPage(page + 1); }
    else if (e.key === "PageUp" && page > 1) { e.preventDefault(); setPage(page - 1); }
  };

  const pageList = useMemo(() => {
    const out: (number | "…")[] = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 1) out.push(i);
      else if (out[out.length - 1] !== "…") out.push("…");
    }
    return out;
  }, [pages, page]);

  const today = todayInAccra();
  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Audit</div>
        <h1 className="text-2xl font-black tracking-tight">Ticket Lookup</h1>
        <p className="text-xs text-muted-foreground font-medium max-w-3xl">
          Scan or type a ticket to validate it, or browse a day&apos;s book by category. Pick a ticket to see its
          receipt and every state it has passed through.
        </p>
      </div>

      {/* ── Search + day ── */}
      <div className="rounded-2xl border bg-card p-3 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row gap-2">
          <form onSubmit={submit} className="flex min-w-0 flex-1 gap-2">
            <div className="relative flex-1">
              <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Scan a QR, or type a ticket number, writer or numbers"
                className="pl-9 h-10 font-mono"
              />
            </div>
            <Button type="submit" className="h-10" disabled={!input.trim() || scan.isFetching}>
              {scan.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-2 hidden sm:inline">Validate</span>
            </Button>
            {(filter || scanQuery) && (
              <Button type="button" variant="ghost" className="h-10" onClick={() => { setInput(""); setFilter(""); setScanQuery(null); }}>
                Clear
              </Button>
            )}
          </form>

          {/* The day being read. Hidden on Flagged, which is a rolling 30-day scan. */}
          <div className={cn("flex flex-wrap items-center gap-1.5", category === "flagged" && "hidden")}>
            <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 h-10 items-center">
              {[
                { label: "Today", value: today },
                { label: "Yesterday", value: yesterday },
                { label: "All dates", value: "" },
              ].map((d) => (
                <button key={d.label} type="button" onClick={() => setDate(d.value)}
                  className={cn("text-[11px] font-semibold px-3 h-8 rounded-md transition-colors",
                    date === d.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {d.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)}
                aria-label="Show tickets sold on" className="h-10 w-[11.5rem] pl-9" />
            </div>
          </div>
        </div>
        {scan.isError && <p className="text-sm text-destructive">{(scan.error as Error).message}</p>}

        {/* Categories */}
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((c) => (
            <CategoryTab key={c.key} label={c.label} count={counts[c.key]} active={category === c.key} onClick={() => setCategory(c.key)} />
          ))}
          {canSeeFraud && (
            <CategoryTab label="Flagged" count={flaggedCount} active={category === "flagged"} danger onClick={() => setCategory("flagged")} />
          )}
        </div>
      </div>

      {category === "flagged" ? (
        <div className="space-y-6">
          {/* What a person refused comes before what the rules noticed: these
              are waiting on a decision, the anomalies below are a report. */}
          {canSeeFraud && (
            <FlaggedClaimsQueue
              canAct={user?.role === "administrator"}
              onOpenTicket={(ticketId) => {
                setCategory("all");
                setDate("");
                setSelectedId(ticketId);
              }}
            />
          )}
          <FraudPanel
            data={fraud.data}
            isLoading={fraud.isLoading}
            onOpen={(ticketId) => {
              setCategory("all");
              setSelectedId(ticketId);
            }}
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-start">
          {/* ── List: its own scroll, a pager underneath ── */}
          <section className="rounded-2xl border bg-card shadow-sm flex flex-col min-w-0 lg:sticky lg:top-4 lg:h-[max(28rem,calc(100vh-18rem))]">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold">{CATEGORIES.find((c) => c.key === category)?.label} tickets</h2>
                <p className="text-[11px] text-muted-foreground truncate">
                  {browse.isLoading ? "Loading…" : `${total.toLocaleString()} from ${describeDay(date)}${filter ? ` matching “${filter}”` : ""} · newest first`}
                </p>
              </div>
              {browse.isFetching && !browse.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
            </div>

            <div
              ref={listRef}
              tabIndex={0}
              onKeyDown={onListKey}
              aria-label="Tickets. Use the up and down arrow keys to move through them."
              className="flex-1 min-h-[320px] max-h-[70vh] lg:max-h-none overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {browse.isLoading ? (
                <div className="p-3 space-y-2">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
              ) : tickets.length === 0 ? (
                <div className="py-20 text-center px-6">
                  <Receipt className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-semibold">No tickets here</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nothing in this category {date ? `on ${describeDay(date)}` : "on any date"}{filter ? ` matching “${filter}”` : ""}.
                  </p>
                </div>
              ) : (
                <ul className={cn("divide-y", browse.isPlaceholderData && "opacity-60")}>
                  {tickets.map((t) => {
                    const active = selectedId === t.id;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          data-ticket={t.id}
                          onClick={() => select(t.id)}
                          className={cn(
                            "w-full text-left px-4 py-3 border-l-4 transition-colors",
                            active ? "border-l-primary bg-primary/[0.06]" : "border-l-transparent hover:bg-muted/40",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-sm font-bold">{t.ticketNumber}</span>
                                <Badge variant="outline" className={cn("text-[9px] font-bold px-1.5 py-0", statusTone(t))}>{statusLabel(t)}</Badge>
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                                {t.gameName} · {t.betTypeName} · <span className="font-mono">{t.writerCode}</span> {t.writerName}
                              </div>
                              <div className="font-mono text-xs tabular-nums mt-1 truncate">{t.numbers}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono text-sm font-semibold tabular-nums">{fmtGHS(t.stakeAmount)}</div>
                              {Number(t.winAmount) > 0 ? (
                                <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">won {fmtGHS(t.winAmount)}</div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground">{format(new Date(t.createdAt), date ? "HH:mm" : "d MMM HH:mm")}</div>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Pager */}
            {total > 0 && (
              <div className="border-t bg-muted/30 px-3 py-2 flex flex-col sm:flex-row items-center justify-between gap-2 rounded-b-2xl">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span><span className="font-semibold text-foreground">{firstShown.toLocaleString()}–{lastShown.toLocaleString()}</span> of <span className="font-semibold text-foreground">{total.toLocaleString()}</span></span>
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Tickets per page"
                    className="h-7 rounded-md border bg-background px-1.5 text-[11px] text-foreground">
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <PagerButton label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></PagerButton>
                  {pageList.map((n, i) => n === "…" ? (
                    <span key={`gap${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                  ) : (
                    <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined}
                      className={cn("min-w-[28px] h-7 px-1.5 rounded-md text-[11px] font-semibold transition-colors",
                        n === page ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                      {n}
                    </button>
                  ))}
                  <PagerButton label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></PagerButton>
                </div>
              </div>
            )}
          </section>

          {/* ── Detail: stays put while the list scrolls ── */}
          <section ref={detailRef} className="rounded-2xl border bg-card shadow-sm flex flex-col min-w-0 lg:sticky lg:top-4 lg:h-[max(28rem,calc(100vh-18rem))] scroll-mt-4">
            {!selectedId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
                <Receipt className="h-10 w-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm font-semibold">No ticket selected</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-[16rem]">
                  Pick a ticket from the list, or scan one. Use ↑ and ↓ to move through the list.
                </p>
              </div>
            ) : (
              <>
                <TicketDetailHeader row={selectedRow} receipt={receipt.data} onStep={step} />
                {selectedAnomalies.length > 0 && (
                  <div className="mx-4 mt-3 rounded-xl border border-red-300/60 bg-red-500/[0.05] dark:border-red-500/30 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-300">
                      <ShieldAlert className="h-4 w-4" />
                      {selectedAnomalies.length} flag{selectedAnomalies.length === 1 ? "" : "s"} on this ticket
                    </div>
                    {selectedAnomalies.map((a, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <AnomalyBadge severity={a.severity}>{anomalyLabel(a.code)}</AnomalyBadge>
                        <span className="text-[11px]">{a.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="px-4 pt-3">
                  <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
                    {([
                      { key: "receipt", label: "Receipt", icon: <Receipt className="h-3.5 w-3.5" /> },
                      { key: "history", label: `Audit trail${history.data ? ` · ${history.data.events.length}` : ""}`, icon: <History className="h-3.5 w-3.5" /> },
                    ] as const).map((t) => (
                      <button key={t.key} type="button" onClick={() => setDetailTab(t.key)}
                        className={cn("flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-md transition-colors",
                          detailTab === t.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                        {t.icon}{t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 min-h-0">
                  {detailTab === "receipt" ? (
                    receipt.isLoading ? (
                      <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
                    ) : receipt.data ? (
                      <div className="space-y-2">
                        <p className="text-[11px] text-muted-foreground">
                          Sold by {receipt.data.writer.name} ({receipt.data.writer.code})
                          {receipt.data.agent.name ? ` · ${receipt.data.agent.name}` : ""}
                        </p>
                        <TicketReceiptView data={receipt.data} />
                      </div>
                    ) : (
                      <p className="py-10 text-center text-xs text-muted-foreground">Receipt not available.</p>
                    )
                  ) : history.isLoading ? (
                    <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <TicketAuditTimeline events={history.data?.events ?? []} anomalies={selectedAnomalies} />
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** The fixed top of the detail panel: what the ticket is, at a glance. */
function TicketDetailHeader({ row, receipt, onStep }: {
  row: BrowseTicket | null;
  receipt?: TicketReceipt;
  onStep: (dir: 1 | -1) => void;
}) {
  const number = row?.ticketNumber ?? receipt?.ticket.ticketNumber ?? "…";
  const stake = row?.stakeAmount ?? receipt?.ticket.stakeAmount;
  const potential = row?.potentialPayout ?? receipt?.ticket.potentialPayout;
  const won = row?.winAmount ?? receipt?.ticket.winAmount;
  const game = row ? `${row.gameName} #${row.eventNumber}` : receipt ? `${receipt.game.name} #${receipt.game.eventNumber}` : "";
  const bet = row?.betTypeName ?? receipt?.betType.name ?? "";
  const writer = row ? `${row.writerCode} · ${row.writerName}` : receipt ? `${receipt.writer.code} · ${receipt.writer.name}` : "";
  const sold = row?.createdAt ?? receipt?.ticket.saleDate;
  return (
    <div className="border-b p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Ticket</div>
          <div className="font-mono text-lg font-black truncate">{number}</div>
          <div className="text-[11px] text-muted-foreground truncate">{game}{bet ? ` · ${bet}` : ""}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {row ? (
            <Badge variant="outline" className={cn("text-[10px] font-bold", statusTone(row))}>{statusLabel(row)}</Badge>
          ) : receipt ? (
            <Badge variant="outline" className="text-[10px] font-bold">{receipt.ticket.status.toUpperCase()}</Badge>
          ) : null}
          <div className="flex gap-1">
            <PagerButton label="Previous ticket (↑)" disabled={false} onClick={() => onStep(-1)}><ChevronUp className="h-4 w-4" /></PagerButton>
            <PagerButton label="Next ticket (↓)" disabled={false} onClick={() => onStep(1)}><ChevronDown className="h-4 w-4" /></PagerButton>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Stake", value: stake != null ? fmtGHS(stake) : "—", cls: "" },
          { label: Number(won ?? 0) > 0 ? "Won" : "Could win", value: Number(won ?? 0) > 0 ? fmtGHS(won!) : potential != null ? fmtGHS(potential) : "—", cls: Number(won ?? 0) > 0 ? "text-emerald-600 dark:text-emerald-400" : "" },
          { label: "Sold", value: sold ? format(new Date(sold), "d MMM HH:mm") : "—", cls: "" },
        ].map((x) => (
          <div key={x.label} className="rounded-lg bg-muted/40 px-2.5 py-2 min-w-0">
            <div className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">{x.label}</div>
            <div className={cn("font-mono text-xs font-bold truncate", x.cls)}>{x.value}</div>
          </div>
        ))}
      </div>
      {writer && <div className="text-[11px] text-muted-foreground truncate">Writer <span className="font-mono text-foreground">{writer}</span>{row?.agencyName ? ` · ${row.agencyName}` : ""}</div>}
    </div>
  );
}

function PagerButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="h-7 w-7 inline-flex items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none">
      {children}
    </button>
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
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? danger
            ? "border-red-500 bg-red-500 text-white"
            : "border-foreground bg-foreground text-background"
          : danger
            ? "border-red-300/60 text-red-600 dark:text-red-400 hover:bg-red-500/10"
            : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            active
              ? "bg-background/20 text-inherit"
              : danger && count > 0
                ? "bg-red-500/15 text-red-700 dark:text-red-300"
                : "bg-muted text-muted-foreground",
          )}
        >
          {count.toLocaleString()}
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
