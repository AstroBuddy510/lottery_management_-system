import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronRight, ChevronDown, Loader2, Check, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS } from "@/lib/utils";
import { TicketReceiptView, useTicketReceipt } from "@/components/ticket-receipt";

/**
 * Payout review, drilled down four levels:
 *   agent -> writer -> winning ticket -> full ticket detail + approve.
 * Each level loads only when opened, so a draw with many agents costs one
 * query up front rather than one per writer.
 */

interface DrawGame {
  gameId: string;
  name: string;
  eventNumber: string;
  drawDate: string;
  winningNumbers: string | null;
  totalWinners: number | null;
  totalPayouts: string | null;
}

interface AgentRow {
  agentId: string;
  agentCode: string;
  agencyName: string | null;
  agentName: string;
  ticketCount: number;
  totalWins: string;
  pendingCount: number;
  approvedCount: number;
  paidCount: number;
}

interface WriterRow {
  writerId: string;
  writerName: string;
  writerCode: string;
  phone: string | null;
  operationModel: string;
  ticketCount: number;
  totalWins: string;
  pendingCount: number;
}

interface TicketRow {
  payoutId: string;
  status: string;
  payoutAmount: string;
  ticketId: string;
  ticketNumber: string;
  numbers: string;
  stakeAmount: string;
  winAmount: string;
  soldAt: string;
  betTypeName: string;
  gameName: string;
  eventNumber: string;
  winningNumbers: string | null;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
  return res.json();
}

function statusBadge(status: string) {
  const tone =
    status === "paid"
      ? "bg-emerald-500/10 text-emerald-700 border-emerald-200"
      : status === "approved"
        ? "bg-blue-500/10 text-blue-700 border-blue-200"
        : status === "rejected"
          ? "bg-destructive/10 text-destructive border-destructive/20"
          : "bg-amber-500/10 text-amber-700 border-amber-200";
  return <Badge variant="outline" className={`${tone} text-[10px] font-bold`}>{status.toUpperCase()}</Badge>;
}

/** Level 3 + 4: a writer's winning tickets, each expandable to full detail. */
function WriterTickets({ writerId, gameId }: { writerId: string; gameId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openTicket, setOpenTicket] = useState<string | null>(null);

  const { data: tickets, isLoading } = useQuery<TicketRow[]>({
    queryKey: ["/api/payouts/writer-tickets", writerId, gameId],
    queryFn: () => getJson(`/api/payouts/writers/${writerId}/tickets?gameId=${encodeURIComponent(gameId)}`),
  });

  const approve = useMutation({
    mutationFn: async (payoutId: string) => {
      const res = await fetch(`/api/payouts/${payoutId}/approve`, { method: "PATCH", headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Approval failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payout approved" });
      qc.invalidateQueries({ queryKey: ["/api/payouts"] });
      qc.invalidateQueries({ queryKey: ["/api/payouts/writer-tickets"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>;
  if (!tickets?.length) return <p className="py-3 text-xs text-muted-foreground">No winning tickets.</p>;

  return (
    <div className="rounded-md border bg-background overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Ticket</TableHead>
            <TableHead className="text-xs">Bet</TableHead>
            <TableHead className="text-xs">Numbers</TableHead>
            <TableHead className="text-xs text-right">Stake</TableHead>
            <TableHead className="text-xs text-right">Win</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((t) => (
            <TableRow key={t.payoutId} className="cursor-pointer" onClick={() => setOpenTicket(t.ticketId)}>
              <TableCell className="font-mono text-xs">{t.ticketNumber}</TableCell>
              <TableCell className="text-xs">{t.betTypeName}</TableCell>
              <TableCell className="font-mono text-xs">{t.numbers}</TableCell>
              <TableCell className="text-xs text-right tabular-nums">{fmtGHS(t.stakeAmount)}</TableCell>
              <TableCell className="text-xs text-right tabular-nums font-semibold">{fmtGHS(t.payoutAmount)}</TableCell>
              <TableCell>{statusBadge(t.status)}</TableCell>
              <TableCell className="text-right">
                {t.status === "pending" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={approve.isPending}
                    onClick={(e) => { e.stopPropagation(); approve.mutate(t.payoutId); }}
                  >
                    <Check className="h-3 w-3 mr-1" /> Approve
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <TicketDetailDialog ticketId={openTicket} onClose={() => setOpenTicket(null)} />
    </div>
  );
}

/** Level 4: the full ticket, reusing the receipt view. */
function TicketDetailDialog({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  const { data, isLoading, isError, error } = useTicketReceipt(ticketId);
  return (
    <Dialog open={!!ticketId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Ticket detail</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-destructive">{(error as Error).message}</p>
        ) : data ? (
          <TicketReceiptView data={data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Level 2: writers under one agent. */
function AgentWriters({ agentId, gameId }: { agentId: string; gameId: string }) {
  const [openWriter, setOpenWriter] = useState<string | null>(null);
  const { data: writers, isLoading } = useQuery<WriterRow[]>({
    queryKey: ["/api/payouts/agent-writers", agentId, gameId],
    queryFn: () => getJson(`/api/payouts/agents/${agentId}/writers?gameId=${encodeURIComponent(gameId)}`),
  });

  if (isLoading) return <div className="py-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>;
  if (!writers?.length) return <p className="py-3 text-xs text-muted-foreground">No winning writers.</p>;

  return (
    <div className="space-y-2">
      {writers.map((w) => {
        const open = openWriter === w.writerId;
        return (
          <div key={w.writerId} className="rounded-lg border bg-muted/20">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-muted/40 transition-colors"
              onClick={() => setOpenWriter(open ? null : w.writerId)}
            >
              <span className="flex items-center gap-2 min-w-0">
                {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{w.writerName}</span>
                  <span className="block text-[11px] font-mono text-muted-foreground">{w.writerCode}</span>
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-sm font-bold tabular-nums">{fmtGHS(w.totalWins)}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {w.ticketCount} ticket{w.ticketCount === 1 ? "" : "s"}
                  {w.pendingCount > 0 && ` · ${w.pendingCount} pending`}
                </span>
              </span>
            </button>
            {open && <div className="px-3 pb-3"><WriterTickets writerId={w.writerId} gameId={gameId} /></div>}
          </div>
        );
      })}
    </div>
  );
}

/** Level 1: agents. */
export function PayoutApprovals() {
  const [gameId, setGameId] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  const { data: games, isLoading: gamesLoading } = useQuery<DrawGame[]>({
    queryKey: ["/api/payouts/games"],
    queryFn: () => getJson("/api/payouts/games"),
  });

  const effectiveGameId = gameId ?? games?.[0]?.gameId ?? null;
  const selectedGame = games?.find((g) => g.gameId === effectiveGameId);

  const { data: agents, isLoading } = useQuery<AgentRow[]>({
    queryKey: ["/api/payouts/agents", effectiveGameId],
    queryFn: () => getJson(`/api/payouts/agents?gameId=${encodeURIComponent(effectiveGameId!)}`),
    enabled: !!effectiveGameId,
  });

  const grandTotal = (agents ?? []).reduce((sum, a) => sum + Number(a.totalWins), 0);
  const pendingTotal = (agents ?? []).reduce((sum, a) => sum + a.pendingCount, 0);
  const approvedTotal = (agents ?? []).reduce((sum, a) => sum + a.approvedCount, 0);

  const qc = useQueryClient();
  const { toast } = useToast();

  /** The paying step: credits approved payouts and sends the win SMS. */
  const processPayouts = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/game-results/${effectiveGameId}/process-payouts`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Processing failed");
      return res.json();
    },
    onSuccess: (r: { processedCount?: number; skippedCount?: number }) => {
      toast({
        title: `Processed ${r?.processedCount ?? 0} payout${r?.processedCount === 1 ? "" : "s"}`,
        description: r?.skippedCount ? `${r.skippedCount} skipped — see response for reasons.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["/api/payouts"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-amber-500" />
            Payout Approvals
          </CardTitle>
          <CardDescription>
            Agent → writer → ticket. Approving authorises a payout; it does not credit the writer.
          </CardDescription>
        </div>
        {(games?.length ?? 0) > 0 && (
          <Select value={effectiveGameId ?? undefined} onValueChange={setGameId}>
            <SelectTrigger className="w-[240px] h-9"><SelectValue placeholder="Select a draw" /></SelectTrigger>
            <SelectContent>
              {games!.map((g) => (
                <SelectItem key={g.gameId} value={g.gameId}>
                  {g.name} · {g.eventNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {gamesLoading ? (
          <div className="py-10 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : !games?.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No settled draws yet. Post the declared numbers in NLA Declared Draw Entry to settle a draw.
          </p>
        ) : (
          <>
            {selectedGame?.winningNumbers && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs rounded-lg border bg-muted/30 px-3 py-2">
                <span>
                  <span className="text-muted-foreground">Winning numbers: </span>
                  <span className="font-mono font-semibold">{selectedGame.winningNumbers}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Total wins: </span>
                  <span className="font-semibold tabular-nums">{fmtGHS(grandTotal)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Pending approvals: </span>
                  <span className="font-semibold tabular-nums">{pendingTotal}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Approved, awaiting payment: </span>
                  <span className="font-semibold tabular-nums">{approvedTotal}</span>
                </span>
                <Button
                  size="sm"
                  className="ml-auto h-8"
                  disabled={approvedTotal === 0 || processPayouts.isPending}
                  onClick={() => processPayouts.mutate()}
                >
                  {processPayouts.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    : <Check className="h-3.5 w-3.5 mr-1.5" />}
                  Process Payouts &amp; SMS
                </Button>
              </div>
            )}

            {isLoading ? (
              <div className="py-10 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
            ) : !agents?.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No winning tickets for this draw.</p>
            ) : (
              <div className="space-y-2">
                {agents.map((a) => {
                  const open = openAgent === a.agentId;
                  return (
                    <div key={a.agentId} className="rounded-xl border">
                      <button
                        type="button"
                        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/40 transition-colors"
                        onClick={() => setOpenAgent(open ? null : a.agentId)}
                      >
                        <span className="flex items-center gap-3 min-w-0">
                          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                          <span className="min-w-0">
                            <span className="block font-semibold truncate">{a.agentName}</span>
                            <span className="block text-xs text-muted-foreground">
                              <span className="font-mono">{a.agentCode}</span>
                              {a.agencyName ? ` · ${a.agencyName}` : ""}
                            </span>
                          </span>
                        </span>
                        <span className="text-right shrink-0">
                          <span className="block text-lg font-bold tabular-nums">{fmtGHS(a.totalWins)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {a.ticketCount} ticket{a.ticketCount === 1 ? "" : "s"}
                            {a.pendingCount > 0 && ` · ${a.pendingCount} pending`}
                          </span>
                        </span>
                      </button>
                      {open && effectiveGameId && (
                        <div className="px-4 pb-4">
                          <AgentWriters agentId={a.agentId} gameId={effectiveGameId} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
