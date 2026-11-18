import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { format } from "date-fns";
import { Archive, ChevronDown, ChevronLeft, ChevronRight, Clock, Loader2, Ticket } from "lucide-react";
import { cn, fmtGHS } from "@/lib/utils";
import { TicketReceiptView, useTicketReceipt } from "@/components/ticket-receipt";

interface TicketRow {
  id: string;
  ticketNumber: string;
  createdAt: string;
  numbers: string;
  stakeAmount: string;
  winAmount: string;
  potentialPayout: string;
  isWinner: boolean;
  status: string;
  gameName: string;
  eventNumber: string;
  drawAt: string;
  betTypeName: string;
}

interface PastPage {
  rows: TicketRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  won: number;
  wonAmount: string;
}

const PAGE_SIZE = 10;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Could not load your tickets (${res.status}).`);
  return body as T;
}

/** Smooth, unless the phone has asked for less motion. */
function scrollToTop(el: HTMLElement | null) {
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "won"
      ? "bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-300"
      : status === "lost"
        ? "bg-slate-500/10 text-slate-600 border-slate-300"
        : status === "cancelled" || status === "void"
          ? "bg-destructive/10 text-destructive border-destructive/30"
          : "bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-300";
  return (
    <Badge variant="outline" className={`${tone} text-[10px] font-bold px-1.5 py-0 h-5`}>
      {status.toUpperCase()}
    </Badge>
  );
}

/**
 * Full receipt for one ticket, opened from the list. Closing returns to the
 * list without a navigation, so the writer keeps their place - including
 * which page of past tickets they were on.
 */
function TicketDetail({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  const { data, isLoading, isError, error } = useTicketReceipt(ticketId);
  return (
    <Dialog open={!!ticketId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm w-[calc(100%-1.5rem)] max-h-[88vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Ticket Details</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-10 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-destructive">{(error as Error).message}</p>
        ) : data ? (
          <TicketReceiptView data={data} />
        ) : null}
        <DialogFooter>
          <Button variant="outline" className="w-full h-11 rounded-xl" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Cards rather than a table: six columns cannot align on a phone, and
   horizontal scrolling to read a stake is worse than stacking. */
function TicketItem({ t, active, onOpen }: { t: TicketRow; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors rounded-lg px-1 -mx-1"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-semibold truncate">{t.ticketNumber}</span>
            <StatusBadge status={t.status} />
          </div>
          <div className="font-mono font-bold text-primary text-sm tracking-wide break-words">
            {t.numbers.split(",").map((n) => n.trim()).join(" · ")}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {t.gameName} · {t.betTypeName}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {active ? (
              new Date(t.drawAt).getTime() > Date.now() ? (
                <span className="inline-flex items-center gap-1 font-medium text-blue-700 dark:text-blue-300">
                  <Clock className="h-3 w-3" /> Draw {format(new Date(t.drawAt), "d MMM · h:mm a")}
                </span>
              ) : (
                // The draw has closed and the result is not in yet.
                <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                  <Clock className="h-3 w-3" /> Awaiting result · drew {format(new Date(t.drawAt), "d MMM")}
                </span>
              )
            ) : (
              format(new Date(t.createdAt), "d MMM yyyy · h:mm a")
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-sm font-bold tabular-nums">{fmtGHS(t.stakeAmount)}</div>
          <div className="text-[11px] tabular-nums">
            {active ? (
              <span className="text-muted-foreground">to win {fmtGHS(t.potentialPayout)}</span>
            ) : t.isWinner ? (
              <span className="text-emerald-600 font-bold">+{fmtGHS(t.winAmount)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    </li>
  );
}

/** Page numbers that fit a phone: first, last, and the two either side. */
function pageList(page: number, total: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - page) <= 1) out.push(p);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

function Pager({ page, totalPages, total, pageSize, busy, onPage }: {
  page: number; totalPages: number; total: number; pageSize: number; busy: boolean; onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Past tickets pages" className="pt-3 border-t border-border/60 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" className="h-9 rounded-lg px-2.5" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1">
          {pageList(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
            ) : (
              <Button
                key={p}
                size="sm"
                variant={p === page ? "default" : "ghost"}
                className="h-9 min-w-9 rounded-lg px-2 text-xs tabular-nums"
                aria-current={p === page ? "page" : undefined}
                disabled={busy && p !== page}
                onClick={() => p !== page && onPage(p)}
              >
                {p}
              </Button>
            ),
          )}
        </div>
        <Button variant="outline" size="sm" className="h-9 rounded-lg px-2.5" disabled={page >= totalPages || busy} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-center text-[11px] text-muted-foreground tabular-nums">
        {from}–{to} of {total} past tickets
      </p>
    </nav>
  );
}

export function WriterTickets() {
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pastRef = useRef<HTMLDivElement>(null);
  const turnedPage = useRef(false);

  // Keys start with "/api/tickets", so placing a bet (which invalidates that
  // key) refreshes both lists.
  const active = useQuery({
    queryKey: ["/api/tickets", "mine", "active"],
    queryFn: () => getJson<{ rows: TicketRow[] }>("/api/tickets/mine?scope=active"),
    refetchInterval: 60_000,
  });
  // The count in the collapsed header comes from page 1, fetched up front;
  // later pages load only once the section is open.
  const past = useQuery({
    queryKey: ["/api/tickets", "mine", "past", page, PAGE_SIZE],
    queryFn: () => getJson<PastPage>(`/api/tickets/mine?scope=past&page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
    enabled: pastOpen || page === 1,
  });

  const activeRows = active.data?.rows ?? [];
  const pastData = past.data;

  // After a page change, bring the top of the section back into view - the
  // writer tapped at the bottom of a list that has just been replaced.
  useEffect(() => {
    if (!turnedPage.current || past.isPlaceholderData) return;
    turnedPage.current = false;
    scrollToTop(pastRef.current);
  }, [page, past.isPlaceholderData]);

  const goTo = (p: number) => {
    turnedPage.current = true;
    setPage(p);
  };

  const onPastOpenChange = (open: boolean) => {
    setPastOpen(open);
    // Let the section start opening, then glide to it.
    if (open) window.setTimeout(() => scrollToTop(pastRef.current), 120);
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold tracking-tight">My Tickets</h1>

      {/* ── Active: waiting for their draw, nearest draw first ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Ticket className="h-4 w-4 text-primary" />
            Active Tickets
            {activeRows.length > 0 && (
              <Badge className="h-5 px-1.5 text-[10px] font-bold tabular-nums">{activeRows.length}</Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">Waiting for their draw. Tap a ticket to see the full receipt.</CardDescription>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          {active.isLoading ? (
            <div className="py-10 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
          ) : active.isError ? (
            <p className="py-8 text-center text-sm text-destructive">{(active.error as Error).message}</p>
          ) : activeRows.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">No active tickets right now.</p>
              <Button asChild size="sm" className="rounded-lg">
                <Link href="/writer/place-bet">Place a bet</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {activeRows.map((t) => (
                <TicketItem key={t.id} t={t} active onOpen={() => setOpenTicket(t.id)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Past: settled, cancelled and void - folded away, a page at a time ── */}
      <div ref={pastRef} className="scroll-mt-20">
        <Collapsible open={pastOpen} onOpenChange={onPastOpenChange}>
          <Card>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={pastOpen ? "Hide past tickets" : "Show past tickets"}
              >
                <CardHeader className="py-4 flex-row items-center justify-between gap-3 space-y-0">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Archive className="h-4 w-4 text-muted-foreground" />
                      Past Tickets
                      {pastData && pastData.total > 0 && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold tabular-nums">{pastData.total}</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {pastData && pastData.won > 0
                        ? `${pastData.won} won · ${fmtGHS(pastData.wonAmount)} in winnings`
                        : "Drawn, cancelled and void tickets."}
                    </CardDescription>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300",
                      pastOpen && "rotate-180",
                    )}
                  />
                </CardHeader>
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              <CardContent className="px-3 sm:px-6 pt-0">
                {past.isLoading ? (
                  <div className="py-10 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
                ) : past.isError ? (
                  <p className="py-8 text-center text-sm text-destructive">{(past.error as Error).message}</p>
                ) : !pastData || pastData.total === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No past tickets yet.</p>
                ) : (
                  <>
                    <ul className={cn("divide-y divide-border/60 transition-opacity duration-200", past.isPlaceholderData && "opacity-50")}>
                      {pastData.rows.map((t) => (
                        <TicketItem key={t.id} t={t} active={false} onOpen={() => setOpenTicket(t.id)} />
                      ))}
                    </ul>
                    <Pager
                      page={pastData.page}
                      totalPages={pastData.totalPages}
                      total={pastData.total}
                      pageSize={pastData.pageSize}
                      busy={past.isFetching}
                      onPage={goTo}
                    />
                  </>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>

      <TicketDetail ticketId={openTicket} onClose={() => setOpenTicket(null)} />
    </div>
  );
}
