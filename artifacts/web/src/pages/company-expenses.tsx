import { useState, useMemo } from "react";
import {
  useListCompanyExpenses,
  useCreateCompanyExpense,
  useListRecurringExpenses,
  getListCompanyExpensesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS } from "@/lib/utils";

function fmtDateTime(ts?: string | null) {
  if (!ts) return "—";
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function CompanyExpenses() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

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

  // Helper helper to get query invalidation key
  function getCompanyExpensesQueryKey() {
    return getListCompanyExpensesQueryKey(queryParams);
  }

  const isCashierOrAdmin = user?.role === "cashier" || user?.role === "administrator";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Company Expenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Unified statement tracking for company operations, recurring costs, and non-recurring operational spending.
          </p>
        </div>
        {isCashierOrAdmin && (
          <Button
            onClick={() => {
              resetForm();
              setRecordOpen(true);
            }}
            className="shadow-sm hover:scale-[1.02] transition-transform duration-150"
          >
            + Record Company Expense
          </Button>
        )}
      </div>

      {/* ── Metric Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-sidebar-border bg-gradient-to-br from-background to-sidebar/20 shadow-sm">
          <CardHeader className="pb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Combined Expenditures</span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-primary">{fmtGHS(metrics.total)}</div>
            <p className="text-xs text-muted-foreground mt-1">All expenses for the selected period</p>
          </CardContent>
        </Card>

        <Card className="border-sidebar-border bg-gradient-to-br from-background to-sidebar/20 shadow-sm">
          <CardHeader className="pb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recurring Expenses</span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-violet-600">{fmtGHS(metrics.recurringTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">Ongoing operation costs and fixed stipends</p>
          </CardContent>
        </Card>

        <Card className="border-sidebar-border bg-gradient-to-br from-background to-sidebar/20 shadow-sm">
          <CardHeader className="pb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Non-Recurring Expenses</span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-emerald-600">{fmtGHS(metrics.nonRecurringTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">Ad-hoc payouts and emergency expenditures</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Date Filters Card ── */}
      <Card className="border-sidebar-border shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 bg-sidebar rounded-lg p-1 border">
              {(["today", "week", "month", "custom"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setDateFilter(f)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors capitalize ${
                    dateFilter === f
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  {f === "week" ? "This Week" : f === "month" ? "This Month" : f}
                </button>
              ))}
            </div>

            {dateFilter === "custom" && (
              <div className="flex items-center gap-3 animate-in fade-in duration-200">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">From:</Label>
                  <Input
                    type="date"
                    value={customStart}
                    onChange={e => setCustomStart(e.target.value)}
                    className="h-8 text-xs py-1 w-44"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">To:</Label>
                  <Input
                    type="date"
                    value={customEnd}
                    onChange={e => setCustomEnd(e.target.value)}
                    className="h-8 text-xs py-1 w-44"
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Statement Statement Table ── */}
      <Card className="border-sidebar-border shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">Date & Time</TableHead>
                  <TableHead className="w-32">Expense Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-36">Amount</TableHead>
                  <TableHead className="w-44">Payee</TableHead>
                  <TableHead className="w-44">Authorizing Officer</TableHead>
                  <TableHead className="w-40">Issued Cashier</TableHead>
                  <TableHead className="w-28 text-center">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingExpenses ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-sm text-muted-foreground">
                      Loading statement records…
                    </TableCell>
                  </TableRow>
                ) : !expenses || expenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-sm text-muted-foreground">
                      No expense records found for the selected period.
                    </TableCell>
                  </TableRow>
                ) : (
                  expenses.map(item => (
                    <TableRow key={item.id} className="hover:bg-sidebar/10 transition-colors">
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {fmtDateTime(item.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={item.type === "recurring" ? "secondary" : "default"}
                          className={`text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 ${
                            item.type === "recurring"
                              ? "bg-violet-50 text-violet-700 border-violet-100 hover:bg-violet-50"
                              : "bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-50"
                          }`}
                        >
                          {item.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-medium">{item.description}</TableCell>
                      <TableCell className="text-sm font-bold font-mono text-right text-primary">
                        {fmtGHS(Number(item.amount))}
                      </TableCell>
                      <TableCell className="text-sm">{item.payeeName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.authorizingOfficer ?? <span className="italic text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.cashierName || "System"}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.receiptImage ? (
                          <Button
                            variant="link"
                            onClick={() => setReceiptModalImage(item.receiptImage!)}
                            className="text-primary hover:text-primary/80 font-semibold text-xs h-auto p-0"
                          >
                            View Receipt
                          </Button>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs italic">N/A</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Record Expense Dialog ── */}
      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Company Expense</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Expense Flow Type</Label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-sidebar rounded-lg border">
                <button
                  type="button"
                  onClick={() => {
                    setExpenseType("recurring");
                    resetForm();
                  }}
                  className={`text-xs font-semibold py-1.5 rounded-md transition-colors ${
                    expenseType === "recurring" ? "bg-background text-primary shadow-sm" : "text-muted-foreground"
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
                  className={`text-xs font-semibold py-1.5 rounded-md transition-colors ${
                    expenseType === "non-recurring" ? "bg-background text-primary shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Non-Recurring
                </button>
              </div>
            </div>

            {expenseType === "recurring" ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Select Recurring Expense</Label>
                  <Select value={recurringId} onValueChange={handleRecurringChange}>
                    <SelectTrigger className="h-9 text-sm">
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
                  <Label className="text-xs">Expense Value (GH₵)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required
                    placeholder="0.00"
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Payee / Recipient Name</Label>
                  <Input
                    value={payeeName}
                    onChange={e => setPayeeName(e.target.value)}
                    required
                    placeholder="Who receives this payment?"
                    className="h-9 text-sm"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Expense Description</Label>
                  <Input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    required
                    placeholder="What is this expense for?"
                    className="h-9 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount (GH₵)</Label>
                    <Input
                      type="number"
                      step="0.01;0"
                      min="0.01"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      required
                      placeholder="0.00"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Authorizing Officer</Label>
                    <Input
                      value={authOfficer}
                      onChange={e => setAuthOfficer(e.target.value)}
                      required
                      placeholder="Who approved this?"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Payee / Recipient Name</Label>
                  <Input
                    value={payeeName}
                    onChange={e => setPayeeName(e.target.value)}
                    required
                    placeholder="Recipient's Name"
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5 border border-dashed rounded-lg p-3 bg-sidebar/10">
                  <Label className="text-xs font-semibold block mb-1">Receipt Upload</Label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileUpload}
                    required
                    className="block w-full text-xs text-muted-foreground file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90 cursor-pointer"
                  />
                  {fileName && (
                    <p className="text-[10px] text-emerald-600 font-semibold mt-1 truncate">
                      ✓ Uploaded: {fileName}
                    </p>
                  )}
                </div>
              </>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRecordOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={createExpenseMutation.isPending}>
                {createExpenseMutation.isPending ? "Submitting…" : "Submit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── View Receipt Dialog ── */}
      <Dialog open={!!receiptModalImage} onOpenChange={open => !open && setReceiptModalImage(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>View Expense Receipt</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-4 border rounded-lg bg-sidebar/5 overflow-hidden">
            {receiptModalImage ? (
              receiptModalImage.startsWith("data:application/pdf") ? (
                <iframe src={receiptModalImage} className="w-full h-[500px] rounded-md border" />
              ) : (
                <img
                  src={receiptModalImage}
                  alt="Receipt Scan"
                  className="max-h-[500px] w-auto object-contain rounded-md shadow"
                />
              )
            ) : null}
          </div>
          <DialogFooter>
            <Button size="sm" onClick={() => setReceiptModalImage(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
