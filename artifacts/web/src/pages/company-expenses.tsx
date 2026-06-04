import { useState, useMemo } from "react";
import {
  useListCompanyExpenses,
  useCreateCompanyExpense,
  useListRecurringExpenses,
  getListCompanyExpensesQueryKey,
  useGetReserveBalance,
  useGetSalaryWallet,
  getGetReserveBalanceQueryKey,
  getGetSalaryWalletQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS } from "@/lib/utils";
import {
  Banknote,
  Coins,
  TrendingUp,
  Activity,
  Plus,
  Calendar,
  Clock,
  Search,
  Filter,
  FileText,
  UploadCloud,
  Eye,
  Settings,
  ShieldCheck,
  Building,
  Wallet
} from "lucide-react";

function fmtDateTime(ts?: string | null) {
  if (!ts) return "—";
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function CompanyExpenses() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const isDirectorOrAdmin = user?.role === "director" || user?.role === "administrator";

  const { data: reserveBalRaw, isLoading: loadingReserve } = useGetReserveBalance({
    query: {
      queryKey: getGetReserveBalanceQueryKey(),
      enabled: isDirectorOrAdmin,
      refetchInterval: 5_000,
    }
  });

  const { data: walletRaw, isLoading: loadingWallet } = useGetSalaryWallet({
    query: {
      queryKey: getGetSalaryWalletQueryKey(),
      enabled: isDirectorOrAdmin,
      refetchInterval: 5_000,
    }
  });

  const companyFundsTotal = useMemo(() => {
    return Number(reserveBalRaw?.balance ?? 0) + Number(walletRaw?.balance ?? 0);
  }, [reserveBalRaw, walletRaw]);

  const isLoadingFunds = loadingReserve || loadingWallet;

  // ── Date Filters state ──
  const [dateFilter, setDateFilter] = useState<"today" | "week" | "month" | "custom">("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const queryParams = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    if (dateFilter === "today") {
      return { startDate: todayStr, endDate: todayStr };
    } else if (dateFilter === "week") {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return { startDate: d.toISOString().split("T")[0], endDate: todayStr };
    } else if (dateFilter === "month") {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return { startDate: d.toISOString().split("T")[0], endDate: todayStr };
    } else {
      return { startDate: customStart || undefined, endDate: customEnd || undefined };
    }
  }, [dateFilter, customStart, customEnd]);

  // ── Queries ──
  const { data: expenses, isLoading: loadingExpenses } = useListCompanyExpenses(queryParams);
  const { data: recurringList } = useListRecurringExpenses();

  // ── Mutations ──
  const createExpenseMutation = useCreateCompanyExpense();

  // ── Modals state ──
  const [recordOpen, setRecordOpen] = useState(false);
  const [receiptModalImage, setReceiptModalImage] = useState<string | null>(null);

  // ── Form state ──
  const [expenseType, setExpenseType] = useState<"recurring" | "non-recurring">("recurring");
  const [recurringId, setRecurringId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [authOfficer, setAuthOfficer] = useState("");
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  // ── Active recurring list ──
  const activeRecurring = useMemo(() => {
    return (recurringList || []).filter(item => item.isActive);
  }, [recurringList]);

  // ── Calculate Metrics ──
  const metrics = useMemo(() => {
    const list = expenses || [];
    let total = 0;
    let recurringTotal = 0;
    let nonRecurringTotal = 0;

    list.forEach(item => {
      const val = parseFloat(item.amount);
      total += val;
      if (item.type === "recurring") {
        recurringTotal += val;
      } else {
        nonRecurringTotal += val;
      }
    });

    return { total, recurringTotal, nonRecurringTotal };
  }, [expenses]);

  // ── Form handlers ──
  const handleRecurringChange = (id: string) => {
    setRecurringId(id);
    const selected = activeRecurring.find(item => item.id === id);
    if (selected) {
      setDescription(selected.name);
      setAmount(selected.defaultAmount ? String(selected.defaultAmount) : "");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setReceiptBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast({ title: "Please enter a valid amount", variant: "destructive" });
      return;
    }

    try {
      await createExpenseMutation.mutateAsync({
        data: {
          type: expenseType,
          recurringExpenseId: expenseType === "recurring" ? recurringId : undefined,
          description,
          amount,
          payeeName,
          authorizingOfficer: expenseType === "non-recurring" ? authOfficer : undefined,
          receiptImage: expenseType === "non-recurring" ? (receiptBase64 || undefined) : undefined,
        },
      });

      toast({ title: "Company expense recorded successfully" });
      qc.invalidateQueries({ queryKey: getCompanyExpensesQueryKey() });
      if (isDirectorOrAdmin) {
        qc.invalidateQueries({ queryKey: getGetReserveBalanceQueryKey() });
        qc.invalidateQueries({ queryKey: getGetSalaryWalletQueryKey() });
      }
      resetForm();
      setRecordOpen(false);
    } catch (err: any) {
      toast({
        title: "Failed to record expense",
        description: err?.response?.data?.error || "Check inputs and try again",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setExpenseType("recurring");
    setRecurringId("");
    setDescription("");
    setAmount("");
    setPayeeName("");
    setAuthOfficer("");
    setReceiptBase64(null);
    setFileName("");
  };

  function getCompanyExpensesQueryKey() {
    return getListCompanyExpensesQueryKey(queryParams);
  }

  const isCashierOrAdmin = user?.role === "cashier" || user?.role === "administrator";

  return (
    <div className="p-6 space-y-6 relative min-h-screen">
      {/* Background radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-64 bg-gradient-to-b from-indigo-500/5 via-transparent to-transparent blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between flex-wrap gap-4 relative z-10">
        <div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">Company Expenses</h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">
            Unified statement tracking for company operations, recurring costs, and non-recurring operational spending.
          </p>
        </div>
        {isCashierOrAdmin && (
          <Button
            onClick={() => {
              resetForm();
              setRecordOpen(true);
            }}
            className="gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl shadow-md transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 text-xs h-9"
          >
            <Plus className="w-4 h-4" />
            Record Company Expense
          </Button>
        )}
      </div>

      {/* Summary KPI stats */}
      <div className={`grid gap-4 grid-cols-1 ${isDirectorOrAdmin ? "md:grid-cols-4" : "md:grid-cols-3"} relative z-10`}>
        {/* Total Company Funds (Director/Admin only) */}
        {isDirectorOrAdmin && (
          <Card className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-indigo-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden relative group">
            <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500/10 rounded-full blur-xl -mr-6 -mt-6 pointer-events-none group-hover:bg-indigo-500/20 transition-all duration-300" />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5 px-4.5">
              <CardTitle className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Total Company Funds
              </CardTitle>
              <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-xs">
                <Wallet className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent className="px-4.5 pb-3.5">
              <div className="text-xl font-bold font-mono tracking-tight text-foreground bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">
                {isLoadingFunds ? (
                  <span className="text-xs font-sans text-muted-foreground/60 animate-pulse">Calculating...</span>
                ) : (
                  fmtGHS(companyFundsTotal)
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[9.5px] text-muted-foreground/70 font-semibold">Treasury + Investment</p>
                <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-extrabold uppercase border border-emerald-500/20 leading-none">
                  Active
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Total combined */}
        <Card className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-indigo-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5 px-4.5">
            <CardTitle className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Total Combined Expenditures</CardTitle>
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-xs"><Activity className="h-4 w-4" /></span>
          </CardHeader>
          <CardContent className="px-4.5 pb-3.5">
            <div className="text-xl font-bold font-mono tracking-tight text-foreground">{fmtGHS(metrics.total)}</div>
            <p className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">All expenses for selected period</p>
          </CardContent>
        </Card>

        {/* Recurring */}
        <Card className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-violet-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5 px-4.5">
            <CardTitle className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Recurring Expenses</CardTitle>
            <span className="p-1.5 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 shadow-xs"><Banknote className="h-4 w-4" /></span>
          </CardHeader>
          <CardContent className="px-4.5 pb-3.5">
            <div className="text-xl font-bold font-mono tracking-tight text-violet-600 dark:text-violet-400">{fmtGHS(metrics.recurringTotal)}</div>
            <p className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">Ongoing operation costs and stipends</p>
          </CardContent>
        </Card>

        {/* Non-recurring */}
        <Card className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-emerald-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5 px-4.5">
            <CardTitle className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Non-Recurring Expenses</CardTitle>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-xs"><Coins className="h-4 w-4" /></span>
          </CardHeader>
          <CardContent className="px-4.5 pb-3.5">
            <div className="text-xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">{fmtGHS(metrics.nonRecurringTotal)}</div>
            <p className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">Ad-hoc payouts and emergency expenditures</p>
          </CardContent>
        </Card>
      </div>

      {/* Date Filter Card */}
      <Card className="border border-border/40 bg-card/45 backdrop-blur-md shadow-sm rounded-2xl relative z-10">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-xl border border-border/40 backdrop-blur-sm self-start sm:self-auto">
            {(["today", "week", "month", "custom"] as const).map(f => (
              <button
                key={f}
                onClick={() => setDateFilter(f)}
                className={`text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-all capitalize ${
                  dateFilter === f
                    ? "bg-background text-foreground shadow-sm font-bold"
                    : "text-muted-foreground hover:text-foreground/80"
                }`}
              >
                {f === "week" ? "This Week" : f === "month" ? "This Month" : f}
              </button>
            ))}
          </div>

          {dateFilter === "custom" && (
            <div className="flex flex-wrap items-center gap-4 animate-in fade-in duration-200 w-full sm:w-auto">
              <div className="flex items-center gap-2 flex-1 sm:flex-initial">
                <Label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">From</Label>
                <Input
                  type="date"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="h-9 text-xs w-full sm:w-40 bg-background/60 border-border/60 rounded-lg"
                />
              </div>
              <div className="flex items-center gap-2 flex-1 sm:flex-initial">
                <Label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">To</Label>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="h-9 text-xs w-full sm:w-40 bg-background/60 border-border/60 rounded-lg"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statement Table */}
      <Card className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden relative z-10">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="border-b border-border/40">
                  <TableHead className="text-xs font-bold text-muted-foreground pl-5 py-3">Date & Time</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Expense Type</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Description</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground">Amount</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Payee</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Authorizing Officer</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground">Issued Cashier</TableHead>
                  <TableHead className="text-center text-xs font-bold text-muted-foreground pr-5">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingExpenses ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-xs font-medium">
                      <Activity className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600/60" />
                      Loading statement records…
                    </TableCell>
                  </TableRow>
                ) : !expenses || expenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-xs font-medium">
                      No expense records found for the selected period.
                    </TableCell>
                  </TableRow>
                ) : (
                  expenses.map(item => {
                    const rowClass = item.type === "recurring"
                      ? "hover:bg-muted/10 border-b border-border/40 border-l-2 border-l-violet-500/50 transition-colors"
                      : "hover:bg-muted/10 border-b border-border/40 border-l-2 border-l-emerald-500/50 transition-colors";

                    return (
                      <TableRow key={item.id} className={rowClass}>
                        <TableCell className="text-xs font-mono text-muted-foreground pl-5 py-3.5">
                          {fmtDateTime(item.createdAt)}
                        </TableCell>
                        <TableCell className="py-3.5">
                          <Badge
                            variant={item.type === "recurring" ? "secondary" : "default"}
                            className={`text-[9.5px] font-extrabold tracking-wide uppercase px-2.5 py-0.5 rounded-lg border shadow-xs ${
                              item.type === "recurring"
                                ? "bg-violet-500/10 border-violet-500/20 text-violet-700 dark:text-violet-400"
                                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                            }`}
                          >
                            {item.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-bold text-foreground py-3.5">{item.description}</TableCell>
                        <TableCell className="text-xs font-bold font-mono text-right text-indigo-600 dark:text-indigo-400 py-3.5">
                          {fmtGHS(Number(item.amount))}
                        </TableCell>
                        <TableCell className="text-xs font-medium text-foreground py-3.5">{item.payeeName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-medium py-3.5">
                          {item.authorizingOfficer ? (
                            <span className="flex items-center gap-1">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                              {item.authorizingOfficer}
                            </span>
                          ) : (
                            <span className="italic text-muted-foreground/30">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-medium py-3.5">
                          {item.cashierName || "System"}
                        </TableCell>
                        <TableCell className="text-center pr-5 py-3.5">
                          {item.receiptImage ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setReceiptModalImage(item.receiptImage!)}
                              className="h-7 text-[10px] font-bold rounded-lg border-primary/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 gap-1.5"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View
                            </Button>
                          ) : (
                            <span className="text-muted-foreground/30 text-xs italic">N/A</span>
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

      {/* Record Expense Dialog */}
      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="max-w-md rounded-3xl border border-border/40 bg-card/95 backdrop-blur-lg shadow-2xl p-6">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-base font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">Record Company Expense</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Expense Flow Type</Label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-muted/40 rounded-xl border border-border/40 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => {
                    setExpenseType("recurring");
                    resetForm();
                  }}
                  className={`text-xs font-bold py-1.5 rounded-lg transition-all ${
                    expenseType === "recurring" 
                      ? "bg-background text-foreground shadow-sm font-bold" 
                      : "text-muted-foreground hover:text-foreground/80"
                  }`}
                >
                  Recurring
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExpenseType("non-recurring");
                    resetForm();
                    setExpenseType("non-recurring");
                  }}
                  className={`text-xs font-bold py-1.5 rounded-lg transition-all ${
                    expenseType === "non-recurring" 
                      ? "bg-background text-foreground shadow-sm font-bold" 
                      : "text-muted-foreground hover:text-foreground/80"
                  }`}
                >
                  Non-Recurring
                </button>
              </div>
            </div>

            {expenseType === "recurring" ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Select Recurring Expense</Label>
                  <Select value={recurringId} onValueChange={handleRecurringChange}>
                    <SelectTrigger className="h-9 text-xs bg-background/60 border-border/60 rounded-xl">
                      <SelectValue placeholder="Choose recurring cost item" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeRecurring.length === 0 ? (
                        <div className="p-2 text-xs text-muted-foreground italic text-center">
                          No active recurring expenses found.
                        </div>
                      ) : (
                        activeRecurring.map(item => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Expense Value (GH₵)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required
                    placeholder="0.00"
                    className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Payee / Recipient Name</Label>
                  <Input
                    value={payeeName}
                    onChange={e => setPayeeName(e.target.value)}
                    required
                    placeholder="Who receives this payment?"
                    className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Expense Description</Label>
                  <Input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    required
                    placeholder="What is this expense for?"
                    className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Amount (GH₵)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      required
                      placeholder="0.00"
                      className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Authorizing Officer</Label>
                    <Input
                      value={authOfficer}
                      onChange={e => setAuthOfficer(e.target.value)}
                      required
                      placeholder="Who approved this?"
                      className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Payee / Recipient Name</Label>
                  <Input
                    value={payeeName}
                    onChange={e => setPayeeName(e.target.value)}
                    required
                    placeholder="Recipient's Name"
                    className="h-9 text-xs bg-background/60 border-border/60 rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground block">Receipt Upload</Label>
                  <div className="relative border-2 border-dashed border-border/60 rounded-2xl p-4.5 bg-muted/20 hover:bg-muted/30 transition-colors flex flex-col items-center justify-center text-center cursor-pointer">
                    <UploadCloud className="w-8 h-8 text-muted-foreground/60 mb-1.5" />
                    <span className="text-xs font-bold text-foreground/80">Upload Receipt File</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Drag & drop or click to choose file</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFileUpload}
                      required
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </div>
                  {fileName && (
                    <p className="text-[10.5px] text-emerald-600 dark:text-emerald-400 font-bold mt-1.5 text-center truncate">
                      ✓ Selected: {fileName}
                    </p>
                  )}
                </div>
              </>
            )}

            <DialogFooter className="pt-2 gap-2 sm:gap-0">
              <Button type="button" variant="outline" size="sm" className="rounded-xl border-border/60" onClick={() => setRecordOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold" disabled={createExpenseMutation.isPending}>
                {createExpenseMutation.isPending ? "Submitting…" : "Submit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Receipt Dialog */}
      <Dialog open={!!receiptModalImage} onOpenChange={open => !open && setReceiptModalImage(null)}>
        <DialogContent className="max-w-xl rounded-3xl border border-border/40 bg-card/95 backdrop-blur-lg shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">View Expense Receipt</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-4 border border-border/40 rounded-2xl bg-muted/20 overflow-hidden min-h-[300px]">
            {receiptModalImage ? (
              receiptModalImage.startsWith("data:application/pdf") ? (
                <iframe src={receiptModalImage} className="w-full h-[500px] rounded-xl border border-border/40" />
              ) : (
                <img
                  src={receiptModalImage}
                  alt="Receipt Scan"
                  className="max-h-[500px] w-auto object-contain rounded-xl shadow-lg border border-border/40"
                />
              )
            ) : null}
          </div>
          <DialogFooter className="pt-2">
            <Button size="sm" className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold" onClick={() => setReceiptModalImage(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
