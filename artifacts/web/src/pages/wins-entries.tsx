import { useState } from "react";
import {
  useListWinsEntries, useCreateWinsEntry, useUpdateWinsEntry,
  useListAgents, useListWriters, getListWinsEntriesQueryKey, getListWritersQueryKey, WinsEntry,
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

export function WinsEntries() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const { data: entries, isLoading } = useListWinsEntries({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });

  const { data: agents } = useListAgents({});
  const [selectedAgent, setSelectedAgent] = useState("");
  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent }
  });

  const createMutation = useCreateWinsEntry();
  const updateMutation = useUpdateWinsEntry();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<WinsEntry | null>(null);
  const [form, setForm] = useState({ writerId: "", entryDate: new Date().toISOString().split("T")[0], winsAmount: "" });
  const [editForm, setEditForm] = useState({ winsAmount: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWinsEntriesQueryKey({}) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, entryDate: form.entryDate, winsAmount: form.winsAmount } });
      toast({ title: "Entry created" });
      setCreateOpen(false);
      setForm({ writerId: "", entryDate: new Date().toISOString().split("T")[0], winsAmount: "" });
      invalidate();
    } catch {
      toast({ title: "Failed to create entry", variant: "destructive" });
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEntry) return;
    try {
      await updateMutation.mutateAsync({ id: editEntry.id, data: { winsAmount: editForm.winsAmount } });
      toast({ title: "Entry updated" });
      setEditEntry(null);
      invalidate();
    } catch {
      toast({ title: "Failed to update entry", variant: "destructive" });
    }
  };

  const agentList = Array.isArray(agents) ? agents : [];
  const writerList = Array.isArray(writers) ? writers : [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Wins Entries</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>Add Entry</Button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-8 text-sm w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-8 text-sm w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Writer ID</Label>
          <Input value={filterWriterId} onChange={e => setFilterWriterId(e.target.value)} className="h-8 text-sm w-48" placeholder="Filter by writer" />
        </div>
        <div className="flex items-end">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); }}>Clear</Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Writer</TableHead>
              <TableHead className="text-right">Wins Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : !Array.isArray(entries) || entries.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No entries found.</TableCell></TableRow>
            ) : entries.map(entry => (
              <TableRow key={entry.id} className={entry.locked ? "opacity-60" : ""}>
                <TableCell className="text-sm">{entry.entryDate?.split("T")[0]}</TableCell>
                <TableCell className="text-sm font-mono">{entry.writerId}</TableCell>
                <TableCell className="text-sm text-right font-mono">${Number(entry.winsAmount).toFixed(2)}</TableCell>
                <TableCell><Badge variant={entry.locked ? "secondary" : "default"} className="text-xs">{entry.locked ? "Locked" : "Open"}</Badge></TableCell>
                <TableCell>
                  {!entry.locked && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditEntry(entry); setEditForm({ winsAmount: entry.winsAmount }); }}>Edit</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Wins Entry</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Agent</Label>
              <Select value={selectedAgent} onValueChange={v => { setSelectedAgent(v); setForm(f => ({ ...f, writerId: "" })); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select agent..." /></SelectTrigger>
                <SelectContent>{agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.fullCode}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Writer</Label>
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))} disabled={!selectedAgent}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select writer..." /></SelectTrigger>
                <SelectContent>{writerList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Date</Label><Input type="date" value={form.entryDate} onChange={e => setForm(f => ({ ...f, entryDate: e.target.value }))} required className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Wins Amount</Label><Input type="number" step="0.01" value={form.winsAmount} onChange={e => setForm(f => ({ ...f, winsAmount: e.target.value }))} required className="h-9 text-sm" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending || !form.writerId}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editEntry} onOpenChange={open => !open && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Entry</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5"><Label className="text-xs">Wins Amount</Label><Input type="number" step="0.01" value={editForm.winsAmount} onChange={e => setEditForm({ winsAmount: e.target.value })} required className="h-9 text-sm" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditEntry(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
