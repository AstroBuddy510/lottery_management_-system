import { useState, useMemo, useCallback, useRef } from "react";
import {
  useListPayments, useCreatePayment, useVoidPayment,
  useListAgents, useListRecurringExpenses, useListCalculations,
  useListTimeWindows, useApprovePayment, useRejectPayment, useListGames,
  getListPaymentsQueryKey, getListCalculationsQueryKey,
  getListTimeWindowsQueryKey,
} from "@workspace/api-client-react";
import type { TimeWindow } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
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
import { ModelRequestsPanel } from "@/components/model-requests-panel";
import { TokenSalesPanel } from "@/pages/token-sales";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS } from "@/lib/utils";
import { generateDailySettlementPDF } from "@/lib/pdf-generator";
import { Activity, AlertTriangle, ArrowRightLeft, Banknote, Calendar, CheckCircle2, ChevronRight, Clock, Coins, FileDown, FileText, Filter, Loader2, Plus, Printer, QrCode, Scale, Search, Trash2, TrendingDown, TrendingUp, User, XCircle } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions, DirectionBadge, SignedAmount, StatTile, PAGE_SIZE } from "@/components/data-kit";
import { exportReportPdf, printReport, money, type TableReport } from "@/lib/table-report";
import { AdminPostpaidSettlement } from "@/pages/admin-postpaid-settlement";
import { UnitRequests } from "@/pages/unit-requests";
import { TokenSupply } from "@/pages/token-supply";

type ExpenseItem = { expenseCategoryId: string; name: string; amount: string };
type CreatedPayment = {
  id: string; agentId: string; transactionType: string;
  grossAmount?: string | null; amount: string;
  expenseItems?: ExpenseItem[] | null; paymentDate: string; receiptNumber?: string | null;
};

const today = () => new Date().toISOString().split("T")[0];

/** "16 Nov 2026" from a YYYY-MM-DD day. */
/** The Accra calendar day of a timestamp, as yyyy-mm-dd. */
function accraDay(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function fmtDay(d?: string | null) {
  if (!d) return "—";
  const t = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

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

  // Writers asking to sell on credit (postpaid). Same query as the panel in
  // the tab, so the badge and the list share one fetch.
  const { data: modelRequests } = useQuery<Array<{ status: string }>>({
    queryKey: ["/api/writer-model-requests", "pending"],
    queryFn: async () => {
      const res = await fetch("/api/writer-model-requests?status=pending", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("Could not load requests");
      return res.json();
    },
    refetchInterval: 30_000,
  });
  const postpaidRequests = (Array.isArray(modelRequests) ? modelRequests : []).filter((r) => r.status === "pending").length;

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

  const [filterGameId, setFilterGameId] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("gameId") || "";
    }
    return "";
  });

  /**
   * A desk payment is not tied to a game row: it settles an agency's balance
   * for a business day, and the Settlement Board pairs it with that day's
   * draw by date. So "this game's payments" are the payments dated on the
   * game's draw day (Accra), narrowed further by any From/To dates chosen -
   * a game whose draw day falls outside them leaves nothing to show.
   */
  const { data: gamesRaw } = useListGames();
  const gameOptions = useMemo(() => {
    const list = Array.isArray(gamesRaw) ? gamesRaw : [];
    return [...list]
      .filter((g) => new Date(g.closeAt).getTime() <= Date.now() + 86_400_000)
      .sort((a, b) => new Date(b.closeAt).getTime() - new Date(a.closeAt).getTime());
  }, [gamesRaw]);
  const selectedGame = filterGameId ? gameOptions.find((g) => g.id === filterGameId) ?? null : null;
  const gameDay = selectedGame ? accraDay(selectedGame.closeAt) : null;
  const effFrom = gameDay ? (filterFrom && filterFrom > gameDay ? filterFrom : gameDay) : filterFrom;
  const effTo = gameDay ? (filterTo && filterTo < gameDay ? filterTo : gameDay) : filterTo;
  const gameOutsideRange = !!gameDay && !!effFrom && !!effTo && effFrom > effTo;

  const { data: rawPayments, isLoading: loadingPayments } = useListPayments({
    agentId: filterAgentId || undefined,
    dateFrom: effFrom || undefined,
    dateTo:   effTo   || undefined,
  });
  const { data: pendingPayments, isLoading: loadingPending } = useListPayments({
    status: "pending",
  });
  const { data: allPaymentsRaw } = useListPayments({});
  const { data: agents }         = useListAgents({});
  const { data: expenseCategories } = useListRecurringExpenses();

  /**
   * Postpaid writers who have said they are paying and are waiting on the
   * cashier. Surfaced as a badge on the tab: a declared payment that nobody
   * confirms leaves the writer marked unsettled through no fault of theirs.
   */
  const { data: postpaidOutstanding } = useQuery<{
    ledgers?: Array<{ ledger: { paymentDeclaredAt: string | null } }>;
  }>({
    queryKey: ["/api/postpaid/outstanding"],
    queryFn: async () => {
      const res = await fetch("/api/postpaid/outstanding", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("Failed to load postpaid ledgers");
      return res.json();
    },
  });
  const postpaidDeclared = (postpaidOutstanding?.ledgers ?? []).filter(
    (r) => r.ledger.paymentDeclaredAt,
  ).length;
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
  const paymentList = useMemo(
    () => (gameOutsideRange || !Array.isArray(rawPayments) ? [] : rawPayments),
    [rawPayments, gameOutsideRange],
  );
  const gameLabel = selectedGame ? `${selectedGame.name} (#${selectedGame.eventNumber}, drawn ${fmtDay(gameDay)})` : undefined;

  /**
   * Transaction History as a PDF, on the company letterhead.
   *
   * Exports exactly what is on screen, filters included, so the paper matches
   * what the cashier was looking at when she pressed the button. jsPDF is
   * pulled in on the click rather than at page load - it is one of the
   * heaviest things in the bundle and most visits never print.
   */
  const [exporting, setExporting] = useState(false);
  const exportHistoryPdf = async () => {
    if (paymentList.length === 0) return;
    setExporting(true);
    try {
      const { generatePaymentsHistoryPDF } = await import("@/lib/pdf-generator");
      await generatePaymentsHistoryPDF(paymentList, agentMap, {
        agentName: filterAgentId ? agentMap[filterAgentId]?.name : undefined,
        gameName: gameLabel,
        from: effFrom || undefined,
        to: effTo || undefined,
      });
    } catch (err) {
      toast({
        title: "Could not build the PDF",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };
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

  /* ── Paging, and the same rows as paper ── */
  const pBoard   = usePaged(settlements, PAGE_SIZE, boardDate);
  const pPending = usePaged(pendingList, 12);
  const pHistory = usePaged(paymentList, PAGE_SIZE, `${filterAgentId}|${filterGameId}|${filterFrom}|${filterTo}`);
  const historyIn  = paymentList.filter(p => !p.isVoided && p.transactionType === "pay_in").reduce((s, p) => s + Number(p.amount), 0);
  const historyOut = paymentList.filter(p => !p.isVoided && p.transactionType === "pay_out").reduce((s, p) => s + Number(p.amount), 0);

  /** The whole board - every page, not just the one on screen. */
  const boardReport = (): TableReport => ({
    title: "Settlement Board",
    fileName: `settlement_board_${boardDate}`,
    orientation: "landscape",
    meta: [{ label: "Settlement Date", value: fmtDay(boardDate) }],
    summary: [
      `${settlements.length} active agenc${settlements.length === 1 ? "y" : "ies"} · ${settledCount} settled · ${outstandingCount} outstanding`,
      `Collected ${money(boardTotalCollected)} · Paid out ${money(boardTotalOut)}`,
    ],
    sections: [{
      columns: [
        { header: "Agent" }, { header: "Code" },
        { header: "Balance Due", align: "right" }, { header: "Collected", align: "right" },
        { header: "Paid Out", align: "right" }, { header: "Net Position", align: "right" }, { header: "Status" },
      ],
      rows: settlements.map(r => [
        agentMap[r.agent.id]?.name ?? r.agent.fullCode,
        r.agent.fullCode,
        r.hasCalc ? money(r.balanceDue) : "—",
        r.collected > 0 ? money(r.collected) : "—",
        r.paidOut > 0 ? money(r.paidOut) : "—",
        r.hasCalc || r.collected > 0 ? money(r.collected - r.paidOut) : "—",
        settlementStatus(r).label.replace("GH₵", "GHS"),
      ]),
      totals: ["TOTAL", "", money(boardTotalDue), money(boardTotalCollected), money(boardTotalOut), money(boardTotalCollected - boardTotalOut),
        `Outstanding ${money(Math.max(0, boardTotalDue - boardTotalCollected + boardTotalOut))}`],
      empty: "No active agents.",
    }],
  });

  const historyReport = (): TableReport => ({
    title: "Transaction History",
    fileName: "transaction_history",
    orientation: "landscape",
    meta: [
      { label: "Agent", value: filterAgentId ? (agentMap[filterAgentId]?.name ?? "—") : "All agents" },
      { label: "Game", value: gameLabel ?? "All games" },
      { label: "Period", value: effFrom || effTo ? `${effFrom ? fmtDay(effFrom) : "start"} – ${effTo ? fmtDay(effTo) : "today"}` : "All dates" },
    ],
    summary: [
      `${paymentList.length} transaction(s) · Pay-In ${money(historyIn)} · Pay-Out ${money(historyOut)}`,
      `Net ${money(historyIn - historyOut)}`,
    ],
    sections: [{
      columns: [
        { header: "Receipt #" }, { header: "Date" }, { header: "Time" }, { header: "Agent" },
        { header: "Direction" }, { header: "Gross", align: "right" }, { header: "Net Amount", align: "right" }, { header: "Status" },
      ],
      rows: paymentList.map(p => [
        p.receiptNumber ?? "—",
        fmtDay(p.paymentDate?.split("T")[0]),
        fmtTime(p.createdAt),
        `${agentMap[p.agentId]?.name ?? "—"} (${agentMap[p.agentId]?.code ?? ""})`,
        p.transactionType === "pay_out" ? "Pay-Out" : "Pay-In",
        p.grossAmount ? money(p.grossAmount) : "—",
        `${p.transactionType === "pay_out" ? "-" : "+"}${money(p.amount)}`,
        p.isVoided ? "Voided" : "Valid",
      ]),
      empty: "No transactions for this selection.",
    }],
  });

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
    if (!confirm(`Confirm collection of cash for GH₵ ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}?`)) return;
    try {
      const result = await approveMutation.mutateAsync({ id });
      toast({ title: `Payment request approved — ${result.receiptNumber ?? ""}` });
      invalidate();
    } catch (err: any) {
      toast({ 
        title: "Failed to approve payment request", 
        description: err?.data?.error || err?.message || "Check network and try again",
        variant: "destructive" 
      });
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm("Reject this payment request?")) return;
    try {
      await rejectMutation.mutateAsync({ id });
      toast({ title: "Payment request rejected" });
      invalidate();
    } catch (err: any) {
      toast({ 
        title: "Failed to reject payment request", 
        description: err?.data?.error || err?.message || "Check network and try again",
        variant: "destructive" 
      });
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
    } catch (err: any) {
      const backendError = err?.data?.error;
      const msg = backendError || (err instanceof Error ? err.message : "");
      if (msg.toLowerCase().includes("window") || msg.toLowerCase().includes("outside") || msg.toLowerCase().includes("time")) {
        toast({ title: "Outside payment window", description: "Payments are not allowed at this time.", variant: "destructive" });
      } else {
        toast({ title: "Failed to record payment", description: msg || "Check inputs and try again", variant: "destructive" });
      }
    }
  };

  const handleVoid = async (id: string) => {
    if (!confirm("Void this payment? This cannot be undone.")) return;
    try {
      await voidMutation.mutateAsync({ id, data: { reason: "Voided by administrator" } });
      toast({ title: "Payment voided" });
      invalidate();
    } catch (err: any) {
      toast({ 
        title: "Failed to void payment", 
        description: err?.data?.error || err?.message || "Check permissions and try again",
        variant: "destructive" 
      });
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
      ${receiptPayment.grossAmount ? `<div class="row"><span class="label">Gross</span><span>GH₵ ${Number(receiptPayment.grossAmount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>` : ""}
      ${(receiptPayment.expenseItems ?? []).map(e => `<div class="row"><span class="label">— ${e.name}</span><span>−GH₵ ${Number(e.amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`).join("")}
      <div class="row" style="font-weight:bold"><span>NET AMOUNT</span><span>GH₵ ${Number(receiptPayment.amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
      <div class="center" style="margin-top:16px; font-size:11px; color:#999">Printed ${new Date().toLocaleString()}</div>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 min-w-0">

      {/* ── Header ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border border-border/80 bg-card/60 backdrop-blur-md p-5 sm:p-6 rounded-3xl shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shadow-inner border border-primary/10 shrink-0">
            <Banknote className="w-7 h-7" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-foreground">Payments</h1>
            <p className="text-xs text-muted-foreground mt-1 font-medium">Cashier station · payment collection, settlement tracking and receipts</p>
          </div>
        </div>
        <Button onClick={() => { resetForm(); setOpen(true); }} className="gap-2 rounded-xl font-bold self-start lg:self-center">
          <Plus className="w-4 h-4" />
          Record Payment
        </Button>
      </div>

      {/* ── Time window banner ── */}
      <WindowBanner windows={windows} />

      {/* ── Today's cash position ── */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile
          label="Pay-In Today"
          value={fmtGHS(todayPayIn)}
          sub={`${todayValid.filter(p => p.transactionType === "pay_in").length} transaction(s)`}
          icon={TrendingUp}
          tone="in"
        />
        <StatTile
          label="Pay-Out Today"
          value={fmtGHS(todayPayOut)}
          sub={`${todayValid.filter(p => p.transactionType === "pay_out").length} transaction(s)`}
          icon={TrendingDown}
          tone="out"
        />
        <StatTile
          label="Net Cash Position"
          value={fmtGHS(netPosition)}
          sub="Pay-In minus Pay-Out"
          icon={Banknote}
          tone={netPosition >= 0 ? "default" : "bad"}
        />
        <StatTile
          label="Settlement Status"
          value={<>{settledCount} <span className="text-xs font-bold text-muted-foreground">settled</span>{outstandingCount > 0 && <> · <span className="text-rose-600 dark:text-rose-400">{outstandingCount}</span> <span className="text-xs font-bold text-rose-500">pending</span></>}</>}
          sub={`for ${boardDate === todayStr ? "today" : fmtDay(boardDate)}`}
          icon={Activity}
          tone="in"
        />
      </div>

      {/* ── Main tabs ── */}
      <Tabs defaultValue="settlement" className="space-y-5 min-w-0">
        {/* Scrolls sideways on a narrow screen instead of wrapping into a jumble. */}
        <TabsList className="w-full justify-start border-b border-border/60 rounded-none h-auto p-0 bg-transparent gap-1 overflow-x-auto overflow-y-hidden flex-nowrap thin-scroll [&>button]:shrink-0">
          <TabsTrigger value="settlement" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary dark:data-[state=active]:border-primary dark:data-[state=active]:text-primary px-3 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            Settlement Board
          </TabsTrigger>
          <TabsTrigger value="postpaid-requests" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary dark:data-[state=active]:border-primary dark:data-[state=active]:text-primary px-3 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent relative">
            Postpaid Request Approval
            {postpaidRequests > 0 && (
              <span className="ml-2 bg-amber-500 text-white rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold shadow-xs">
                {postpaidRequests}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="postpaid" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary dark:data-[state=active]:border-primary dark:data-[state=active]:text-primary px-3 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent relative">
            Postpaid Settlement
            {postpaidDeclared > 0 && (
              <span className="ml-2 bg-amber-500 text-white rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold shadow-xs">
                {postpaidDeclared}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pending-requests" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary dark:data-[state=active]:border-primary dark:data-[state=active]:text-primary px-3 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent relative">
            Pending Cash Requests
            {pendingList.length > 0 && (
              <span className="ml-2 bg-rose-500 text-white rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold shadow-xs">
                {pendingList.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="unit-requests" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary dark:data-[state=active]:border-primary dark:data-[state=active]:text-primary px-3 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            Unit Requests
          </TabsTrigger>
          <TabsTrigger value="token-supply" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary dark:data-[state=active]:border-primary dark:data-[state=active]:text-primary px-3 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            E-Token Supply
          </TabsTrigger>
          <TabsTrigger value="token-transactions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary dark:data-[state=active]:border-primary dark:data-[state=active]:text-primary px-3 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            E-Token Transactions
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary dark:data-[state=active]:border-primary dark:data-[state=active]:text-primary px-3 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            Transaction History
          </TabsTrigger>
        </TabsList>

        {/* ── Settlement Board ── */}
        <TabsContent value="settlement" className="outline-none">
          <Panel
            title="Settlement Board"
            icon={Scale}
            subtitle={`What each agency owes for ${fmtDay(boardDate)}, against what was collected and paid out.`}
            actions={
              <>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="date"
                    value={boardDate}
                    onChange={e => setBoardDate(e.target.value)}
                    aria-label="Settlement date"
                    className="h-8 w-40 rounded-lg text-xs"
                  />
                  {boardDate !== todayStr && (
                    <Button size="sm" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs font-bold" onClick={() => setBoardDate(todayStr)}>
                      Today
                    </Button>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 rounded-lg px-3 text-xs font-bold"
                  disabled={boardPayments.length === 0}
                  title={boardPayments.length === 0 ? "No payments on this date" : "The day's payments as a settlement statement"}
                  onClick={() => {
                    const agentMapObj: Record<string, string> = {};
                    Object.entries(agentMap).forEach(([id, info]) => {
                      if (info) agentMapObj[id] = `${info.code} (${info.name})`;
                    });
                    generateDailySettlementPDF(boardDate, boardTotalCollected, boardTotalOut, boardTotalCollected - boardTotalOut, boardPayments, agentMapObj);
                  }}
                >
                  <FileText className="h-3.5 w-3.5" /> Daily statement
                </Button>
                <ReportActions
                  label="the settlement board"
                  disabled={settlements.length === 0}
                  onPdf={() => exportReportPdf(boardReport())}
                  onPrint={() => printReport(boardReport())}
                />
              </>
            }
            footer={
              <>
                {(boardCalcs.length > 0 || boardPayments.length > 0) && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t bg-muted/30 px-5 py-3 text-xs font-bold sm:flex sm:flex-wrap sm:items-center">
                    <span className="flex items-center gap-2"><span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Total due</span><span className="font-mono">{fmtGHS(boardTotalDue)}</span></span>
                    <span className="flex items-center gap-2"><span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Collected</span><span className="font-mono text-emerald-600 dark:text-emerald-400">{fmtGHS(boardTotalCollected)}</span></span>
                    <span className="flex items-center gap-2"><span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Paid out</span><span className="font-mono text-orange-600 dark:text-orange-400">{fmtGHS(boardTotalOut)}</span></span>
                    <span className="flex items-center gap-2 sm:ml-auto"><span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Outstanding</span>
                      <span className={`font-mono text-sm font-black ${boardTotalDue - boardTotalCollected > 0.005 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                        {fmtGHS(Math.max(0, boardTotalDue - boardTotalCollected + boardTotalOut))}
                      </span>
                    </span>
                  </div>
                )}
                <Pager page={pBoard.page} totalPages={pBoard.totalPages} onPage={pBoard.setPage} total={pBoard.total} size={pBoard.size} noun="agencies" />
              </>
            }
          >
            {boardCalcs.length === 0 && (
              <div className="flex items-center gap-2 border-b bg-amber-500/5 px-5 py-2.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> No calculations have been run for this date, so balances due are blank.
              </div>
            )}
            <ScrollTable minWidth="58rem">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Agent</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Paid Out</TableHead>
                    <TableHead className="text-right">Net Position</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right pr-5">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-xs font-medium text-muted-foreground">No active agents found.</TableCell>
                    </TableRow>
                  ) : pBoard.rows.map(row => {
                    const st = settlementStatus(row);
                    const netCollected = row.collected - row.paidOut;
                    const shortfall = row.balanceDue - netCollected;
                    const { agent } = row;
                    const name = agentMap[agent.id]?.name ?? agent.fullCode;
                    const edge = !row.hasCalc
                      ? "opacity-60"
                      : shortfall > 0.005
                        ? "border-l-2 border-l-rose-500 bg-rose-500/[0.03]"
                        : shortfall < -0.005
                          ? "border-l-2 border-l-amber-500 bg-amber-500/[0.03]"
                          : "border-l-2 border-l-emerald-500 bg-emerald-500/[0.03]";
                    return (
                      <TableRow key={agent.id} className={`hover:bg-muted/30 ${edge}`}>
                        <TableCell className="pl-5 py-3">
                          <div className="text-xs font-bold text-foreground">{name}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{agent.fullCode}</div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.hasCalc ? fmtGHS(row.balanceDue) : <span className="text-[10px] text-muted-foreground/50">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          {row.collected > 0 ? fmtGHS(row.collected) : <span className="text-muted-foreground/40">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold text-orange-600 dark:text-orange-400">
                          {row.paidOut > 0 ? fmtGHS(row.paidOut) : <span className="text-muted-foreground/40">—</span>}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs font-bold ${netCollected >= 0 ? "text-foreground" : "text-rose-600 dark:text-rose-400"}`}>
                          {row.hasCalc || row.collected > 0 ? fmtGHS(netCollected) : <span className="text-[10px] text-muted-foreground/50">—</span>}
                        </TableCell>
                        <TableCell className="py-3 text-center">
                          <span className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[9.5px] font-black uppercase tracking-wider ${st.bg}`}>{st.label}</span>
                        </TableCell>
                        <TableCell className="py-3 pr-5 text-right">
                          <div className="flex justify-end gap-1.5">
                            {row.hasCalc && shortfall > 0.005 && (
                              <Button size="sm" className="h-7 rounded-lg bg-emerald-600 text-[10px] font-bold text-white hover:bg-emerald-700" onClick={() => prefillAgent(agent.id, shortfall, "pay_in")}>
                                Collect {fmtGHS(shortfall)}
                              </Button>
                            )}
                            {row.hasCalc && row.balanceDue < -0.005 && Math.abs(row.paidOut) < Math.abs(row.balanceDue) - 0.005 && (
                              <Button size="sm" variant="outline" className="h-7 rounded-lg border-orange-500/30 text-[10px] font-bold text-orange-600 hover:bg-orange-500/10 dark:text-orange-400" onClick={() => prefillAgent(agent.id, Math.abs(row.balanceDue) - row.paidOut, "pay_out")}>
                                Pay Out {fmtGHS(Math.abs(row.balanceDue) - row.paidOut)}
                              </Button>
                            )}
                            {!row.hasCalc && (row.collected > 0 || row.paidOut > 0) && (
                              <span className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">Has txns</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollTable>
          </Panel>
        </TabsContent>

        {/* ── Postpaid Request Approval: writers asking to sell on credit ── */}
        <TabsContent value="postpaid-requests" className="outline-none">
          <ModelRequestsPanel showAgent />
        </TabsContent>

        {/* ── Postpaid Settlement ── */}
        <TabsContent value="postpaid" className="outline-none">
          <AdminPostpaidSettlement />
        </TabsContent>

        <TabsContent value="pending-requests" className="outline-none">
          <Panel
            title="Pending Cash Requests"
            icon={Clock}
            subtitle="Agents who have asked to settle in cash. Approve once the money is counted; the receipt is issued on approval."
            actions={
              pendingList.length > 0 ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full border bg-muted/50 px-2.5 py-1 font-bold tabular-nums">{pendingList.length} waiting</span>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-bold tabular-nums text-amber-700 dark:text-amber-400">
                    {fmtGHS(pendingList.reduce((s, r) => s + Number(r.amount), 0))}
                  </span>
                </div>
              ) : undefined
            }
            footer={<Pager page={pPending.page} totalPages={pPending.totalPages} onPage={pPending.setPage} total={pPending.total} size={pPending.size} noun="requests" />}
          >
            {loadingPending ? (
              <div className="py-14 text-center text-xs font-medium text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading requests…
              </div>
            ) : pendingList.length === 0 ? (
              <div className="py-14 text-center text-muted-foreground">
                <CheckCircle2 className="mx-auto h-8 w-8 opacity-30" />
                <p className="mt-2 text-sm font-semibold">No pending cash requests</p>
                <p className="mt-1 text-xs">New requests from agents appear here.</p>
              </div>
            ) : (
              <div className="grid gap-4 p-5 sm:grid-cols-2 2xl:grid-cols-3">
                {pPending.rows.map(req => {
                  const agentInfo = agentMap[req.agentId];
                  return (
                    <article key={req.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border/80 bg-background/60 p-4 shadow-sm transition-shadow hover:shadow-md">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-muted dark:text-foreground">
                            <User className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold">{agentInfo?.name ?? "—"}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{agentInfo?.code ?? ""}</div>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">Pending</span>
                      </div>
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Amount</div>
                        <div className="text-2xl font-black tabular-nums tracking-tight">{fmtGHS(Number(req.amount))}</div>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDay(req.paymentDate)}</span>
                        <span className="inline-flex items-center gap-1 font-semibold uppercase"><Banknote className="h-3 w-3" />{req.paymentMethod}</span>
                      </div>
                      <div className="mt-auto flex gap-2">
                        <Button size="sm" className="h-8 flex-1 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700" onClick={() => handleApprove(req.id, req.amount)} disabled={approveMutation.isPending}>
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve &amp; collect
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 rounded-lg border-rose-500/30 text-xs font-bold text-rose-600 hover:bg-rose-500/10 dark:text-rose-400" onClick={() => handleReject(req.id)} disabled={rejectMutation.isPending}>
                          <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Panel>
        </TabsContent>

        {/* ── Writer unit purchases ── */}
        <TabsContent value="unit-requests" className="outline-none">
          <UnitRequests />
        </TabsContent>

        {/* ── E-token supply chain ── */}
        <TabsContent value="token-supply" className="outline-none">
          <TokenSupply />
        </TabsContent>

        {/* Sits between supply and the cash ledger: where the units came from,
            where they went, then the money that came back. */}
        <TabsContent value="token-transactions" className="outline-none">
          <TokenSalesPanel embedded />
        </TabsContent>

        {/* ── Transaction History ── */}
        <TabsContent value="history" className="outline-none">
          <Panel
            title="Transaction History"
            icon={ArrowRightLeft}
            subtitle="Every cash Pay-In and Pay-Out recorded at the desk, newest first."
            actions={
              <ReportActions
                label="the transaction history"
                disabled={paymentList.length === 0}
                onPdf={exportHistoryPdf}
                onPrint={() => printReport(historyReport())}
              />
            }
            footer={
              <>
                {!loadingPayments && paymentList.filter(p => !p.isVoided).length > 0 && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t bg-muted/30 px-5 py-3 text-xs font-bold sm:flex sm:flex-wrap sm:items-center">
                    <span className="flex items-center gap-2"><span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Pay-In</span><span className="font-mono text-emerald-600 dark:text-emerald-400">{fmtGHS(historyIn)}</span></span>
                    <span className="flex items-center gap-2"><span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Pay-Out</span><span className="font-mono text-orange-600 dark:text-orange-400">{fmtGHS(historyOut)}</span></span>
                    <span className="flex items-center gap-2"><span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Net</span><span className="font-mono">{fmtGHS(historyIn - historyOut)}</span></span>
                    <span className="col-span-2 text-[10px] font-semibold text-muted-foreground sm:ml-auto">
                      {paymentList.filter(p => !p.isVoided).length} valid
                      {paymentList.some(p => p.isVoided) && <span className="text-rose-500"> · {paymentList.filter(p => p.isVoided).length} voided</span>}
                    </span>
                  </div>
                )}
                <Pager page={pHistory.page} totalPages={pHistory.totalPages} onPage={pHistory.setPage} total={pHistory.total} size={pHistory.size} noun="transactions" />
              </>
            }
          >
            {/* Filters, one row above the table */}
            <div className="grid grid-cols-1 gap-3 border-b bg-muted/20 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[1.3fr_1.3fr_1fr_1fr_auto] lg:items-end">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground"><Filter className="h-3 w-3" /> Agent</Label>
                <Select value={filterAgentId || "_all"} onValueChange={v => setFilterAgentId(v === "_all" ? "" : v)}>
                  <SelectTrigger className="h-9 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">All agents</SelectItem>
                    {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground"><Filter className="h-3 w-3" /> Game</Label>
                <Select value={filterGameId || "_all"} onValueChange={v => setFilterGameId(v === "_all" ? "" : v)}>
                  <SelectTrigger className="h-9 rounded-lg text-xs [&>span]:truncate"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value="_all">All games</SelectItem>
                    {gameOptions.map(g => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} · #{g.eventNumber} · {fmtDay(accraDay(g.closeAt))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">From</Label>
                <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9 rounded-lg text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">To</Label>
                <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-9 rounded-lg text-xs" />
              </div>
              {(filterAgentId || filterGameId || filterFrom || filterTo) ? (
                <Button size="sm" variant="ghost" className="h-9 rounded-lg text-xs font-bold" onClick={() => { setFilterAgentId(""); setFilterGameId(""); setFilterFrom(""); setFilterTo(""); }}>
                  Clear filters
                </Button>
              ) : <span className="hidden lg:block" />}
            </div>
            {selectedGame && (
              <div className={`border-b px-5 py-2 text-[11px] ${gameOutsideRange ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-muted/10 text-muted-foreground"}`}>
                {gameOutsideRange
                  ? <>{selectedGame.name} was drawn on {fmtDay(gameDay)}, outside the From/To dates chosen - widen the dates or clear them to see its payments.</>
                  : <>Showing payments recorded for <b className="text-foreground">{selectedGame.name}</b>'s draw day, {fmtDay(gameDay)}{filterAgentId ? <>, for <b className="text-foreground">{agentMap[filterAgentId]?.name ?? "the selected agent"}</b></> : null}.</>}
              </div>
            )}

            <ScrollTable minWidth="64rem">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Receipt #</TableHead>
                    <TableHead>Date · Time</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Net Amount</TableHead>
                    <TableHead>Status</TableHead>
                    {canVoid && <TableHead className="pr-5 text-right">Void</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPayments ? (
                    <TableRow>
                      <TableCell colSpan={canVoid ? 8 : 7} className="py-12 text-center text-xs font-medium text-muted-foreground">
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading transactions…
                      </TableCell>
                    </TableRow>
                  ) : paymentList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canVoid ? 8 : 7} className="py-12 text-center text-xs font-medium text-muted-foreground">
                        {filterAgentId || filterGameId || filterFrom || filterTo ? "No transactions match these filters." : "No transactions found."}
                      </TableCell>
                    </TableRow>
                  ) : pHistory.rows.map(p => {
                    const dir = p.transactionType === "pay_out" ? "out" : "in";
                    return (
                      <TableRow key={p.id} className={p.isVoided ? "bg-muted/20 opacity-50" : "hover:bg-muted/30"}>
                        <TableCell className="py-3 pl-5 font-mono text-xs font-bold text-muted-foreground">{p.receiptNumber ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap py-3 text-xs">
                          <div className="font-semibold">{fmtDay(p.paymentDate?.split("T")[0])}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{fmtTime(p.createdAt)}</div>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="text-xs font-bold">{agentMap[p.agentId]?.name ?? "—"}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{agentMap[p.agentId]?.code ?? ""}</div>
                        </TableCell>
                        <TableCell className="py-3"><DirectionBadge direction={dir} /></TableCell>
                        <TableCell className="py-3 text-right font-mono text-xs text-muted-foreground">
                          {p.grossAmount ? fmtGHS(Number(p.grossAmount)) : "—"}
                        </TableCell>
                        <TableCell className={`py-3 text-right text-xs ${p.isVoided ? "line-through" : ""}`}>
                          <SignedAmount direction={dir} muted={!!p.isVoided}>{fmtGHS(Number(p.amount))}</SignedAmount>
                        </TableCell>
                        <TableCell className="py-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[9.5px] font-black uppercase tracking-wider ${p.isVoided ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400" : "border-border bg-muted/50 text-muted-foreground"}`}>
                            {p.isVoided ? "Voided" : "Valid"}
                          </span>
                        </TableCell>
                        {canVoid && (
                          <TableCell className="py-3 pr-5 text-right">
                            {!p.isVoided && (
                              <Button size="sm" variant="ghost" className="h-7 rounded-lg text-[10px] font-bold text-rose-600 hover:bg-rose-500/10 dark:text-rose-400" onClick={() => handleVoid(p.id)}>
                                Void
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollTable>
          </Panel>
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
                  <span className="font-mono">GH₵ {gross.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {expenseItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-muted-foreground pl-3">
                    <span>— {item.name || "Expense"}</span>
                    <span className="font-mono text-rose-600 dark:text-rose-400">−GH₵ {(Number(item.amount) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                ))}
                {expenseItems.length > 0 && <div className="border-t border-border/40" />}
                <div className="flex justify-between text-sm font-bold pt-1">
                  <span>Net {form.transactionType === "pay_in" ? "collected" : "paid out"}</span>
                  <span className={`font-mono text-base font-extrabold ${netAmount < 0 ? "text-rose-600 dark:text-rose-400" : form.transactionType === "pay_in" ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}>
                    GH₵ {netAmount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
