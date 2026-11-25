import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, CreditCard, Check, X, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Writers asking to sell on credit.
 *
 * Postpaid means the writer takes bets without buying units first, so the
 * company carries the exposure until settlement. The agent normally decides,
 * but an administrator or cashier can too - an agent may be unreachable, and
 * a writer should not be stuck because of it. Whoever decides is recorded.
 *
 * One component, mounted for both the agent and the admin, so the two views
 * cannot drift apart.
 */

export interface ModelRequest {
  id: string;
  requestedModel: string;
  currentModel: string;
  status: string;
  reason: string | null;
  decisionNote: string | null;
  decidedByRole: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
  writerId: string;
  writerName: string;
  writerCode: string;
  writerPhone: string | null;
  agentCode: string;
  agencyName: string | null;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

export function ModelRequestsPanel({ showAgent = false }: { showAgent?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [deciding, setDeciding] = useState<{ row: ModelRequest; decision: "approved" | "rejected" } | null>(null);
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const { data: rows, isLoading } = useQuery<ModelRequest[]>({
    queryKey: ["/api/writer-model-requests", showHistory ? "all" : "pending"],
    queryFn: async () => {
      const res = await fetch(
        `/api/writer-model-requests?status=${showHistory ? "all" : "pending"}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error("Could not load requests");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const decide = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/writer-model-requests/${deciding!.row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ decision: deciding!.decision, note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save the decision");
      return body;
    },
    onSuccess: () => {
      const approved = deciding!.decision === "approved";
      toast({
        title: approved ? "Approved" : "Rejected",
        description: approved
          ? `${deciding!.row.writerName} is now on ${deciding!.row.requestedModel}.`
          : `${deciding!.row.writerName} stays on ${deciding!.row.currentModel}.`,
      });
      setDeciding(null);
      setNote("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const list = showHistory ? (rows ?? []) : pending;

  // One column template for the heads and every row, so they line up.
  const cols = showAgent
    ? "md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9.5rem_minmax(0,1.3fr)_6.5rem_11rem]"
    : "md:grid-cols-[minmax(0,1.3fr)_9.5rem_minmax(0,1.5fr)_6.5rem_11rem]";

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="space-y-0 border-b px-4 py-4 sm:px-5">
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <CardTitle className="flex min-w-0 items-center gap-2 text-sm sm:text-base">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                <CreditCard className="h-4 w-4 text-amber-600" />
              </span>
              <span className="truncate">Postpaid request approval</span>
              {pending.length > 0 && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-700 dark:text-amber-300">
                  {pending.length} pending
                </span>
              )}
            </CardTitle>
            <div role="group" aria-label="Show" className="order-3 mt-2 inline-flex h-8 w-full items-center rounded-lg border bg-muted/40 p-0.5 sm:order-none sm:mt-0 sm:w-auto">
              {([["pending", "Pending"], ["history", "History"]] as const).map(([k, label]) => {
                const on = (k === "history") === showHistory;
                return (
                  <button key={k} type="button" aria-pressed={on} onClick={() => setShowHistory(k === "history")}
                    className={cn("h-7 flex-1 rounded-md px-3 text-[11px] font-semibold transition-colors sm:flex-none",
                      on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {label}
                  </button>
                );
              })}
            </div>
            <CardDescription className="order-2 text-xs leading-relaxed sm:order-none sm:col-span-2 sm:pl-9">
              Postpaid lets a writer sell without buying units first, so the company carries the
              risk until settlement. Approving switches them over immediately.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {showHistory ? "No requests yet." : "No requests waiting."}
            </p>
          ) : (
            <>
              <div className={cn("hidden md:grid gap-4 border-b bg-muted/30 px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground", cols)}>
                <span>Writer</span>
                {showAgent && <span>Agent</span>}
                <span>Change</span>
                <span>Reason</span>
                <span>Asked</span>
                <span className="text-right">Decision</span>
              </div>
              <ul className="max-h-[28rem] divide-y overflow-y-auto overscroll-contain">
                {list.map((r) => (
                  <li key={r.id}
                    className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 px-4 py-3 sm:px-5 md:items-center", cols,
                      r.status === "pending" && "bg-amber-500/[0.04]")}>
                    {/* Writer */}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{r.writerName}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {r.writerCode}{r.writerPhone ? ` · ${r.writerPhone}` : ""}
                      </div>
                    </div>
                    {/* Asked: beside the name on a phone, its own column on desktop */}
                    <div className="whitespace-nowrap text-right text-[11px] tabular-nums text-muted-foreground md:order-last md:hidden">
                      {format(new Date(r.createdAt), "d MMM · HH:mm")}
                    </div>
                    {showAgent && (
                      <div className="col-span-2 min-w-0 text-xs md:col-span-1">
                        <span className="truncate">{r.agencyName ?? r.agentCode}</span>
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground md:ml-0 md:block">{r.agentCode}</span>
                      </div>
                    )}
                    <div className="col-span-2 md:col-span-1">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border bg-background px-2 py-0.5 text-[11px]">
                        <span className="capitalize text-muted-foreground">{r.currentModel}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-semibold capitalize">{r.requestedModel}</span>
                      </span>
                    </div>
                    <p className={cn("col-span-2 text-[11px] leading-snug text-muted-foreground md:col-span-1 md:line-clamp-2", !r.reason && "max-md:hidden")}>
                      {r.reason || "—"}
                    </p>
                    <div className="hidden whitespace-nowrap text-[11px] tabular-nums text-muted-foreground md:block">
                      {format(new Date(r.createdAt), "d MMM · HH:mm")}
                    </div>
                    {/* Decision */}
                    <div className="col-span-2 md:col-span-1 md:text-right">
                      {r.status === "pending" ? (
                        <div className="grid grid-cols-2 gap-2 md:flex md:justify-end md:gap-1.5">
                          <Button size="sm" className="h-8 text-[11px]"
                            onClick={() => { setNote(""); setDeciding({ row: r, decision: "approved" }); }}>
                            <Check className="mr-1 h-3 w-3" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-[11px]"
                            onClick={() => { setNote(""); setDeciding({ row: r, decision: "rejected" }); }}>
                            <X className="mr-1 h-3 w-3" /> Reject
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 md:flex-col md:items-end md:gap-0.5">
                          <Badge variant="outline"
                            className={cn("text-[10px] font-bold",
                              r.status === "approved"
                                ? "border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "border-red-300/60 bg-red-500/10 text-red-700 dark:text-red-300")}>
                            {r.status.toUpperCase()}
                          </Badge>
                          <div className="min-w-0 truncate text-[10px] text-muted-foreground">
                            {r.decidedByName ?? "—"}
                            {r.decidedByRole ? ` · ${r.decidedByRole}` : ""}
                            {r.decisionNote && <span className="md:block"> · {r.decisionNote}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!deciding} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deciding?.decision === "approved" ? "Approve credit selling" : "Reject the request"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {deciding?.row.writerName} · <span className="font-mono">{deciding?.row.writerCode}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
              {deciding?.decision === "approved"
                ? "They will be able to sell without buying units first. The company carries what they sell until settlement, and it takes effect immediately."
                : "They stay as they are and can ask again later."}
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Note (optional)</label>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Agent agreed by phone, limit reviewed monthly"
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              className={cn("flex-1 font-semibold", deciding?.decision === "rejected" && "bg-red-600 hover:bg-red-700")}
              disabled={decide.isPending}
              onClick={() => decide.mutate()}
            >
              {decide.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deciding?.decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
