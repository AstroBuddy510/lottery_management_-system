import { useState } from "react";
import {
  useListGrossEntries, useCreateGrossEntry, useUpdateGrossEntry, useConfirmLateGrossEntry,
  useListWinsEntries, useCreateWinsEntry, useUpdateWinsEntry,
  useListWriters, getListGrossEntriesQueryKey, getListWinsEntriesQueryKey, getListWritersQueryKey,
  GrossEntry, WinsEntry, useGetSettings, ListGrossEntriesParams, ListWinsEntriesParams,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

function GrossTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { writerMap, agentList } = useWriterLookup();

  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const { data: filterWriters } = useListWriters(filterAgentId, {}, {
    query: { queryKey: getListWritersQueryKey(filterAgentId, {}), enabled: !!filterAgentId },
  });
  const filterWriterList = Array.isArray(filterWriters) ? filterWriters : [];

  const grossParams: ListGrossEntriesParams = {
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  };
  const { data: entries, isLoading } = useListGrossEntries(grossParams, {
    query: { queryKey: getListGrossEntriesQueryKey(grossParams), refetchInterval: 30_000 },
  });

  const [selectedAgent, setSelectedAgent] = useState("");
  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent },
  });
  const writerList = Array.isArray(writers) ? writers : [];

  const createMutation = useCreateGrossEntry();
  const updateMutation = useUpdateGrossEntry();
  const confirmMutation = useConfirmLateGrossEntry();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<GrossEntry | null>(null);
  const [form, setForm] = useState({ writerId: "", entryDate: new Date().toISOString().split("T")[0], grossAmount: "" });
  const [editForm, setEditForm] = useState({ grossAmount: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/entries/gross"] });

  const handleConfirmLate = async (id: string) => {
    if (!confirm("Are you sure you want to confirm this late gross entry for inclusion in calculations?")) return;
    try {
      await confirmMutation.mutateAsync({ id });
      toast({ title: "Late entry confirmed" });
      invalidate();
    } catch (err: any) {
      toast({ title: err?.data?.error ?? "Failed to confirm entry", variant: "destructive" });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, entryDate: form.entryDate, grossAmount: form.grossAmount } });
      toast({ title: "Entry created" });
      setCreateOpen(false);
      setForm({ writerId: "", entryDate: new Date().toISOString().split("T")[0], grossAmount: "" });
      setSelectedAgent("");
      invalidate();
    } catch (err: any) {
      toast({ title: err?.data?.error ?? "Failed to create entry", variant: "destructive" });
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
      toast({ title: err?.data?.error ?? "Failed to update entry", variant: "destructive" });
    }
  };

  const clearFilter = () => { setFilterAgentId(""); setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); };

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Record and manage gross sales entries per writer</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>Add Entry</Button>
      </div>

      <div className="bg-muted/30 border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter Entries</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={clearFilter}>Clear filters</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant={entry.locked ? "secondary" : "default"} className="text-xs w-fit">{entry.locked ? "Locked" : "Open"}</Badge>
                      {entry.isLate && (
                        <Badge variant={entry.adminConfirmed ? "secondary" : "destructive"} className={`text-xs w-fit ${entry.adminConfirmed ? "bg-emerald-100 text-emerald-800 border-emerald-200" : ""}`}>
                          {entry.adminConfirmed ? "Late (Confirmed)" : "Late (Pending)"}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {!entry.locked && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditEntry(entry); setEditForm({ grossAmount: entry.grossAmount }); }}>Edit</Button>
                      )}
                      {entry.isLate && !entry.adminConfirmed && (
                        <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200 font-bold" onClick={() => handleConfirmLate(entry.id)}>Confirm</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={open => { if (!open) { setSelectedAgent(""); setForm(f => ({ ...f, writerId: "" })); } setCreateOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Gross Entry</DialogTitle></DialogHeader>
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

      <Dialog open={!!editEntry} onOpenChange={open => !open && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Gross Entry</DialogTitle></DialogHeader>
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

function WinsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { writerMap, agentList } = useWriterLookup();

  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const { data: filterWriters } = useListWriters(filterAgentId, {}, {
    query: { queryKey: getListWritersQueryKey(filterAgentId, {}), enabled: !!filterAgentId },
  });
  const filterWriterList = Array.isArray(filterWriters) ? filterWriters : [];

  const winsParams: ListWinsEntriesParams = {
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  };
  const { data: entries, isLoading } = useListWinsEntries(winsParams, {
    query: { queryKey: getListWinsEntriesQueryKey(winsParams), refetchInterval: 30_000 },
  });

  const [selectedAgent, setSelectedAgent] = useState("");
  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent },
  });
  const writerList = Array.isArray(writers) ? writers : [];

  const createMutation = useCreateWinsEntry();
  const updateMutation = useUpdateWinsEntry();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<WinsEntry | null>(null);
  const [form, setForm] = useState({ writerId: "", entryDate: new Date().toISOString().split("T")[0], winsAmount: "" });
  const [editForm, setEditForm] = useState({ winsAmount: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/entries/wins"] });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, entryDate: form.entryDate, winsAmount: form.winsAmount } });
      toast({ title: "Entry created" });
      setCreateOpen(false);
      setForm({ writerId: "", entryDate: new Date().toISOString().split("T")[0], winsAmount: "" });
      setSelectedAgent("");
      invalidate();
    } catch (err: any) {
      toast({ title: err?.data?.error ?? "Failed to create entry", variant: "destructive" });
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
      toast({ title: err?.data?.error ?? "Failed to update entry", variant: "destructive" });
    }
  };

  const clearFilter = () => { setFilterAgentId(""); setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); };

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Record and manage wins payouts per writer</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>Add Entry</Button>
      </div>

      <div className="bg-muted/30 border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter Entries</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={clearFilter}>Clear filters</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              <TableHead className="text-right">Wins Amount</TableHead>
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
                  <TableCell className="text-sm text-right font-mono">GH₵ {Number(entry.winsAmount).toFixed(2)}</TableCell>
                  <TableCell className="text-sm tabular-nums pl-8">
                    {ts ? ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                  </TableCell>
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

      <Dialog open={createOpen} onOpenChange={open => { if (!open) { setSelectedAgent(""); setForm(f => ({ ...f, writerId: "" })); } setCreateOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Wins Entry</DialogTitle></DialogHeader>
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

      <Dialog open={!!editEntry} onOpenChange={open => !open && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Wins Entry</DialogTitle></DialogHeader>
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

function SummaryTab() {
  const { writerMap, agentList, allWriters } = useWriterLookup();
  const { data: settings } = useGetSettings();

  const [summaryFrom, setSummaryFrom] = useState("");
  const [summaryTo, setSummaryTo] = useState("");
  const [summaryAgentId, setSummaryAgentId] = useState("");

  const { data: grossEntries, isLoading: loadingGross } = useListGrossEntries({
    dateFrom: summaryFrom || undefined,
    dateTo: summaryTo || undefined,
  });

  const { data: winsEntries, isLoading: loadingWins } = useListWinsEntries({
    dateFrom: summaryFrom || undefined,
    dateTo: summaryTo || undefined,
  });

  const writerCommissionPct = Number(settings?.writerCommissionPct ?? 0);
  const reservePct = Number(settings?.reservePct ?? 0);

  const grossMap: Record<string, number> = {};
  if (Array.isArray(grossEntries)) {
    grossEntries.forEach(e => { grossMap[e.writerId] = (grossMap[e.writerId] ?? 0) + Number(e.grossAmount); });
  }
  const winsMap: Record<string, number> = {};
  if (Array.isArray(winsEntries)) {
    winsEntries.forEach(e => { winsMap[e.writerId] = (winsMap[e.writerId] ?? 0) + Number(e.winsAmount); });
  }

  const allWriterIds = Array.from(new Set([...Object.keys(grossMap), ...Object.keys(winsMap)]));

  const agentWriterIds = summaryAgentId
    ? allWriters.filter(w => w.agentId === summaryAgentId).map(w => w.id)
    : null;
  const filteredWriterIds = agentWriterIds
    ? allWriterIds.filter(id => agentWriterIds.includes(id))
    : allWriterIds;

  type SummaryRow = {
    writerId: string;
    gross: number;
    wins: number;
    commission: number;
    netGross: number;
    reserve: number;
    balance: number;
  };

  const rows: SummaryRow[] = filteredWriterIds.map(writerId => {
    const gross = grossMap[writerId] ?? 0;
    const wins = winsMap[writerId] ?? 0;
    const commission = gross * writerCommissionPct;
    const netGross = gross - commission;
    const reserve = netGross * reservePct;
    const balance = netGross - wins - reserve;
    return { writerId, gross, wins, commission, netGross, reserve, balance };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.gross,
      wins: acc.wins + r.wins,
      commission: acc.commission + r.commission,
      netGross: acc.netGross + r.netGross,
      reserve: acc.reserve + r.reserve,
      balance: acc.balance + r.balance,
    }),
    { gross: 0, wins: 0, commission: 0, netGross: 0, reserve: 0, balance: 0 },
  );

  const isLoading = loadingGross || loadingWins;

  const fmt = (n: number) => `GH₵ ${n.toFixed(2)}`;

  return (
    <div className="space-y-4 pt-4">
      <div className="bg-muted/30 border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter Summary</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Rates in use: writer commission {(writerCommissionPct * 100).toFixed(2)}% · reserve {(reservePct * 100).toFixed(2)}%
            </p>
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => { setSummaryFrom(""); setSummaryTo(""); setSummaryAgentId(""); }}>Clear filters</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
            <Select value={summaryAgentId || "_all"} onValueChange={v => setSummaryAgentId(v === "_all" ? "" : v)}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All agents</SelectItem>
                {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">From</Label>
            <Input type="date" value={summaryFrom} onChange={e => setSummaryFrom(e.target.value)} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">To</Label>
            <Input type="date" value={summaryTo} onChange={e => setSummaryTo(e.target.value)} className="h-9 text-sm bg-background" />
          </div>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Writer</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Wins</TableHead>
              <TableHead className="text-right">Commission</TableHead>
              <TableHead className="text-right">Net Gross</TableHead>
              <TableHead className="text-right">Reserve</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">No data for the selected filters.</TableCell></TableRow>
            ) : (
              <>
                {rows.map(row => {
                  const writer = writerMap[row.writerId];
                  return (
                    <TableRow key={row.writerId}>
                      <TableCell className="text-sm">
                        <span className="font-mono">{writer?.fullCode ?? row.writerId.slice(0, 8) + "…"}</span>
                        {writer && <span className="text-muted-foreground ml-1.5 text-xs">{writer.fullName}</span>}
                      </TableCell>
                      <TableCell className="text-sm text-right font-mono">{fmt(row.gross)}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{fmt(row.wins)}</TableCell>
                      <TableCell className="text-sm text-right font-mono text-amber-600">{fmt(row.commission)}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{fmt(row.netGross)}</TableCell>
                      <TableCell className="text-sm text-right font-mono text-violet-600">{fmt(row.reserve)}</TableCell>
                      <TableCell className={`text-sm text-right font-mono font-semibold ${row.balance < 0 ? "text-destructive" : "text-emerald-600"}`}>
                        {fmt(row.balance)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/50 border-t-2">
                  <TableCell className="text-sm font-bold">Total</TableCell>
                  <TableCell className="text-sm text-right font-mono font-bold">{fmt(totals.gross)}</TableCell>
                  <TableCell className="text-sm text-right font-mono font-bold">{fmt(totals.wins)}</TableCell>
                  <TableCell className="text-sm text-right font-mono font-bold text-amber-600">{fmt(totals.commission)}</TableCell>
                  <TableCell className="text-sm text-right font-mono font-bold">{fmt(totals.netGross)}</TableCell>
                  <TableCell className="text-sm text-right font-mono font-bold text-violet-600">{fmt(totals.reserve)}</TableCell>
                  <TableCell className={`text-sm text-right font-mono font-bold ${totals.balance < 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {fmt(totals.balance)}
                  </TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function GrossWins() {
  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Gross & Wins</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Unified view of gross entries, wins entries, and per-writer summary</p>
      </div>

      <Tabs defaultValue="gross">
        <TabsList>
          <TabsTrigger value="gross">Gross Entries</TabsTrigger>
          <TabsTrigger value="wins">Wins Entries</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="gross"><GrossTab /></TabsContent>
        <TabsContent value="wins"><WinsTab /></TabsContent>
        <TabsContent value="summary"><SummaryTab /></TabsContent>
      </Tabs>
    </div>
  );
}
