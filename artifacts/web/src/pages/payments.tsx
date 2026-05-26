import { useState, useMemo, useCallback, useRef } from "react";
import {
  useListPayments, useCreatePayment, useVoidPayment,
  useListAgents, useListRecurringExpenses, useListCalculations,
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
import {
  Banknote,
  Coins,
  TrendingUp,
  TrendingDown,
  Activity,
  Plus,
  Trash2,
  Calendar,
  Clock,
  Printer,
  QrCode,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Filter,
  FileText,
  User,
  ArrowRightLeft
} from "lucide-react";

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
    <div className={`relative overflow-hidden rounded-2xl border px-5 py-4 flex items-center gap-4 flex-wrap backdrop-blur-md transition-all duration-300 ${
      ws.open 
        ? "bg-emerald-500/10 dark:bg-emerald-500/5 border-emerald-500/20 dark:border-emerald-500/10 text-emerald-800 dark:text-emerald-300 shadow-sm shadow-emerald-500/5" 
        : "bg-rose-500/10 dark:bg-rose-500/5 border-rose-500/20 dark:border-rose-500/10 text-rose-800 dark:text-rose-300 shadow-sm shadow-rose-500/5"
    }`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border transition-all ${
        ws.open 
          ? "bg-emerald-500/20 dark:bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400" 
          : "bg-rose-500/20 dark:bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
      }`}>
        <Clock className="w-5 h-5 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-extrabold tracking-tight flex items-center gap-1.5">
          Payment Window: {ws.open ? "OPEN" : "CLOSED"}
          {ws.open && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground/90 mt-0.5 font-medium">
          {ws.open && ws.window
            ? `Accepting payments until ${fmtHHMM(ws.window.windowClose)}`
            : ws.nextTime
              ? `Next window opens at ${fmtHHMM(ws.nextTime)}`
              : "No payment windows scheduled for today"}
        </div>
      </div>
      <span className={`text-[10px] font-extrabold px-3 py-1 rounded-lg tracking-wider uppercase border shadow-xs ${
        ws.open 
          ? "bg-emerald-500/20 dark:bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300" 
          : "bg-rose-500/20 dark:bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
      }`}>
        {ws.open ? "Accepting" : "Restricted"}
      </span>
    </div>
  );
}

/* ── Settlement status badge ─────────────────────────────────────────────── */
type Settlement = { balanceDue: number; collected: number; paidOut: number; hasCalc: boolean };
function settlementStatus(s: Settlement) {
  if (!s.hasCalc) return { label: "No Calc", color: "text-muted-foreground", bg: "bg-muted/60 dark:bg-muted/20 border-muted-foreground/10 text-muted-foreground" };
  const net = s.collected - s.paidOut;
  const shortfall = s.balanceDue - net;
  if (Math.abs(shortfall) < 0.005) return { label: "Settled", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 dark:bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400" };
  if (shortfall > 0) return { label: `Due ${fmtGHS(shortfall)}`, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10 dark:bg-rose-500/5 border-rose-500/20 text-rose-700 dark:text-rose-400" };
  return { label: `Overpaid ${fmtGHS(-shortfall)}`, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10 dark:bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400" };
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
  const [filterAgentId, setFilterAgentId] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("agentId") || "";
    }
    return "";
  });
  const [filterFrom, setFilterFrom] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("dateFrom") || "";
    }
    return "";
  });
  const [filterTo, setFilterTo] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("dateTo") || "";
    }
    return "";
  });

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
  const { data: expenseCategories } = useListRecurringExpenses();
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
    <div className="p-6 space-y-6 relative min-h-screen">
      {/* Background radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-64 bg-gradient-to-b from-indigo-500/5 via-transparent to-transparent blur-3xl pointer-events-none" />

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4 relative z-10">
        <div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">Cashier Station</h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">Payment collection · settlement tracking · receipts</p>
        </div>
        <Button onClick={() => { resetForm(); setOpen(true); }} className="gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl shadow-md transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
          <Plus className="w-4 h-4" />
          Record Payment
        </Button>
      </div>

      {/* ── Time window banner ── */}
      <div className="relative z-10">
        <WindowBanner windows={windows} />
      </div>

      {/* ── Today's cash position ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 relative z-10">
        {/* Pay-In Today */}
        <div className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-emerald-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden p-4.5 flex flex-col justify-between min-h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Pay-In Today</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="text-xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">{fmtGHS(todayPayIn)}</div>
            <div className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">{todayValid.filter(p => p.transactionType === "pay_in").length} transaction(s)</div>
          </div>
        </div>

        {/* Pay-Out Today */}
        <div className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-orange-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden p-4.5 flex flex-col justify-between min-h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Pay-Out Today</span>
            <div className="p-1.5 rounded-lg bg-orange-500/10 dark:bg-orange-500/5 text-orange-600 dark:text-orange-400 border border-orange-500/25">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="text-xl font-bold font-mono tracking-tight text-orange-600 dark:text-orange-400">{fmtGHS(todayPayOut)}</div>
            <div className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">{todayValid.filter(p => p.transactionType === "pay_out").length} transaction(s)</div>
          </div>
        </div>

        {/* Net Cash Position */}
        <div className={`bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden p-4.5 flex flex-col justify-between min-h-[110px] ${
          netPosition >= 0 ? "hover:border-indigo-500/20" : "hover:border-rose-500/20"
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Net Cash Position</span>
            <div className={`p-1.5 rounded-lg border ${
              netPosition >= 0 
                ? "bg-indigo-500/10 dark:bg-indigo-500/5 text-indigo-600 dark:text-indigo-400 border-indigo-500/25" 
                : "bg-rose-500/10 dark:bg-rose-500/5 text-rose-600 dark:text-rose-400 border-rose-500/25"
            }`}>
              <Banknote className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className={`text-xl font-bold font-mono tracking-tight ${netPosition >= 0 ? "text-indigo-600 dark:text-indigo-400" : "text-rose-600 dark:text-rose-400"}`}>{fmtGHS(netPosition)}</div>
            <div className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">Pay-In minus Pay-Out</div>
          </div>
        </div>

        {/* Settlement Status */}
        <div className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-primary/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden p-4.5 flex flex-col justify-between min-h-[110px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Settlement Status</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2.5">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">{settledCount}</span>
              <span className="text-[10px] text-muted-foreground/70 font-semibold mr-1.5">settled</span>
              {outstandingCount > 0 && (
                <>
                  <span className="text-lg font-bold font-mono tracking-tight text-rose-600 dark:text-rose-400">{outstandingCount}</span>
                  <span className="text-[10px] text-rose-500 font-semibold">pending</span>
                </>
              )}
            </div>
            <div className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">for {boardDate === todayStr ? "today" : boardDate}</div>
          </div>
        </div>
      </div>

      {/* ── Main tabs ── */}
      <Tabs defaultValue="settlement" className="relative z-10 space-y-6">
        <TabsList className="w-full justify-start border-b border-border/40 rounded-none h-auto p-0 bg-transparent gap-4">
          <TabsTrigger value="settlement" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 dark:data-[state=active]:border-indigo-400 dark:data-[state=active]:text-indigo-400 px-5 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            Settlement Board
          </TabsTrigger>
          <TabsTrigger value="pending-requests" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 dark:data-[state=active]:border-indigo-400 dark:data-[state=active]:text-indigo-400 px-5 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent relative">
            Pending Cash Requests
            {pendingList.length > 0 && (
              <span className="ml-2 bg-rose-500 text-white rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold shadow-xs">
                {pendingList.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 dark:data-[state=active]:border-indigo-400 dark:data-[state=active]:text-indigo-400 px-5 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            Transaction History
          </TabsTrigger>
        </TabsList>

        {/* ── Settlement Board ── */}
        <TabsContent value="settlement" className="space-y-4 outline-none">
          {/* Date + summary header */}
          <div className="flex items-center justify-between flex-wrap gap-3 bg-card/45 backdrop-blur-md border border-border/40 rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Settlement Date</Label>
              <div className="relative">
                <Input 
                  type="date" 
                  value={boardDate} 
                  onChange={e => setBoardDate(e.target.value)} 
                  className="h-8 text-xs w-36 bg-background/60 border-border/60 rounded-lg pr-8 focus:ring-1 focus:ring-primary" 
                />
              </div>
              {boardDate !== todayStr && (
                <Button size="sm" variant="ghost" className="h-8 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20" onClick={() => setBoardDate(todayStr)}>
                  Today
                </Button>
              )}
            </div>
            {boardCalcs.length === 0 && (
              <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-500/10 text-[10px] font-extrabold uppercase tracking-wide px-2.5 py-0.5 rounded-lg shadow-sm">
                No calculations run for this date
              </Badge>
            )}
          </div>

          {/* Settlement table */}
          <div className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="border-b border-border/40">
                  <TableHead className="text-xs font-bold text-muted-foreground pl-5">Agent</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Balance Due</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Collected</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Paid Out</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Net Position</TableHead>
                  <TableHead className="text-center text-xs font-bold text-muted-foreground">Status</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground pr-5">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-xs font-medium">
                      No active agents found.
                    </TableCell>
                  </TableRow>
                ) : settlements.map(row => {
                  const st = settlementStatus(row);
                  const netCollected = row.collected - row.paidOut;
                  const shortfall = row.balanceDue - netCollected;
                  const { agent } = row;
                  const name = agentMap[agent.id]?.name ?? agent.fullCode;
                  
                  const rowClass = !row.hasCalc 
                    ? "opacity-60 border-b border-border/40 hover:bg-muted/5 transition-colors" 
                    : shortfall > 0.005 
                      ? "bg-rose-500/5 dark:bg-rose-500/[0.02] border-b border-border/40 border-l-2 border-l-rose-500 hover:bg-rose-500/10 dark:hover:bg-rose-500/[0.05] transition-colors" 
                      : shortfall < -0.005 
                        ? "bg-amber-500/5 dark:bg-amber-500/[0.02] border-b border-border/40 border-l-2 border-l-amber-500 hover:bg-amber-500/10 dark:hover:bg-amber-500/[0.05] transition-colors" 
                        : "bg-emerald-500/5 dark:bg-emerald-500/[0.02] border-b border-border/40 border-l-2 border-l-emerald-500 hover:bg-emerald-500/10 dark:hover:bg-emerald-500/[0.05] transition-colors";

                  return (
                    <TableRow key={agent.id} className={rowClass}>
                      <TableCell className="pl-5 py-3.5">
                        <div className="font-bold text-xs text-foreground">{name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{agent.fullCode}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {row.hasCalc ? fmtGHS(row.balanceDue) : <span className="text-muted-foreground/50 text-[10px]">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        {row.collected > 0 ? fmtGHS(row.collected) : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-orange-600 dark:text-orange-400 font-medium">
                        {row.paidOut > 0 ? fmtGHS(row.paidOut) : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs font-bold ${netCollected >= 0 ? "text-indigo-600 dark:text-indigo-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {row.hasCalc || row.collected > 0 ? fmtGHS(netCollected) : <span className="text-muted-foreground/50 text-[10px]">—</span>}
                      </TableCell>
                      <TableCell className="text-center py-3.5">
                        <span className={`text-[9.5px] font-extrabold px-2.5 py-0.5 rounded-lg tracking-wider uppercase border shadow-xs ${st.bg}`}>
                          {st.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right pr-5 py-3.5">
                        <div className="flex justify-end gap-1.5">
                          {row.hasCalc && shortfall > 0.005 && (
                            <Button size="sm" className="h-7 text-[10px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs" onClick={() => prefillAgent(agent.id, shortfall, "pay_in")}>
                              Collect {fmtGHS(shortfall)}
                            </Button>
                          )}
                          {row.hasCalc && row.balanceDue < -0.005 && Math.abs(row.paidOut) < Math.abs(row.balanceDue) - 0.005 && (
                            <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold rounded-lg text-orange-600 dark:text-orange-400 border-orange-500/20 hover:bg-orange-500/10" onClick={() => prefillAgent(agent.id, Math.abs(row.balanceDue) - row.paidOut, "pay_out")}>
                              Pay Out {fmtGHS(Math.abs(row.balanceDue) - row.paidOut)}
                            </Button>
                          )}
                          {!row.hasCalc && (row.collected > 0 || row.paidOut > 0) && (
                            <span className="text-[9.5px] text-muted-foreground font-semibold uppercase tracking-wider">Has Txns</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Board totals footer */}
            {(boardCalcs.length > 0 || boardPayments.length > 0) && (
              <div className="border-t border-border/40 bg-muted/40 px-5 py-3.5 flex items-center gap-6 flex-wrap text-xs font-bold text-foreground">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider font-extrabold">Total Due:</span>
                  <span className="font-mono">{fmtGHS(boardTotalDue)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider font-extrabold">Collected:</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">{fmtGHS(boardTotalCollected)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider font-extrabold">Paid Out:</span>
                  <span className="font-mono text-orange-600 dark:text-orange-400">{fmtGHS(boardTotalOut)}</span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider font-extrabold">Outstanding:</span>
                  <span className={`font-mono text-sm font-extrabold ${boardTotalDue - boardTotalCollected > 0.005 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {fmtGHS(Math.max(0, boardTotalDue - boardTotalCollected + boardTotalOut))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Pending Cash Requests ── */}
        <TabsContent value="pending-requests" className="space-y-4 outline-none">
          <div className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="border-b border-border/40">
                  <TableHead className="text-xs font-bold text-muted-foreground pl-5">Agent</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Request Date</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Method</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Amount</TableHead>
                  <TableHead className="text-center text-xs font-bold text-muted-foreground">Status</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground pr-5">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPending ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs font-medium">
                      <Activity className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600/60" />
                      Loading requests…
                    </TableCell>
                  </TableRow>
                ) : pendingList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs font-medium">
                      No pending cash requests found.
                    </TableCell>
                  </TableRow>
                ) : pendingList.map(req => {
                  const agentInfo = agentMap[req.agentId];
                  const name = agentInfo?.name ?? "—";
                  const code = agentInfo?.code ?? "";
                  return (
                    <TableRow key={req.id} className="hover:bg-muted/10 border-b border-border/40 transition-colors">
                      <TableCell className="pl-5 py-3.5">
                        <div className="font-bold text-xs text-foreground">{name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{code}</div>
                      </TableCell>
                      <TableCell className="text-xs text-foreground/80 font-medium py-3.5">
                        {req.paymentDate}
                      </TableCell>
                      <TableCell className="text-xs font-extrabold uppercase tracking-wide text-foreground/80 py-3.5">
                        {req.paymentMethod}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 py-3.5">
                        {fmtGHS(Number(req.amount))}
                      </TableCell>
                      <TableCell className="text-center py-3.5">
                        <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-lg tracking-wider uppercase border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400 shadow-xs">
                          PENDING CASHIER
                        </span>
                      </TableCell>
                      <TableCell className="text-right pr-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" className="h-7 text-[10px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs" onClick={() => handleApprove(req.id, req.amount)} disabled={approveMutation.isPending}>
                            Approve & Collect
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold rounded-lg text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/10" onClick={() => handleReject(req.id)} disabled={rejectMutation.isPending}>
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
        <TabsContent value="history" className="space-y-4 outline-none">
          {/* Filters */}
          <div className="bg-card/45 border border-border/40 backdrop-blur-md rounded-2xl p-4 shadow-sm relative">
            <div className="flex items-center justify-between mb-3.5">
              <span className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />
                Filter Transactions
              </span>
              {(filterAgentId || filterFrom || filterTo) && (
                <Button size="sm" variant="ghost" className="h-7 text-[10px] font-bold rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20" onClick={() => { setFilterAgentId(""); setFilterFrom(""); setFilterTo(""); }}>
                  Clear filters
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Agent</Label>
                <Select value={filterAgentId || "_all"} onValueChange={v => setFilterAgentId(v === "_all" ? "" : v)}>
                  <SelectTrigger className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All agents</SelectItem>
                    {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">From</Label>
                <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 text-xs bg-background/60 border-border/60 rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">To</Label>
                <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-9 text-xs bg-background/60 border-border/60 rounded-xl" />
              </div>
            </div>
          </div>

          {/* Transaction table */}
          <div className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="border-b border-border/40">
                  <TableHead className="text-xs font-bold text-muted-foreground pl-5">Receipt #</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Date</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Time</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Agent</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Type</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Gross</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Net Amount</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Status</TableHead>
                  {canVoid && <TableHead className="w-16 text-right pr-5 text-xs font-bold text-muted-foreground">Void</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPayments ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground text-xs font-medium">
                      <Activity className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600/60" />
                      Loading transactions…
                    </TableCell>
                  </TableRow>
                ) : paymentList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground text-xs font-medium">
                      No transactions found.
                    </TableCell>
                  </TableRow>
                ) : paymentList.map(p => (
                  <TableRow key={p.id} className={`border-b border-border/40 transition-colors ${p.isVoided ? "opacity-45 bg-muted/10 line-through" : "hover:bg-muted/10"}`}>
                    <TableCell className="text-xs font-mono font-bold text-muted-foreground pl-5 py-3.5">{p.receiptNumber ?? "—"}</TableCell>
                    <TableCell className="text-xs font-medium text-foreground/80 py-3.5">{p.paymentDate?.split("T")[0]}</TableCell>
                    <TableCell className="text-xs text-muted-foreground/70 font-mono py-3.5">{fmtTime(p.createdAt)}</TableCell>
                    <TableCell className="py-3.5">
                      <div className="text-xs font-bold text-foreground">{agentMap[p.agentId]?.name ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{agentMap[p.agentId]?.code ?? ""}</div>
                    </TableCell>
                    <TableCell className="py-3.5">
                      <Badge
                        variant={p.transactionType === "pay_in" ? "default" : "secondary"}
                        className={`text-[9.5px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-lg border shadow-xs ${
                          p.transactionType === "pay_out" 
                            ? "bg-orange-500/10 border-orange-500/20 text-orange-700 dark:text-orange-400" 
                            : "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {p.transactionType === "pay_in" ? "Pay-In" : "Pay-Out"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono text-muted-foreground py-3.5">
                      {p.grossAmount ? fmtGHS(Number(p.grossAmount)) : "—"}
                    </TableCell>
                    <TableCell className={`text-xs text-right font-mono font-bold py-3.5 ${
                      p.isVoided
                        ? "text-muted-foreground"
                        : p.transactionType === "pay_out" 
                          ? "text-orange-600 dark:text-orange-400" 
                          : "text-indigo-600 dark:text-indigo-400"
                    }`}>
                      {fmtGHS(Number(p.amount))}
                    </TableCell>
                    <TableCell className="py-3.5">
                      <Badge variant={p.isVoided ? "destructive" : "outline"} className={`text-[9.5px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${
                        p.isVoided
                          ? "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400"
                          : "bg-indigo-500/5 border-indigo-500/10 text-indigo-700 dark:text-indigo-400"
                      }`}>
                        {p.isVoided ? "Voided" : "Valid"}
                      </Badge>
                    </TableCell>
                    {canVoid && (
                      <TableCell className="text-right pr-5 py-3.5">
                        {!p.isVoided && (
                          <Button size="sm" variant="ghost" className="h-7 text-[10px] font-bold rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10" onClick={() => handleVoid(p.id)}>
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
              <div className="border-t border-border/40 bg-muted/40 px-5 py-3.5 flex items-center gap-6 flex-wrap text-xs font-bold text-foreground">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider font-extrabold">Pay-In:</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {fmtGHS(paymentList.filter(p => !p.isVoided && p.transactionType === "pay_in").reduce((s, p) => s + Number(p.amount), 0))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider font-extrabold">Pay-Out:</span>
                  <span className="font-mono text-orange-600 dark:text-orange-400">
                    {fmtGHS(paymentList.filter(p => !p.isVoided && p.transactionType === "pay_out").reduce((s, p) => s + Number(p.amount), 0))}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-[10px] text-muted-foreground font-semibold">
                    {paymentList.filter(p => !p.isVoided).length} valid transaction(s)
                  </span>
                  {paymentList.some(p => p.isVoided) && (
                    <span className="text-[10px] text-rose-500 font-semibold">
                      · {paymentList.filter(p => p.isVoided).length} voided
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Record Payment Modal ── */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-border/40 bg-card/95 backdrop-blur-lg shadow-2xl p-6">
          <DialogHeader className="pb-3">
            <DialogTitle className="text-base font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">Record Payment</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-5">
            {/* Transaction type selector */}
            <div className="grid grid-cols-2 gap-3">
              {(["pay_in", "pay_out"] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, transactionType: type }))}
                  className={`rounded-2xl border p-4 text-left transition-all duration-300 shadow-xs flex flex-col justify-between ${
                    form.transactionType === type
                      ? type === "pay_in" 
                        ? "border-emerald-500/50 bg-emerald-500/10 dark:bg-emerald-500/5 shadow-emerald-500/5" 
                        : "border-orange-500/50 bg-orange-500/10 dark:bg-orange-500/5 shadow-orange-500/5"
                      : "border-border/60 hover:border-border bg-card/50 hover:bg-card"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-extrabold ${
                      type === "pay_in" ? "bg-emerald-600" : "bg-orange-500"
                    }`}>
                      {type === "pay_in" ? "↓" : "↑"}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-foreground">{type === "pay_in" ? "Pay-In" : "Pay-Out"}</div>
                      <div className="text-[10px] text-muted-foreground/80 mt-0.5">{type === "pay_in" ? "Cash from agent" : "Cash to agent"}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Agent */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Agent</Label>
              <Select value={form.agentId} onValueChange={v => setForm(f => ({ ...f, agentId: v }))}>
                <SelectTrigger className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"><SelectValue placeholder="Select agent…" /></SelectTrigger>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Gross Amount (GH₵)</Label>
                <Input
                  type="number" step="0.01" min="0.01"
                  value={form.grossAmount}
                  onChange={e => setForm(f => ({ ...f, grossAmount: e.target.value }))}
                  required className="h-9 text-xs bg-background/60 border-border/60 rounded-xl" placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Payment Date</Label>
                <Input
                  type="date"
                  value={form.paymentDate}
                  onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))}
                  required className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"
                />
              </div>
            </div>

            {/* Expense deductions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground">Expense Deductions</Label>
                <Button type="button" size="sm" variant="outline" className="h-7 text-[10px] font-bold rounded-lg border-border/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10" onClick={addExpenseItem}>
                  + Add Expense
                </Button>
              </div>
              {expenseList.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic">No expense categories configured. Use custom category or ask an administrator.</p>
              )}
              {expenseItems.length > 0 && (
                <div className="space-y-3 rounded-2xl border border-border/50 bg-muted/20 p-3.5">
                  {expenseItems.map((item, idx) => (
                    <div key={idx} className="space-y-2.5 border-b border-border/40 last:border-b-0 pb-2.5 last:pb-0">
                      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                        <Select value={item.expenseCategoryId || "_none"} onValueChange={v => updateExpenseItem(idx, "expenseCategoryId", v === "_none" ? "" : v)}>
                          <SelectTrigger className="h-8 text-xs bg-background/60 border-border/60 rounded-lg"><SelectValue placeholder="Select expense…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">Select category…</SelectItem>
                            {expenseList.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                            <SelectItem value="custom">Custom / Other Expense</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="relative w-28">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10.5px] text-muted-foreground">GH₵</span>
                          <Input type="number" step="0.01" min="0" value={item.amount} onChange={e => updateExpenseItem(idx, "amount", e.target.value)} className="h-8 text-xs pl-8 bg-background/60 border-border/60 rounded-lg" placeholder="0.00" />
                        </div>
                        <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 rounded-lg" onClick={() => removeExpenseItem(idx)}>×</Button>
                      </div>
                      {item.expenseCategoryId === "custom" && (
                        <Input
                          type="text"
                          value={item.name}
                          onChange={e => updateExpenseItem(idx, "name", e.target.value)}
                          className="h-8 text-xs w-full bg-background/60 border-border/60 rounded-lg"
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
              <div className="rounded-2xl border border-border/40 bg-muted/20 p-4 space-y-2 text-xs font-semibold text-foreground">
                <div className="flex justify-between text-muted-foreground">
                  <span>Gross amount</span>
                  <span className="font-mono">GH₵ {gross.toFixed(2)}</span>
                </div>
                {expenseItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-muted-foreground pl-3">
                    <span>— {item.name || "Expense"}</span>
                    <span className="font-mono text-rose-600 dark:text-rose-400">−GH₵ {(Number(item.amount) || 0).toFixed(2)}</span>
                  </div>
                ))}
                {expenseItems.length > 0 && <div className="border-t border-border/40" />}
                <div className="flex justify-between text-sm font-bold pt-1">
                  <span>Net {form.transactionType === "pay_in" ? "collected" : "paid out"}</span>
                  <span className={`font-mono text-base font-extrabold ${netAmount < 0 ? "text-rose-600 dark:text-rose-400" : form.transactionType === "pay_in" ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}>
                    GH₵ {netAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" size="sm" className="rounded-xl border-border/60" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
              <Button type="submit" size="sm" className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold" disabled={createMutation.isPending || !form.agentId || !form.grossAmount}>
                {createMutation.isPending ? "Recording…" : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Receipt Modal ── */}
      <Dialog open={!!receiptPayment} onOpenChange={v => !v && setReceiptPayment(null)}>
        <DialogContent className="max-w-sm rounded-3xl border border-border/40 bg-card/95 backdrop-blur-lg shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-center text-sm font-extrabold tracking-wider uppercase text-muted-foreground/80">Payment Receipt</DialogTitle>
          </DialogHeader>
          {receiptPayment && (
            <div className="space-y-4 pt-1" ref={receiptRef}>
              {/* Receipt number */}
              <div className="text-center rounded-2xl border-2 border-dashed border-indigo-500/30 bg-indigo-500/5 p-4">
                <div className="text-[9px] font-extrabold text-muted-foreground/80 uppercase tracking-widest mb-1">Receipt Number</div>
                <div className="text-2xl font-black font-mono tracking-widest text-indigo-600 dark:text-indigo-400">{receiptPayment.receiptNumber ?? "—"}</div>
              </div>

              {/* QR Code */}
              {receiptPayment.receiptNumber && (
                <div className="flex flex-col items-center gap-1.5 my-2">
                  <QRCodeSVG value={receiptPayment.receiptNumber} size={130} level="M" includeMargin className="rounded-xl border border-border/40 p-2 bg-white" />
                  <p className="text-[10px] text-muted-foreground font-semibold">Scan to verify transaction</p>
                </div>
              )}

              {/* Payment details */}
              <div className="rounded-2xl border border-border/40 bg-muted/20 p-4.5 space-y-2 text-xs font-semibold text-foreground">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agent</span>
                  <span className="font-bold">{agentMap[receiptPayment.agentId]?.name ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant={receiptPayment.transactionType === "pay_in" ? "default" : "secondary"} className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-lg border shadow-xs ${
                    receiptPayment.transactionType === "pay_in" 
                      ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-400" 
                      : "bg-orange-500/10 border-orange-500/25 text-orange-700 dark:text-orange-400"
                  }`}>
                    {receiptPayment.transactionType === "pay_in" ? "Pay-In" : "Pay-Out"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">{receiptPayment.paymentDate}</span>
                </div>
                {receiptPayment.grossAmount && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gross</span>
                    <span className="font-mono">{fmtGHS(Number(receiptPayment.grossAmount))}</span>
                  </div>
                )}
                {(receiptPayment.expenseItems ?? []).map((exp, idx) => (
                  <div key={idx} className="flex justify-between text-muted-foreground pl-2.5">
                    <span>— {exp.name}</span>
                    <span className="font-mono text-rose-600 dark:text-rose-400">−{fmtGHS(Number(exp.amount))}</span>
                  </div>
                ))}
                <div className="border-t border-border/40 pt-2 flex justify-between font-bold text-sm">
                  <span>Net Amount</span>
                  <span className={`font-mono text-base font-extrabold ${receiptPayment.transactionType === "pay_in" ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}>
                    {fmtGHS(Number(receiptPayment.amount))}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" size="sm" className="flex-1 rounded-xl border-border/60" onClick={handlePrintReceipt}>
                  <Printer className="w-3.5 h-3.5 mr-1.5" />
                  Print Receipt
                </Button>
                <Button size="sm" className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold" onClick={() => setReceiptPayment(null)}>Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
