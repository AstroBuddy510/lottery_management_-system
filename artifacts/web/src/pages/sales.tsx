import { useState } from "react";
import {
  useListSales, useCreateSale, useListWriters,
  getListSalesQueryKey, getListWritersQueryKey,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

export function Sales() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { writerMap, agentList } = useWriterLookup();

  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const { data: filterWriters } = useListWriters(filterAgentId, {}, {
    query: { queryKey: getListWritersQueryKey(filterAgentId, {}), enabled: !!filterAgentId }
  });
  const filterWriterList = Array.isArray(filterWriters) ? filterWriters : [];

  const { data: sales, isLoading } = useListSales({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });

  const [selectedAgent, setSelectedAgent] = useState("");
  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent }
  });

  const createMutation = useCreateSale();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ writerId: "", gameType: "", ticketAmount: "", saleDate: new Date().toISOString().split("T")[0] });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, gameType: form.gameType, ticketAmount: form.ticketAmount, saleDate: form.saleDate } });
      toast({ title: "Sale logged" });
      setOpen(false);
      setForm({ writerId: "", gameType: "", ticketAmount: "", saleDate: new Date().toISOString().split("T")[0] });
      qc.invalidateQueries({ queryKey: getListSalesQueryKey({}) });
    } catch {
      toast({ title: "Failed to log sale", variant: "destructive" });
    }
  };

  const writerList = Array.isArray(writers) ? writers : [];
  const clearFilter = () => { setFilterAgentId(""); setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Sales Log</h1>
        <Button size="sm" onClick={() => setOpen(true)}>Log Sale</Button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Agent</Label>
          <Select value={filterAgentId || "_all"} onValueChange={v => { setFilterAgentId(v === "_all" ? "" : v); setFilterWriterId(""); }}>
            <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All agents</SelectItem>
              {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Writer</Label>
          <Select value={filterWriterId || "_all"} onValueChange={v => setFilterWriterId(v === "_all" ? "" : v)} disabled={!filterAgentId}>
            <SelectTrigger className="h-8 text-sm w-44"><SelectValue placeholder="All writers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All writers</SelectItem>
              {filterWriterList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-8 text-sm w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-8 text-sm w-36" />
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={clearFilter}>Clear</Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Writer</TableHead>
              <TableHead>Game Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : !Array.isArray(sales) || sales.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No sales found.</TableCell></TableRow>
            ) : sales.map(s => {
              const writer = writerMap[s.writerId];
              return (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">{s.saleDate?.split("T")[0]}</TableCell>
                  <TableCell className="text-sm">
                    <span className="font-mono">{writer?.fullCode ?? s.writerId.slice(0, 8) + "…"}</span>
                    {writer && <span className="text-muted-foreground ml-1.5 text-xs">{writer.fullName}</span>}
                  </TableCell>
                  <TableCell className="text-sm">{s.gameType}</TableCell>
                  <TableCell className="text-sm text-right font-mono">GH₵ {Number(s.ticketAmount).toFixed(2)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={open => { if (!open) { setSelectedAgent(""); setForm(f => ({ ...f, writerId: "" })); } setOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Sale</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Agent</Label>
              <Select value={selectedAgent} onValueChange={v => { setSelectedAgent(v); setForm(f => ({ ...f, writerId: "" })); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select agent..." /></SelectTrigger>
                <SelectContent>{agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Writer</Label>
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))} disabled={!selectedAgent}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select writer..." /></SelectTrigger>
                <SelectContent>{writerList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Game Type</Label><Input value={form.gameType} onChange={e => setForm(f => ({ ...f, gameType: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. Pick 3" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Amount</Label><Input type="number" step="0.01" min="0" value={form.ticketAmount} onChange={e => setForm(f => ({ ...f, ticketAmount: e.target.value }))} required className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Date</Label><Input type="date" value={form.saleDate} onChange={e => setForm(f => ({ ...f, saleDate: e.target.value }))} required className="h-9 text-sm" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending || !form.writerId}>Log</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
