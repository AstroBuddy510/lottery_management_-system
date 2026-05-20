import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgents,
  useListReserveReceipts,
  useListAgentDailyTotals,
  useCreateReserveReceipt,
  useDeleteReserveReceipt,
  getListReserveReceiptsQueryKey,
  getListAgentDailyTotalsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const GHS = (v: number | string) =>
  `GH₵ ${Number(v).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayStr = () => new Date().toISOString().slice(0, 10);

type Agent = { id: string; fullCode: string; user?: { fullName?: string | null } | null };

export function ReserveReceipts() {
  const [date, setDate] = useState<string>(todayStr());
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [formAgentId, setFormAgentId] = useState<string>("");
  const [formAmountDue, setFormAmountDue] = useState<string>("");
  const [formAmountPaid, setFormAmountPaid] = useState<string>("");
  const [formNotes, setFormNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const qc = useQueryClient();

  const { data: agents } = useListAgents();
  const { data: receipts, isLoading: loadingReceipts } = useListReserveReceipts(
    { calcDate: date },
    { query: { queryKey: getListReserveReceiptsQueryKey({ calcDate: date }), refetchInterval: 15_000 } },
  );
  const { data: dailyTotals, isLoading: loadingTotals } = useListAgentDailyTotals(
    { calcDate: date },
    { query: { queryKey: getListAgentDailyTotalsQueryKey({ calcDate: date }), refetchInterval: 30_000 } },
  );

  const { mutateAsync: createReceipt } = useCreateReserveReceipt();
  const { mutateAsync: deleteReceipt } = useDeleteReserveReceipt();

  const agentList: Agent[] = Array.isArray(agents) ? agents : [];
  const receiptList = Array.isArray(receipts) ? receipts : [];
  const totalsList = Array.isArray(dailyTotals) ? dailyTotals : [];

  // Maps agentId → calculated reserve amount from calculations
  const calcTotalMap = new Map(totalsList.map((t) => [t.agentId, t.totalReserve]));
  // Maps agentId → existing receipt for today
  const receiptMap = new Map(receiptList.map((r) => [r.agentId, r]));

  const hasCalcData = totalsList.length > 0;

  const filteredAgents = agentFilter.trim()
    ? agentList.filter(
        (a) =>
          a.fullCode.toLowerCase().includes(agentFilter.toLowerCase()) ||
          (a.user?.fullName ?? "").toLowerCase().includes(agentFilter.toLowerCase()),
      )
    : agentList;

  async function handleMarkPaid() {
    if (!formAgentId || !formAmountPaid) {
      toast.error("Please select an agent and enter the amount paid.");
      return;
    }
    setSubmitting(true);
    try {
      await createReceipt({
        data: {
          agentId: formAgentId,
          calcDate: date,
          amountDue: formAmountDue || "0.00",
          amountPaid: formAmountPaid,
          ...(formNotes.trim() ? { notes: formNotes.trim() } : {}),
        },
      });
      toast.success("Payment recorded.");
      setShowForm(false);
      setFormAgentId("");
      setFormAmountDue("");
      setFormAmountPaid("");
      setFormNotes("");
      await qc.invalidateQueries({ queryKey: getListReserveReceiptsQueryKey({ calcDate: date }) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("already")) {
        toast.error("A receipt for this agent and date already exists.");
      } else {
        toast.error("Failed to record payment.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteReceipt({ id });
      toast.success("Receipt removed.");
      await qc.invalidateQueries({ queryKey: getListReserveReceiptsQueryKey({ calcDate: date }) });
    } catch {
      toast.error("Failed to remove receipt.");
    } finally {
      setDeleting(null);
    }
  }

  function openFormForAgent(agent: Agent) {
    const calcAmount = calcTotalMap.get(agent.id) ?? "";
    setFormAgentId(agent.id);
    setFormAmountDue(calcAmount ? Number(calcAmount).toFixed(2) : "");
    setFormAmountPaid(calcAmount ? Number(calcAmount).toFixed(2) : "");
    setFormNotes("");
    setShowForm(true);
  }

  const paidCount = receiptList.length;
  const unpaidCount = Math.max(0, agentList.length - paidCount);
  const totalPaid = receiptList.reduce((s, r) => s + Number(r.amountPaid), 0);
  const totalDue = totalsList.reduce((s, t) => s + Number(t.totalReserve), 0);

  // The agent selected in the dialog
  const formAgent = agentList.find((a) => a.id === formAgentId);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b px-6 pt-6 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-slate-400 text-xs font-medium uppercase tracking-widest">Cashier</span>
              <span className="text-slate-300">›</span>
              <span className="text-slate-600 text-xs font-medium">Reserve Receipts</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 leading-tight">Agent Reserve Payments</h1>
            <p className="text-sm text-slate-500 mt-0.5">Mark agent reserve payments — amounts are calculated automatically from the system</p>
          </div>
          <Button
            onClick={() => {
              setFormAgentId("");
              setFormAmountDue("");
              setFormAmountPaid("");
              setFormNotes("");
              setShowForm(true);
            }}
          >
            <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M5 12h14"/></svg>
            Record Payment
          </Button>
        </div>
      </div>

      <div className="px-6 py-6 space-y-5">
        {/* Filters */}
        <div className="flex gap-3 items-center flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 font-medium whitespace-nowrap">Date</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 text-sm w-40"
            />
          </div>
          <Input
            placeholder="Filter agents…"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="h-8 text-sm w-52"
          />
          {date !== todayStr() && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDate(todayStr())}>
              Back to today
            </Button>
          )}
        </div>

        {/* No-calculation notice */}
        {!loadingTotals && !hasCalcData && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <p className="text-xs text-amber-700">
              No calculation has been run for <strong>{date}</strong>. Reserve amounts cannot be determined automatically — you can still record payments manually.
            </p>
          </div>
        )}

        {/* Summary chips */}
        <div className="flex gap-3 flex-wrap">
          {[
            { label: "Total Agents", value: agentList.length, color: "bg-slate-100 text-slate-700" },
            { label: "Paid", value: paidCount, color: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
            { label: "Unpaid", value: unpaidCount, color: unpaidCount > 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-slate-100 text-slate-500" },
            {
              label: "Total Due",
              value: loadingTotals ? "…" : hasCalcData ? GHS(totalDue) : "—",
              color: "bg-slate-100 text-slate-700",
            },
            {
              label: "Total Collected",
              value: GHS(totalPaid),
              color: "bg-blue-50 text-blue-700 border border-blue-200",
            },
          ].map((c) => (
            <div key={c.label} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${c.color}`}>
              {c.label}: <span className="font-bold">{c.value}</span>
            </div>
          ))}
        </div>

        {/* Agent payment status table */}
        <Card className="border-0 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-5 px-5 flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold text-slate-700">
                Agent Payment Status — {date}
              </CardTitle>
              {hasCalcData && (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  Amounts from calculation
                </span>
              )}
            </div>
            <span className="text-xs text-slate-400">{filteredAgents.length} agent{filteredAgents.length !== 1 ? "s" : ""}</span>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-t bg-slate-50/80">
                  <TableHead className="pl-5 text-xs text-slate-500">Agent</TableHead>
                  <TableHead className="text-xs text-slate-500">Status</TableHead>
                  <TableHead className="text-xs text-slate-500 text-right">Amount Due</TableHead>
                  <TableHead className="text-xs text-slate-500 text-right">Amount Paid</TableHead>
                  <TableHead className="text-xs text-slate-500">Notes</TableHead>
                  <TableHead className="text-xs text-slate-500">Marked By</TableHead>
                  <TableHead className="text-xs text-slate-500 pr-5 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(loadingReceipts || loadingTotals) ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-slate-400 text-sm">Loading…</TableCell>
                  </TableRow>
                ) : filteredAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-slate-400 text-sm">No agents found</TableCell>
                  </TableRow>
                ) : (
                  filteredAgents.map((agent) => {
                    const receipt = receiptMap.get(agent.id);
                    const calcTotal = calcTotalMap.get(agent.id);
                    const paid = !!receipt;
                    const amountDueDisplay = receipt
                      ? GHS(receipt.amountDue)
                      : calcTotal
                        ? GHS(calcTotal)
                        : <span className="text-slate-300 text-xs italic">No calc</span>;

                    return (
                      <TableRow key={agent.id} className={paid ? "bg-emerald-50/30 hover:bg-emerald-50/50" : "hover:bg-slate-50/60"}>
                        <TableCell className="pl-5">
                          <div>
                            <span className="font-mono text-xs font-bold text-slate-800">{agent.fullCode}</span>
                            {agent.user?.fullName && (
                              <p className="text-xs text-slate-400 mt-0.5">{agent.user.fullName}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {paid ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Paid</Badge>
                          ) : (
                            <Badge variant="outline" className="text-slate-500 border-slate-300 text-xs">Unpaid</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {amountDueDisplay}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold text-emerald-700">
                          {receipt ? GHS(receipt.amountPaid) : <span className="text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-[140px] truncate">
                          {receipt?.notes ?? <span className="text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {receipt?.markedByName ?? (receipt ? receipt.markedBy.slice(0, 8) + "…" : <span className="text-slate-300">—</span>)}
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          {paid ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                              disabled={deleting === receipt!.id}
                              onClick={() => handleDelete(receipt!.id)}
                            >
                              {deleting === receipt!.id ? "Removing…" : "Remove"}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => openFormForAgent(agent)}
                            >
                              Mark Paid
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Mark Paid Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Reserve Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Agent selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Agent</label>
              <select
                value={formAgentId}
                onChange={(e) => {
                  const id = e.target.value;
                  setFormAgentId(id);
                  const calcAmount = calcTotalMap.get(id);
                  const amt = calcAmount ? Number(calcAmount).toFixed(2) : "";
                  setFormAmountDue(amt);
                  setFormAmountPaid(amt);
                }}
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select agent…</option>
                {agentList
                  .filter((a) => !receiptMap.has(a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullCode}{a.user?.fullName ? ` — ${a.user.fullName}` : ""}
                    </option>
                  ))}
              </select>
            </div>

            {/* Date (read-only) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Date</label>
              <Input type="date" value={date} disabled className="h-9 text-sm bg-slate-50" />
            </div>

            {/* Amount Due — from calculation, read-only if available */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">Amount Due (GH₵)</label>
                {formAgentId && calcTotalMap.has(formAgentId) ? (
                  <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                    From calculation
                  </span>
                ) : formAgentId ? (
                  <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                    No calc for this date
                  </span>
                ) : null}
              </div>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={formAmountDue}
                onChange={(e) => setFormAmountDue(e.target.value)}
                className={`h-9 text-sm ${formAgentId && calcTotalMap.has(formAgentId) ? "bg-emerald-50/50 border-emerald-200 font-semibold" : ""}`}
                readOnly={!!(formAgentId && calcTotalMap.has(formAgentId))}
              />
            </div>

            {/* Amount Paid */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Amount Paid (GH₵)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={formAmountPaid}
                onChange={(e) => setFormAmountPaid(e.target.value)}
                className="h-9 text-sm"
              />
              {formAmountDue && formAmountPaid && Number(formAmountPaid) < Number(formAmountDue) && (
                <p className="text-[11px] text-amber-600 flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  Partial payment — shortfall of {GHS(Number(formAmountDue) - Number(formAmountPaid))}
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Notes (optional)</label>
              <Input
                placeholder="e.g. Cash received at office"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleMarkPaid} disabled={submitting || !formAgentId || !formAmountPaid}>
              {submitting ? "Saving…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
