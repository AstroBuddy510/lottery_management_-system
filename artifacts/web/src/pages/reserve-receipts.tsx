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
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  AlertTriangle,
  Activity,
  Filter,
  Calendar,
  CheckCircle2,
  User,
  Clock,
  ArrowRight,
  TrendingUp,
  FileText,
  Search,
  RefreshCw
} from "lucide-react";

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

  const calcTotalMap = new Map(totalsList.map((t) => [t.agentId, t.totalReserve]));
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

  const formAgent = agentList.find((a) => a.id === formAgentId);

  return (
    <div className="p-6 space-y-6 relative min-h-screen">
      {/* Background radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-64 bg-gradient-to-b from-indigo-500/5 via-transparent to-transparent blur-3xl pointer-events-none" />

      {/* Breadcrumb Path & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/80">
            <span>Cashier</span>
            <span className="text-muted-foreground/45">/</span>
            <span className="text-indigo-600 dark:text-indigo-400">Reserve Receipts</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">Agent Reserve Payments</h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">Mark agent reserve payments — amounts are calculated automatically from the system</p>
        </div>
        <Button
          onClick={() => {
            setFormAgentId("");
            setFormAmountDue("");
            setFormAmountPaid("");
            setFormNotes("");
            setShowForm(true);
          }}
          className="gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl shadow-md transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 text-xs h-9"
        >
          <Plus className="w-4 h-4" />
          Record Payment
        </Button>
      </div>

      {/* Filters Box */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-card/45 backdrop-blur-md border border-border/40 rounded-2xl p-4 shadow-sm relative z-10">
        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Calculation Date</Label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="pl-9 h-9 text-xs bg-background/60 border-border/60 rounded-xl w-full"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Search Agent</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
            <Input
              placeholder="Filter by agent code or name..."
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="pl-9 h-9 text-xs bg-background/60 border-border/60 rounded-xl w-full"
            />
          </div>
        </div>

        <div className="flex items-end justify-start sm:justify-end pb-0.5">
          {date !== todayStr() && (
            <Button 
              size="sm" 
              variant="outline" 
              className="h-9 text-xs border-indigo-200 text-indigo-600 hover:bg-indigo-50/50 dark:border-indigo-900 dark:text-indigo-400 dark:hover:bg-indigo-950/20 rounded-xl"
              onClick={() => setDate(todayStr())}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Reset to Today
            </Button>
          )}
        </div>
      </div>

      {/* No-calculation warning notice */}
      {!loadingTotals && !hasCalcData && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 rounded-xl p-4 relative z-10 font-medium text-xs">
          <AlertTriangle className="w-4.5 h-4.5 text-amber-500 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            No calculation has been run for <strong>{date}</strong>. Reserve amounts cannot be determined automatically — you can still record payments manually.
          </p>
        </div>
      )}

      {/* Status summary tags */}
      <div className="flex gap-3 flex-wrap relative z-10">
        {[
          { label: "Total Agents", value: agentList.length, color: "bg-muted/40 border border-border/40 text-foreground" },
          { label: "Paid", value: paidCount, color: "bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400" },
          { label: "Unpaid", value: unpaidCount, color: unpaidCount > 0 ? "bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400" : "bg-muted/40 border border-border/40 text-muted-foreground" },
          {
            label: "Total Due",
            value: loadingTotals ? "…" : hasCalcData ? GHS(totalDue) : "—",
            color: "bg-muted/40 border border-border/40 text-foreground",
          },
          {
            label: "Total Collected",
            value: GHS(totalPaid),
            color: "bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-400",
          },
        ].map((c) => (
          <div key={c.label} className={`px-3.5 py-2 rounded-xl text-xs font-bold shadow-xs ${c.color}`}>
            {c.label}: <span className="font-extrabold font-mono ml-0.5">{c.value}</span>
          </div>
        ))}
      </div>

      {/* Agent Daily Status List Table */}
      <Card className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden relative z-10">
        <CardHeader className="pb-3 px-5 pt-5 border-b border-border/40 flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">
              Agent Payment Status — {date}
            </h2>
            {hasCalcData && (
              <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-lg font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 inline-block animate-pulse" />
                Amounts Sync'd
              </span>
            )}
          </div>
          <span className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-wider">{filteredAgents.length} agent{filteredAgents.length !== 1 ? "s" : ""}</span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="border-b border-border/40">
                  <TableHead className="text-xs font-bold text-muted-foreground pl-5 py-3">Agent</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Status</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Amount Due</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Amount Paid</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Notes</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Marked By</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground pr-5">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(loadingReceipts || loadingTotals) ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-xs font-medium">
                      <Activity className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600/60" />
                      Loading receipts…
                    </TableCell>
                  </TableRow>
                ) : filteredAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-xs font-medium">
                      No agents found for this filter.
                    </TableCell>
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
                        : <span className="text-muted-foreground/30 text-xs italic">No calc</span>;

                    const rowClass = paid
                      ? "bg-emerald-500/[0.01] hover:bg-muted/10 border-b border-border/40 border-l-2 border-l-emerald-500/50 transition-colors"
                      : "hover:bg-muted/10 border-b border-border/40 transition-colors";

                    return (
                      <TableRow key={agent.id} className={rowClass}>
                        <TableCell className="pl-5 py-3.5">
                          <div>
                            <span className="font-mono text-xs font-bold text-foreground">{agent.fullCode}</span>
                            {agent.user?.fullName && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">{agent.user.fullName}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5">
                          {paid ? (
                            <Badge className="text-[9.5px] font-extrabold uppercase px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-400 shadow-xs">
                              Paid
                            </Badge>
                          ) : (
                            <Badge className="text-[9.5px] font-extrabold uppercase px-2 py-0.5 rounded-lg bg-muted/40 border border-border text-muted-foreground">
                              Unpaid
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-medium py-3.5">
                          {amountDueDisplay}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 py-3.5">
                          {receipt ? GHS(receipt.amountPaid) : <span className="text-muted-foreground/30">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground/80 font-medium max-w-[140px] truncate py-3.5">
                          {receipt?.notes ?? <span className="text-muted-foreground/30">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground/80 font-medium py-3.5">
                          {receipt?.markedByName ?? (receipt ? receipt.markedBy.slice(0, 8) + "…" : <span className="text-muted-foreground/30">—</span>)}
                        </TableCell>
                        <TableCell className="pr-5 text-right py-3.5">
                          {paid ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px] font-bold rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                              disabled={deleting === receipt!.id}
                              onClick={() => handleDelete(receipt!.id)}
                            >
                              {deleting === receipt!.id ? "Removing…" : "Remove"}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="h-7 text-[10px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
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
          </div>
        </CardContent>
      </Card>

      {/* Record Payment Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md rounded-3xl border border-border/40 bg-card/95 backdrop-blur-lg shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">Record Reserve Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Agent selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Agent</Label>
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
                className="w-full h-9 rounded-xl border border-border/60 bg-background/60 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
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

            {/* Date */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Date</Label>
              <Input type="date" value={date} disabled className="h-9 text-xs bg-muted/40 border-border/60 rounded-xl cursor-not-allowed" />
            </div>

            {/* Amount Due */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground">Amount Due (GH₵)</Label>
                {formAgentId && calcTotalMap.has(formAgentId) ? (
                  <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-400">
                    Sync'd
                  </span>
                ) : formAgentId ? (
                  <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400">
                    No calculations
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
                className={`h-9 text-xs bg-background/60 border-border/60 rounded-xl ${
                  formAgentId && calcTotalMap.has(formAgentId) ? "bg-emerald-500/5 border-emerald-500/25 font-bold" : ""
                }`}
                readOnly={!!(formAgentId && calcTotalMap.has(formAgentId))}
              />
            </div>

            {/* Amount Paid */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Amount Paid (GH₵)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={formAmountPaid}
                onChange={(e) => setFormAmountPaid(e.target.value)}
                className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"
              />
              {formAmountDue && formAmountPaid && Number(formAmountPaid) < Number(formAmountDue) && (
                <p className="text-[10px] text-rose-600 dark:text-rose-400 flex items-center gap-1 font-bold">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  Partial payment — shortfall of {GHS(Number(formAmountDue) - Number(formAmountPaid))}
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Notes (optional)</Label>
              <Input
                placeholder="e.g. Paid in full via office cash drop"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"
              />
            </div>
          </div>
          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button variant="outline" size="sm" className="rounded-xl border-border/60" onClick={() => setShowForm(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold" onClick={handleMarkPaid} disabled={submitting || !formAgentId || !formAmountPaid}>
              {submitting ? "Saving…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
