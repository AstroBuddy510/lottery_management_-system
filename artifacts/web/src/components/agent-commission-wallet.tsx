import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, ChevronDown, ChevronUp, FileText, Loader2, Wallet as WalletIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiSend, errorText, ghs, fmtDate, fmtDateTime } from "@/lib/finance-api";
import { PayoutBadge } from "@/components/finance/commissions-tab";
import { StatementDialog } from "@/components/finance/agencies-tab";
import { FormDialog, Field } from "@/components/finance/shared";

type Wallet = {
  agentId: string;
  weeks: Array<{ weekStart: string; weekEnd: string; gross: number; commission: number; rate: number; closed: boolean }>;
  totalEarned: number; earnedClosed: number; currentWeek: { weekStart: string; weekEnd: string; gross: number; commission: number } | null;
  paid: number; pending: number; outstanding: number; available: number;
  payouts: Array<{ id: string; amount: string; status: string; requestedAt: string; reviewNote: string | null; paidAt: string | null; method: string | null; reference: string | null }>;
};

const KEY = ["agent-commission"] as const;

/**
 * The agent's commission: what they have earned on their writers' sales,
 * what has been paid, and a way to ask for the rest. Commission is owed by
 * the company - it is not money the agent already holds.
 */
export function AgentCommissionWallet({
  agencyCode, agencyName, agentName, collapsible, open, onOpenChange, id,
}: {
  agencyCode?: string; agencyName?: string | null; agentName?: string;
  /** Show only the wallet icon and title until tapped; the figures stay hidden. */
  collapsible?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; id?: string;
}) {
  const q = useQuery({ queryKey: KEY, queryFn: apiGet<Wallet>("/agent/commission"), refetchInterval: 60_000 });
  const [requestOpen, setRequestOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [statement, setStatement] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const cancel = useMutation({
    mutationFn: (id: string) => apiSend(`/agent/commission/requests/${id}/cancel`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast({ title: "Request withdrawn" }); },
    onError: (e) => toast({ title: errorText(e, "Could not withdraw it"), variant: "destructive" }),
  });
  const w = q.data;
  if (!w) return null;

  const body = (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {/* Folded, the bar above already names the wallet. */}
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">{collapsible ? "Available to request" : "Commission wallet"}</div>
          <div className="mt-1 text-2xl font-black font-mono text-gray-900">{ghs(w.available)}</div>
          <div className="text-[11px] text-gray-500">{collapsible ? "owed to you by the company" : "available to request · owed to you by the company"}</div>
        </div>
        {!collapsible && <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><BadgePercent className="w-5 h-5" /></span>}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          ["Total earned", ghs(w.totalEarned)],
          ["This week (accruing)", ghs(w.currentWeek?.commission ?? 0)],
          ["Paid to you", ghs(w.paid)],
          ["Requested, pending", ghs(w.pending)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-gray-50 px-3 py-2"><div className="text-[10px] font-semibold uppercase text-gray-400">{l}</div><div className="font-mono font-bold text-gray-800">{v}</div></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="rounded-xl font-bold" disabled={w.available <= 0} onClick={() => setRequestOpen(true)}>Request payment</Button>
        <Button size="sm" variant="outline" className="rounded-xl gap-1" onClick={() => setShowHistory((v) => !v)}>
          History {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </Button>
        <Button size="sm" variant="outline" className="rounded-xl gap-1" onClick={() => setStatement(true)}><FileText className="w-3.5 h-3.5" /> Account statement</Button>
      </div>
      {w.available <= 0 && <p className="text-[11px] text-gray-500">Commission for a week can be requested once the week has ended (Sunday).</p>}

      {showHistory && (
        <div className="space-y-3">
          <div>
            <div className="text-[10px] font-bold uppercase text-gray-400 mb-1">Payout requests</div>
            {w.payouts.length === 0 && <p className="text-xs text-gray-500">None yet.</p>}
            <ul className="divide-y">
              {w.payouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                  <div>
                    <div className="font-mono font-bold">{ghs(p.amount)}</div>
                    <div className="text-[11px] text-gray-500">{fmtDateTime(p.requestedAt)}{p.paidAt ? ` · paid ${fmtDate(p.paidAt)} (${p.method}${p.reference ? `, ${p.reference}` : ""})` : ""}{p.reviewNote && p.status === "rejected" ? ` · ${p.reviewNote}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PayoutBadge s={p.status} />
                    {p.status === "requested" && (
                      <button type="button" className="text-[11px] font-bold text-rose-600 hover:underline disabled:opacity-50" disabled={cancel.isPending} onClick={() => cancel.mutate(p.id)}>
                        {cancel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Withdraw"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-gray-400 mb-1">By week</div>
            <ul className="divide-y">
              {w.weeks.slice(0, 12).map((wk) => (
                <li key={wk.weekStart} className="flex items-center justify-between py-1.5 text-xs">
                  <span>{fmtDate(wk.weekStart)} – {fmtDate(wk.weekEnd)}{!wk.closed && <span className="ml-1 text-[10px] font-bold text-sky-600">accruing</span>}</span>
                  <span className="text-gray-500">{ghs(wk.gross)} × {(wk.rate * 100).toFixed(2)}% = <b className="font-mono text-gray-800">{ghs(wk.commission)}</b></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

    </div>
  );

  const dialogs = (
    <>
      {requestOpen && <RequestDialog available={w.available} onClose={() => { setRequestOpen(false); qc.invalidateQueries({ queryKey: KEY }); }} />}
      {statement && <StatementDialog a={{ id: w.agentId, code: agencyCode ?? "My agency", agencyName: agencyName ?? null, agentName: agentName ?? "" }} onClose={() => setStatement(false)} />}
    </>
  );

  if (!collapsible) {
    return (
      <div id={id} className="bg-card border rounded-2xl p-5 shadow-sm">
        {body}
        {dialogs}
      </div>
    );
  }

  // Folded to an icon and a title: nothing about the money shows until the
  // agent taps it, which keeps the home screen short.
  return (
    <Collapsible id={id} open={open} onOpenChange={onOpenChange}
      className="bg-card border rounded-2xl shadow-sm overflow-hidden scroll-mt-4">
      <CollapsibleTrigger asChild>
        <button type="button"
          className="group w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <WalletIcon className="w-5 h-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">Commission wallet</span>
            <span className="block text-[11px] text-muted-foreground">
              <span className="group-data-[state=open]:hidden">Tap to view your commission</span>
              <span className="hidden group-data-[state=open]:inline">Tap to hide</span>
            </span>
          </span>
          {w.pending > 0 && (
            <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700">Request pending</span>
          )}
          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn("overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up")}>
        <div className="border-t px-5 pb-5 pt-4">{body}</div>
      </CollapsibleContent>
      {dialogs}
    </Collapsible>
  );
}

function RequestDialog({ available, onClose }: { available: number; onClose: () => void }) {
  const [amount, setAmount] = useState(available.toFixed(2));
  const [note, setNote] = useState("");
  const ok = /^\d{1,9}(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0 && Number(amount) <= available + 0.005;
  return (
    <FormDialog open onOpenChange={(v) => { if (!v) onClose(); }} title="Request commission payment" submitLabel="Send request" successMessage="Request sent to the administrator"
      description={`Up to ${ghs(available)} - commission for completed weeks, less what is paid or already requested. An administrator approves it and a cashier pays it.`}
      disabled={!ok}
      onSubmit={() => apiSend("/agent/commission/requests", { amount: amount.trim(), note: note || null })}>
      <Field label="Amount (GH₵)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Commission for the week ending 15 Nov" /></Field>
    </FormDialog>
  );
}
