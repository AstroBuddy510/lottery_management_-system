import { useState, useMemo } from "react";
import { getServerNow } from "../lib/time-sync";
import {
  useListSales, useCreateSale, useListWriters,
  useGetMyAgent, getGetMyAgentQueryKey,
  getListSalesQueryKey, getListWritersQueryKey,
  useListGrossEntries, useListWinsEntries,
  useGetSettings,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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

function relDate(s: string) {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const d = s.split("T")[0];
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function AgentSalesView() {
  const qc = useQueryClient();
  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [open, setOpen] = useState(false);

  const { data: myAgent } = useGetMyAgent({ query: { queryKey: getGetMyAgentQueryKey() } });
  const { data: allWriters } = useListWriters(myAgent?.id ?? "", {}, {
    query: { queryKey: getListWritersQueryKey(myAgent?.id ?? "", {}), enabled: !!myAgent?.id }
  });
  const agentWriters = Array.isArray(allWriters) ? allWriters : [];

  const { data: sales, isLoading } = useListSales({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });
  const salesList = Array.isArray(sales) ? sales : [];

  const createMutation = useCreateSale();
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ writerId: "", gameType: "", ticketAmount: "", saleDate: today });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { writerId: form.writerId, gameType: form.gameType, ticketAmount: form.ticketAmount, saleDate: form.saleDate } });
      toast.success("Sale logged successfully");
      setOpen(false);
      setForm({ writerId: "", gameType: "", ticketAmount: "", saleDate: today });
      qc.invalidateQueries({ queryKey: getListSalesQueryKey({}) });
    } catch {
      toast.error("Failed to log sale");
    }
  };

  const hasFilter = !!(filterWriterId || filterFrom || filterTo);
  const clearFilter = () => { setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); };

  const todaySales = salesList.filter(s => s.saleDate?.startsWith(today));
  const totalAmount = salesList.reduce((s, sale) => s + Number(sale.ticketAmount ?? 0), 0);

  const { data: settings } = useGetSettings();
  const commPct = Number(settings?.commissionPct ?? 0);
  const resvPct = Number(settings?.reservePct ?? 0);

  const { data: grossEntries } = useListGrossEntries({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || today,
    dateTo: filterTo || today,
  });

  const { data: winsEntries } = useListWinsEntries({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || today,
    dateTo: filterTo || today,
  });

  const grossList = Array.isArray(grossEntries) ? grossEntries : [];
  const winsList = Array.isArray(winsEntries) ? winsEntries : [];

  const grossSum = useMemo(() => {
    return grossList.reduce((s, e) => s + Number(e.grossAmount ?? 0), 0);
  }, [grossList]);

  const winsSum = useMemo(() => {
    return winsList.reduce((s, e) => s + Number(e.winsAmount ?? 0), 0);
  }, [winsList]);

  const commissionSum = useMemo(() => {
    return grossSum * commPct;
  }, [grossSum, commPct]);

  const netGrossSum = useMemo(() => {
    return grossSum - commissionSum;
  }, [grossSum, commissionSum]);

  const reserveSum = useMemo(() => {
    return netGrossSum * resvPct;
  }, [netGrossSum, resvPct]);

  const balanceSum = useMemo(() => {
    return netGrossSum - winsSum - reserveSum;
  }, [netGrossSum, winsSum, reserveSum]);

  const submittedWritersCount = useMemo(() => {
    return new Set(grossList.map(e => e.writerId)).size;
  }, [grossList]);

  const totalWritersCount = useMemo(() => {
    return agentWriters.filter(w => w.isActive).length;
  }, [agentWriters]);

  const submitPercentage = totalWritersCount > 0 ? (submittedWritersCount / totalWritersCount) * 100 : 0;

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div className="flex items-center gap-3 max-w-xl mx-auto md:max-w-2xl">
          <div className="flex-1">
            <h1 className="text-base font-semibold">Sales Log</h1>
            <p className="text-xs text-muted-foreground">{salesList.length} records · {fmtGHS(totalAmount)}</p>
          </div>
          <button
            onClick={() => setShowFilter(f => !f)}
            className={`p-2 rounded-xl transition-colors active:scale-95 ${showFilter || hasFilter ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            <FilterIcon />
          </button>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-xl text-sm font-semibold active:scale-95 transition-transform shadow-sm"
          >
            <PlusIcon /> Log
          </button>
        </div>
      </div>

      <div className="px-4 max-w-xl mx-auto md:max-w-2xl">
        {/* Filter panel */}
        {showFilter && (
          <div className="mt-3 bg-muted/30 border border-border rounded-2xl p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Writer</Label>
              <Select value={filterWriterId || "_all"} onValueChange={v => setFilterWriterId(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-11 text-sm bg-background rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All writers</SelectItem>
                  {agentWriters.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
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
            {hasFilter && (
              <button onClick={clearFilter} className="text-xs text-primary font-medium active:opacity-70">
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Today summary strip */}
        {!hasFilter && (
          <div className="mt-4 flex items-center gap-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-2xl px-4 py-3">
            <div className="flex-1">
              <div className="text-xs font-medium text-blue-700 dark:text-blue-300">Today</div>
              <div className="text-lg font-bold text-blue-900 dark:text-blue-100">{todaySales.length} sales</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-blue-700 dark:text-blue-300">Amount</div>
              <div className="text-sm font-bold text-blue-900 dark:text-blue-100 tabular-nums">
                {fmtGHS(todaySales.reduce((s, sale) => s + Number(sale.ticketAmount ?? 0), 0))}
              </div>
            </div>
          </div>
        )}

        {/* Real-time Transaction Summary Card */}
        <div className="mt-4 bg-card border border-border/60 rounded-2xl overflow-hidden shadow-sm">
          <div className="bg-muted/30 border-b border-border/40 px-4 py-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-foreground">Real-time Transaction Summary</h2>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                {filterFrom || filterTo
                  ? `${filterFrom || "Start"} to ${filterTo || "End"}`
                  : "Today's Live Progress"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[9px] font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 px-2.5 py-0.5 rounded-full shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              LIVE
            </span>
          </div>

          <div className="px-4 py-4 grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-3.5">
            {[
              { label: "Gross Sales", value: grossSum, isBalance: false },
              { label: "Net Gross", value: netGrossSum, isBalance: false },
              { label: "Commission", value: commissionSum, isBalance: false },
              { label: "Wins Claimed", value: winsSum, isBalance: false },
              { label: "Reserve Pool", value: reserveSum, isBalance: false },
              { label: "Current Balance", value: balanceSum, isBalance: true },
            ].map(({ label, value, isBalance }) => (
              <div key={label} className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/80">
                  {label}
                </span>
                <span className={`text-sm font-bold font-mono mt-0.5 ${
                  isBalance && value < 0 ? "text-rose-600 dark:text-rose-400"
                  : isBalance ? "text-primary"
                  : "text-foreground"
                }`}>
                  {fmtGHS(value)}
                </span>
              </div>
            ))}
          </div>

          {/* Writer Submissions Progress Bar */}
          <div className="px-4 pb-3.5 space-y-1.5 bg-muted/5 border-t border-border/40 pt-3">
            <div className="flex justify-between text-xs font-semibold text-muted-foreground">
              <span>Writer Submissions</span>
              <span className="font-mono text-foreground font-bold">{submittedWritersCount}/{totalWritersCount}</span>
            </div>
            <div className="w-full bg-muted/65 dark:bg-muted/20 h-1.5 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  submitPercentage === 100 ? "bg-emerald-500" : "bg-primary"
                }`}
                style={{ width: `${submitPercentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Sale cards list */}
        <div className="mt-4 space-y-2.5">
          {isLoading ? (
            [1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)
          ) : salesList.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <div className="text-4xl mb-3">🧾</div>
              <div className="font-medium text-sm">No sales yet</div>
              <div className="text-xs mt-1">Tap Log to record your first sale</div>
            </div>
          ) : salesList.map(s => {
            const writer = agentWriters.find(w => w.id === s.writerId);
            return (
              <div key={s.id} className="bg-card border border-border rounded-2xl px-4 py-3.5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
                    <rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 7h6M9 11h6M9 15h4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-semibold font-mono truncate">{writer?.fullCode ?? s.writerId.slice(0,8)}</span>
                    {writer && <span className="text-xs text-muted-foreground truncate hidden sm:inline">{writer.fullName}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{s.gameType ?? "—"}</span>
                    <span className="text-[10px] text-muted-foreground/60">·</span>
                    <span className="text-xs text-muted-foreground">{relDate(s.saleDate ?? "")}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold tabular-nums">{fmtGHS(Number(s.ticketAmount ?? 0))}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Log Sale Dialog */}
      <Dialog open={open} onOpenChange={o => { if (!o) setForm({ writerId: "", gameType: "", ticketAmount: "", saleDate: today }); setOpen(o); }}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
          <DialogHeader><DialogTitle>Log Sale</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Writer</Label>
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))}>
                <SelectTrigger className="h-11 text-sm rounded-xl"><SelectValue placeholder="Select writer…" /></SelectTrigger>
                <SelectContent>
                  {agentWriters.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Game Type</Label>
              <Input value={form.gameType} onChange={e => setForm(f => ({ ...f, gameType: e.target.value }))} required className="h-11 text-sm rounded-xl" placeholder="e.g. Pick 3" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={form.ticketAmount} onChange={e => setForm(f => ({ ...f, ticketAmount: e.target.value }))} required className="h-11 text-sm rounded-xl" placeholder="0.00" inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Date</Label>
              <Input type="date" value={form.saleDate} onChange={e => setForm(f => ({ ...f, saleDate: e.target.value }))} required className="h-11 text-sm rounded-xl" />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1 h-11 rounded-xl font-semibold" disabled={createMutation.isPending || !form.writerId}>
                {createMutation.isPending ? "Logging…" : "Log Sale"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminSalesView() {
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
      toast.success("Sale logged");
      setOpen(false);
      setForm({ writerId: "", gameType: "", ticketAmount: "", saleDate: new Date().toISOString().split("T")[0] });
      qc.invalidateQueries({ queryKey: getListSalesQueryKey({}) });
    } catch {
      toast.error("Failed to log sale");
    }
  };

  const writerList = Array.isArray(writers) ? writers : [];
  const clearFilter = () => { setFilterAgentId(""); setFilterWriterId(""); setFilterFrom(""); setFilterTo(""); };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold">Sales Log</h1>
          <p className="text-xs text-muted-foreground mt-0.5">View and record lottery sales by writer</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>Log Sale</Button>
      </div>

      <div className="bg-muted/30 border rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter Sales</span>
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

      <Dialog open={open} onOpenChange={o => { if (!o) { setSelectedAgent(""); setForm(f => ({ ...f, writerId: "" })); } setOpen(o); }}>
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

export function Sales() {
  const { user } = useAuth();
  if (user?.role === "agent") return <AgentSalesView />;
  return <AdminSalesView />;
}
