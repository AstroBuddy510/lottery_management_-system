import { useEffect, useMemo, useState } from "react";
import {
  useListGrossEntries, useCreateGrossEntry, useUpdateGrossEntry, useConfirmLateGrossEntry,
  useListWinsEntries, useCreateWinsEntry, useUpdateWinsEntry,
  useListWriters, getListGrossEntriesQueryKey, getListWinsEntriesQueryKey, getListWritersQueryKey,
  useGetSettings, type ListGrossEntriesParams, type ListWinsEntriesParams,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp, Trophy, Calculator, Plus, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUpDown, ArrowUp, ArrowDown, Lock, Unlock, Clock, CheckCircle2, Pencil, FileStack,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Gross & Wins: the figures agents and entry clerks key in, per writer.
 *
 * Every list here is read whole from the API (the endpoints neither sort nor
 * page) and paged in the browser, so the filters, the totals and the pages all
 * describe the same set of rows.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

const ghs = (n: number | string) =>
  `GH₵ ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedGhs = (n: number) => (n < 0 ? `(${ghs(Math.abs(n))})` : ghs(n));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const fmtDay = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

function quickRanges() {
  const now = new Date();
  const today = isoDay(now);
  const yesterday = isoDay(new Date(now.getTime() - 86_400_000));
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "This week", from: isoDay(monday), to: today },
    { label: "This month", from: `${today.slice(0, 8)}01`, to: today },
    { label: "All time", from: "", to: "" },
  ];
}

// ── Shared building blocks ────────────────────────────────────────────────────

function StatTile({ label, value, sub, edge, text, icon }: {
  label: string; value: string; sub?: React.ReactNode; edge: string; text?: string; icon: React.ReactNode;
}) {
  return (
    <div className={cn("bg-card border border-border border-l-4 rounded-2xl p-4 shadow-sm flex flex-col justify-between min-h-[6.5rem] min-w-0", edge)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">{label}</div>
        <div className="text-muted-foreground/70 shrink-0">{icon}</div>
      </div>
      <div className={cn("font-mono text-lg sm:text-xl font-black tracking-tight mt-1 truncate", text)}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground font-medium mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border bg-background p-0.5 h-9 items-center">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn("text-[11px] font-semibold px-3 h-7 rounded-md whitespace-nowrap transition-colors",
            value === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Filters = { agentId: string; writerId: string; from: string; to: string; search: string };
const NO_FILTERS: Filters = { agentId: "", writerId: "", from: "", to: "", search: "" };

function FilterBar({ filters, onChange, extra }: {
  filters: Filters; onChange: (f: Filters) => void; extra?: React.ReactNode;
}) {
  const { agentList, allWriters } = useWriterLookup();
  const writersOfAgent = useMemo(
    () => allWriters.filter(w => !filters.agentId || w.agentId === filters.agentId).sort((a, b) => a.fullCode.localeCompare(b.fullCode)),
    [allWriters, filters.agentId],
  );
  const ranges = quickRanges();
  const active = ranges.find(r => r.from === filters.from && r.to === filters.to)?.label;
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const dirty = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <div className="rounded-2xl border bg-card p-3 shadow-sm space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_auto_auto_minmax(0,1.4fr)] gap-2 items-end">
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Agency</Label>
          <Select value={filters.agentId || "_all"} onValueChange={v => set({ agentId: v === "_all" ? "" : v, writerId: "" })}>
            <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All agencies</SelectItem>
              {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.agencyName ?? a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 min-w-0">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Writer</Label>
          <Select value={filters.writerId || "_all"} onValueChange={v => set({ writerId: v === "_all" ? "" : v })}>
            <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="_all">All writers</SelectItem>
              {writersOfAgent.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">From</Label>
          <Input type="date" value={filters.from} max={filters.to || undefined} onChange={e => set({ from: e.target.value })} className="h-9 w-full lg:w-[150px] text-sm bg-background" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">To</Label>
          <Input type="date" value={filters.to} min={filters.from || undefined} onChange={e => set({ to: e.target.value })} className="h-9 w-full lg:w-[150px] text-sm bg-background" />
        </div>
        <div className="space-y-1 col-span-2 lg:col-span-1 min-w-0">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Search</Label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={filters.search} onChange={e => set({ search: e.target.value })} placeholder="Writer code or name…" className="pl-9 h-9 text-sm bg-background" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-1.5">
          {ranges.map(r => (
            <button key={r.label} type="button" onClick={() => set({ from: r.from, to: r.to })}
              className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors",
                active === r.label ? "bg-foreground text-background border-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {extra}
          {dirty && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onChange(NO_FILTERS)}>Clear</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function usePaging<T>(rows: T[], resetKey: string, initialSize = 25) {
  const [pageSize, setPageSize] = useState(initialSize);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey, pageSize]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * pageSize, current * pageSize);
  return { shown, page: current, pages, pageSize, setPage, setPageSize, total: rows.length };
}

function Pager({ page, pages, pageSize, total, setPage, setPageSize, noun }: {
  page: number; pages: number; pageSize: number; total: number;
  setPage: (n: number) => void; setPageSize: (n: number) => void; noun: string;
}) {
  if (total === 0) return null;
  const list: (number | "…")[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) list.push(i);
    else if (list[list.length - 1] !== "…") list.push("…");
  }
  const btn = "h-8 w-8 inline-flex items-center justify-center rounded-lg border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none";
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Showing <span className="font-semibold text-foreground">{((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()}</span> of <span className="font-semibold text-foreground">{total.toLocaleString()}</span> {noun}</span>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} aria-label="Rows per page"
          className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground">
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="First page" title="First page" className={btn} disabled={page === 1} onClick={() => setPage(1)}><ChevronsLeft className="w-4 h-4" /></button>
        <button type="button" aria-label="Previous page" title="Previous page" className={btn} disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></button>
        {list.map((n, i) => n === "…" ? (
          <span key={`g${i}`} className="px-1 text-xs text-muted-foreground">…</span>
        ) : (
          <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined}
            className={cn("min-w-[32px] h-8 px-2 rounded-lg text-xs font-semibold transition-colors",
              n === page ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {n}
          </button>
        ))}
        <button type="button" aria-label="Next page" title="Next page" className={btn} disabled={page === pages} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></button>
        <button type="button" aria-label="Last page" title="Last page" className={btn} disabled={page === pages} onClick={() => setPage(pages)}><ChevronsRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

type SortDir = "asc" | "desc";
function SortHead<K extends string>({ label, k, sort, onSort, right }: {
  label: string; k: K; sort: { key: K; dir: SortDir }; onSort: (k: K) => void; right?: boolean;
}) {
  const on = sort.key === k;
  const Icon = !on ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={cn("text-xs whitespace-nowrap", right && "text-right")}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", on && "text-foreground font-semibold", right && "flex-row-reverse")}>
        {label}<Icon className="w-3 h-3 opacity-70" />
      </button>
    </TableHead>
  );
}

/** A table that scrolls inside itself with its header pinned. */
function ScrollTable({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm overflow-hidden min-w-0">
      <div className="overflow-auto max-h-[max(24rem,calc(100vh-24rem))] [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-muted/95 [&_thead]:backdrop-blur">
        {children}
      </div>
      {footer}
    </div>
  );
}

// ── Gross / Wins entry lists (one component, two kinds) ───────────────────────

type Kind = "gross" | "wins";
type EntryRow = {
  id: string; writerId: string; entryDate: string; amount: number; createdAt?: string | null;
  locked: boolean; isLate?: boolean; adminConfirmed?: boolean;
};

function EntriesTab({ kind }: { kind: Kind }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { writerMap, agentList, allWriters } = useWriterLookup();
  const isGross = kind === "gross";

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [status, setStatus] = useState<"all" | "open" | "locked" | "late">("all");
  const [sort, setSort] = useState<{ key: "date" | "writer" | "amount" | "recorded"; dir: SortDir }>({ key: "date", dir: "desc" });

  const params = {
    writerId: filters.writerId || undefined,
    dateFrom: filters.from || undefined,
    dateTo: filters.to || undefined,
  };
  const gross = useListGrossEntries(params as ListGrossEntriesParams, {
    query: { queryKey: getListGrossEntriesQueryKey(params as ListGrossEntriesParams), refetchInterval: 30_000, enabled: isGross },
  });
  const wins = useListWinsEntries(params as ListWinsEntriesParams, {
    query: { queryKey: getListWinsEntriesQueryKey(params as ListWinsEntriesParams), refetchInterval: 30_000, enabled: !isGross },
  });
  const isLoading = isGross ? gross.isLoading : wins.isLoading;

  const agentOf = useMemo(() => Object.fromEntries(allWriters.map(w => [w.id, w.agentId])), [allWriters]);
  const agencyCode = useMemo(() => Object.fromEntries(agentList.map(a => [a.id, a.fullCode])), [agentList]);

  const base: EntryRow[] = useMemo(() => {
    if (isGross) {
      return (Array.isArray(gross.data) ? gross.data : []).map(e => ({
        id: e.id, writerId: e.writerId, entryDate: e.entryDate, amount: Number(e.grossAmount), createdAt: e.createdAt,
        locked: e.locked, isLate: e.isLate, adminConfirmed: e.adminConfirmed,
      }));
    }
    return (Array.isArray(wins.data) ? wins.data : []).map(e => ({
      id: e.id, writerId: e.writerId, entryDate: e.entryDate, amount: Number(e.winsAmount), createdAt: e.createdAt, locked: e.locked,
    }));
  }, [isGross, gross.data, wins.data]);

  // Everything except the status chip, so the chip counts describe the filtered set.
  const scoped = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return base.filter(e => {
      if (filters.agentId && agentOf[e.writerId] !== filters.agentId) return false;
      if (q) {
        const w = writerMap[e.writerId];
        if (!w || !(`${w.fullCode} ${w.fullName}`.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [base, filters.agentId, filters.search, agentOf, writerMap]);

  const latePending = scoped.filter(e => e.isLate && !e.adminConfirmed);
  const rows = useMemo(() => {
    let list = scoped;
    if (status === "open") list = list.filter(e => !e.locked);
    else if (status === "locked") list = list.filter(e => e.locked);
    else if (status === "late") list = list.filter(e => e.isLate && !e.adminConfirmed);
    const dir = sort.dir === "asc" ? 1 : -1;
    const code = (id: string) => writerMap[id]?.fullCode ?? id;
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case "amount": return (a.amount - b.amount) * dir;
        case "writer": return code(a.writerId).localeCompare(code(b.writerId)) * dir;
        case "recorded": return (a.createdAt ?? "").localeCompare(b.createdAt ?? "") * dir;
        default: return (a.entryDate.localeCompare(b.entryDate) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "")) * dir;
      }
    });
  }, [scoped, status, sort, writerMap]);

  const paging = usePaging(rows, JSON.stringify([filters, status, sort]));
  const onSort = (k: typeof sort.key) => setSort(s => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }));

  const total = rows.reduce((s, e) => s + e.amount, 0);
  const writersCount = new Set(rows.map(e => e.writerId)).size;
  const lockedCount = scoped.filter(e => e.locked).length;

  // ── Create / edit / confirm ──
  const createGross = useCreateGrossEntry();
  const updateGross = useUpdateGrossEntry();
  const confirmLate = useConfirmLateGrossEntry();
  const createWins = useCreateWinsEntry();
  const updateWins = useUpdateWinsEntry();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<EntryRow | null>(null);
  const [form, setForm] = useState({ agentId: "", writerId: "", entryDate: isoDay(new Date()), amount: "" });
  const [editAmount, setEditAmount] = useState("");
  const { data: formWriters } = useListWriters(form.agentId, {}, {
    query: { queryKey: getListWritersQueryKey(form.agentId, {}), enabled: !!form.agentId },
  });
  const formWriterList = Array.isArray(formWriters) ? formWriters : [];

  const invalidate = () => qc.invalidateQueries({ queryKey: [isGross ? "/api/entries/gross" : "/api/entries/wins"] });
  const resetForm = () => setForm({ agentId: "", writerId: "", entryDate: isoDay(new Date()), amount: "" });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isGross) await createGross.mutateAsync({ data: { writerId: form.writerId, entryDate: form.entryDate, grossAmount: form.amount } });
      else await createWins.mutateAsync({ data: { writerId: form.writerId, entryDate: form.entryDate, winsAmount: form.amount } });
      toast({ title: "Entry created" });
      setCreateOpen(false);
      resetForm();
      invalidate();
    } catch (err: any) {
      toast({ title: err?.data?.error ?? "Failed to create entry", variant: "destructive" });
    }
  };
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEntry) return;
    try {
      if (isGross) await updateGross.mutateAsync({ id: editEntry.id, data: { grossAmount: editAmount } });
      else await updateWins.mutateAsync({ id: editEntry.id, data: { winsAmount: editAmount } });
      toast({ title: "Entry updated" });
      setEditEntry(null);
      invalidate();
    } catch (err: any) {
      toast({ title: err?.data?.error ?? "Failed to update entry", variant: "destructive" });
    }
  };
  const handleConfirmLate = async (id: string) => {
    if (!confirm("Confirm this late gross entry so it is included in calculations?")) return;
    try {
      await confirmLate.mutateAsync({ id });
      toast({ title: "Late entry confirmed" });
      invalidate();
    } catch (err: any) {
      toast({ title: err?.data?.error ?? "Failed to confirm entry", variant: "destructive" });
    }
  };

  const noun = isGross ? "gross entries" : "wins entries";
  const statusOptions = [
    { value: "all" as const, label: `All ${scoped.length}` },
    { value: "open" as const, label: `Open ${scoped.length - lockedCount}` },
    { value: "locked" as const, label: `Locked ${lockedCount}` },
    ...(isGross ? [{ value: "late" as const, label: `Late, pending ${latePending.length}` }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label={isGross ? "Total gross" : "Total wins"} value={ghs(total)} sub={`${rows.length.toLocaleString()} entries shown`}
          edge={isGross ? "border-l-sky-500" : "border-l-violet-500"} text={isGross ? "text-sky-600 dark:text-sky-400" : "text-violet-600 dark:text-violet-400"}
          icon={isGross ? <TrendingUp className="w-4 h-4" /> : <Trophy className="w-4 h-4" />} />
        <StatTile label="Writers" value={writersCount.toLocaleString()} sub={writersCount ? `avg ${ghs(total / writersCount)} each` : "none in view"}
          edge="border-l-slate-400" icon={<FileStack className="w-4 h-4" />} />
        <StatTile label="Open" value={(scoped.length - lockedCount).toLocaleString()} sub="still editable"
          edge="border-l-emerald-500" text="text-emerald-600 dark:text-emerald-400" icon={<Unlock className="w-4 h-4" />} />
        {isGross ? (
          <StatTile label="Late, awaiting confirmation" value={latePending.length.toLocaleString()}
            sub={latePending.length ? `${ghs(latePending.reduce((s, e) => s + e.amount, 0))} not yet counted` : "nothing waiting"}
            edge="border-l-amber-500" text={latePending.length ? "text-amber-600 dark:text-amber-400" : ""} icon={<Clock className="w-4 h-4" />} />
        ) : (
          <StatTile label="Locked" value={lockedCount.toLocaleString()} sub="calculated in Run Draws"
            edge="border-l-slate-400" icon={<Lock className="w-4 h-4" />} />
        )}
      </div>

      <FilterBar filters={filters} onChange={setFilters}
        extra={<Button size="sm" className="h-8 gap-1.5 font-semibold" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> Add entry</Button>} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<typeof status> value={status} onChange={setStatus} options={statusOptions} />
        <span className="text-[11px] text-muted-foreground">Click a column heading to sort</span>
      </div>

      <ScrollTable footer={<Pager {...paging} noun={noun} />}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label="Entry date" k="date" sort={sort} onSort={onSort} />
              <SortHead label="Writer" k="writer" sort={sort} onSort={onSort} />
              <SortHead label={isGross ? "Gross" : "Wins"} k="amount" sort={sort} onSort={onSort} right />
              <SortHead label="Recorded" k="recorded" sort={sort} onSort={onSort} />
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs text-right pr-4">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3, 4, 5].map(i => <TableRow key={i}><TableCell colSpan={6}><div className="h-6 rounded bg-muted animate-pulse" /></TableCell></TableRow>)
            ) : paging.shown.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-16">
                <p className="text-sm font-semibold">No {noun} here</p>
                <p className="text-xs text-muted-foreground mt-1">Widen the dates, change the filters, or add an entry.</p>
              </TableCell></TableRow>
            ) : paging.shown.map(entry => {
              const w = writerMap[entry.writerId];
              const pending = entry.isLate && !entry.adminConfirmed;
              return (
                <TableRow key={entry.id} className={cn(pending && "bg-amber-500/[0.04]")}>
                  <TableCell className="text-sm whitespace-nowrap">{fmtDay(entry.entryDate)}</TableCell>
                  <TableCell className="min-w-[160px]">
                    <div className="font-mono text-xs font-bold">{w?.fullCode ?? `${entry.writerId.slice(0, 8)}…`}</div>
                    <div className="text-[11px] text-muted-foreground">{w?.fullName ?? ""}{agentOf[entry.writerId] ? ` · ${agencyCode[agentOf[entry.writerId]!] ?? ""}` : ""}</div>
                  </TableCell>
                  <TableCell className={cn("text-right font-mono text-sm font-semibold whitespace-nowrap", entry.locked && "text-muted-foreground")}>{ghs(entry.amount)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtTime(entry.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border",
                        entry.locked ? "bg-muted text-muted-foreground" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30")}>
                        {entry.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}{entry.locked ? "Locked" : "Open"}
                      </span>
                      {entry.isLate && (
                        <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border",
                          entry.adminConfirmed ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30" : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30")}>
                          {entry.adminConfirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          {entry.adminConfirmed ? "Late · confirmed" : "Late · pending"}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right pr-4">
                    <div className="inline-flex items-center gap-1.5">
                      {pending && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 font-semibold" onClick={() => handleConfirmLate(entry.id)}>Confirm</Button>
                      )}
                      {!entry.locked && (
                        <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2 gap-1" onClick={() => { setEditEntry(entry); setEditAmount(String(entry.amount.toFixed(2))); }}><Pencil className="w-3 h-3" /> Edit</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollTable>

      {/* Add */}
      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) resetForm(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add {isGross ? "gross" : "wins"} entry</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Agency</Label>
              <Select value={form.agentId} onValueChange={v => setForm(f => ({ ...f, agentId: v, writerId: "" }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select an agency…" /></SelectTrigger>
                <SelectContent>{agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.agencyName ?? a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Writer</Label>
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))} disabled={!form.agentId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select a writer…" /></SelectTrigger>
                <SelectContent>{formWriterList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input type="date" value={form.entryDate} onChange={e => setForm(f => ({ ...f, entryDate: e.target.value }))} required className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isGross ? "Gross" : "Wins"} amount (GH₵)</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required className="h-9 text-sm" placeholder="0.00" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={(isGross ? createGross.isPending : createWins.isPending) || !form.writerId}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editEntry} onOpenChange={open => !open && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit {isGross ? "gross" : "wins"} entry</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            {editEntry && (
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <span className="font-mono font-bold">{writerMap[editEntry.writerId]?.fullCode ?? editEntry.writerId}</span>
                <span className="text-muted-foreground"> · {writerMap[editEntry.writerId]?.fullName ?? ""} · {fmtDay(editEntry.entryDate)}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">{isGross ? "Gross" : "Wins"} amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={editAmount} onChange={e => setEditAmount(e.target.value)} required className="h-9 text-sm" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditEntry(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={isGross ? updateGross.isPending : updateWins.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

type SummaryRow = { writerId: string; gross: number; wins: number; commission: number; netGross: number; reserve: number; netAfterReserve: number; balance: number };
type SummaryKey = "writer" | keyof Omit<SummaryRow, "writerId">;

function SummaryTab() {
  const { writerMap, agentList, allWriters } = useWriterLookup();
  const { data: settings } = useGetSettings();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [standing, setStanding] = useState<"all" | "surplus" | "deficit">("all");
  const [sort, setSort] = useState<{ key: SummaryKey; dir: SortDir }>({ key: "gross", dir: "desc" });

  const params = { dateFrom: filters.from || undefined, dateTo: filters.to || undefined };
  const { data: grossEntries, isLoading: loadingGross } = useListGrossEntries(params, {
    query: { queryKey: getListGrossEntriesQueryKey(params) },
  });
  const { data: winsEntries, isLoading: loadingWins } = useListWinsEntries(params, {
    query: { queryKey: getListWinsEntriesQueryKey(params) },
  });

  // The draw commission rate - the same one the calculation run uses. This
  // used to read the postpaid writer-commission setting, a different rate;
  // whenever the two differed, Commission and Net here disagreed with every
  // statement (and with the two rates 70/30 apart, looked swapped).
  const writerCommissionPct = Number(settings?.commissionPct ?? 0);
  const reservePct = Number(settings?.reservePct ?? 0);
  const agentOf = useMemo(() => Object.fromEntries(allWriters.map(w => [w.id, w.agentId])), [allWriters]);
  const agencyCode = useMemo(() => Object.fromEntries(agentList.map(a => [a.id, a.fullCode])), [agentList]);

  const allRows: SummaryRow[] = useMemo(() => {
    const grossMap: Record<string, number> = {};
    const winsMap: Record<string, number> = {};
    (Array.isArray(grossEntries) ? grossEntries : []).forEach(e => { grossMap[e.writerId] = (grossMap[e.writerId] ?? 0) + Number(e.grossAmount); });
    (Array.isArray(winsEntries) ? winsEntries : []).forEach(e => { winsMap[e.writerId] = (winsMap[e.writerId] ?? 0) + Number(e.winsAmount); });
    const ids = Array.from(new Set([...Object.keys(grossMap), ...Object.keys(winsMap)]));
    return ids.map(writerId => {
      const gross = grossMap[writerId] ?? 0;
      const wins = winsMap[writerId] ?? 0;
      // The platform waterfall, in whole pesewas (see lib/waterfall).
      const g = Math.round(gross * 100), wn = Math.round(wins * 100);
      const c = Math.round(g * writerCommissionPct);
      const n = g - c;
      const rs = Math.round(n * reservePct);
      return { writerId, gross: g / 100, wins: wn / 100, commission: c / 100, netGross: n / 100, reserve: rs / 100, netAfterReserve: (n - rs) / 100, balance: (n - rs - wn) / 100 };
    });
  }, [grossEntries, winsEntries, writerCommissionPct, reservePct]);

  const scoped = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return allRows.filter(r => {
      if (filters.agentId && agentOf[r.writerId] !== filters.agentId) return false;
      if (filters.writerId && r.writerId !== filters.writerId) return false;
      if (q) {
        const w = writerMap[r.writerId];
        if (!w || !(`${w.fullCode} ${w.fullName}`.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [allRows, filters, agentOf, writerMap]);

  const rows = useMemo(() => {
    let list = scoped;
    if (standing === "surplus") list = list.filter(r => r.balance >= 0);
    else if (standing === "deficit") list = list.filter(r => r.balance < 0);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => sort.key === "writer"
      ? (writerMap[a.writerId]?.fullCode ?? a.writerId).localeCompare(writerMap[b.writerId]?.fullCode ?? b.writerId) * dir
      : (a[sort.key] - b[sort.key]) * dir);
  }, [scoped, standing, sort, writerMap]);

  const totals = rows.reduce(
    (acc, r) => ({ gross: acc.gross + r.gross, wins: acc.wins + r.wins, commission: acc.commission + r.commission, netGross: acc.netGross + r.netGross, reserve: acc.reserve + r.reserve, netAfterReserve: acc.netAfterReserve + r.netAfterReserve, balance: acc.balance + r.balance }),
    { gross: 0, wins: 0, commission: 0, netGross: 0, reserve: 0, netAfterReserve: 0, balance: 0 },
  );
  const deficits = scoped.filter(r => r.balance < 0).length;
  const paging = usePaging(rows, JSON.stringify([filters, standing, sort]));
  const onSort = (k: SummaryKey) => setSort(s => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }));
  const isLoading = loadingGross || loadingWins;
  const pctLabel = (p: number) => `${(p * 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Gross" value={ghs(totals.gross)} sub={`less ${ghs(totals.commission)} commission`} edge="border-l-sky-500" text="text-sky-600 dark:text-sky-400" icon={<TrendingUp className="w-4 h-4" />} />
        <StatTile label="Wins" value={ghs(totals.wins)} sub={totals.gross > 0 ? `${Math.round((totals.wins / totals.gross) * 100)}% of gross` : "—"} edge="border-l-violet-500" text="text-violet-600 dark:text-violet-400" icon={<Trophy className="w-4 h-4" />} />
        <StatTile label="Reserve" value={ghs(totals.reserve)} sub={`${pctLabel(reservePct)} of net gross`} edge="border-l-amber-500" text="text-amber-600 dark:text-amber-400" icon={<Lock className="w-4 h-4" />} />
        <StatTile label="Balance" value={signedGhs(totals.balance)} sub={`${deficits} writer${deficits === 1 ? "" : "s"} in deficit`}
          edge={totals.balance < 0 ? "border-l-rose-500" : "border-l-emerald-500"} text={totals.balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"} icon={<Calculator className="w-4 h-4" />} />
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<typeof standing> value={standing} onChange={setStanding} options={[
          { value: "all", label: `All writers ${scoped.length}` },
          { value: "surplus", label: `In surplus ${scoped.length - deficits}` },
          { value: "deficit", label: `In deficit ${deficits}` },
        ]} />
        <span className="text-[11px] text-muted-foreground">
          Rates: writer commission {pctLabel(writerCommissionPct)} · reserve {pctLabel(reservePct)} · keyed-in entries only
        </span>
      </div>

      <ScrollTable footer={<Pager {...paging} noun="writers" />}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label="Writer" k="writer" sort={sort} onSort={onSort} />
              <SortHead label="Gross Sales" k="gross" sort={sort} onSort={onSort} right />
              <SortHead label="Commission" k="commission" sort={sort} onSort={onSort} right />
              <SortHead label="Net After Commission" k="netGross" sort={sort} onSort={onSort} right />
              <SortHead label="Reserve" k="reserve" sort={sort} onSort={onSort} right />
              <SortHead label="Net After Reserve" k="netAfterReserve" sort={sort} onSort={onSort} right />
              <SortHead label="Wins Deduct" k="wins" sort={sort} onSort={onSort} right />
              <SortHead label="Profit / (Deficit)" k="balance" sort={sort} onSort={onSort} right />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3, 4, 5].map(i => <TableRow key={i}><TableCell colSpan={8}><div className="h-6 rounded bg-muted animate-pulse" /></TableCell></TableRow>)
            ) : paging.shown.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-16">
                <p className="text-sm font-semibold">Nothing to summarise</p>
                <p className="text-xs text-muted-foreground mt-1">No gross or wins entries match these filters.</p>
              </TableCell></TableRow>
            ) : paging.shown.map(r => {
              const w = writerMap[r.writerId];
              const margin = r.gross > 0 ? Math.max(0, Math.min(100, (r.wins / r.gross) * 100)) : r.wins > 0 ? 100 : 0;
              return (
                <TableRow key={r.writerId}>
                  <TableCell className="min-w-[170px]">
                    <div className="font-mono text-xs font-bold">{w?.fullCode ?? `${r.writerId.slice(0, 8)}…`}</div>
                    <div className="text-[11px] text-muted-foreground">{w?.fullName ?? ""}{agentOf[r.writerId] ? ` · ${agencyCode[agentOf[r.writerId]!] ?? ""}` : ""}</div>
                    <div className="mt-1 h-1 w-28 rounded-full bg-muted overflow-hidden" title={`Wins are ${Math.round(margin)}% of gross`}>
                      <div className={cn("h-full", margin > 80 ? "bg-rose-500" : margin > 50 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${margin}%` }} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm whitespace-nowrap">{ghs(r.gross)}</TableCell>
                  <TableCell className="text-right font-mono text-sm whitespace-nowrap text-muted-foreground">{ghs(r.commission)}</TableCell>
                  <TableCell className="text-right font-mono text-sm whitespace-nowrap">{ghs(r.netGross)}</TableCell>
                  <TableCell className="text-right font-mono text-sm whitespace-nowrap text-amber-600 dark:text-amber-400">{ghs(r.reserve)}</TableCell>
                  <TableCell className="text-right font-mono text-sm whitespace-nowrap">{ghs(r.netAfterReserve)}</TableCell>
                  <TableCell className="text-right font-mono text-sm whitespace-nowrap text-violet-600 dark:text-violet-400">{ghs(r.wins)}</TableCell>
                  <TableCell className={cn("text-right font-mono text-sm font-bold whitespace-nowrap", r.balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{signedGhs(r.balance)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {rows.length > 0 && (
            <tfoot className="sticky bottom-0 z-10 bg-muted/95 backdrop-blur">
              <tr className="border-t-2">
                <td className="px-4 py-2.5 text-xs font-black uppercase tracking-wider text-muted-foreground">Total · {rows.length} writers</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-bold whitespace-nowrap">{ghs(totals.gross)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-bold whitespace-nowrap">{ghs(totals.commission)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-bold whitespace-nowrap">{ghs(totals.netGross)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-bold whitespace-nowrap">{ghs(totals.reserve)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-bold whitespace-nowrap">{ghs(totals.netAfterReserve)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-bold whitespace-nowrap">{ghs(totals.wins)}</td>
                <td className={cn("px-4 py-2.5 text-right font-mono text-sm font-black whitespace-nowrap", totals.balance < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{signedGhs(totals.balance)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </ScrollTable>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TabKey = "gross" | "wins" | "summary";

export function GrossWins() {
  const [tab, setTab] = useState<TabKey>("gross");
  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "gross", label: "Gross Entries", icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { key: "wins", label: "Wins Entries", icon: <Trophy className="w-3.5 h-3.5" /> },
    { key: "summary", label: "Summary", icon: <Calculator className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Entries</div>
          <h1 className="text-2xl font-black tracking-tight">Gross &amp; Wins</h1>
          <p className="text-xs text-muted-foreground mt-1 font-medium">The gross and wins figures keyed in for each writer, and what they come to.</p>
        </div>
        <div className="flex bg-muted/80 border p-1 rounded-2xl gap-1 w-fit max-w-full overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={cn("flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all",
                tab === t.key ? "bg-background text-foreground shadow-sm border border-border/40" : "text-muted-foreground hover:text-foreground")}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Each tab keeps its own filters while you switch away and back. */}
      <div className={tab === "gross" ? "" : "hidden"}><EntriesTab kind="gross" /></div>
      <div className={tab === "wins" ? "" : "hidden"}><EntriesTab kind="wins" /></div>
      <div className={tab === "summary" ? "" : "hidden"}><SummaryTab /></div>
    </div>
  );
}
