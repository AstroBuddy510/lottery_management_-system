import { useState } from "react";
import {
  useListPayments, useCreatePayment, useVoidPayment,
  useListAgents, useListExpenseCategories,
  getListPaymentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type ExpenseItem = { expenseCategoryId: string; name: string; amount: string };

type CreatedPayment = {
  id: string;
  agentId: string;
  transactionType: string;
  grossAmount?: string | null;
  amount: string;
  expenseItems?: ExpenseItem[] | null;
  paymentDate: string;
  receiptNumber?: string | null;
};

const EMPTY_FORM = {
  agentId: "",
  transactionType: "pay_in" as "pay_in" | "pay_out",
  grossAmount: "",
  paymentDate: new Date().toISOString().split("T")[0],
};

export function Payments() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const { data: payments, isLoading } = useListPayments({
    agentId: filterAgentId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });

  const { data: agents } = useListAgents({});
  const { data: expenseCategories } = useListExpenseCategories();
  const createMutation = useCreatePayment();
  const voidMutation = useVoidPayment();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([]);

  const [receiptPayment, setReceiptPayment] = useState<CreatedPayment | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPaymentsQueryKey({}) });

  const agentList = Array.isArray(agents) ? agents : [];
  const expenseList = Array.isArray(expenseCategories)
    ? expenseCategories.filter(e => e.isActive)
    : [];
  const agentMap: Record<string, string> = Object.fromEntries(
    agentList.map(a => [a.id, a.user?.fullName ?? a.fullCode])
  );

  const gross = Number(form.grossAmount) || 0;
  const expenseTotal = expenseItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const netAmount = gross - expenseTotal;

  const addExpenseItem = () => {
    setExpenseItems(prev => [...prev, { expenseCategoryId: "", name: "", amount: "" }]);
  };

  const removeExpenseItem = (idx: number) => {
    setExpenseItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateExpenseItem = (idx: number, field: keyof ExpenseItem, value: string) => {
    setExpenseItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      if (field === "expenseCategoryId") {
        const cat = expenseList.find(e => e.id === value);
        return {
          expenseCategoryId: value,
          name: cat?.name ?? "",
          amount: cat?.defaultAmount ?? "",
        };
      }
      return { ...item, [field]: value };
    }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setExpenseItems([]);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.agentId || !form.grossAmount) return;

    const invalidItems = expenseItems.filter(i => !i.expenseCategoryId || !i.amount);
    if (invalidItems.length > 0) {
      toast({ title: "Fill in all expense fields or remove incomplete rows", variant: "destructive" });
      return;
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
      await voidMutation.mutateAsync({ id, data: { reason: "Voided by cashier" } });
      toast({ title: "Payment voided" });
      invalidate();
    } catch {
      toast({ title: "Failed to void payment", variant: "destructive" });
    }
  };

  const paymentList = Array.isArray(payments) ? payments : [];
  const today = new Date().toISOString().split("T")[0];
  const todayValid = paymentList.filter(p => !p.isVoided && p.paymentDate?.startsWith(today));
  const todayPayIn = todayValid.filter(p => p.transactionType === "pay_in").reduce((s, p) => s + Number(p.amount), 0);
  const todayPayOut = todayValid.filter(p => p.transactionType === "pay_out").reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold">Payments</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Record and track agent payment transactions</p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setOpen(true); }}>Record Payment</Button>
      </div>

      {(!filterFrom && !filterTo && !filterAgentId) && paymentList.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <div className="text-xs font-medium text-muted-foreground mb-1">Today — Pay-In</div>
            <div className="text-2xl font-bold text-primary">GH₵ {todayPayIn.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{todayValid.filter(p => p.transactionType === "pay_in").length} transaction(s)</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <div className="text-xs font-medium text-muted-foreground mb-1">Today — Pay-Out</div>
            <div className="text-2xl font-bold text-orange-600">GH₵ {todayPayOut.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{todayValid.filter(p => p.transactionType === "pay_out").length} transaction(s)</div>
          </div>
        </div>
      )}

      <div className="bg-muted/30 border rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter Payments</span>
          {(filterAgentId || filterFrom || filterTo) && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => { setFilterAgentId(""); setFilterFrom(""); setFilterTo(""); }}>Clear filters</Button>
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

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Receipt #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Net Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : paymentList.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">No payments found.</TableCell></TableRow>
            ) : paymentList.map(p => (
              <TableRow key={p.id} className={p.isVoided ? "opacity-50" : ""}>
                <TableCell className="text-xs font-mono text-muted-foreground">{p.receiptNumber ?? "—"}</TableCell>
                <TableCell className="text-sm">{p.paymentDate?.split("T")[0]}</TableCell>
                <TableCell className="text-sm font-mono font-medium">{agentMap[p.agentId] ?? p.agentId.slice(0, 8) + "…"}</TableCell>
                <TableCell>
                  <Badge
                    variant={p.transactionType === "pay_in" ? "default" : "secondary"}
                    className={`text-xs ${p.transactionType === "pay_out" ? "bg-orange-100 text-orange-700 border-orange-200" : ""}`}
                  >
                    {p.transactionType === "pay_in" ? "Pay-In" : "Pay-Out"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-right font-mono text-muted-foreground">
                  {p.grossAmount ? `GH₵ ${Number(p.grossAmount).toFixed(2)}` : "—"}
                </TableCell>
                <TableCell className="text-sm text-right font-mono font-semibold">GH₵ {Number(p.amount).toFixed(2)}</TableCell>
                <TableCell><Badge variant={p.isVoided ? "destructive" : "outline"} className="text-xs">{p.isVoided ? "Voided" : "Valid"}</Badge></TableCell>
                <TableCell>
                  {!p.isVoided && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleVoid(p.id)}>Void</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Record Payment Modal ── */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-5">

            {/* Agent */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Agent</Label>
              <Select value={form.agentId} onValueChange={v => setForm(f => ({ ...f, agentId: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select agent..." /></SelectTrigger>
                <SelectContent>
                  {agentList.filter(a => a.isActive).map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Transaction Type */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Transaction Direction</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, transactionType: "pay_in" }))}
                  className={`rounded-lg border-2 p-3 text-left transition-colors ${
                    form.transactionType === "pay_in"
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="text-sm font-semibold">Pay-In</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Cash received from agent</div>
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, transactionType: "pay_out" }))}
                  className={`rounded-lg border-2 p-3 text-left transition-colors ${
                    form.transactionType === "pay_out"
                      ? "border-orange-500 bg-orange-50"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="text-sm font-semibold">Pay-Out</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Cash issued to agent</div>
                </button>
              </div>
            </div>

            {/* Gross Amount + Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Gross Amount (GH₵)</Label>
                <Input
                  type="number" step="0.01" min="0.01"
                  value={form.grossAmount}
                  onChange={e => setForm(f => ({ ...f, grossAmount: e.target.value }))}
                  required className="h-9 text-sm"
                  placeholder="0.00"
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

            {/* Expense Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Expense Deductions</Label>
                <Button
                  type="button" size="sm" variant="outline"
                  className="h-7 text-xs px-2"
                  onClick={addExpenseItem}
                  disabled={expenseList.length === 0}
                >
                  + Add Expense
                </Button>
              </div>

              {expenseList.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No expense categories configured. Ask an administrator to set them up in Settings.</p>
              )}

              {expenseItems.length > 0 && (
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  {expenseItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                      <Select
                        value={item.expenseCategoryId || "_none"}
                        onValueChange={v => updateExpenseItem(idx, "expenseCategoryId", v === "_none" ? "" : v)}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select expense..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Select category...</SelectItem>
                          {expenseList.map(e => (
                            <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="relative w-28">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">GH₵</span>
                        <Input
                          type="number" step="0.01" min="0"
                          value={item.amount}
                          onChange={e => updateExpenseItem(idx, "amount", e.target.value)}
                          className="h-8 text-xs pl-8"
                          placeholder="0.00"
                        />
                      </div>
                      <Button
                        type="button" size="sm" variant="ghost"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => removeExpenseItem(idx)}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Net Calculation Summary */}
            {form.grossAmount && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Gross amount</span>
                  <span className="font-mono">GH₵ {gross.toFixed(2)}</span>
                </div>
                {expenseItems.length > 0 && (
                  <>
                    {expenseItems.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-xs text-muted-foreground pl-2">
                        <span>— {item.name || "Expense"}</span>
                        <span className="font-mono text-destructive">− GH₵ {(Number(item.amount) || 0).toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="border-t pt-1.5 mt-1" />
                  </>
                )}
                <div className="flex justify-between text-sm font-semibold">
                  <span>Net {form.transactionType === "pay_in" ? "collected" : "paid out"}</span>
                  <span className={`font-mono ${netAmount < 0 ? "text-destructive" : "text-primary"}`}>
                    GH₵ {netAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
              <Button
                type="submit" size="sm"
                disabled={createMutation.isPending || !form.agentId || !form.grossAmount}
              >
                {createMutation.isPending ? "Recording…" : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Receipt Modal ── */}
      <Dialog open={!!receiptPayment} onOpenChange={open => !open && setReceiptPayment(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">Payment Receipt</DialogTitle>
          </DialogHeader>

          {receiptPayment && (
            <div className="space-y-5">
              {/* Receipt number — prominently displayed */}
              <div className="text-center rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Receipt Number</div>
                <div className="text-3xl font-bold font-mono tracking-wider text-primary">
                  {receiptPayment.receiptNumber ?? "—"}
                </div>
              </div>

              {/* QR Code */}
              {receiptPayment.receiptNumber && (
                <div className="flex flex-col items-center gap-2">
                  <QRCodeSVG
                    value={receiptPayment.receiptNumber}
                    size={160}
                    level="M"
                    includeMargin
                    className="rounded-lg border p-2"
                  />
                  <p className="text-xs text-muted-foreground">Scan to verify receipt</p>
                </div>
              )}

              {/* Payment summary */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant={receiptPayment.transactionType === "pay_in" ? "default" : "secondary"} className="text-xs">
                    {receiptPayment.transactionType === "pay_in" ? "Pay-In" : "Pay-Out"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agent</span>
                  <span className="font-mono font-medium text-sm">{agentMap[receiptPayment.agentId] ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span>{receiptPayment.paymentDate}</span>
                </div>
                {receiptPayment.grossAmount && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gross</span>
                    <span className="font-mono">GH₵ {Number(receiptPayment.grossAmount).toFixed(2)}</span>
                  </div>
                )}
                {receiptPayment.expenseItems && receiptPayment.expenseItems.length > 0 && (
                  receiptPayment.expenseItems.map((exp, idx) => (
                    <div key={idx} className="flex justify-between text-xs text-muted-foreground pl-2">
                      <span>— {exp.name}</span>
                      <span className="font-mono">− GH₵ {Number(exp.amount).toFixed(2)}</span>
                    </div>
                  ))
                )}
                <div className="border-t pt-2 flex justify-between font-semibold">
                  <span>Net Amount</span>
                  <span className="font-mono text-primary">GH₵ {Number(receiptPayment.amount).toFixed(2)}</span>
                </div>
              </div>

              <Button className="w-full" onClick={() => setReceiptPayment(null)}>Close Receipt</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
