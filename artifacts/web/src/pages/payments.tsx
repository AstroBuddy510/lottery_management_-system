import { useState } from "react";
import {
  useListPayments, useCreatePayment, useVoidPayment,
  useListAgents, getListPaymentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

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
  const createMutation = useCreatePayment();
  const voidMutation = useVoidPayment();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ agentId: "", amount: "", paymentDate: new Date().toISOString().split("T")[0], notes: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPaymentsQueryKey({}) });

  const agentList = Array.isArray(agents) ? agents : [];
  const agentMap: Record<string, string> = Object.fromEntries(agentList.map(a => [a.id, a.fullCode]));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        data: {
          agentId: form.agentId,
          amount: form.amount,
          paymentDate: form.paymentDate,
          notes: form.notes || undefined,
        }
      });
      toast({ title: "Payment recorded" });
      setOpen(false);
      setForm({ agentId: "", amount: "", paymentDate: new Date().toISOString().split("T")[0], notes: "" });
      invalidate();
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
  const todayValid = paymentList.filter(p => !p.isVoided && p.paymentDate?.startsWith(new Date().toISOString().split("T")[0]));
  const todayTotal = todayValid.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Payments</h1>
        <Button size="sm" onClick={() => setOpen(true)}>Record Payment</Button>
      </div>

      {(!filterFrom && !filterTo && !filterAgentId) && paymentList.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Collected Today</div>
            <div className="text-xl font-bold text-primary">${todayTotal.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{todayValid.length} payment{todayValid.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Total (filtered)</div>
            <div className="text-xl font-bold">${paymentList.filter(p => !p.isVoided).reduce((s, p) => s + Number(p.amount), 0).toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{paymentList.filter(p => !p.isVoided).length} valid</div>
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-4 flex-wrap items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-8 text-sm w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-8 text-sm w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Agent</Label>
          <Select value={filterAgentId || "_all"} onValueChange={v => setFilterAgentId(v === "_all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All agents</SelectItem>
              {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.fullCode} — {a.user?.fullName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setFilterAgentId(""); setFilterFrom(""); setFilterTo(""); }}>Clear</Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : paymentList.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No payments found.</TableCell></TableRow>
            ) : paymentList.map(p => (
              <TableRow key={p.id} className={p.isVoided ? "opacity-50" : ""}>
                <TableCell className="text-sm">{p.paymentDate?.split("T")[0]}</TableCell>
                <TableCell className="text-sm font-mono font-medium">{agentMap[p.agentId] ?? p.agentId.slice(0, 8) + "…"}</TableCell>
                <TableCell className="text-sm text-right font-mono">${Number(p.amount).toFixed(2)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.notes ?? "—"}</TableCell>
                <TableCell><Badge variant={p.isVoided ? "destructive" : "default"} className="text-xs">{p.isVoided ? "Voided" : "Valid"}</Badge></TableCell>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Agent</Label>
              <Select value={form.agentId} onValueChange={v => setForm(f => ({ ...f, agentId: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select agent..." /></SelectTrigger>
                <SelectContent>{agentList.filter(a => a.isActive).map(a => <SelectItem key={a.id} value={a.id}>{a.fullCode} — {a.user?.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Amount</Label><Input type="number" step="0.01" min="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Payment Date</Label><Input type="date" value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))} required className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Notes (optional)</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="h-9 text-sm" placeholder="Receipt #, memo..." /></div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending || !form.agentId}>Record</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
