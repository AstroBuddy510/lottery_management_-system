import { useState, useMemo, useCallback, useRef } from "react";
import {
  useListPayments, useCreatePayment, useVoidPayment,
  useListAgents, useListExpenseCategories, useListCalculations,
  useListTimeWindows, useApprovePayment, useRejectPayment,
  getListPaymentsQueryKey, getListCalculationsQueryKey,
  getListTimeWindowsQueryKey,
} from "@workspace/api-client-react";
import type { TimeWindow } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useAuth } from "@/lib/auth";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS } from "@/lib/utils";

type ExpenseItem = { expenseCategoryId: string; name: string; amount: string };
type CreatedPayment = {
  id: string; agentId: string; transactionType: string;
  grossAmount?: string | null; amount: string;
  expenseItems?: ExpenseItem[] | null; paymentDate: string; receiptNumber?: string | null;
};

const today = () => new Date().toISOString().split("T")[0];

function fmtTime(ts?: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ── Time window helpers ─────────────────────────────────────────────────── */
function getWindowStatus(windows: TimeWindow[]) {
  const now   = new Date();
  const dow   = now.getDay();
  const hhmm  = now.toTimeString().slice(0, 5);
  const active = windows.filter(w => w.isActive && w.dayOfWeek === dow);
  const current = active.find(w => w.windowOpen <= hhmm && hhmm <= w.windowClose);
  if (current) return { open: true, window: current, nextTime: null as string | null };
  const upcoming = active
    .filter(w => w.windowOpen > hhmm)
    .sort((a, b) => a.windowOpen.localeCompare(b.windowOpen));
  return { open: false, window: null, nextTime: upcoming[0]?.windowOpen ?? null };
}

function fmtHHMM(t?: string | null) {
  if (!t) return "—";
  const [h, m] = t.split(":");
  const hr = Number(h);
  return `${hr % 12 || 12}:${m} ${hr < 12 ? "AM" : "PM"}`;
}

/* ── Window status banner ─────────────────────────────────────────────────── */
function WindowBanner({ windows }: { windows: TimeWindow[] }) {
  const ws = getWindowStatus(windows);
  return (
    <div className={`rounded-xl border px-5 py-3 flex items-center gap-4 flex-wrap ${ws.open ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${ws.open ? "bg-emerald-100" : "bg-red-100"}`}>
        <svg className={`w-4 h-4 ${ws.open ? "text-emerald-700" : "text-red-600"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-bold ${ws.open ? "text-emerald-800" : "text-red-700"}`}>
          Payment Window: {ws.open ? "OPEN" : "CLOSED"}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {ws.open && ws.window
            ? `Accepting payments until ${fmtHHMM(ws.window.windowClose)}`
            : ws.nextTime
              ? `Next window opens at ${fmtHHMM(ws.nextTime)}`
              : "No payment windows scheduled for today"}
              </div>
      </div>
      <span className={`text-xs font-semibold px-3 py-1 rounded-full ${ws.open ? "bg-emerald-200 text-emerald-800" : "bg-red-200 text-red-800"}`}>
        {ws.open ? "● ACCEPTING" : "○ RESTRICTED"}
      </span>
    </div>
  );
}

/* ── Settlement status badge ─────────────────────────────────────────────── */
type Settlement = { balanceDue: number; collected: number; paidOut: number; hasCalc: boolean };
function settlementStatus(s: Settlement) {
  if (!s.hasCalc) return { label: "No Calc", color: "text-muted-foreground", bg: "bg-muted/50 text-muted-foreground" };
  const net = s.collected - s.paidOut;
  const shortfall = s.balanceDue - net;
  if (Math.abs(shortfall) < 0.005) return { label: "Settled", color: "text-emerald-700", bg: "bg-emerald-100 text-emerald-800" };
  if (shortfall > 0) return { label: `Due ${fmtGHS(shortfall)}`, color: "text-red-600", bg: "bg-red-100 text-red-800" };
  return { label: `Overpaid ${fmtGHS(-shortfall)}`, color: "text-amber-700", bg: "bg-amber-100 text-amber-800" };
}

/* ── Main Payments component ─────────────────────────────────────────────── */
const EMPTY_FORM = { agentId: "", transactionType: "pay_in" as "pay_in" | "pay_out", grossAmount: "", paymentDate: today() };

export function Payments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canVoid = user?.role === "director" || user?.role === "administrator";

  /* ── data ── */
  const [boardDate, setBoardDate] = useState(today());
  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterFrom, setFilterFrom]   = useState("");
  const [filterTo, setFilterTo]       = useState("");

  const { data: rawPayments, isLoading: loadingPayments } = useListPayments({
    agentId: filterAgentId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo:   filterTo   || undefined,
  });
  const { data: pendingPayments, isLoading: loadingPending } = useListPayments({
    status: "pending",
  });
  const { data: allPaymentsRaw } = useListPayments({});
  const { data: agents }         = useListAgents({});
  const { data: expenseCategories } = useListExpenseCategories();
  const { data: allCalcs }       = useListCalculations({}, { query: { queryKey: getListCalculationsQueryKey({}) } });
  const { data: timeWindows }    = useListTimeWindows({ query: { queryKey: getListTimeWindowsQueryKey() } });
  const { allWriters }           = useWriterLookup();

  const createMutation = useCreatePayment();
  const voidMutation   = useVoidPayment();
  const approveMutation = useApprovePayment();
  const rejectMutation = useRejectPayment();

  /* ── modal state ── */
  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState(EMPTY_FORM);
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([]);
  const [receiptPayment, setReceiptPayment] = useState<CreatedPayment | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  /* ── derived lists ── */
  const agentList   = useMemo(() => Array.isArray(agents) ? agents : [], [agents]);
  const expenseList = useMemo(() => Array.isArray(expenseCategories) ? expenseCategories.filter(e => e.isActive) : [], [expenseCategories]);
  const calcList    = useMemo(() => Array.isArray(allCalcs) ? allCalcs : [], [allCalcs]);
  const pendingList = useMemo(() => Array.isArray(pendingPayments) ? pendingPayments : [], [pendingPayments]);
  const paymentList = useMemo(() => Array.isArray(rawPayments) ? rawPayments : [], [rawPayments]);
  const allPayments = useMemo(() => Array.isArray(allPaymentsRaw) ? allPaymentsRaw : [], [allPaymentsRaw]);
  const windows     = useMemo(() => Array.isArray(timeWindows) ? timeWindows : [], [timeWindows]);

  const agentMap = useMemo(() =>
    Object.fromEntries(agentList.map(a => [a.id, { name: a.user?.fullName ?? a.fullCode, code: a.fullCode }])),
    [agentList]
  );

  /* writer → agentId map */
  const writerAgentMap = useMemo(() =>
    Object.fromEntries(allWriters.map(w => [w.id, w.agentId])),
    [allWriters]
  );

  /* ── Today's cash position (always across all filters) ── */
  const todayStr = today();
  const todayValid = useMemo(
    () => allPayments.filter(p => p.paymentDate?.startsWith(todayStr) && !p.isVoided),
    [allPayments, todayStr]
  );
  const todayPayIn  = useMemo(() => todayValid.filter(p => p.transactionType === "pay_in").reduce((s, p) => s + Number(p.amount), 0), [todayValid]);
  const todayPayOut = useMemo(() => todayValid.filter(p => p.transactionType === "pay_out").reduce((s, p) => s + Number(p.amount), 0), [todayValid]);
  const netPosition = todayPayIn - todayPayOut;

  /* ── Settlement board computation ── */
  const boardCalcs    = useMemo(() => calcList.filter(c => c.calcDate === boardDate), [calcList, boardDate]);
  const boardPayments = useMemo(() => allPayments.filter(p => p.paymentDate?.startsWith(boardDate) && !p.isVoided), [allPayments, boardDate]);

  const settlements = useMemo(() => {
    return agentList.filter(a => a.isActive).map(a => {
      const agentWriterIds = new Set(allWriters.filter(w => w.agentId === a.id).map(w => w.id));
      const agentCalcs     = boardCalcs.filter(c => agentWriterIds.has(c.writerId));
      const agentPmts      = boardPayments.filter(p => p.agentId === a.id);
      const balanceDue     = agentCalcs.reduce((s, c) => s + Number(c.writerBalance), 0);
      const collected      = agentPmts.filter(p => p.transactionType === "pay_in").reduce((s, p) => s + Number(p.amount), 0);
      const paidOut        = agentPmts.filter(p => p.transactionType === "pay_out").reduce((s, p) => s + Number(p.amount), 0);
      const hasCalc        = agentCalcs.length > 0;
      return { agent: a, balanceDue, collected, paidOut, hasCalc };
    });
  }, [agentList, allWriters, boardCalcs, boardPayments]);

  const boardTotalDue       = settlements.reduce((s, r) => s + Math.max(0, r.balanceDue), 0);
  const boardTotalCollected = settlements.reduce((s, r) => s + r.collected, 0);
  const boardTotalOut       = settlements.reduce((s, r) => s + r.paidOut, 0);
  const settledCount        = settlements.filter(r => {
    const s = settlementStatus(r); return s.label === "Settled";
  }).length;
  const outstandingCount    = settlements.filter(r => r.hasCalc && settlementStatus(r).label !== "Settled").length;

  /* ── Form helpers ── */
  const gross        = Number(form.grossAmount) || 0;
  const expenseTotal = expenseItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const netAmount    = gross - expenseTotal;

  const resetForm = useCallback(() => { setForm(EMPTY_FORM); setExpenseItems([]); }, []);

  const prefillAgent = useCallback((agentId: string, amount: number, type: "pay_in" | "pay_out" = "pay_in") => {
    setForm({ agentId, transactionType: type, grossAmount: Math.abs(amount).toFixed(2), paymentDate: boardDate });
    setExpenseItems([]);
    setOpen(true);
  }, [boardDate]);

  const addExpenseItem = () => setExpenseItems(prev => [...prev, { expenseCategoryId: "", name: "", amount: "" }]);
  const removeExpenseItem = (idx: number) => setExpenseItems(prev => prev.filter((_, i) => i !== idx));
  const updateExpenseItem = (idx: number, field: keyof ExpenseItem, value: string) => {
    setExpenseItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      if (field === "expenseCategoryId") {
        if (value === "custom") {
          return { expenseCategoryId: "custom", name: "", amount: "" };
        }
        const cat = expenseList.find(e => e.id === value);
        return { expenseCategoryId: value, name: cat?.name ?? "", amount: cat?.defaultAmount ?? "" };
      }
      return { ...item, [field]: value };
    }));
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListPaymentsQueryKey({}) });
    qc.invalidateQueries({ queryKey: getListPaymentsQueryKey({ status: "pending" }) });
    qc.invalidateQueries({ queryKey: getListCalculationsQueryKey({}) });
  };

  const handleApprove = async (id: string, amount: string) => {
    if (!confirm(`Confirm collection of cash for GH₵ ${Number(amount).toFixed(2)}?`)) return;
    try {
      const result = await approveMutation.mutateAsync({ id });
      toast({ title: `Payment request approved — ${result.receiptNumber ?? ""}` });
      invalidate();
    } catch {
      toast({ title: "Failed to approve payment request", variant: "destructive" });
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm("Reject this payment request?")) return;
    try {
      await rejectMutation.mutateAsync({ id });
      toast({ title: "Payment request rejected" });
      invalidate();
    } catch {
      toast({ title: "Failed to reject payment request", variant: "destructive" });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.agentId || !form.grossAmount) return;
    if (expenseItems.some(i => !i.expenseCategoryId || !i.amount || (i.expenseCategoryId === "custom" && !i.name.trim()))) {
      toast({ title: "Fill in all expense fields (including name for custom expenses) or remove incomplete rows", variant: "destructive" }); return;
    }
    try {
      const result = await createMutation.mutateAsync({
        data: {
          agentId: form.agentId,
          transactionType: form.transactionType,
          grossAmount: form.grossAmount,
          paymentDate: form.paymentDate,
          expenseItems: expenseItems.length > 0 ? expenseItems : undefined,
        },
      });
      toast({ title: `Payment recorded — ${result.receiptNumber ?? ""}` });
      setOpen(false);
      resetForm();
      invalidate();
      setReceiptPayment(result as CreatedPayment);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("window") || msg.toLowerCase().includes("outside") || msg.toLowerCase().includes("time")) {
        toast({ title: "Outside payment window", description: "Payments are not allowed at this time.", variant: "destructive" });
      } else {
        toast({ title: "Failed to record payment", variant: "destructive" });
      }
    }
  };

  const handleVoid = async (id: string) => {
    if (!confirm("Void this payment? This cannot be undone.")) return;
    try {
      await voidMutation.mutateAsync({ id, data: { reason: "Voided by administrator" } });
      toast({ title: "Payment voided" });
      invalidate();
    } catch {
      toast({ title: "Failed to void payment", variant: "destructive" });
    }
  };

  const handlePrintReceipt = () => {
    if (!receiptPayment) return;
    const agentName = agentMap[receiptPayment.agentId]?.name ?? "—";
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return;
    w.document.write(`
      <html><head><title>Receipt ${receiptPayment.receiptNumber}</title>
      <style>
        body { font-family: monospace; font-size: 13px; padding: 24px; }
        h2 { text-align: center; margin: 0 0 8px; font-size: 16px; }
        .center { text-align: center; }
        .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #ccc; }
        .big { font-size: 20px; font-weight: bold; text-align: center; margin: 12px 0; }
        .label { color: #666; }
      </style></head><body>
      <h2>VS2000 Smart Office</h2>
      <div class="center" style="margin-bottom:12px;">PAYMENT RECEIPT</div>
      <div class="big">${receiptPayment.receiptNumber ?? "—"}</div>
      <div class="row"><span class="label">Agent</span><span>${agentName}</span></div>
      <div class="row"><span class="label">Type</span><span>${receiptPayment.transactionType === "pay_in" ? "Pay-In" : "Pay-Out"}</span></div>
      <div class="row"><span class="label">Date</span><span>${receiptPayment.paymentDate}</span></div>
      ${receiptPayment.grossAmount ? `<div class="row"><span class="label">Gross</span><span>GH₵ ${Number(receiptPayment.grossAmount).toFixed(2)}</span></div>` : ""}
      ${(receiptPayment.expenseItems ?? []).map(e => `<div class="row"><span class="label">— ${e.name}</span><span>−GH₵ ${Number(e.amount).toFixed(2)}</span></div>`).join("")}
      <div class="row" style="font-weight:bold"><span>NET AMOUNT</span><span>GH₵ ${Number(receiptPayment.amount).toFixed(2)}</span></div>
      <div class="center" style="margin-top:16px; font-size:11px; color:#999">Printed ${new Date().toLocaleString()}</div>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="p-6 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Cashier Station</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Payment collection · settlement tracking · receipts</p>
        </div>
        <Button onClick={() => { resetForm(); setOpen(true); }} className="gap-2">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Record Payment
        </Button>
      </div>

      {/* ── Time window banner ── */}
      <WindowBanner windows={windows} />

      {/* ── Today's cash position ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pay-In Today</div>
          <div className="text-2xl font-bold text-emerald-700">{fmtGHS(todayPayIn)}</div>
          <div className="text-[11px] text-muted-foreground">{todayValid.filter(p => p.transactionType === "pay_in").length} transaction(s)</div>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pay-Out Today</div>
          <div className="text-2xl font-bold text-orange-600">{fmtGHS(todayPayOut)}</div>
          <div className="text-[11px] text-muted-foreground">{todayValid.filter(p => p.transactionType === "pay_out").length} transaction(s)</div>
        </div>
        <div className={`rounded-xl border p-4 space-y-1.5 ${netPosition >= 0 ? "bg-primary/5 border-primary/20" : "bg-red-50 border-red-200"}`}>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Net Cash Position</div>
          <div className={`text-2xl font-bold ${netPosition >= 0 ? "text-primary" : "text-destructive"}`}>{fmtGHS(netPosition)}</div>
          <div className="text-[11px] text-muted-foreground">Pay-In minus Pay-Out</div>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Settlement Status</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-700">{settledCount}</span>
            <span className="text-sm text-muted-foreground">settled</span>
            {outstandingCount > 0 && (
              <><span className="text-destructive font-bold text-lg">{outstandingCount}</span><span className="text-xs text-destructive">pending</span></>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">for {boardDate === todayStr ? "today" : boardDate}</div>
        </div>
      </div>

      {/* ── Main tabs ── */}
      <Tabs defaultValue="settlement">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
          <TabsTrigger value="settlement" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-5 py-2.5 text-sm">
            Settlement Board
          </TabsTrigger>
          <TabsTrigger value="pending-requests" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-5 py-2.5 text-sm relative">
            Pending Cash Requests
            {pendingList.length > 0 && (
              <span className="ml-2 bg-amber-500 text-white rounded-full px-2 py-0.5 text-[10px] font-bold">
                {pendingList.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-5 py-2.5 text-sm">
            Transaction History
          </TabsTrigger>
        </TabsList>

        {/* ── Settlement Board ── */}
        <TabsContent value="settlement" className="mt-5 space-y-4">

          {/* Date + summary header */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Settlement Date</Label>
              <Input type="date" value={boardDate} onChange={e => setBoardDate(e.target.value)} className="h-8 text-sm w-40" />
              {boardDate !== todayStr && (
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setBoardDate(todayStr)}>Today</Button>
              )}
            </div>
            {boardCalcs.length === 0 && (
              <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs">
                No calculations run for this date yet
              </Badge>
            )}
          </div>

          {/* Settlement table */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="font-semibold">Agent</TableHead>
                  <TableHead className="text-right font-semibold">Balance Due</TableHead>
                  <TableHead className="text-right font-semibold">Collected</TableHead>
                  <TableHead className="text-right font-semibold">Paid Out</TableHead>
                  <TableHead className="text-right font-semibold">Net Position</TableHead>
                  <TableHead className="text-center font-semibold">Status</TableHead>
                  <TableHead className="text-right font-semibold">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                      No active agents found.
                    </TableCell>
                  </TableRow>
                ) : settlements.map(row => {
                  const st = settlementStatus(row);
                  const netCollected = row.collected - row.paidOut;
                  const shortfall = row.balanceDue - netCollected;
                  const { agent } = row;
                  const name = agentMap[agent.id]?.name ?? agent.fullCode;
                  return (
                    <TableRow key={agent.id} className={!row.hasCalc ? "opacity-60" : shortfall > 0.005 ? "bg-red-50/40" : shortfall < -0.005 ? "bg-amber-50/30" : "bg-emerald-50/30"}>
                      <TableCell>
                        <div className="font-medium text-sm">{name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{agent.fullCode}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.hasCalc ? fmtGHS(row.balanceDue) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-emerald-700">
                        {row.collected > 0 ? fmtGHS(row.collected) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-orange-600">
                        {row.paidOut > 0 ? fmtGHS(row.paidOut) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-semibold ${netCollected >= 0 ? "text-primary" : "text-destructive"}`}>
                        {row.hasCalc || row.collected > 0 ? fmtGHS(netCollected) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.bg}`}>{st.label}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.hasCalc && shortfall > 0.005 && (
                          <Button size="sm" className="h-7 text-xs" onClick={() => prefillAgent(agent.id, shortfall, "pay_in")}>
                            Collect {fmtGHS(shortfall)}
                          </Button>
                        )}
                        {row.hasCalc && row.balanceDue < -0.005 && Math.abs(row.paidOut) < Math.abs(row.balanceDue) - 0.005 && (
                          <Button size="sm" variant="outline" className="h-7 text-xs text-orange-700 border-orange-300" onClick={() => prefillAgent(agent.id, Math.abs(row.balanceDue) - row.paidOut, "pay_out")}>
                            Pay Out {fmtGHS(Math.abs(row.balanceDue) - row.paidOut)}
                          </Button>
                        )}
                        {!row.hasCalc && (row.collected > 0 || row.paidOut > 0) && (
                          <span className="text-[10px] text-muted-foreground">Has transactions</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Board totals footer */}
            {(boardCalcs.length > 0 || boardPayments.length > 0) && (
              <div className="border-t bg-muted/30 px-4 py-3 flex items-center gap-6 flex-wrap text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Total Due:</span>
                  <span className="font-mono font-semibold">{fmtGHS(boardTotalDue)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Collected:</span>
                  <span className="font-mono font-semibold text-emerald-700">{fmtGHS(boardTotalCollected)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Paid Out:</span>
                  <span className="font-mono font-semibold text-orange-600">{fmtGHS(boardTotalOut)}</span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-muted-foreground">Outstanding:</span>
                  <span className={`font-mono font-bold ${boardTotalDue - boardTotalCollected > 0.005 ? "text-destructive" : "text-emerald-700"}`}>
                    {fmtGHS(Math.max(0, boardTotalDue - boardTotalCollected + boardTotalOut))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Pending Cash Requests ── */}
        <TabsContent value="pending-requests" className="mt-5 space-y-4">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="font-semibold">Agent</TableHead>
                  <TableHead className="font-semibold">Request Date</TableHead>
                  <TableHead className="font-semibold">Method</TableHead>
                  <TableHead className="text-right font-semibold">Amount</TableHead>
                  <TableHead className="text-center font-semibold">Status</TableHead>
                  <TableHead className="text-right font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPending ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading requests…</TableCell></TableRow>
                ) : pendingList.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No pending cash requests found.</TableCell></TableRow>
                ) : pendingList.map(req => {
                  const agentInfo = agentMap[req.agentId];
                  const name = agentInfo?.name ?? "—";
                  const code = agentInfo?.code ?? "";
                  return (
                    <TableRow key={req.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{code}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {req.paymentDate}
                      </TableCell>
                      <TableCell className="text-sm font-semibold uppercase">
                        {req.paymentMethod}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold text-primary">
                        {fmtGHS(Number(req.amount))}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                          PENDING CASHIER
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleApprove(req.id, req.amount)} disabled={approveMutation.isPending}>
                            Approve & Collect Cash
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => handleReject(req.id)} disabled={rejectMutation.isPending}>
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Transaction History ── */}
        <TabsContent value="history" className="mt-5 space-y-4">

          {/* Filters */}
          <div className="bg-muted/30 border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter Transactions</span>
              {(filterAgentId || filterFrom || filterTo) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setFilterAgentId(""); setFilterFrom(""); setFilterTo(""); }}>
                  Clear filters
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
                <Select value={filterAgentId || "_all"} onValueChange={v => setFilterAgentId(v === "_all" ? "" : v)}>
                  <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All agents</SelectItem>
                    {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">From</Label>
                <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-sm bg-background" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">To</Label>
                <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-9 text-sm bg-background" />
              </div>
            </div>
          </div>

          {/* Transaction table */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net Amount</TableHead>
                  <TableHead>Status</TableHead>
                  {canVoid && <TableHead className="w-16">Void</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPayments ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
                ) : paymentList.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">No transactions found.</TableCell></TableRow>
                ) : paymentList.map(p => (
                  <TableRow key={p.id} className={p.isVoided ? "opacity-40 line-through" : ""}>
                    <TableCell className="text-xs font-mono text-muted-foreground">{p.receiptNumber ?? "—"}</TableCell>
                    <TableCell className="text-sm">{p.paymentDate?.split("T")[0]}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{fmtTime(p.createdAt)}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{agentMap[p.agentId]?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{agentMap[p.agentId]?.code ?? ""}</div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={p.transactionType === "pay_in" ? "default" : "secondary"}
                        className={`text-xs ${p.transactionType === "pay_out" ? "bg-orange-100 text-orange-700 border-orange-200" : ""}`}
                      >
                        {p.transactionType === "pay_in" ? "Pay-In" : "Pay-Out"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono text-muted-foreground">
                      {p.grossAmount ? fmtGHS(Number(p.grossAmount)) : "—"}
                    </TableCell>
                    <TableCell className={`text-sm text-right font-mono font-semibold ${p.transactionType === "pay_out" ? "text-orange-700" : "text-primary"}`}>
                      {fmtGHS(Number(p.amount))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.isVoided ? "destructive" : "outline"} className="text-xs">
                        {p.isVoided ? "Voided" : "Valid"}
                      </Badge>
                    </TableCell>
                    {canVoid && (
                      <TableCell>
                        {!p.isVoided && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive hover:text-destructive" onClick={() => handleVoid(p.id)}>
                            Void
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* History totals footer */}
            {!loadingPayments && paymentList.filter(p => !p.isVoided).length > 0 && (
              <div className="border-t bg-muted/30 px-4 py-3 flex items-center gap-6 flex-wrap text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Pay-In:</span>
                  <span className="font-mono font-semibold text-emerald-700">
                    {fmtGHS(paymentList.filter(p => !p.isVoided && p.transactionType === "pay_in").reduce((s, p) => s + Number(p.amount), 0))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Pay-Out:</span>
                  <span className="font-mono font-semibold text-orange-600">
                    {fmtGHS(paymentList.filter(p => !p.isVoided && p.transactionType === "pay_out").reduce((s, p) => s + Number(p.amount), 0))}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-muted-foreground">{paymentList.filter(p => !p.isVoided).length} valid transaction(s)</span>
                  {paymentList.some(p => p.isVoided) && (
                    <span className="text-xs text-muted-foreground">· {paymentList.filter(p => p.isVoided).length} voided</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Record Payment Modal ── */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-5">

            {/* Transaction type selector */}
            <div className="grid grid-cols-2 gap-2">
              {(["pay_in", "pay_out"] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, transactionType: type }))}
                  className={`rounded-xl border-2 p-3.5 text-left transition-colors ${
                    form.transactionType === type
                      ? type === "pay_in" ? "border-emerald-500 bg-emerald-50" : "border-orange-500 bg-orange-50"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold ${type === "pay_in" ? "bg-emerald-600" : "bg-orange-500"}`}>
                      {type === "pay_in" ? "↓" : "↑"}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{type === "pay_in" ? "Pay-In" : "Pay-Out"}</div>
                      <div className="text-xs text-muted-foreground">{type === "pay_in" ? "Cash received from agent" : "Cash issued to agent"}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Agent */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Agent</Label>
              <Select value={form.agentId} onValueChange={v => setForm(f => ({ ...f, agentId: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select agent…" /></SelectTrigger>
                <SelectContent>
                  {agentList.filter(a => a.isActive).map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.user?.fullName ?? a.fullCode} ({a.fullCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Amount + Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Gross Amount (GH₵)</Label>
                <Input
                  type="number" step="0.01" min="0.01"
                  value={form.grossAmount}
                  onChange={e => setForm(f => ({ ...f, grossAmount: e.target.value }))}
                  required className="h-9 text-sm" placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Date</Label>
                <Input
                  type="date"
                  value={form.paymentDate}
                  onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))}
                  required className="h-9 text-sm"
                />
              </div>
            </div>

            {/* Expense deductions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Expense Deductions</Label>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs px-2" onClick={addExpenseItem}>
                  + Add Expense
                </Button>
              </div>
              {expenseList.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No expense categories configured. Use custom category or ask an administrator.</p>
              )}
              {expenseItems.length > 0 && (
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  {expenseItems.map((item, idx) => (
                    <div key={idx} className="space-y-2 border-b last:border-b-0 pb-2 last:pb-0">
                      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                        <Select value={item.expenseCategoryId || "_none"} onValueChange={v => updateExpenseItem(idx, "expenseCategoryId", v === "_none" ? "" : v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select expense…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">Select category…</SelectItem>
                            {expenseList.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                            <SelectItem value="custom">Custom / Other Expense</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="relative w-28">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">GH₵</span>
                          <Input type="number" step="0.01" min="0" value={item.amount} onChange={e => updateExpenseItem(idx, "amount", e.target.value)} className="h-8 text-xs pl-8" placeholder="0.00" />
                        </div>
                        <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => removeExpenseItem(idx)}>×</Button>
                      </div>
                      {item.expenseCategoryId === "custom" && (
                        <Input
                          type="text"
                          value={item.name}
                          onChange={e => updateExpenseItem(idx, "name", e.target.value)}
                          className="h-8 text-xs w-full"
                          placeholder="Enter custom category name (e.g. Office Supplies)…"
                          required
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Net preview */}
            {form.grossAmount && (
              <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Gross amount</span>
                  <span className="font-mono">GH₵ {gross.toFixed(2)}</span>
                </div>
                {expenseItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-xs text-muted-foreground pl-3">
                    <span>— {item.name || "Expense"}</span>
                    <span className="font-mono text-destructive">−GH₵ {(Number(item.amount) || 0).toFixed(2)}</span>
                  </div>
                ))}
                {expenseItems.length > 0 && <div className="border-t" />}
                <div className="flex justify-between text-sm font-bold">
                  <span>Net {form.transactionType === "pay_in" ? "collected" : "paid out"}</span>
                  <span className={`font-mono ${netAmount < 0 ? "text-destructive" : form.transactionType === "pay_in" ? "text-emerald-700" : "text-orange-700"}`}>
                    GH₵ {netAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending || !form.agentId || !form.grossAmount}>
                {createMutation.isPending ? "Recording…" : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Receipt Modal ── */}
      <Dialog open={!!receiptPayment} onOpenChange={v => !v && setReceiptPayment(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">Payment Receipt</DialogTitle>
          </DialogHeader>
          {receiptPayment && (
            <div className="space-y-4" ref={receiptRef}>
              {/* Receipt number */}
              <div className="text-center rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Receipt Number</div>
                <div className="text-3xl font-bold font-mono tracking-wider text-primary">{receiptPayment.receiptNumber ?? "—"}</div>
              </div>

              {/* QR Code */}
              {receiptPayment.receiptNumber && (
                <div className="flex flex-col items-center gap-1.5">
                  <QRCodeSVG value={receiptPayment.receiptNumber} size={140} level="M" includeMargin className="rounded-lg border p-2" />
                  <p className="text-xs text-muted-foreground">Scan to verify</p>
                </div>
              )}

              {/* Payment details */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agent</span>
                  <span className="font-medium">{agentMap[receiptPayment.agentId]?.name ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant={receiptPayment.transactionType === "pay_in" ? "default" : "secondary"} className="text-xs">
                    {receiptPayment.transactionType === "pay_in" ? "Pay-In" : "Pay-Out"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span>{receiptPayment.paymentDate}</span>
                </div>
                {receiptPayment.grossAmount && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gross</span>
                    <span className="font-mono">{fmtGHS(Number(receiptPayment.grossAmount))}</span>
                  </div>
                )}
                {(receiptPayment.expenseItems ?? []).map((exp, idx) => (
                  <div key={idx} className="flex justify-between text-xs text-muted-foreground pl-2">
                    <span>— {exp.name}</span>
                    <span className="font-mono text-destructive">−{fmtGHS(Number(exp.amount))}</span>
                  </div>
                ))}
                <div className="border-t pt-2 flex justify-between font-semibold">
                  <span>Net Amount</span>
                  <span className={`font-mono ${receiptPayment.transactionType === "pay_in" ? "text-emerald-700" : "text-orange-700"}`}>
                    {fmtGHS(Number(receiptPayment.amount))}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={handlePrintReceipt}>
                  <svg className="w-3.5 h-3.5 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                  Print
                </Button>
                <Button size="sm" className="flex-1" onClick={() => setReceiptPayment(null)}>Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
