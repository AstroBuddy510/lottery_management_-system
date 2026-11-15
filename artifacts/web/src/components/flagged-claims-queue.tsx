import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldAlert, Undo2, Ban, Loader2 } from "lucide-react";
import { apiGet, apiSend } from "@/lib/api-fetch";
import { fmtGHS } from "@/lib/utils";

/**
 * Payouts a cashier refused, waiting on an administrator.
 *
 * Two ways out, and they are not symmetrical. Clearing a claim sends it back
 * to the cashier - it does not pay it; the person who ran the draw never
 * releases its money. Withholding ends it: the payout is cancelled and the
 * writer is texted the reason typed here, so that reason is written for the
 * writer to read.
 */

interface FlaggedRequest {
  payoutId: string;
  amount: string;
  flaggedAt: string | null;
  rejectionReason: string | null;
  reviewedByName: string | null;
  claimMethod: string | null;
  payeeMomoNumber: string | null;
  payeeName: string | null;
  ticketId: string;
  ticketNumber: string;
  numbers: string;
  betTypeName: string;
  gameName: string;
  eventNumber: string;
  writerName: string;
  writerCode: string;
  agentCode: string;
  flags: string[];
}

export function FlaggedClaimsQueue({
  canAct, onOpenTicket,
}: {
  /** Only an administrator resolves or withholds; a director may look. */
  canAct: boolean;
  onOpenTicket?: (ticketId: string) => void;
}) {
  const qc = useQueryClient();
  const [acting, setActing] = useState<{ request: FlaggedRequest; mode: "resolve" | "withhold" } | null>(null);
  const [text, setText] = useState("");

  const { data, isLoading } = useQuery<{ requests: FlaggedRequest[] }>({
    queryKey: ["/api/pos-wins/flagged"],
    queryFn: () => apiGet("/api/pos-wins/flagged"),
    refetchInterval: 30_000,
  });

  const act = useMutation({
    mutationFn: (v: { id: string; mode: "resolve" | "withhold"; text: string }) =>
      apiSend<{ status: string; writerNotified?: boolean }>(
        "POST",
        `/api/pos-wins/${v.id}/${v.mode}`,
        v.mode === "resolve" ? { note: v.text } : { reason: v.text },
      ),
    onSuccess: (r, v) => {
      if (v.mode === "resolve") {
        toast.success(
          r.status === "awaiting_funds"
            ? "Cleared. It will rejoin the cashier's queue once the Master Wallet can cover it."
            : "Cleared and sent back to the cashier's queue.",
        );
      } else {
        toast.success("Payout withheld.", {
          description: r.writerNotified ? "The writer has been texted the reason." : "The writer could not be texted - they have no phone on record.",
        });
      }
      setActing(null);
      setText("");
      qc.invalidateQueries({ queryKey: ["/api/pos-wins/flagged"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requests = data?.requests ?? [];
  if (isLoading) {
    return <div className="py-6 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /></div>;
  }
  if (requests.length === 0) return null;

  return (
    <Card className="border-red-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-600" />
          Payouts rejected by a cashier
          <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-200">{requests.length}</Badge>
        </CardTitle>
        <CardDescription>
          Each of these was verified by the system and then refused by a person. Clear it back to
          the cashier, or withhold it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.map(r => (
          <div key={r.payoutId} className="rounded-xl border p-3.5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="font-mono text-sm font-bold hover:underline"
                    onClick={() => onOpenTicket?.(r.ticketId)}
                    title="Open this ticket's full history"
                  >
                    {r.ticketNumber}
                  </button>
                  <Badge variant="outline" className="text-[10px]">{r.betTypeName}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">{r.numbers}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.gameName} #{r.eventNumber} · {r.writerName} <span className="font-mono">{r.writerCode}</span> · {r.agentCode}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">{r.reviewedByName ?? "A cashier"} said: </span>
                  <span className="font-medium">“{r.rejectionReason}”</span>
                </p>
                {r.flags.map((f, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-xs text-red-700">
                    <ShieldAlert className="w-3 h-3 mt-0.5 shrink-0" /> {f}
                  </p>
                ))}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xl font-black tabular-nums">{fmtGHS(r.amount)}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{r.payeeMomoNumber}</p>
                <p className="text-[11px] text-muted-foreground">
                  flagged {r.flaggedAt ? new Date(r.flaggedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""}
                </p>
              </div>
            </div>
            {canAct && (
              <div className="mt-3 pt-3 border-t flex items-center justify-end gap-2">
                <Button size="sm" variant="outline" className="text-red-700 border-red-200 hover:bg-red-50" onClick={() => { setActing({ request: r, mode: "withhold" }); setText(""); }}>
                  <Ban className="w-3.5 h-3.5 mr-1.5" /> Withhold payout
                </Button>
                <Button size="sm" onClick={() => { setActing({ request: r, mode: "resolve" }); setText(""); }}>
                  <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Clear &amp; return to cashier
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={!!acting} onOpenChange={o => !o && setActing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {acting?.mode === "resolve" ? "Clear this claim" : "Withhold this payout"}
            </DialogTitle>
            <DialogDescription>
              {acting?.mode === "resolve"
                ? "It goes back to the cashier's queue with your note attached. This does not pay it - a cashier still has to approve."
                : "The payout is cancelled for good and the writer is texted the reason below. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="flag-text" className="text-xs">
              {acting?.mode === "resolve" ? "What did you check?" : "Reason sent to the writer"}
            </Label>
            <Textarea
              id="flag-text"
              rows={3}
              maxLength={500}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={acting?.mode === "resolve"
                ? "e.g. Confirmed with the agent that the wallet change was requested by the writer"
                : "e.g. The ticket presented could not be authenticated"}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)}>Cancel</Button>
            <Button
              variant={acting?.mode === "withhold" ? "destructive" : "default"}
              disabled={text.trim().length < 5 || act.isPending}
              onClick={() => acting && act.mutate({ id: acting.request.payoutId, mode: acting.mode, text: text.trim() })}
            >
              {act.isPending ? "Saving…" : acting?.mode === "resolve" ? "Clear and return" : `Withhold ${acting ? fmtGHS(acting.request.amount) : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ───────────────────────── refused claim attempts ───────────────────────── */

interface AttemptsByWriter {
  writerId: string;
  writerCode: string;
  writerName: string;
  agentCode: string;
  refused: number;
  notOurs: number;
  notTheirs: number;
  repeats: number;
  losers: number;
  lastAt: string;
}

/**
 * Where forged and foreign tickets show up: every scan the system refused,
 * counted per terminal. One misread QR is nothing. A terminal with a dozen
 * tickets "not issued by VS2000" is somebody trying their luck.
 */
export function ClaimAttemptsPanel() {
  const { data, isLoading } = useQuery<{ days: number; byWriter: AttemptsByWriter[] }>({
    queryKey: ["/api/pos-wins/claim-attempts"],
    queryFn: () => apiGet("/api/pos-wins/claim-attempts?days=7"),
    refetchInterval: 60_000,
  });
  const rows = data?.byWriter ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600" /> Refused claim attempts
        </CardTitle>
        <CardDescription>
          Scans the system turned away in the last 7 days, by terminal. Ten tickets that are not
          ours or not the writer's within an hour pauses that terminal's claims and alerts you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No refused claims in the last 7 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                  <th className="text-left py-2 font-bold">Writer</th>
                  <th className="text-right py-2 font-bold" title="No such ticket in our records, or a code that did not match one">Not ours / forged</th>
                  <th className="text-right py-2 font-bold" title="A genuine ticket sold on a different terminal">Another writer's</th>
                  <th className="text-right py-2 font-bold" title="Already claimed or already paid">Repeat claims</th>
                  <th className="text-right py-2 font-bold" title="Lost, expired or voided">Not payable</th>
                  <th className="text-right py-2 font-bold">Last attempt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(w => {
                  const hot = w.notOurs + w.notTheirs >= 5;
                  return (
                    <tr key={w.writerId} className={`border-b last:border-0 ${hot ? "bg-red-500/[0.05]" : ""}`}>
                      <td className="py-2">
                        <span className="font-semibold">{w.writerName}</span>
                        <span className="block text-[11px] font-mono text-muted-foreground">{w.writerCode} · {w.agentCode}</span>
                      </td>
                      <td className={`py-2 text-right tabular-nums font-mono ${w.notOurs ? "text-red-700 font-bold" : "text-muted-foreground"}`}>{w.notOurs}</td>
                      <td className={`py-2 text-right tabular-nums font-mono ${w.notTheirs ? "text-red-700 font-bold" : "text-muted-foreground"}`}>{w.notTheirs}</td>
                      <td className={`py-2 text-right tabular-nums font-mono ${w.repeats ? "text-amber-700 font-semibold" : "text-muted-foreground"}`}>{w.repeats}</td>
                      <td className="py-2 text-right tabular-nums font-mono text-muted-foreground">{w.losers}</td>
                      <td className="py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(w.lastAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
