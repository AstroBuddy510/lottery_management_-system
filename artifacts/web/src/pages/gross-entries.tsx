import { useState, useEffect } from "react";
import {
  useListGrossEntries, useCreateGrossEntry, useUpdateGrossEntry,
  useListWriters, getListGrossEntriesQueryKey, getListWritersQueryKey,
  useGetMyAgent, getGetMyAgentQueryKey, GrossEntry,
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

export function GrossEntries() {
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

  const { data: entries, isLoading } = useListGrossEntries({
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

  const createMutation = useCreateGrossEntry();
  const updateMutation = useUpdateGrossEntry();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<GrossEntry | null>(null);
  const [form, setForm] = useState({ writerId: "", entryDate: new Date().toISOString().split("T")[0], grossAmount: "" });
  const [editForm, setEditForm] = useState({ grossAmount: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListGrossEntriesQueryKey({}) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, entryDate: form.entryDate, grossAmount: form.grossAmount } });
      toast({ title: "Entry created" });
      setCreateOpen(false);
      setForm({ writerId: "", entryDate: new Date().toISOString().split("T")[0], grossAmount: "" });
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
      await updateMutation.mutateAsync({ id: editEntry.id, data: { grossAmount: editForm.grossAmount } });
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
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold">Gross Entries</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Record and manage gross sales entries per writer</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>Add Entry</Button>
      </div>

      <div className="bg-muted/30 border rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter Entries</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={clearFilter}>Clear filters</Button>
        </div>
        <div className={`grid gap-3 ${isAgent ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
          {!isAgent && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
              <Select value={filterAgentId || "_all"} onValueChange={v => { setFilterAgentId(v === "_all" ? "" : v); setFilterWriterId(""); }}>
                <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All agents</SelectItem>
                  {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Writer</Label>
            <Select value={filterWriterId || "_all"} onValueChange={v => setFilterWriterId(v === "_all" ? "" : v)} disabled={!filterAgentId}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="All writers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All writers</SelectItem>
                {filterWriterList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
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
              <TableHead>Entry Date</TableHead>
              <TableHead>Writer</TableHead>
              <TableHead className="text-right">Gross Amount</TableHead>
              <TableHead className="pl-8">Recorded At</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : !Array.isArray(entries) || entries.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No entries found.</TableCell></TableRow>
            ) : entries.map(entry => {
              const writer = writerMap[entry.writerId];
              const ts = entry.createdAt ? new Date(entry.createdAt) : null;
              return (
                <TableRow key={entry.id} className={entry.locked ? "opacity-60" : ""}>
                  <TableCell className="text-sm">{entry.entryDate?.split("T")[0]}</TableCell>
                  <TableCell className="text-sm">
                    <span className="font-mono">{writer?.fullCode ?? entry.writerId.slice(0, 8) + "…"}</span>
                    {writer && <span className="text-muted-foreground ml-1.5 text-xs">{writer.fullName}</span>}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono">GH₵ {Number(entry.grossAmount).toFixed(2)}</TableCell>
                  <TableCell className="text-sm tabular-nums pl-8">
                    {ts ? ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                  </TableCell>
                  <TableCell><Badge variant={entry.locked ? "secondary" : "default"} className="text-xs">{entry.locked ? "Locked" : "Open"}</Badge></TableCell>
                  <TableCell>
                    {!entry.locked && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditEntry(entry); setEditForm({ grossAmount: entry.grossAmount }); }}>Edit</Button>
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
          <DialogHeader><DialogTitle>Add Gross Entry</DialogTitle></DialogHeader>
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
              <Label className="text-xs">Gross Amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={form.grossAmount} onChange={e => setForm(f => ({ ...f, grossAmount: e.target.value }))} required className="h-9 text-sm" placeholder="0.00" />
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
              <Label className="text-xs">Gross Amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={editForm.grossAmount} onChange={e => setEditForm({ grossAmount: e.target.value })} required className="h-9 text-sm" />
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
