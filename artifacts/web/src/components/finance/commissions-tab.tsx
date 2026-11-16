import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgePercent, CheckCircle2, Clock, HandCoins, XCircle } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions, StatTile } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, FIN_REFRESH_MS, finGet, finSend, ghs, fmtDate, fmtDateTime, todayAccra, type MoneyAccount } from "@/lib/finance-api";
import { EmptyRow, Field, FormDialog, Note } from "./shared";
import { cn } from "@/lib/utils";

type Week = { agentId: string; weekStart: string; weekEnd: string; gross: number; commission: number; rate: number; rateChanged: boolean; closed: boolean };
type Payout = {
  id: string; agent_id: string; agent_code: string; agency_name: string | null; amount: string; status: string;
  requested_at: string; requested_by_name: string; request_note: string | null;
  reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null;
  paid_by_name: string | null; paid_at: string | null; method: string | null; account_name: string | null; reference: string | null;
};
type Data = { weeks: Week[]; payouts: Payout[]; agents: Array<{ id: string; code: string; name: string | null }> };

export const PAYOUT_STATUS: Record<string, { label: string; cls: string }> = {
  requested: { label: "Awaiting review", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  approved: { label: "Approved · to pay", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  paid: { label: "Paid", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "Rejected", cls: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  cancelled: { label: "Withdrawn", cls: "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300" },
};
export const PayoutBadge = ({ s }: { s: string }) => (
  <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider whitespace-nowrap", PAYOUT_STATUS[s]?.cls)}>{PAYOUT_STATUS[s]?.label ?? s}</span>
);

function weeksReport(weeks: Week[], codes: Map<string, string>): TableReport {
  return {
    title: "Agent Commission by Week",
    fileName: `agent-commission-${todayAccra()}`,
    summary: [`Commission earned: ${ghs(weeks.reduce((s, w) => s + w.commission, 0))}`, "Gross sales of each agent's writers × the rate in force on the day"],
    sections: [{
      columns: [{ header: "Agency" }, { header: "Week" }, { header: "Gross sales", align: "right" }, { header: "Rate", align: "right" }, { header: "Commission", align: "right" }, { header: "State" }],
      rows: weeks.map((w) => [codes.get(w.agentId) ?? "—", `${fmtDate(w.weekStart)} – ${fmtDate(w.weekEnd)}`, ghs(w.gross), `${(w.rate * 100).toFixed(2)}%${w.rateChanged ? " (changed)" : ""}`, ghs(w.commission), w.closed ? "Week closed" : "Accruing"]),
      totals: ["Total", "", ghs(weeks.reduce((s, w) => s + w.gross, 0)), "", ghs(weeks.reduce((s, w) => s + w.commission, 0)), ""],
    }],
  };
}

function payoutsReport(rows: Payout[]): TableReport {
  return {
    title: "Agent Commission Payouts",
    fileName: `commission-payouts-${todayAccra()}`,
    orientation: "landscape",
    summary: [`Paid: ${ghs(rows.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.amount), 0))}`, `Awaiting review or payment: ${ghs(rows.filter((r) => r.status === "requested" || r.status === "approved").reduce((s, r) => s + Number(r.amount), 0))}`],
    sections: [{
      columns: [{ header: "Requested" }, { header: "Agency" }, { header: "Status" }, { header: "Reviewed by" }, { header: "Paid by" }, { header: "Method · ref" }, { header: "Amount", align: "right" }],
      rows: rows.map((r) => [fmtDateTime(r.requested_at), r.agent_code, PAYOUT_STATUS[r.status]?.label ?? r.status, r.reviewed_by_name ?? "—", r.paid_by_name ?? "—", r.method ? `${r.method}${r.reference ? ` · ${r.reference}` : ""}` : "—", ghs(r.amount)]),
    }],
  };
}

export function CommissionsTab({ role }: { role?: string }) {
  const isMgmt = role === "director" || role === "administrator";
  const isCashier = role === "cashier";
  const q = useQuery({ queryKey: [...FIN_KEY, "commissions"], queryFn: finGet<Data>("/commissions"), refetchInterval: FIN_REFRESH_MS });
  const [review, setReview] = useState<Payout | null>(null);
  const [pay, setPay] = useState<Payout | null>(null);
  const [agentFilter, setAgentFilter] = useState("_all");
  const codes = useMemo(() => new Map((q.data?.agents ?? []).map((a) => [a.id, a.code])), [q.data]);
  const weeks = (q.data?.weeks ?? []).filter((w) => agentFilter === "_all" || w.agentId === agentFilter);
  const payouts = q.data?.payouts ?? [];
  const queue = payouts.filter((p) => p.status === (isCashier ? "approved" : "requested"));
  const wPaged = usePaged(weeks, 15, agentFilter);
  const pPaged = usePaged(payouts, 15);
  const today = todayAccra();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile label="Earned, completed weeks" value={ghs((q.data?.weeks ?? []).filter((w) => w.weekEnd < today).reduce((s, w) => s + w.commission, 0))} icon={BadgePercent} />
        <StatTile label="Accruing this week" value={ghs((q.data?.weeks ?? []).filter((w) => w.weekEnd >= today).reduce((s, w) => s + w.commission, 0))} icon={Clock} />
        <StatTile label="Awaiting review / payment" value={ghs(payouts.filter((p) => p.status === "requested" || p.status === "approved").reduce((s, p) => s + Number(p.amount), 0))} tone="warn" />
        <StatTile label="Paid" value={ghs(payouts.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0))} tone="in" icon={HandCoins} />
      </div>
      <Note>
        An agent earns the commission rate set in System Settings on the gross sales of all the writers under them, week by week (Monday to Sunday).
        A rate change counts from the day it is recorded, never backwards. The agent asks for payment from their dashboard; an administrator approves or
        rejects; a cashier pays it and records how. The commission owed goes down only when the cashier has paid.
      </Note>

      <Panel title={isCashier ? "Approved - waiting to be paid" : "Requests waiting for review"} subtitle={isCashier ? "Pay each one and record the method and reference." : "Approve to send to the cashier, or reject with a reason."} icon={CheckCircle2}>
        <ScrollTable maxHeight="24rem" minWidth="52rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>Note</TableHead>
                {isCashier && <TableHead>Approved by</TableHead>}
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">{fmtDateTime(p.requested_at)}</TableCell>
                  <TableCell className="text-xs font-semibold">{p.agent_code}<span className="font-normal text-muted-foreground"> · {p.agency_name ?? ""}</span></TableCell>
                  <TableCell className="text-xs max-w-[16rem] truncate">{p.request_note ?? "—"}</TableCell>
                  {isCashier && <TableCell className="text-xs">{p.reviewed_by_name}</TableCell>}
                  <TableCell className="text-right font-mono font-bold">{ghs(p.amount)}</TableCell>
                  <TableCell className="text-right">
                    {isMgmt && <Button size="sm" className="h-7 text-[11px]" onClick={() => setReview(p)}>Review</Button>}
                    {isCashier && <Button size="sm" className="h-7 text-[11px]" onClick={() => setPay(p)}>Pay</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {!q.isLoading && queue.length === 0 && <EmptyRow cols={isCashier ? 6 : 5}>Nothing waiting.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
      </Panel>

      <Panel
        title="Commission by week"
        subtitle="Worked out from the draw calculations, so a corrected draw corrects the commission with it."
        icon={BadgePercent}
        actions={
          <>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All agencies</SelectItem>
                {(q.data?.agents ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.code}</SelectItem>)}
              </SelectContent>
            </Select>
            {weeks.length > 0 && <ReportActions label="commission by week" onPdf={() => exportReportPdf(weeksReport(weeks, codes))} onPrint={() => printReport(weeksReport(weeks, codes))} />}
          </>
        }
      >
        <ScrollTable maxHeight="28rem" minWidth="48rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency</TableHead>
                <TableHead>Week</TableHead>
                <TableHead className="text-right">Gross sales</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wPaged.rows.map((w) => (
                <TableRow key={`${w.agentId}${w.weekStart}`}>
                  <TableCell className="text-xs font-semibold">{codes.get(w.agentId) ?? "—"}</TableCell>
                  <TableCell className="text-xs">{fmtDate(w.weekStart)} – {fmtDate(w.weekEnd)}</TableCell>
                  <TableCell className="text-right font-mono">{ghs(w.gross)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{(w.rate * 100).toFixed(2)}%{w.rateChanged && <span className="ml-1 text-amber-600" title="The rate changed during this week">*</span>}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{ghs(w.commission)}</TableCell>
                  <TableCell className="text-xs">{w.closed ? "Week closed" : <span className="font-semibold text-sky-600">Accruing</span>}</TableCell>
                </TableRow>
              ))}
              {!q.isLoading && weeks.length === 0 && <EmptyRow cols={6}>No calculated sales yet.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={wPaged.page} totalPages={wPaged.totalPages} onPage={wPaged.setPage} total={wPaged.total} size={wPaged.size} noun="weeks" />
      </Panel>

      <Panel title="All payout requests" subtitle="Who asked, who decided, who paid." icon={HandCoins}
        actions={payouts.length > 0 && <ReportActions label="the payouts" onPdf={() => exportReportPdf(payoutsReport(payouts))} onPrint={() => printReport(payoutsReport(payouts))} />}>
        <ScrollTable maxHeight="28rem" minWidth="64rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewed</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pPaged.rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">{fmtDateTime(p.requested_at)}</TableCell>
                  <TableCell className="text-xs font-semibold">{p.agent_code}</TableCell>
                  <TableCell><PayoutBadge s={p.status} /></TableCell>
                  <TableCell className="text-xs">{p.reviewed_by_name ? `${p.reviewed_by_name} · ${fmtDate(p.reviewed_at)}` : "—"}{p.review_note && <div className="text-[11px] text-muted-foreground max-w-[14rem] truncate" title={p.review_note}>{p.review_note}</div>}</TableCell>
                  <TableCell className="text-xs">{p.paid_by_name ? `${p.paid_by_name} · ${p.method}${p.reference ? ` · ${p.reference}` : ""}` : "—"}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{ghs(p.amount)}</TableCell>
                </TableRow>
              ))}
              {!q.isLoading && payouts.length === 0 && <EmptyRow cols={6}>No requests yet.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={pPaged.page} totalPages={pPaged.totalPages} onPage={pPaged.setPage} total={pPaged.total} size={pPaged.size} noun="requests" />
      </Panel>

      {review && <ReviewDialog p={review} onClose={() => setReview(null)} />}
      {pay && <PayDialog p={pay} onClose={() => setPay(null)} />}
    </div>
  );
}

function ReviewDialog({ p, onClose }: { p: Payout; onClose: () => void }) {
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [note, setNote] = useState("");
  return (
    <FormDialog open onOpenChange={(v) => { if (!v) onClose(); }} title={`Commission request — ${p.agent_code}`}
      submitLabel={decision === "approve" ? "Approve" : "Reject"} successMessage={decision === "approve" ? "Approved and sent to the cashier" : "Rejected; the agent has been told"}
      description={<>{ghs(p.amount)} requested on {fmtDateTime(p.requested_at)}{p.request_note ? ` - "${p.request_note}"` : ""}.</>}
      disabled={decision === "reject" && note.trim().length < 3}
      onSubmit={() => finSend(`/commissions/payouts/${p.id}/review`, { decision, note: note || null })}>
      <div className="grid grid-cols-2 gap-2">
        {([["approve", CheckCircle2], ["reject", XCircle]] as const).map(([d, Icon]) => (
          <button key={d} type="button" onClick={() => setDecision(d)} className={cn("flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold capitalize", decision === d ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}><Icon className="h-3.5 w-3.5" />{d}</button>
        ))}
      </div>
      <Field label={decision === "reject" ? "Reason (the agent sees it)" : "Note"}><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
    </FormDialog>
  );
}

function PayDialog({ p, onClose }: { p: Payout; onClose: () => void }) {
  const accounts = useQuery({ queryKey: [...FIN_KEY, "accounts"], queryFn: finGet<MoneyAccount[]>("/accounts") });
  const [method, setMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const usable = (accounts.data ?? []).filter((a) => a.isActive);
  const acc = accountId || (method === "cash" ? usable.find((a) => a.code === "CASH")?.id ?? "" : "");
  const ok = acc && (method === "cash" || reference.trim().length >= 3);
  return (
    <FormDialog open onOpenChange={(v) => { if (!v) onClose(); }} title={`Pay commission — ${p.agent_code}`} submitLabel={`Record payment of ${ghs(p.amount)}`} successMessage="Payment recorded; the agent has been told"
      description={<>Approved by {p.reviewed_by_name}. Pay the agent, then record how. The commission owed goes down once this is recorded.</>}
      disabled={!ok}
      onSubmit={() => finSend(`/commissions/payouts/${p.id}/pay`, { method, accountId: acc, reference: reference || null })}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method">
          <Select value={method} onValueChange={(v) => { setMethod(v); setAccountId(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["cash", "momo", "bank", "transfer"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Paid from">
          <Select value={acc} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>{usable.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Field label={method === "cash" ? "Receipt number (optional)" : "Transfer / MoMo reference"}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
    </FormDialog>
  );
}
