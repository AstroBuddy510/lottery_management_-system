import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, CreditCard, Check, X } from "lucide-react";
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

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4 text-amber-500" />
              Credit (postpaid) requests
              {pending.length > 0 && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                  {pending.length}
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              Postpaid lets a writer sell without buying units first, so the company carries the
              risk until settlement. Approving switches them over immediately.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Pending only" : "Show history"}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {showHistory ? "No requests yet." : "No requests waiting."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Writer</TableHead>
                    {showAgent && <TableHead>Agent</TableHead>}
                    <TableHead>Change</TableHead>
                    <TableHead>Why</TableHead>
                    <TableHead>Asked</TableHead>
                    <TableHead className="text-right">Decision</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r) => (
                    <TableRow key={r.id} className={cn(r.status === "pending" && "bg-amber-500/[0.04]")}>
                      <TableCell>
                        <div className="text-xs font-semibold">{r.writerName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.writerCode}{r.writerPhone ? ` · ${r.writerPhone}` : ""}
                        </div>
                      </TableCell>
                      {showAgent && (
                        <TableCell className="text-xs">
                          {r.agencyName ?? r.agentCode}
                          <div className="font-mono text-[10px] text-muted-foreground">{r.agentCode}</div>
                        </TableCell>
                      )}
                      <TableCell className="text-xs">
                        <span className="text-muted-foreground capitalize">{r.currentModel}</span>
                        {" → "}
                        <span className="font-semibold capitalize">{r.requestedModel}</span>
                      </TableCell>
                      <TableCell className="max-w-[220px] text-[11px] text-muted-foreground">
                        {r.reason || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {format(new Date(r.createdAt), "d MMM · HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "pending" ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              className="h-7 text-[11px]"
                              onClick={() => { setNote(""); setDeciding({ row: r, decision: "approved" }); }}
                            >
                              <Check className="mr-1 h-3 w-3" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => { setNote(""); setDeciding({ row: r, decision: "rejected" }); }}
                            >
                              <X className="mr-1 h-3 w-3" /> Reject
                            </Button>
                          </div>
                        ) : (
                          <div className="text-right">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-bold",
                                r.status === "approved"
                                  ? "border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "border-red-300/60 bg-red-500/10 text-red-700 dark:text-red-300",
                              )}
                            >
                              {r.status.toUpperCase()}
                            </Badge>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {r.decidedByName ?? "—"}
                              {r.decidedByRole ? ` · ${r.decidedByRole}` : ""}
                            </div>
                            {r.decisionNote && (
                              <div className="text-[10px] text-muted-foreground">{r.decisionNote}</div>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
