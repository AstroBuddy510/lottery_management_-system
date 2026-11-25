import { useState, useEffect, useMemo, useRef } from "react";
import { getServerNow } from "../lib/time-sync";
import {
  useListGrossEntries, useCreateGrossEntry, useUpdateGrossEntry,
  useListWriters, getListGrossEntriesQueryKey, getListWritersQueryKey,
  useGetMyAgent, getGetMyAgentQueryKey, GrossEntry,
  useCreateEntryChangeRequest, getListEntryChangeRequestsQueryKey,
  useListGames, useListBookletAgentBalances,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { fmtGHS, cn } from "@/lib/utils";
import { Pager, usePaged } from "@/components/data-kit";
import { TrendingUp, CalendarDays, BookOpen, Layers, Lock } from "lucide-react";

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

const ENTRIES_PER_PAGE = 15;

function relDate(s: string) {
  const today = new Date(getServerNow()).toISOString().split("T")[0];
  const yesterday = new Date(getServerNow().getTime() - 86400000).toISOString().split("T")[0];
  const d = s.split("T")[0];
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function AgentGrossView() {
  const qc = useQueryClient();
  const today = new Date(getServerNow()).toISOString().split("T")[0];
  const { data: myAgent } = useGetMyAgent({ query: { queryKey: getGetMyAgentQueryKey() } });

  const { data: bookletBalances } = useListBookletAgentBalances();
  const agentBookletBalance = useMemo(() => {
    if (!bookletBalances || bookletBalances.length === 0) return null;
    return bookletBalances[0];
  }, [bookletBalances]);

  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState(today);
  const [filterTo, setFilterTo] = useState(today);
  const [showFilter, setShowFilter] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<GrossEntry | null>(null);

  const { data: writers } = useListWriters(myAgent?.id ?? "", {}, {
    query: { queryKey: getListWritersQueryKey(myAgent?.id ?? "", {}), enabled: !!myAgent?.id }
  });
  const writerList = Array.isArray(writers) ? writers : [];

  const { data: games } = useListGames();
  const gameList = Array.isArray(games) ? games : [];
  const liveGames = useMemo(() => {
    return gameList.filter(g => g.status === "live" || (g.status === "closed" && !(g as any).calculationsRun));
  }, [gameList]);

  const groupedGames = useMemo(() => {
    const closed: typeof liveGames = [];
    const open: typeof liveGames = [];
    const now = getServerNow();
    
    for (const g of liveGames) {
      const isGrossClosed = new Date(g.closeAt) <= now || g.status === "closed";
      if (isGrossClosed) {
        closed.push(g);
      } else {
        open.push(g);
      }
    }
    
    closed.sort((a, b) => new Date(b.closeAt).getTime() - new Date(a.closeAt).getTime());
    open.sort((a, b) => new Date(a.closeAt).getTime() - new Date(b.closeAt).getTime());
    
    return { closed, open };
  }, [liveGames]);

  const isGameClosed = (gameId?: string) => {
    if (!gameId) return false;
    const game = gameList.find(g => g.id === gameId);
    if (!game) return false;
    return game.status === "closed";
  };

  const { data: entries, isLoading } = useListGrossEntries({
    writerId: filterWriterId || undefined,
    dateFrom: showFilter ? (filterFrom || undefined) : undefined,
    dateTo: showFilter ? (filterTo || undefined) : undefined,
  });
  const rawEntryList = Array.isArray(entries) ? entries : [];
  const isDefaultFilter = !filterWriterId && !showFilter;
  const entryList = useMemo(() => {
    if (isDefaultFilter) {
      const liveGameIds = new Set(liveGames.map(g => g.id));
      return rawEntryList.filter(e => e.gameId && liveGameIds.has(e.gameId));
    }
    return rawEntryList;
  }, [rawEntryList, isDefaultFilter, liveGames]);

  const todayTotal = entryList.filter(e => e.entryDate?.startsWith(today)).reduce((s, e) => s + Number(e.grossAmount ?? 0), 0);

  const createMutation = useCreateGrossEntry();
  const updateMutation = useUpdateGrossEntry();
  const changeRequestMutation = useCreateEntryChangeRequest();
  const [form, setForm] = useState({ writerId: "", entryDate: today, grossAmount: "", bookletsCount: "", gameId: "" });
  const [writerSearch, setWriterSearch] = useState("");
  const [editForm, setEditForm] = useState({ grossAmount: "", bookletsCount: "" });
  const [changeReqEntry, setChangeReqEntry] = useState<GrossEntry | null>(null);
  const [changeReqForm, setChangeReqForm] = useState({ requestedAmount: "", reason: "" });

  // Fetch all gross entries for the selected date and game to verify which writers have already been entered
  const { data: dateEntries } = useListGrossEntries({
    dateFrom: form.entryDate,
    dateTo: form.entryDate,
    gameId: form.gameId || undefined,
  }, {
    query: {
      queryKey: ["grossEntriesForDate", form.entryDate, form.gameId],
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

  const filteredWriters = useMemo(() => {
    if (!writerSearch) return availableWriters;
    const query = writerSearch.toLowerCase();
    return availableWriters.filter(w =>
      w.fullCode.toLowerCase().includes(query) ||
      w.fullName.toLowerCase().includes(query)
    );
  }, [availableWriters, writerSearch]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/entries/gross"] });
    qc.invalidateQueries({ queryKey: ["grossEntriesForDate"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/booklets/agent-balances"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/booklets/summary"] });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.gameId) {
      toast.error("Please select a game event first.");
      return;
    }
    try {
      await createMutation.mutateAsync({
        data: {
          writerId: form.writerId,
          entryDate: form.entryDate,
          grossAmount: form.grossAmount,
          bookletsCount: form.bookletsCount ? parseInt(form.bookletsCount) : 0,
          gameId: form.gameId || undefined,
        }
      });
      toast.success("Gross entry created");
      setCreateOpen(false);
      setForm({ writerId: "", entryDate: today, grossAmount: "", bookletsCount: "", gameId: "" });
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to create entry");
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEntry) return;
    try {
      await updateMutation.mutateAsync({
        id: editEntry.id,
        data: {
          grossAmount: editForm.grossAmount,
          bookletsCount: editForm.bookletsCount ? parseInt(editForm.bookletsCount) : 0,
        }
      });
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
          entryType: "gross",
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

  const hasFilter = !isDefaultFilter;
  const clearFilter = () => { setFilterWriterId(""); setFilterFrom(today); setFilterTo(today); };

  const listedTotal = entryList.reduce((s, e) => s + Number(e.grossAmount ?? 0), 0);
  const gameName = (id?: string | null) => (id ? gameList.find(g => g.id === id)?.name : undefined);
  const writerById = useMemo(() => new Map(writerList.map(w => [w.id, w])), [writerList]);

  // The list pages in place; a new filter starts again at page one.
  const paged = usePaged(entryList, ENTRIES_PER_PAGE, `${filterWriterId}|${showFilter}|${filterFrom}|${filterTo}`);
  const listRef = useRef<HTMLDivElement>(null);
  const goToPage = (p: number) => {
    paged.setPage(p);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    listRef.current?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 80) listRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="pb-4">
      {/* Sticky header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div className="flex items-center gap-3 max-w-xl mx-auto md:max-w-3xl lg:max-w-5xl">
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold">Gross Entries</h1>
            <p className="text-xs text-muted-foreground truncate">
              {entryList.length} {entryList.length === 1 ? "entry" : "entries"} · {isDefaultFilter ? "open draws" : "filtered"}
            </p>
          </div>
          <button
            onClick={() => setShowFilter(f => !f)}
            aria-label="Filter entries"
            aria-pressed={showFilter}
            className={`p-2.5 rounded-xl transition-colors active:scale-95 ${showFilter || hasFilter ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            <FilterIcon />
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm font-semibold active:scale-95 transition-transform shadow-sm"
          >
            <PlusIcon /> Add
          </button>
        </div>
      </div>

      <div className="mx-auto w-[calc(100%-2rem)] max-w-xl md:max-w-3xl lg:max-w-5xl space-y-4 pt-4">
        {/* Filter panel */}
        {showFilter && (
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Writer</Label>
                <Select value={filterWriterId || "_all"} onValueChange={v => setFilterWriterId(v === "_all" ? "" : v)}>
                  <SelectTrigger className="h-10 text-sm bg-background rounded-xl"><SelectValue placeholder="All writers" /></SelectTrigger>
                  <SelectContent className="max-h-[250px] overflow-y-auto">
                    <SelectItem value="_all">All writers</SelectItem>
                    {writerList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:contents">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">From</Label>
                  <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-10 text-sm bg-background rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">To</Label>
                  <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-10 text-sm bg-background rounded-xl" />
                </div>
              </div>
              <Button type="button" variant="ghost" className="h-10 justify-self-start text-xs" disabled={!hasFilter} onClick={clearFilter}>
                Clear filters
              </Button>
            </div>
          </div>
        )}

        {/* At a glance */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
          <GlanceTile icon={<TrendingUp className="h-4 w-4" />} tone="bg-emerald-500/10 text-emerald-600"
            label="Today's gross" value={todayTotal > 0 ? fmtGHS(todayTotal) : "—"} />
          <GlanceTile icon={<Layers className="h-4 w-4" />} tone="bg-blue-500/10 text-blue-600"
            label={isDefaultFilter ? "Open draws" : "Filtered total"} value={fmtGHS(listedTotal)}
            sub={`${entryList.length} ${entryList.length === 1 ? "entry" : "entries"}`} />
          {agentBookletBalance && (
            <GlanceTile icon={<BookOpen className="h-4 w-4" />} tone="bg-amber-500/10 text-amber-600"
              className="col-span-2 lg:col-span-1"
              label="Booklets left" value={String(agentBookletBalance.balance)}
              negative={Number(agentBookletBalance.balance) < 0}
              sub={`Allocated ${agentBookletBalance.totalAllocated} · Used ${agentBookletBalance.totalUsed}`} />
          )}
        </div>

        {/* Entries: a scrolling list with a pager */}
        <section className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-bold">Entries</h2>
              <p className="text-[11px] text-muted-foreground truncate">Newest first{hasFilter ? " · filtered" : ""}</p>
            </div>
          </div>

          <div className="hidden md:grid grid-cols-[minmax(0,1.5fr)_6rem_minmax(0,1.2fr)_5rem_6.5rem_8rem_8.5rem] gap-3 border-b bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Writer</span><span>Date</span><span>Game</span><span className="text-right">Booklets</span><span>Status</span><span className="text-right">Amount</span><span className="text-right">Action</span>
          </div>

          <div ref={listRef} className="max-h-[min(40rem,64vh)] overflow-y-auto overscroll-contain scroll-mt-40">
            {isLoading ? (
              <div className="p-3 space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : entryList.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground px-6">
                <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <div className="mt-3 font-medium text-sm text-foreground">{isDefaultFilter ? "No entries today" : "No entries found"}</div>
                <div className="text-xs mt-1">{isDefaultFilter ? "Tap Add to record today's first gross entry" : "Try adjusting your filters"}</div>
              </div>
            ) : (
              <ul className="divide-y">
                {paged.rows.map(entry => {
                  const writer = writerById.get(entry.writerId);
                  const isLocked = entry.locked || isGameClosed(entry.gameId);
                  const game = gameName(entry.gameId);
                  const statusBadges = (
                    <>
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                        isLocked ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400")}>
                        {isLocked && <Lock className="h-2.5 w-2.5" />}{isLocked ? "Locked" : "Open"}
                      </span>
                      {entry.isLate && (
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                          entry.adminConfirmed ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400" : "bg-destructive text-destructive-foreground")}>
                          {entry.adminConfirmed ? "Late ✓" : "Late"}
                        </span>
                      )}
                    </>
                  );
                  const action = !isLocked ? (
                    <button
                      onClick={() => { setEditEntry(entry); setEditForm({ grossAmount: entry.grossAmount, bookletsCount: String(entry.bookletsCount ?? 0) }); }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95"
                    >
                      <EditIcon /> Edit
                    </button>
                  ) : (
                    <button
                      onClick={() => { setChangeReqEntry(entry); setChangeReqForm({ requestedAmount: entry.grossAmount ?? "", reason: "" }); }}
                      className="whitespace-nowrap text-[11px] font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300 transition-colors active:scale-95"
                    >
                      Request change
                    </button>
                  );
                  return (
                    <li key={entry.id} className="hover:bg-muted/30 transition-colors">
                      {/* Phone: two tidy lines and the amount on the right */}
                      <div className="md:hidden grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-3">
                        <div className="min-w-0 flex items-baseline gap-1.5">
                          <span className="shrink-0 text-sm font-semibold font-mono">{writer?.fullCode ?? entry.writerId.slice(0, 8)}</span>
                          {writer && <span className="truncate text-xs text-muted-foreground">{writer.fullName}</span>}
                        </div>
                        <div className={cn("text-right text-sm font-bold tabular-nums", isLocked && "text-muted-foreground")}>{fmtGHS(Number(entry.grossAmount ?? 0))}</div>
                        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1 whitespace-nowrap"><CalendarDays className="h-3 w-3" />{relDate(entry.entryDate ?? "")}</span>
                          <span className="whitespace-nowrap">{entry.bookletsCount ?? 0} bk</span>
                          {statusBadges}
                        </div>
                        <div className="flex justify-end">{action}</div>
                      </div>
                      {/* Desktop: one aligned row */}
                      <div className="hidden md:grid grid-cols-[minmax(0,1.5fr)_6rem_minmax(0,1.2fr)_5rem_6.5rem_8rem_8.5rem] items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{writer?.fullName ?? "—"}</div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">{writer?.fullCode ?? entry.writerId.slice(0, 8)}</div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{relDate(entry.entryDate ?? "")}</span>
                        <span className="truncate text-xs text-muted-foreground">{game ?? "—"}</span>
                        <span className="text-right text-xs tabular-nums">{entry.bookletsCount ?? 0}</span>
                        <span className="flex flex-wrap items-center gap-1">{statusBadges}</span>
                        <span className={cn("text-right text-sm font-bold tabular-nums", isLocked && "text-muted-foreground")}>{fmtGHS(Number(entry.grossAmount ?? 0))}</span>
                        <span className="flex justify-end">{action}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Pager page={paged.page} totalPages={paged.totalPages} onPage={goToPage} total={paged.total} size={paged.size} noun="entries" />
        </section>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={o => { if (!o) { setForm({ writerId: "", entryDate: today, grossAmount: "", bookletsCount: "", gameId: "" }); setWriterSearch(""); } setCreateOpen(o); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Gross Entry</DialogTitle></DialogHeader>
          {myAgent && (
            <div className="flex items-center gap-2 py-1 px-3 bg-muted/40 rounded-xl border text-sm">
              <span className="text-muted-foreground text-xs">Agent:</span>
              <span className="font-mono font-semibold">{myAgent.fullCode}</span>
            </div>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Draw Game *</Label>
              <Select
                value={form.gameId}
                onValueChange={gameId => {
                  const selectedGame = liveGames.find(g => g.id === gameId);
                  if (selectedGame) {
                    const drawDate = selectedGame.closeAt.split("T")[0];
                    setForm(f => ({ ...f, gameId, entryDate: drawDate, writerId: "" }));
                  } else {
                    setForm(f => ({ ...f, gameId: "", entryDate: today, writerId: "" }));
                  }
                }}
              >
                <SelectTrigger className="h-11 text-sm rounded-xl text-center [&>span]:w-full">
                  <SelectValue placeholder={liveGames.length === 0 ? "No active games available" : "Select game…"} />
                </SelectTrigger>
                <SelectContent className="w-[var(--radix-select-trigger-width)] max-h-[250px] overflow-y-auto">
                  {groupedGames.closed.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider px-2 py-1 bg-amber-500/5 whitespace-normal break-words">
                        Gross Closed (Late Entries Open)
                      </SelectLabel>
                      {groupedGames.closed.map(g => (
                        <SelectItem key={g.id} value={g.id} className="whitespace-normal break-words">
                          {g.name} (#{g.eventNumber}) (Late)
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {groupedGames.closed.length > 0 && groupedGames.open.length > 0 && <SelectSeparator />}
                  {groupedGames.open.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider px-2 py-1 bg-emerald-500/5 whitespace-normal break-words">
                        Active / Open Games
                      </SelectLabel>
                      {groupedGames.open.map(g => (
                        <SelectItem key={g.id} value={g.id} className="whitespace-normal break-words">
                          {g.name} (#{g.eventNumber})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Writer *</Label>
                {form.gameId && usedWriterIds.size > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {usedWriterIds.size}/{writerList.length} entered
                  </span>
                )}
              </div>
              <Select
                value={form.writerId}
                onValueChange={v => setForm(f => ({ ...f, writerId: v }))}
                disabled={!form.gameId || filteredWriters.length === 0}
              >
                <SelectTrigger className="h-11 text-sm rounded-xl">
                  <SelectValue placeholder={!form.gameId ? "Choose game first…" : filteredWriters.length === 0 ? "No matching writers" : "Select writer…"} />
                </SelectTrigger>
                <SelectContent className="max-h-[250px] overflow-y-auto">
                  {form.gameId && availableWriters.length > 5 && (
                    <div className="p-2 border-b">
                      <Input
                        placeholder="Search writer..."
                        value={writerSearch}
                        onChange={e => setWriterSearch(e.target.value)}
                        className="h-8 text-xs bg-background"
                      />
                    </div>
                  )}
                  {filteredWriters.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Date (Locked)</Label>
              <Input
                type="date"
                value={form.entryDate}
                disabled
                readOnly
                className="h-11 text-sm rounded-xl bg-muted text-muted-foreground cursor-not-allowed opacity-80"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Gross Amount (GH₵) *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.grossAmount}
                onChange={e => setForm(f => ({ ...f, grossAmount: e.target.value }))}
                disabled={!form.gameId}
                required
                className="h-11 text-sm rounded-xl"
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Booklets Used *</Label>
              <Input
                type="number"
                min="0"
                value={form.bookletsCount}
                onChange={e => setForm(f => ({ ...f, bookletsCount: e.target.value }))}
                disabled={!form.gameId}
                required
                className="h-11 text-sm rounded-xl"
                placeholder="0"
              />
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                className="flex-1 h-11 rounded-xl font-semibold bg-emerald-600 hover:bg-emerald-700"
                disabled={createMutation.isPending || !form.gameId || !form.writerId || !form.grossAmount}
              >
                {createMutation.isPending ? "Saving…" : "Add Entry"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editEntry} onOpenChange={o => !o && setEditEntry(null)}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Entry</DialogTitle></DialogHeader>
          {editEntry && (
            <div className="text-sm text-muted-foreground">
              Writer: <span className="text-foreground font-mono font-medium">{writerList.find(w => w.id === editEntry.writerId)?.fullCode ?? editEntry.writerId}</span>
              {" · "}Date: <span className="text-foreground">{relDate(editEntry.entryDate ?? "")}</span>
            </div>
          )}
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Gross Amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={editForm.grossAmount} onChange={e => setEditForm(prev => ({ ...prev, grossAmount: e.target.value }))} required className="h-11 text-sm rounded-xl" inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Booklets Used</Label>
              <Input type="number" min="0" value={editForm.bookletsCount} onChange={e => setEditForm(prev => ({ ...prev, bookletsCount: e.target.value }))} required className="h-11 text-sm rounded-xl" />
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
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
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
                <span className="tabular-nums font-semibold">{fmtGHS(Number(changeReqEntry.grossAmount ?? 0))}</span>
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

function GlanceTile({ icon, tone, label, value, sub, negative, className }: {
  icon: React.ReactNode; tone: string; label: string; value: string; sub?: string; negative?: boolean; className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border bg-card px-3.5 sm:px-4 py-3 shadow-sm min-w-0", className)}>
      <span className={cn("hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">{label}</div>
        <div className={cn("text-[15px] sm:text-lg font-black tabular-nums leading-tight truncate", negative && "text-red-600 dark:text-red-400")}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
      </div>
    </div>
  );
}

function AdminGrossView() {
  const qc = useQueryClient();
  const { writerMap, agentList } = useWriterLookup();
  const { data: myAgent } = useGetMyAgent({ query: { queryKey: getGetMyAgentQueryKey(), enabled: false } });

  const [filterAgentId, setFilterAgentId] = useState("");
  const [filterWriterId, setFilterWriterId] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const { data: filterWriters } = useListWriters(filterAgentId, {}, {
    query: { queryKey: getListWritersQueryKey(filterAgentId, {}), enabled: !!filterAgentId }
  });
  const filterWriterList = Array.isArray(filterWriters) ? filterWriters : [];

  const { data: entries, isLoading } = useListGrossEntries({
    writerId: filterWriterId || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });

  const [selectedAgent, setSelectedAgent] = useState("");
  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent }
  });
  const writerList = Array.isArray(writers) ? writers : [];

  const today = new Date(getServerNow()).toISOString().split("T")[0];
  const [form, setForm] = useState({ writerId: "", entryDate: today, grossAmount: "", bookletsCount: "" });

  // Fetch all gross entries for the selected date to verify which writers have already been entered
  const { data: dateEntries } = useListGrossEntries({
    dateFrom: form.entryDate,
    dateTo: form.entryDate,
  }, {
    query: {
      queryKey: ["grossEntriesForDate", form.entryDate],
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

  const createMutation = useCreateGrossEntry();
  const updateMutation = useUpdateGrossEntry();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<GrossEntry | null>(null);
  const [editForm, setEditForm] = useState({ grossAmount: "", bookletsCount: "" });
  const [writerSearch, setWriterSearch] = useState("");
  const [pin, setPin] = useState("");

  const filteredWriters = useMemo(() => {
    if (!writerSearch) return availableWriters;
    const query = writerSearch.toLowerCase();
    return availableWriters.filter(w =>
      w.fullCode.toLowerCase().includes(query) ||
      w.fullName.toLowerCase().includes(query)
    );
  }, [availableWriters, writerSearch]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/entries/gross"] });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        data: {
          writerId: form.writerId,
          entryDate: form.entryDate,
          grossAmount: form.grossAmount,
          bookletsCount: form.bookletsCount ? parseInt(form.bookletsCount) : 0,
        }
      });
      toast.success("Entry created");
      setCreateOpen(false);
      setSelectedAgent("");
      setForm({ writerId: "", entryDate: today, grossAmount: "", bookletsCount: "" });
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to create entry");
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEntry) return;
    try {
      await updateMutation.mutateAsync({
        id: editEntry.id,
        data: {
          grossAmount: editForm.grossAmount,
          bookletsCount: editForm.bookletsCount ? parseInt(editForm.bookletsCount) : 0,
          pin: editEntry.locked ? pin : undefined,
        }
      });
      toast.success("Entry updated");
      setEditEntry(null);
      setPin("");
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
            <Select value={filterAgentId || "_all"} onValueChange={v => { setFilterAgentId(v === "_all" ? "" : v); setFilterWriterId(""); }}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-[250px] overflow-y-auto">
                <SelectItem value="_all">All agents</SelectItem>
                {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Writer</Label>
            <Select value={filterWriterId || "_all"} onValueChange={v => setFilterWriterId(v === "_all" ? "" : v)} disabled={!filterAgentId}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="All writers" /></SelectTrigger>
              <SelectContent className="max-h-[250px] overflow-y-auto">
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
              <TableHead className="text-right">Gross Amount</TableHead>
              <TableHead className="text-right">Booklets Used</TableHead>
              <TableHead className="pl-8">Recorded At</TableHead>
              <TableHead>Status</TableHead><TableHead className="w-24">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : !Array.isArray(entries) || entries.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">No entries found.</TableCell></TableRow>
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
                  <TableCell className="text-sm text-right font-mono">GH₵ {Number(entry.grossAmount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-sm text-right font-mono">{entry.bookletsCount ?? 0}</TableCell>
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
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditEntry(entry); setEditForm({ grossAmount: entry.grossAmount, bookletsCount: String(entry.bookletsCount ?? 0) }); }}>Edit</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={o => { if (!o) { setSelectedAgent(""); setForm(f => ({ ...f, writerId: "" })); setWriterSearch(""); } setCreateOpen(o); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Gross Entry</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Agent</Label>
              <Select value={selectedAgent} onValueChange={v => { setSelectedAgent(v); setForm(f => ({ ...f, writerId: "" })); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select agent..." /></SelectTrigger>
                <SelectContent className="max-h-[250px] overflow-y-auto">{agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Writer</Label>
              <Select value={form.writerId} onValueChange={v => setForm(f => ({ ...f, writerId: v }))} disabled={!selectedAgent || filteredWriters.length === 0}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={!selectedAgent ? "Select agent..." : filteredWriters.length === 0 ? "No matching writers" : "Select writer..."} />
                </SelectTrigger>
                <SelectContent className="max-h-[250px] overflow-y-auto">
                  {selectedAgent && availableWriters.length > 5 && (
                    <div className="p-2 border-b">
                      <Input
                        placeholder="Search writer..."
                        value={writerSearch}
                        onChange={e => setWriterSearch(e.target.value)}
                        className="h-8 text-xs bg-background"
                      />
                    </div>
                  )}
                  {filteredWriters.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
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
            <div className="space-y-1.5">
              <Label className="text-xs">Booklets Used</Label>
              <Input type="number" min="0" value={form.bookletsCount} onChange={e => setForm(f => ({ ...f, bookletsCount: e.target.value }))} required className="h-9 text-sm" placeholder="0" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending || !form.writerId}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editEntry} onOpenChange={o => { if (!o) { setEditEntry(null); setPin(""); } }}>
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
              <Label className="text-xs">Gross Amount (GH₵)</Label>
              <Input type="number" step="0.01" min="0" value={editForm.grossAmount} onChange={e => setEditForm(prev => ({ ...prev, grossAmount: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Booklets Used</Label>
              <Input type="number" min="0" value={editForm.bookletsCount} onChange={e => setEditForm(prev => ({ ...prev, bookletsCount: e.target.value }))} required className="h-9 text-sm" />
            </div>
            {editEntry && editEntry.locked && (
              <div className="space-y-1.5 border-t pt-3 mt-2">
                <Label className="text-xs font-semibold text-amber-600 dark:text-amber-400">Admin Login PIN Required (Locked Entry)</Label>
                <Input
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  required
                  className="h-10 text-sm font-mono text-center tracking-widest bg-amber-500/5 border-amber-500/30 rounded-xl"
                  placeholder="••••"
                  inputMode="numeric"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">This entry has already been calculated. Enter your 4-digit PIN to authorize this override.</p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditEntry(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending || (editEntry?.locked && pin.length !== 4)}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GrossEntries() {
  const { user } = useAuth();
  if (user?.role === "agent") return <AgentGrossView />;
  return <AdminGrossView />;
}
