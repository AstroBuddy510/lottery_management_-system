import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pager, PastSection } from "@/components/writer-past-section";
import { format } from "date-fns";
import { Archive, ChevronRight, Clock, Loader2, Ticket } from "lucide-react";
import { fmtGHS } from "@/lib/utils";
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

export function WriterTickets() {
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [page, setPage] = useState(1);

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
      <PastSection
        title="Past Tickets"
        icon={Archive}
        count={pastData?.total}
        description={
          pastData && pastData.won > 0
            ? `${pastData.won} won · ${fmtGHS(pastData.wonAmount)} in winnings`
            : "Drawn, cancelled and void tickets."
        }
        open={pastOpen}
        onOpenChange={setPastOpen}
        loading={past.isLoading}
        error={past.error as Error | null}
        empty={!pastData || pastData.total === 0}
        emptyText="No past tickets yet."
        refreshing={past.isPlaceholderData}
        page={page}
        onPage={setPage}
        pager={(goTo) =>
          pastData && (
            <Pager
              label="Past tickets pages"
              page={pastData.page}
              totalPages={pastData.totalPages}
              busy={past.isFetching}
              onPage={goTo}
              summary={`${(pastData.page - 1) * pastData.pageSize + 1}–${Math.min(pastData.total, pastData.page * pastData.pageSize)} of ${pastData.total} past tickets`}
            />
          )
        }
      >
        <ul className="divide-y divide-border/60">
          {pastData?.rows.map((t) => (
            <TicketItem key={t.id} t={t} active={false} onOpen={() => setOpenTicket(t.id)} />
          ))}
        </ul>
      </PastSection>

      <TicketDetail ticketId={openTicket} onClose={() => setOpenTicket(null)} />
    </div>
  );
}
