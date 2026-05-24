import { useState, useMemo } from "react";
import {
  useListWinsEntries, useCreateWinsEntry, useUpdateWinsEntry,
  useListWriters, getListWinsEntriesQueryKey, getListWritersQueryKey,
  useGetMyAgent, getGetMyAgentQueryKey, WinsEntry,
  useCreateEntryChangeRequest, getListEntryChangeRequestsQueryKey,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { fmtGHS } from "@/lib/utils";

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function relDate(s: string) {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const d = s.split("T")[0];
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function AgentWinsView() {
  const qc = useQueryClient();
  const { data: myAgent } = useGetMyAgent({ query: { queryKey: getGetMyAgentQueryKey() } });

  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<WinsEntry | null>(null);

  const { data: writers } = useListWriters(myAgent?.id ?? "", {}, {
    query: { queryKey: getListWritersQueryKey(myAgent?.id ?? "", {}), enabled: !!myAgent?.id }
  });
  const writerList = Array.isArray(writers) ? writers : [];

  const { data: entries, isLoading } = useListWinsEntries({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });
  const entryList = Array.isArray(entries) ? entries : [];

  const today = new Date().toISOString().split("T")[0];
  const todayTotal = entryList.filter(e => e.entryDate?.startsWith(today)).reduce((s, e) => s + Number(e.winsAmount ?? 0), 0);

  const createMutation = useCreateWinsEntry();
  const updateMutation = useUpdateWinsEntry();
  const changeRequestMutation = useCreateEntryChangeRequest();
  const [form, setForm] = useState({ writerId: "", entryDate: today, winsAmount: "" });
  const [editForm, setEditForm] = useState({ winsAmount: "" });
  const [changeReqEntry, setChangeReqEntry] = useState<WinsEntry | null>(null);
  const [changeReqForm, setChangeReqForm] = useState({ requestedAmount: "", reason: "" });

  // Fetch all wins entries for the selected date to verify which writers have already been entered
  const { data: dateEntries } = useListWinsEntries({
    dateFrom: form.entryDate,
    dateTo: form.entryDate,
  }, {
    query: {
      queryKey: ["winsEntriesForDate", form.entryDate],
      enabled: !!form.entryDate,
    }
  });

  const usedWriterIds = useMemo(() => {
    if (!dateEntries) return new Set<string>();
    return new Set(dateEntries.map(e => e.writerId));
  }, [dateEntries]);

  const availableWriters = useMemo(() => {
    return writerList.filter(w => !usedWriterIds.has(w.id));
  }, [writerList, usedWriterIds]);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWinsEntriesQueryKey({}) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, entryDate: form.entryDate, winsAmount: form.winsAmount } });
      toast.success("Wins entry created");
      setCreateOpen(false);
      setForm({ writerId: "", entryDate: today, winsAmount: "" });
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to create entry");
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEntry) return;
    try {
      await updateMutation.mutateAsync({ id: editEntry.id, data: { winsAmount: editForm.winsAmount } });
      toast.success("Entry updated");
      setEditEntry(null);
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to update entry");
    }
  };

  const handleChangeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeReqEntry) return;
    try {
      await changeRequestMutation.mutateAsync({
        data: {
          entryType: "wins",
          entryId: changeReqEntry.id,
          requestedAmount: changeReqForm.requestedAmount,
          reason: changeReqForm.reason,
        },
      });
      toast.success("Change request submitted");
      setChangeReqEntry(null);
      setChangeReqForm({ requestedAmount: "", reason: "" });
      qc.invalidateQueries({ queryKey: getListEntryChangeRequestsQueryKey({}) });
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to submit change request");
    }
  };

  const hasFilter = !!(filterWriterId || filterFrom || filterTo);
  const clearFilter = () => { setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); };

  return (
    <div className="pb-4">
      {/* Sticky header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div className="flex items-center gap-3 max-w-xl mx-auto md:max-w-2xl">
          <div className="flex-1">
            <h1 className="text-base font-semibold">Wins Entries</h1>
            <p className="text-xs text-muted-foreground">{entryList.length} entries</p>
          </div>
          <button
            onClick={() => setShowFilter(f => !f)}
            className={`p-2 rounded-xl transition-colors active:scale-95 ${showFilter || hasFilter ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            <FilterIcon />
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 bg-amber-600 text-white px-3 py-2 rounded-xl text-sm font-semibold active:scale-95 transition-transform shadow-sm"
          >
            <PlusIcon /> Add
          </button>
        </div>
      </div>

      <div className="px-4 max-w-xl mx-auto md:max-w-2xl">
        {/* Filter */}
        {showFilter && (
          <div className="mt-3 bg-muted/30 border border-border rounded-2xl p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Writer</Label>
              <Select value={filterWriterId || "_all"} onValueChange={v => setFilterWriterId(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-11 text-sm bg-background rounded-xl"><SelectValue placeholder="All writers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All writers</SelectItem>
                  {writerList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">From</Label>
                <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-11 text-sm bg-background rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">To</Label>
                <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-11 text-sm bg-background rounded-xl" />
              </div>
            </div>
            {hasFilter && <button onClick={clearFilter} className="text-xs text-primary font-medium active:opacity-70">Clear filters</button>}
          </div>
        )}

        {/* Today summary */}
        {!hasFilter && (
          <div className="mt-4 flex items-center gap-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl px-4 py-3">
            <div className="flex-1">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-300">Today's Wins</div>
              <div className="text-lg font-bold text-amber-900 dark:text-amber-100 tabular-nums">{todayTotal > 0 ? fmtGHS(todayTotal) : "—"}</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-300">All-time</div>
              <div className="text-sm font-bold text-amber-900 dark:text-amber-100 tabular-nums">
                {fmtGHS(entryList.reduce((s, e) => s + Number(e.winsAmount ?? 0), 0))}
              </div>
            </div>
          </div>
        )}

        {/* Entry cards */}
        <div className="mt-4 space-y-2.5">
          {isLoading ? (
            [1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)
          ) : entryList.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <div className="text-4xl mb-3">🏆</div>
              <div className="font-medium text-sm">No wins entries yet</div>
              <div className="text-xs mt-1">Tap Add to record a wins entry</div>
            </div>
          ) : entryList.map(entry => {
            const writer = writerList.find(w => w.id === entry.writerId);
            return (
              <div key={entry.id} className={`bg-card border border-border rounded-2xl px-4 py-3.5 flex items-center gap-3 ${entry.locked ? "opacity-60" : ""}`}>
                <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center text-white flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                    <path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-semibold font-mono">{writer?.fullCode ?? entry.writerId.slice(0,8)}</span>
                    {writer && <span className="text-xs text-muted-foreground truncate hidden sm:inline">{writer.fullName}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{relDate(entry.entryDate ?? "")}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      entry.locked
                        ? "bg-muted text-muted-foreground"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                    }`}>
                      {entry.locked ? "Locked" : "Open"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-sm font-bold tabular-nums">{fmtGHS(Number(entry.winsAmount ?? 0))}</div>
                  </div>
                  {!entry.locked ? (
                    <button
                      onClick={() => { setEditEntry(entry); setEditForm({ winsAmount: entry.winsAmount }); }}
                      className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95"
                    >
                      <EditIcon />
                    </button>
                  ) : (
                    <button
                      onClick={() => { setChangeReqEntry(entry); setChangeReqForm({ requestedAmount: entry.winsAmount ?? "", reason: "" }); }}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300 transition-colors active:scale-95"
                    >
                      Request Change
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={o => { if (!o) setForm({ writerId: "", entryDate: today, winsAmount: "" }); setCreateOpen(o); }}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader><DialogTitle>Add Wins Entry</DialogTitle></DialogHeader>
          {myAgent && (
            <div className="flex items-center gap-2 py-1 px-3 bg-muted/40 rounded-xl border text-sm">
              <span className="text-muted-foreground text-xs">Agent:</span>
              <span className="font-mono font-semibold">{myAgent.fullCode}</span>
            </div>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Writer</Label>
                {usedWriterIds.size > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {usedWriterIds.size}/{writerList.length} entered
                  </span>
                )}
              </div>
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))} disabled={availableWriters.length === 0}>
                <SelectTrigger className="h-11 text-sm rounded-xl">
                  <SelectValue placeholder={availableWriters.length === 0 ? "All writers entered for this date" : "Select writer…"} />
                </SelectTrigger>
                <SelectContent>
                  {availableWriters.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Date</Label>
              <Input type="date" value={form.entryDate} onChange={e => setForm(f => ({ ...f, entryDate: e.target.value }))} required className="h-11 text-sm rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Wins Amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={form.winsAmount} onChange={e => setForm(f => ({ ...f, winsAmount: e.target.value }))} required className="h-11 text-sm rounded-xl" placeholder="0.00" inputMode="decimal" />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1 h-11 rounded-xl font-semibold bg-amber-600 hover:bg-amber-700" disabled={createMutation.isPending || !form.writerId}>
                {createMutation.isPending ? "Saving…" : "Add Entry"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editEntry} onOpenChange={o => !o && setEditEntry(null)}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader><DialogTitle>Edit Entry</DialogTitle></DialogHeader>
          {editEntry && (
            <div className="text-sm text-muted-foreground">
              Writer: <span className="text-foreground font-mono font-medium">{writerList.find(w => w.id === editEntry.writerId)?.fullCode ?? editEntry.writerId}</span>
              {" · "}Date: <span className="text-foreground">{relDate(editEntry.entryDate ?? "")}</span>
            </div>
          )}
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Wins Amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={editForm.winsAmount} onChange={e => setEditForm({ winsAmount: e.target.value })} required className="h-11 text-sm rounded-xl" inputMode="decimal" />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setEditEntry(null)}>Cancel</Button>
              <Button type="submit" className="flex-1 h-11 rounded-xl font-semibold" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change Request dialog */}
      <Dialog open={!!changeReqEntry} onOpenChange={o => { if (!o) { setChangeReqEntry(null); setChangeReqForm({ requestedAmount: "", reason: "" }); } }}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader><DialogTitle>Request Entry Change</DialogTitle></DialogHeader>
          {changeReqEntry && (
            <div className="bg-muted/50 rounded-xl p-3 text-sm space-y-1 mb-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Writer</span>
                <span className="font-mono font-semibold">{writerList.find(w => w.id === changeReqEntry.writerId)?.fullCode ?? changeReqEntry.writerId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span>{relDate(changeReqEntry.entryDate ?? "")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current amount</span>
                <span className="tabular-nums font-semibold">{fmtGHS(Number(changeReqEntry.winsAmount ?? 0))}</span>
              </div>
            </div>
          )}
          <form onSubmit={handleChangeRequest} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Requested Amount (GH₵)</Label>
              <Input
                type="number" step="0.01" min="0"
                value={changeReqForm.requestedAmount}
                onChange={e => setChangeReqForm(f => ({ ...f, requestedAmount: e.target.value }))}
                required className="h-11 text-sm rounded-xl" inputMode="decimal"
                placeholder="New amount…"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Reason <span className="text-muted-foreground">(required)</span></Label>
              <Textarea
                value={changeReqForm.reason}
                onChange={e => setChangeReqForm(f => ({ ...f, reason: e.target.value }))}
                required minLength={5}
                placeholder="Explain why the entry amount should be changed…"
                className="resize-none text-sm h-20 rounded-xl"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => { setChangeReqEntry(null); setChangeReqForm({ requestedAmount: "", reason: "" }); }}>Cancel</Button>
              <Button type="submit" className="flex-1 h-11 rounded-xl font-semibold bg-amber-600 hover:bg-amber-700" disabled={changeRequestMutation.isPending}>
                {changeRequestMutation.isPending ? "Submitting…" : "Submit Request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminWinsView() {
  const qc = useQueryClient();
  const { writerMap, agentList } = useWriterLookup();

  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const { data: filterWriters } = useListWriters(filterAgentId, {}, {
    query: { queryKey: getListWritersQueryKey(filterAgentId, {}), enabled: !!filterAgentId }
  });
  const filterWriterList = Array.isArray(filterWriters) ? filterWriters : [];

  const { data: entries, isLoading } = useListWinsEntries({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });

  const [selectedAgent, setSelectedAgent] = useState("");
  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent }
  });
  const writerList = Array.isArray(writers) ? writers : [];

  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ writerId: "", entryDate: today, winsAmount: "" });

  // Fetch all wins entries for the selected date to verify which writers have already been entered
  const { data: dateEntries } = useListWinsEntries({
    dateFrom: form.entryDate,
    dateTo: form.entryDate,
  }, {
    query: {
      queryKey: ["winsEntriesForDate", form.entryDate],
      enabled: !!form.entryDate,
    }
  });

  const usedWriterIds = useMemo(() => {
    if (!dateEntries) return new Set<string>();
    return new Set(dateEntries.map(e => e.writerId));
  }, [dateEntries]);

  const availableWriters = useMemo(() => {
    return writerList.filter(w => !usedWriterIds.has(w.id));
  }, [writerList, usedWriterIds]);

  const createMutation = useCreateWinsEntry();
  const updateMutation = useUpdateWinsEntry();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<WinsEntry | null>(null);
  const [editForm, setEditForm] = useState({ winsAmount: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWinsEntriesQueryKey({}) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, entryDate: form.entryDate, winsAmount: form.winsAmount } });
      toast.success("Entry created");
      setCreateOpen(false);
      setSelectedAgent("");
      setForm({ writerId: "", entryDate: today, winsAmount: "" });
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to create entry");
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEntry) return;
    try {
      await updateMutation.mutateAsync({ id: editEntry.id, data: { winsAmount: editForm.winsAmount } });
      toast.success("Entry updated");
      setEditEntry(null);
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to update entry");
    }
  };

  const clearFilter = () => { setFilterAgentId(""); setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold">Wins Entries</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Record and manage wins payouts per writer</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>Add Entry</Button>
      </div>

      <div className="bg-muted/30 border rounded-xl p-4 mb-5">
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
              <TableHead>Entry Date</TableHead><TableHead>Writer</TableHead>
              <TableHead className="text-right">Wins Amount</TableHead>
              <TableHead className="pl-8">Recorded At</TableHead>
              <TableHead>Status</TableHead><TableHead className="w-24">Action</TableHead>
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

      <Dialog open={createOpen} onOpenChange={o => { if (!o) { setSelectedAgent(""); setForm(f => ({ ...f, writerId: "" })); } setCreateOpen(o); }}>
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
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))} disabled={!selectedAgent || availableWriters.length === 0}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={!selectedAgent ? "Select agent..." : availableWriters.length === 0 ? "All writers entered for this date" : "Select writer..."} />
                </SelectTrigger>
                <SelectContent>
                  {availableWriters.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
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

      <Dialog open={!!editEntry} onOpenChange={o => !o && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Entry</DialogTitle></DialogHeader>
          {editEntry && (
            <div className="text-sm text-muted-foreground">
              Writer: <span className="text-foreground font-mono font-medium">{writerMap[editEntry.writerId]?.fullCode ?? editEntry.writerId}</span>
              {" · "}Date: <span className="text-foreground">{editEntry.entryDate?.split("T")[0]}</span>
            </div>
          )}
          <form onSubmit={handleEdit} className="space-y-4">
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

export function WinsEntries() {
  const { user } = useAuth();
  if (user?.role === "agent") return <AgentWinsView />;
  return <AdminWinsView />;
}
