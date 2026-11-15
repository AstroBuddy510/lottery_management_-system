import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Banknote, ShieldAlert, Loader2, Check, X, RefreshCw, Smartphone, Clock, AlertTriangle,
} from "lucide-react";
import { apiGet, apiSend } from "@/lib/api-fetch";
import { useAuth } from "@/lib/auth";
import { fmtGHS } from "@/lib/utils";

/**
 * POS WINS PAYMENT: the cashier's gate.
 *
 * Everything in the queue has already been through the machine: the ticket is
 * ours, it won the draw it was sold into, it has not been claimed before, and
 * its payout is held in the Master Wallet. What is left is the part a machine
 * should not do alone - a person looking at who is about to be paid, how much,
 * and anything the system thought was worth mentioning, and deciding.
 *
 * Approve sends the money. There is no second step and no undo, so the dialog
 * shows the wallet and the amount once more and, where the system has raised
 * flags, makes the cashier acknowledge them first.
 */

type TabKey = "verified" | "processing" | "awaiting_funds" | "paid" | "rejected";

interface QueueRequest {
  payoutId: string;
  status: string;
  amount: string;
  claimedAt: string | null;
  claimMethod: string | null;
  payeeMomoNumber: string | null;
  payeeMomoProvider: string | null;
  payeeName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  rejectionReason: string | null;
  transferReference: string | null;
  transferStatus: string | null;
  transferError: string | null;
  paidAt: string | null;
  ticketNumber: string;
  numbers: string;
  stakeAmount: string;
  betTypeName: string;
  gameName: string;
  eventNumber: string;
  winningNumbers: string;
  writerName: string;
  writerCode: string;
  agentCode: string;
  agencyName: string | null;
  flags: string[];
}

interface QueueResponse {
  status: TabKey;
  requests: QueueRequest[];
  counts: Partial<Record<string, { count: number; total: string }>>;
  walletAvailable: string;
  walletHeld: string;
  paystackReady: boolean;
}

const PROVIDER: Record<string, string> = { mtn: "MTN MoMo", vod: "Telecel Cash", atl: "AirtelTigo Money" };

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "verified", label: "To approve" },
  { key: "processing", label: "Transfer sent" },
  { key: "awaiting_funds", label: "Awaiting funds" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function PosWinsPayment() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canAct = user?.role === "cashier";

  const [tab, setTab] = useState<TabKey>("verified");
  const [approving, setApproving] = useState<QueueRequest | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [rejecting, setRejecting] = useState<QueueRequest | null>(null);
  const [reason, setReason] = useState("");

  const queue = useQuery<QueueResponse>({
    queryKey: ["/api/pos-wins/queue", tab],
    queryFn: () => apiGet(`/api/pos-wins/queue?status=${tab}`),
    refetchInterval: 20_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/pos-wins/queue"] });

  const approve = useMutation({
    mutationFn: (id: string) => apiSend<{ state: string; message: string }>("POST", `/api/pos-wins/${id}/approve`),
    onSuccess: (r) => {
      r.state === "paid" ? toast.success(r.message) : toast.message(r.message);
      setApproving(null);
      refresh();
    },
    onError: (e: Error) => { toast.error(e.message); setApproving(null); refresh(); },
  });

  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      apiSend("POST", `/api/pos-wins/${v.id}/reject`, { reason: v.reason }),
    onSuccess: () => {
      toast.success("Rejected and sent to the administrator for review.");
      setRejecting(null);
      setReason("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const check = useMutation({
    mutationFn: (id: string) => apiSend<{ state?: string; message: string }>("POST", `/api/pos-wins/${id}/check`),
    onSuccess: (r) => { r.state === "paid" ? toast.success(r.message) : toast.message(r.message); refresh(); },
    onError: (e: Error) => { toast.error(e.message); refresh(); },
  });

  const data = queue.data;
  const requests = data?.requests ?? [];
  const count = (k: string) => data?.counts[k]?.count ?? 0;
  const total = (k: string) => data?.counts[k]?.total ?? "0";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
          <Banknote className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">POS Wins Payment</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Verified winning tickets waiting for a cashier. Approving sends the payout to the
            writer's MoMo wallet through Paystack.
          </p>
        </div>
      </div>

      {data && !data.paystackReady && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Paystack is not configured on this server. Requests can be reviewed and rejected, but nothing can be paid.
        </div>
      )}

      {!canAct && (
        <div className="rounded-xl border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
          You are viewing the cashier's queue. Only a cashier approves or rejects a payout.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">To approve</p>
          <p className="text-xl font-black mt-1 tabular-nums">{count("verified")}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{fmtGHS(total("verified"))} held for them</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Transfer sent</p>
          <p className="text-xl font-black mt-1 tabular-nums">{count("processing")}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Waiting on Paystack</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Awaiting funds</p>
          <p className={`text-xl font-black mt-1 tabular-nums ${count("awaiting_funds") ? "text-amber-600" : ""}`}>{count("awaiting_funds")}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{fmtGHS(total("awaiting_funds"))} not yet covered</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Master Wallet available</p>
          <p className="text-xl font-black mt-1 tabular-nums text-emerald-600">{data ? fmtGHS(data.walletAvailable) : "—"}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">For claims not yet made</p>
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-1 border-b">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {count(t.key) > 0 && t.key !== "paid" && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-muted text-[10px]">
                {count(t.key)}
              </span>
            )}
          </button>
        ))}
        <Button variant="ghost" size="sm" className="ml-auto h-8 text-xs" onClick={refresh}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${queue.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {queue.isLoading ? (
        <div className="py-16 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : requests.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {tab === "verified" && "Nothing waiting. Claims appear here once a writer scans a winning ticket."}
          {tab === "processing" && "No transfers in flight."}
          {tab === "awaiting_funds" && "No claims are waiting on the Master Wallet."}
          {tab === "paid" && "No payouts yet."}
          {tab === "rejected" && "Nothing rejected is waiting on an administrator."}
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <Card key={r.payoutId} className={r.flags.length ? "border-red-200" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  {/* The ticket */}
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold">{r.ticketNumber}</span>
                      <Badge variant="outline" className="text-[10px]">{r.betTypeName}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{r.numbers}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.gameName} #{r.eventNumber} · drawn <span className="font-mono">{r.winningNumbers}</span> · stake {fmtGHS(r.stakeAmount)}
                    </p>
                    <p className="text-xs">
                      <span className="font-semibold">{r.writerName}</span>{" "}
                      <span className="font-mono text-muted-foreground">{r.writerCode}</span>
                      <span className="text-muted-foreground"> · {r.agencyName ?? r.agentCode}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Claimed {when(r.claimedAt)}
                      {r.claimMethod === "qr" ? " · QR scanned" : r.claimMethod === "manual" ? " · typed in" : ""}
                    </p>
                  </div>

                  {/* The payee and the money */}
                  <div className="text-right shrink-0 space-y-1">
                    <p className="text-2xl font-black tabular-nums">{fmtGHS(r.amount)}</p>
                    <p className="text-xs flex items-center justify-end gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-mono font-semibold">{r.payeeMomoNumber ?? "—"}</span>
                      <span className="text-muted-foreground">{PROVIDER[r.payeeMomoProvider ?? ""] ?? ""}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">{r.payeeName ?? "Name not confirmed by network"}</p>
                  </div>
                </div>

                {r.flags.length > 0 && (
                  <div className="mt-3 rounded-lg bg-red-500/[0.06] border border-red-200 px-3 py-2 space-y-1">
                    {r.flags.map((f, i) => (
                      <p key={i} className="flex items-start gap-1.5 text-xs font-medium text-red-700">
                        <ShieldAlert className="w-3.5 h-3.5 mt-px shrink-0" /> {f}
                      </p>
                    ))}
                  </div>
                )}

                {r.transferError && r.status !== "paid" && (
                  <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {r.transferError}
                  </p>
                )}
                {r.status === "rejected" && r.rejectionReason && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Rejected by {r.reviewedByName ?? "a cashier"} on {when(r.reviewedAt)}: “{r.rejectionReason}”. With the administrator.
                  </p>
                )}
                {r.status === "paid" && (
                  <p className="mt-3 text-xs text-emerald-700">
                    Paid {when(r.paidAt)} · approved by {r.reviewedByName ?? "—"} ·{" "}
                    <span className="font-mono">{r.transferReference}</span>
                  </p>
                )}

                {canAct && (r.status === "verified" || r.status === "processing" || r.status === "awaiting_funds") && (
                  <div className="mt-3 pt-3 border-t flex items-center justify-end gap-2">
                    {r.status === "processing" ? (
                      <Button size="sm" variant="outline" disabled={check.isPending} onClick={() => check.mutate(r.payoutId)}>
                        <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${check.isPending ? "animate-spin" : ""}`} /> Check status
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="text-red-700 border-red-200 hover:bg-red-50" onClick={() => { setRejecting(r); setReason(""); }}>
                          <X className="w-3.5 h-3.5 mr-1.5" /> Reject
                        </Button>
                        {r.status === "verified" && (
                          <Button
                            size="sm"
                            disabled={!data?.paystackReady}
                            onClick={() => { setApproving(r); setAcknowledged(false); }}
                          >
                            <Check className="w-3.5 h-3.5 mr-1.5" /> Approve &amp; pay
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Approve */}
      <Dialog open={!!approving} onOpenChange={o => !o && !approve.isPending && setApproving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send this payout?</DialogTitle>
            <DialogDescription>
              The money leaves as soon as you confirm. It cannot be recalled from here.
            </DialogDescription>
          </DialogHeader>
          {approving && (
            <div className="space-y-3">
              <div className="rounded-xl border p-4 text-center">
                <p className="text-3xl font-black tabular-nums">{fmtGHS(approving.amount)}</p>
                <p className="text-sm mt-2">
                  to <span className="font-mono font-bold">{approving.payeeMomoNumber}</span>{" "}
                  <span className="text-muted-foreground">({PROVIDER[approving.payeeMomoProvider ?? ""] ?? "MoMo"})</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{approving.payeeName}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Ticket <span className="font-mono">{approving.ticketNumber}</span> · {approving.writerName} ({approving.writerCode})
                </p>
              </div>
              {approving.flags.length > 0 && (
                <div className="rounded-lg bg-red-500/[0.06] border border-red-200 px-3 py-2 space-y-1.5">
                  {approving.flags.map((f, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-xs font-medium text-red-700">
                      <ShieldAlert className="w-3.5 h-3.5 mt-px shrink-0" /> {f}
                    </p>
                  ))}
                  <label className="flex items-start gap-2 pt-1.5 border-t border-red-200 text-xs text-red-800 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
                    I have read the above and am satisfied this payout should go.
                  </label>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={approve.isPending} onClick={() => setApproving(null)}>Cancel</Button>
            <Button
              disabled={approve.isPending || (!!approving?.flags.length && !acknowledged)}
              onClick={() => approving && approve.mutate(approving.payoutId)}
            >
              {approve.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Sending…</> : `Pay ${approving ? fmtGHS(approving.amount) : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject */}
      <Dialog open={!!rejecting} onOpenChange={o => !o && setRejecting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject this payout</DialogTitle>
            <DialogDescription>
              The ticket is flagged and goes to the administrator, who will either clear it back to
              this queue or withhold it. Its money returns to the Master Wallet in the meantime.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason" className="text-xs">What is wrong with it?</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Writer's wallet was changed yesterday and the name does not match"
            />
            <p className="text-[11px] text-muted-foreground">The administrator reads this, so say what you saw.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 5 || reject.isPending}
              onClick={() => rejecting && reject.mutate({ id: rejecting.payoutId, reason: reason.trim() })}
            >
              {reject.isPending ? "Rejecting…" : "Reject and flag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PosWinsPayment;
