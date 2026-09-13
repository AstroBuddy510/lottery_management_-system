import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { format } from "date-fns";
import { Loader2, ChevronRight } from "lucide-react";
import { fmtGHS } from "@/lib/utils";
import { TicketReceiptView, useTicketReceipt } from "@/components/ticket-receipt";

interface TicketRow {
  id: string;
  ticketNumber: string;
  createdAt: string;
  numbers: string;
  stakeAmount: string;
  winAmount: string;
  isWinner: boolean;
  status: string;
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
 * list without a navigation, so the writer keeps their scroll position.
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

export function WriterTickets() {
  const [openTicket, setOpenTicket] = useState<string | null>(null);

  const { data: tickets, isLoading } = useQuery<TicketRow[]>({
    queryKey: ["/api/tickets"],
    queryFn: async () => {
      const res = await fetch("/api/tickets", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      return res.json();
    },
  });

  const list = Array.isArray(tickets) ? tickets : [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold tracking-tight">My Tickets</h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Tickets</CardTitle>
          <CardDescription className="text-xs">Tap a ticket to see the full receipt.</CardDescription>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          {isLoading ? (
            <div className="py-10 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
          ) : list.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No tickets yet.</p>
          ) : (
            /* Cards rather than a table: six columns cannot align on a phone,
               and horizontal scrolling to read a stake is worse than stacking. */
            <ul className="divide-y divide-border/60">
              {list.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setOpenTicket(t.id)}
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

                      <div className="text-[11px] text-muted-foreground">
                        {format(new Date(t.createdAt), "d MMM yyyy · h:mm a")}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold tabular-nums">{fmtGHS(t.stakeAmount)}</div>
                      <div className="text-[11px] tabular-nums">
                        {t.isWinner ? (
                          <span className="text-emerald-600 font-bold">+{fmtGHS(t.winAmount)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>

                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <TicketDetail ticketId={openTicket} onClose={() => setOpenTicket(null)} />
    </div>
  );
}
