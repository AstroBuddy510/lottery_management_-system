import { useState, useEffect } from "react";
import {
  useListWinsEntries, useCreateWinsEntry, useUpdateWinsEntry,
  useListWriters, getListWinsEntriesQueryKey, getListWritersQueryKey,
  useGetMyAgent, getGetMyAgentQueryKey, WinsEntry,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useAuth } from "@/lib/auth";
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
  const { user } = useAuth();
  const isAgent = user?.role === "agent";

  const { writerMap, agentList } = useWriterLookup();

  // For agent role: load their own agent record to pre-select
  const { data: myAgent } = useGetMyAgent({
    query: { queryKey: getGetMyAgentQueryKey(), enabled: isAgent }
  });

  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Auto-set filter agent for agent role
  useEffect(() => {
    if (isAgent && myAgent?.id) setFilterAgentId(myAgent.id);
  }, [isAgent, myAgent?.id]);

  const { data: filterWriters } = useListWriters(filterAgentId, {}, {
    query: { queryKey: getListWritersQueryKey(filterAgentId, {}), enabled: !!filterAgentId }
  });
  const filterWriterList = Array.isArray(filterWriters) ? filterWriters : [];

  const { data: entries, isLoading } = useListWinsEntries({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });

  // For create dialog: agent is pre-selected for agent role
  const [selectedAgent, setSelectedAgent] = useState("");
  useEffect(() => {
    if (isAgent && myAgent?.id) setSelectedAgent(myAgent.id);
  }, [isAgent, myAgent?.id]);

  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent }
  });
  const writerList = Array.isArray(writers) ? writers : [];

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
      if (!isAgent) setSelectedAgent("");
      invalidate();
    } catch (err: any) {
      const msg = err?.data?.error ?? "Failed to create entry";
      toast({ title: msg, variant: "destructive" });
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
    } catch (err: any) {
      const msg = err?.data?.error ?? "Failed to update entry";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const clearFilter = () => {
    if (!isAgent) setFilterAgentId("");
    setFilterWriterId("");
    setFilterFrom("");
    setFilterTo("");
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Wins Entries</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>Add Entry</Button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap items-end">
        {!isAgent && (
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
        )}
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
            ) : entries.map(entry => {
              const writer = writerMap[entry.writerId];
              return (
                <TableRow key={entry.id} className={entry.locked ? "opacity-60" : ""}>
                  <TableCell className="text-sm">{entry.entryDate?.split("T")[0]}</TableCell>
                  <TableCell className="text-sm">
                    <span className="font-mono">{writer?.fullCode ?? entry.writerId.slice(0, 8) + "…"}</span>
                    {writer && <span className="text-muted-foreground ml-1.5 text-xs">{writer.fullName}</span>}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono">GH₵ {Number(entry.winsAmount).toFixed(2)}</TableCell>
                  <TableCell><Badge variant={entry.locked ? "secondary" : "default"} className="text-xs">{entry.locked ? "Locked" : "Open"}</Badge></TableCell>
                  <TableCell>
                    {!entry.locked && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditEntry(entry); setEditForm({ winsAmount: entry.winsAmount }); }}>Edit</Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={open => {
        if (!open) {
          if (!isAgent) setSelectedAgent("");
          setForm(f => ({ ...f, writerId: "" }));
        }
        setCreateOpen(open);
      }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Wins Entry</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            {!isAgent && (
              <div className="space-y-1.5">
                <Label className="text-xs">Agent</Label>
                <Select value={selectedAgent} onValueChange={v => { setSelectedAgent(v); setForm(f => ({ ...f, writerId: "" })); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select agent..." /></SelectTrigger>
                  <SelectContent>{agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {isAgent && myAgent && (
              <div className="flex items-center gap-2 py-1 px-3 bg-muted/40 rounded-md border">
                <span className="text-xs text-muted-foreground">Agent:</span>
                <span className="text-sm font-mono font-semibold">{myAgent.fullCode}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Writer</Label>
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))} disabled={!selectedAgent}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select writer..." /></SelectTrigger>
                <SelectContent>{writerList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={form.entryDate} onChange={e => setForm(f => ({ ...f, entryDate: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Wins Amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={form.winsAmount} onChange={e => setForm(f => ({ ...f, winsAmount: e.target.value }))} required className="h-9 text-sm" placeholder="0.00" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending || !form.writerId}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editEntry} onOpenChange={open => !open && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Entry</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            {editEntry && (
              <div className="text-sm text-muted-foreground">
                Writer: <span className="text-foreground font-mono font-medium">{writerMap[editEntry.writerId]?.fullCode ?? editEntry.writerId}</span>
                {" · "}Date: <span className="text-foreground">{editEntry.entryDate?.split("T")[0]}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Wins Amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={editForm.winsAmount} onChange={e => setEditForm({ winsAmount: e.target.value })} required className="h-9 text-sm" />
            </div>
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
