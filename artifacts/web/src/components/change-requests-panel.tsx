import { useState, useMemo, useEffect } from "react";
import {
  useListEntryChangeRequests,
  useAdminReviewEntryChangeRequest,
  useDirectorReviewEntryChangeRequest,
  getListEntryChangeRequestsQueryKey,
  type EntryChangeRequest,
  useListGames,
  useListWriters,
  useGetMyAgent,
  getGetMyAgentQueryKey,
  useListGrossEntries,
  useListWinsEntries,
  useCreateEntryChangeRequest,
  getListWritersQueryKey,
  getListGrossEntriesQueryKey,
  getListWinsEntriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search, Plus, ArrowRight, Clock, CheckCircle2, XCircle, Inbox, FileEdit, TrendingUp, TrendingDown,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getServerNow } from "@/lib/time-sync";

/**
 * Entry change requests: corrections agents ask for on gross and wins entries
 * that are already locked.
 *
 * One component, two audiences. Administrators and directors review from the
 * Settings page; agents submit and follow their own requests from their menu.
 * The server already limits an agent to their own requests, so the list is
 * the same call for both.
 *
 * An administrator's approval applies the new amount there and then - there
 * is no second step. "Awaiting director" survives only for requests filed
 * before that was the rule, and a director can still clear them.
 */

const ghs = (v: number | string) => {
  const n = Number(v);
  const s = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}GH₵ ${s}`;
};
const fmtDay = (s: string | null | undefined) =>
  s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtWhen = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const ageDays = (s: string) => Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86_400_000));

type StatusKey = EntryChangeRequest["status"];
const STATUS: Record<string, { label: string; dot: string; chip: string; edge: string }> = {
  pending_admin: {
    label: "Awaiting review", dot: "bg-amber-500", edge: "border-l-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  pending_director: {
    label: "Awaiting director", dot: "bg-indigo-500", edge: "border-l-indigo-500",
    chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30",
  },
  approved: {
    label: "Approved · applied", dot: "bg-emerald-500", edge: "border-l-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  rejected: {
    label: "Rejected", dot: "bg-rose-500", edge: "border-l-rose-500",
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
  },
};
const statusOf = (s: StatusKey) => STATUS[s] ?? { label: s, dot: "bg-slate-400", edge: "border-l-slate-400", chip: "bg-muted text-muted-foreground" };
const isPending = (s: StatusKey) => s === "pending_admin" || s === "pending_director";

type View = "pending" | "approved" | "rejected" | "all";

function StatusChip({ status }: { status: StatusKey }) {
  const s = statusOf(status);
  return <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${s.chip}`}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}</span>;
}

function TypeChip({ type }: { type: string }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${type === "gross" ? "text-sky-700 dark:text-sky-400 border-sky-500/30 bg-sky-500/10" : "text-violet-700 dark:text-violet-400 border-violet-500/30 bg-violet-500/10"}`}>
      {type === "gross" ? "Gross" : "Wins"}
    </span>
  );
}

function Diff({ from, to, size = "sm" }: { from: string; to: string; size?: "sm" | "lg" }) {
  const d = Number(to) - Number(from);
  const big = size === "lg";
  return (
    <div className={`flex items-center gap-2 ${big ? "flex-wrap" : ""}`}>
      <span className={`font-mono text-muted-foreground line-through decoration-muted-foreground/40 ${big ? "text-base" : "text-xs"}`}>{ghs(from)}</span>
      <ArrowRight className={`${big ? "w-4 h-4" : "w-3 h-3"} text-muted-foreground shrink-0`} />
      <span className={`font-mono font-bold ${big ? "text-xl" : "text-sm"}`}>{ghs(to)}</span>
      <span className={`inline-flex items-center gap-0.5 font-mono font-bold rounded-full px-1.5 py-0.5 ${big ? "text-xs" : "text-[10px]"} ${d >= 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/10 text-rose-700 dark:text-rose-400"}`}>
        {d >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{d >= 0 ? "+" : ""}{ghs(d)}
      </span>
    </div>
  );
}

export function ChangeRequestsPanel({ variant }: { variant: "review" | "agent" }) {
  const { user } = useAuth();
  const role = user?.role ?? "";
  const qc = useQueryClient();
  const isAgent = variant === "agent";

  const [view, setView] = useState<View>("pending");
  const [typeFilter, setTypeFilter] = useState<"all" | "gross" | "wins">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [verdict, setVerdict] = useState<"approve" | "reject">("approve");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useListEntryChangeRequests({}, {
    query: { queryKey: getListEntryChangeRequestsQueryKey({}), refetchInterval: 60_000 },
  });
  const requests: EntryChangeRequest[] = Array.isArray(data) ? data : [];

  const counts = useMemo(() => {
    const pending = requests.filter(r => isPending(r.status));
    const approved = requests.filter(r => r.status === "approved");
    return {
      pending: pending.length,
      approved: approved.length,
      rejected: requests.filter(r => r.status === "rejected").length,
      all: requests.length,
      oldestPending: pending.reduce((m, r) => Math.max(m, ageDays(r.createdAt)), 0),
      netApplied: approved.reduce((s, r) => s + (Number(r.requestedAmount) - Number(r.currentAmount)), 0),
    };
  }, [requests]);

  const visible = useMemo(() => {
    let list = requests;
    if (view === "pending") list = list.filter(r => isPending(r.status));
    else if (view !== "all") list = list.filter(r => r.status === view);
    if (typeFilter !== "all") list = list.filter(r => r.entryType === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(r => [r.writerFullCode, r.writerFullName, r.agentFullCode, r.agentName, r.requestedByName, r.reason]
        .some(v => (v ?? "").toLowerCase().includes(q)));
    }
    // The queue is worked oldest first; everything else reads newest first.
    return view === "pending"
      ? [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : list;
  }, [requests, view, typeFilter, search]);

  // Keep a sensible selection as the list changes underneath it.
  useEffect(() => {
    if (visible.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !visible.some(r => r.id === selectedId)) setSelectedId(visible[0]!.id);
  }, [visible, selectedId]);
  const selected = visible.find(r => r.id === selectedId) ?? null;

  useEffect(() => { setVerdict("approve"); setNote(""); }, [selectedId]);

  const adminReview = useAdminReviewEntryChangeRequest();
  const directorReview = useDirectorReviewEntryChangeRequest();
  const canReview = (r: EntryChangeRequest) =>
    !isAgent && ((r.status === "pending_admin" && (role === "administrator" || role === "director")) ||
      (r.status === "pending_director" && role === "director"));

  const submitReview = async () => {
    if (!selected) return;
    if (verdict === "reject" && note.trim().length < 3) {
      toast.error("Say why it is rejected - the agent receives this note.");
      return;
    }
    setSubmitting(true);
    try {
      const body = { id: selected.id, data: { action: verdict, note: note.trim() || undefined } };
      if (selected.status === "pending_director") await directorReview.mutateAsync(body);
      else await adminReview.mutateAsync(body);
      toast.success(verdict === "approve"
        ? `Applied: ${selected.writerFullCode ?? "entry"} is now ${ghs(selected.requestedAmount)}`
        : "Request rejected - the agent has been notified");
      await qc.invalidateQueries({ queryKey: getListEntryChangeRequestsQueryKey({}) });
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Review failed");
    } finally {
      setSubmitting(false);
    }
  };

  const tiles: Array<{ key: View; label: string; value: string; sub: string; edge: string; text: string; icon: React.ReactNode }> = [
    { key: "pending", label: isAgent ? "Waiting" : "Awaiting review", value: String(counts.pending), sub: counts.pending ? `oldest ${counts.oldestPending}d` : "queue is clear", edge: "border-l-amber-500", text: "text-amber-600 dark:text-amber-400", icon: <Clock className="w-4 h-4" /> },
    { key: "approved", label: "Approved", value: String(counts.approved), sub: `net ${counts.netApplied >= 0 ? "+" : ""}${ghs(counts.netApplied)} applied`, edge: "border-l-emerald-500", text: "text-emerald-600 dark:text-emerald-400", icon: <CheckCircle2 className="w-4 h-4" /> },
    { key: "rejected", label: "Rejected", value: String(counts.rejected), sub: "not applied", edge: "border-l-rose-500", text: "text-rose-600 dark:text-rose-400", icon: <XCircle className="w-4 h-4" /> },
    { key: "all", label: "All requests", value: String(counts.all), sub: "full history", edge: "border-l-slate-400", text: "text-foreground", icon: <Inbox className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-5">
      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-6 rounded-full bg-amber-500" />
          <div>
            <h2 className="text-lg font-bold">{isAgent ? "My Change Requests" : "Entry Change Requests"}</h2>
            <p className="text-[11px] text-muted-foreground">
              {isAgent
                ? "Ask for a correction to a gross or wins entry that is already locked, and follow its review."
                : "Corrections agents have asked for on locked gross and wins entries. Approving applies the new amount immediately and notifies the agent."}
            </p>
          </div>
        </div>
        {isAgent && <NewRequestButton />}
      </div>

      {/* Status tiles double as filters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            className={`text-left bg-card border border-border border-l-4 ${t.edge} rounded-2xl p-3.5 shadow-sm transition-all min-w-0 ${view === t.key ? "ring-2 ring-primary/40 shadow-md" : "hover:shadow-md"}`}>
            <div className="flex items-center justify-between text-[10px] uppercase font-black tracking-wider text-muted-foreground">{t.label}<span className="opacity-70">{t.icon}</span></div>
            <div className={`font-mono text-2xl font-black mt-1 ${t.text}`}>{t.value}</div>
            <div className="text-[10px] text-muted-foreground truncate">{t.sub}</div>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 self-start">
          {(["all", "gross", "wins"] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`text-[11px] font-semibold px-3 py-1 rounded-md transition-colors ${typeFilter === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "all" ? "All entries" : t === "gross" ? "Gross" : "Wins"}
            </button>
          ))}
        </div>
        <div className="relative md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search writer, agency, reason…" className="pl-9 h-9 text-xs" />
        </div>
      </div>

      {/* Queue + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-4 items-start">
        <div className="rounded-2xl border bg-card overflow-hidden min-w-0">
          <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between text-[10px] uppercase font-black tracking-wider text-muted-foreground">
            <span>{view === "pending" ? "Queue · oldest first" : view === "all" ? "All requests · newest first" : `${tiles.find(t => t.key === view)?.label} · newest first`}</span>
            <span>{visible.length}</span>
          </div>
          {isLoading ? (
            <div className="p-4 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center px-6">
              <FileEdit className="w-8 h-8 mx-auto text-muted-foreground/50" />
              <p className="text-sm font-semibold mt-3">{view === "pending" ? "Nothing waiting for review" : "No requests here"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {isAgent ? "Use New request to ask for a correction to a locked entry." : search || typeFilter !== "all" ? "Try clearing the search or entry filter." : "New requests from agents appear here."}
              </p>
            </div>
          ) : (
            <div className="divide-y max-h-[640px] overflow-y-auto">
              {visible.map(r => {
                const st = statusOf(r.status);
                const active = r.id === selectedId;
                const age = ageDays(r.createdAt);
                return (
                  <button key={r.id} onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left px-4 py-3 border-l-4 transition-colors ${active ? `${st.edge} bg-muted/50` : "border-l-transparent hover:bg-muted/30"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold">{r.writerFullCode ?? "Writer"}</span>
                          <span className="text-xs text-muted-foreground truncate">{r.writerFullName}</span>
                          <TypeChip type={r.entryType} />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {fmtDay(r.entryDate)}{r.agentFullCode && !isAgent ? ` · ${r.agentFullCode}` : ""}
                          {isPending(r.status) ? ` · waiting ${age === 0 ? "since today" : `${age}d`}` : ""}
                        </div>
                      </div>
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${st.dot}`} title={st.label} />
                    </div>
                    <div className="mt-1.5"><Diff from={r.currentAmount} to={r.requestedAmount} /></div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="rounded-2xl border bg-card p-5 space-y-5 lg:sticky lg:top-4 min-w-0">
          {!selected ? (
            <div className="py-16 text-center text-xs text-muted-foreground">Select a request to see its details.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-base font-black">{selected.writerFullCode}</span>
                    <TypeChip type={selected.entryType} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{selected.writerFullName}{selected.agentName && !isAgent ? ` · ${selected.agentName} (${selected.agentFullCode})` : ""}</div>
                </div>
                <StatusChip status={selected.status} />
              </div>

              <div className="rounded-xl bg-muted/40 p-4 space-y-2">
                <div className="text-[10px] uppercase font-black tracking-wider text-muted-foreground">
                  {selected.entryType === "gross" ? "Gross" : "Wins"} entry for {fmtDay(selected.entryDate)}
                </div>
                <Diff from={selected.currentAmount} to={selected.requestedAmount} size="lg" />
              </div>

              <div>
                <div className="text-[10px] uppercase font-black tracking-wider text-muted-foreground mb-1">Reason given</div>
                <p className="text-sm leading-relaxed">“{selected.reason}”</p>
              </div>

              {/* Trail */}
              <ol className="relative border-l border-border ml-1.5 space-y-3 pl-4">
                <li className="relative">
                  <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-sky-500 ring-4 ring-background" />
                  <div className="text-xs"><span className="font-semibold">Requested</span> by {selected.requestedByName ?? "agent"}</div>
                  <div className="text-[10px] text-muted-foreground">{fmtWhen(selected.createdAt)}</div>
                </li>
                {(selected.reviewedByAdminName || selected.adminNote) && (
                  <li className="relative">
                    <span className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-background ${selected.status === "rejected" && !selected.reviewedByDirectorName ? "bg-rose-500" : "bg-emerald-500"}`} />
                    <div className="text-xs"><span className="font-semibold">Reviewed</span> by {selected.reviewedByAdminName ?? "administrator"}</div>
                    <div className="text-[10px] text-muted-foreground">{fmtWhen(selected.adminReviewedAt)}</div>
                    {selected.adminNote && <p className="text-xs text-muted-foreground italic mt-0.5">“{selected.adminNote}”</p>}
                  </li>
                )}
                {(selected.reviewedByDirectorName || selected.directorNote) && (
                  <li className="relative">
                    <span className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-background ${selected.status === "rejected" ? "bg-rose-500" : "bg-emerald-500"}`} />
                    <div className="text-xs"><span className="font-semibold">Director decision</span> by {selected.reviewedByDirectorName ?? "director"}</div>
                    <div className="text-[10px] text-muted-foreground">{fmtWhen(selected.directorReviewedAt)}</div>
                    {selected.directorNote && <p className="text-xs text-muted-foreground italic mt-0.5">“{selected.directorNote}”</p>}
                  </li>
                )}
                {isPending(selected.status) && (
                  <li className="relative">
                    <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-4 ring-background animate-pulse" />
                    <div className="text-xs font-semibold">{selected.status === "pending_director" ? "Waiting for a director" : "Waiting for review"}</div>
                    <div className="text-[10px] text-muted-foreground">{ageDays(selected.createdAt) === 0 ? "since today" : `${ageDays(selected.createdAt)} days`}</div>
                  </li>
                )}
              </ol>

              {canReview(selected) && (
                <div className="border-t pt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setVerdict("approve")}
                      className={`py-2 rounded-xl text-xs font-bold border-2 transition-colors ${verdict === "approve" ? "border-emerald-600 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-border text-muted-foreground hover:text-foreground"}`}>
                      Approve
                    </button>
                    <button onClick={() => setVerdict("reject")}
                      className={`py-2 rounded-xl text-xs font-bold border-2 transition-colors ${verdict === "reject" ? "border-rose-600 bg-rose-500/10 text-rose-700 dark:text-rose-400" : "border-border text-muted-foreground hover:text-foreground"}`}>
                      Reject
                    </button>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Note to the agent {verdict === "reject" ? <span className="text-rose-600">(required)</span> : <span className="text-muted-foreground">(optional)</span>}</Label>
                    <Textarea value={note} onChange={e => setNote(e.target.value)} className="resize-none text-xs h-20"
                      placeholder={verdict === "reject" ? "Why this correction is not accepted…" : "Anything the agent should know…"} />
                  </div>
                  <Button onClick={submitReview} disabled={submitting} className={`w-full font-semibold ${verdict === "reject" ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}>
                    {submitting ? "Saving…" : verdict === "approve" ? `Approve and set to ${ghs(selected.requestedAmount)}` : "Reject request"}
                  </Button>
                  {verdict === "approve" && (
                    <p className="text-[10px] text-muted-foreground">The {selected.entryType} entry changes from {ghs(selected.currentAmount)} to {ghs(selected.requestedAmount)} as soon as you approve.</p>
                  )}
                </div>
              )}
              {!isAgent && selected.status === "pending_director" && role !== "director" && (
                <p className="text-[11px] text-muted-foreground border-t pt-3">Only a director can decide this request.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The agent's "New request" button and form. Unchanged in what it submits. */
function NewRequestButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [gameId, setGameId] = useState("");
  const [writerId, setWriterId] = useState("");
  const [type, setType] = useState<"gross" | "wins">("gross");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: myAgent } = useGetMyAgent({ query: { queryKey: getGetMyAgentQueryKey(), enabled: open } });
  const { data: gamesData } = useListGames();
  const lockedGames = useMemo(() => {
    const list = Array.isArray(gamesData) ? gamesData : [];
    return list.filter(g => g.status === "closed" || new Date(g.closeAt) <= new Date(getServerNow()));
  }, [gamesData]);
  const { data: writersData } = useListWriters(myAgent?.id ?? "", {}, {
    query: { queryKey: getListWritersQueryKey(myAgent?.id ?? "", {}), enabled: !!myAgent?.id },
  });
  const writers = Array.isArray(writersData) ? writersData : [];

  const scope = { gameId: gameId || undefined, writerId: writerId || undefined };
  const gross = useListGrossEntries(scope, { query: { queryKey: getListGrossEntriesQueryKey(scope), enabled: type === "gross" && !!gameId && !!writerId } });
  const wins = useListWinsEntries(scope, { query: { queryKey: getListWinsEntriesQueryKey(scope), enabled: type === "wins" && !!gameId && !!writerId } });
  const entries = type === "gross" ? gross.data : wins.data;
  const fetching = type === "gross" ? gross.isLoading : wins.isLoading;
  const entry = Array.isArray(entries) && entries.length > 0 ? entries[0] : null;
  const current = entry ? (type === "gross" ? (entry as { grossAmount: string }).grossAmount : (entry as { winsAmount: string }).winsAmount) : null;

  const create = useCreateEntryChangeRequest();
  const reset = () => { setGameId(""); setWriterId(""); setAmount(""); setReason(""); setType("gross"); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entry) return;
    setSubmitting(true);
    try {
      await create.mutateAsync({ data: { entryType: type, entryId: entry.id, requestedAmount: amount, reason } });
      toast.success("Change request submitted");
      setOpen(false);
      reset();
      qc.invalidateQueries({ queryKey: getListEntryChangeRequestsQueryKey({}) });
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="font-semibold gap-1.5 self-start"><Plus className="w-4 h-4" /> New request</Button>
      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Request a correction</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Locked game</Label>
              <Select value={gameId} onValueChange={setGameId}>
                <SelectTrigger className="h-10 text-xs"><SelectValue placeholder="Select a game…" /></SelectTrigger>
                <SelectContent className="max-h-[250px]">
                  {lockedGames.map(g => (
                    <SelectItem key={g.id} value={g.id} className="text-xs">#{g.eventNumber} — {g.name} ({new Date(g.closeAt).toLocaleDateString("en-GB")})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Writer</Label>
              <Select value={writerId} onValueChange={setWriterId}>
                <SelectTrigger className="h-10 text-xs"><SelectValue placeholder="Select a writer…" /></SelectTrigger>
                <SelectContent className="max-h-[250px]">
                  {writers.map(w => <SelectItem key={w.id} value={w.id} className="text-xs">{w.fullCode} — {w.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs block">Entry</Label>
              <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
                {(["gross", "wins"] as const).map(t => (
                  <button type="button" key={t} onClick={() => setType(t)}
                    className={`text-xs font-semibold px-4 py-1.5 rounded-md ${type === t ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
                    {t === "gross" ? "Gross" : "Wins"}
                  </button>
                ))}
              </div>
            </div>
            {gameId && writerId && (
              <div className="rounded-xl border bg-muted/30 p-4 space-y-3 text-xs">
                {fetching ? <div className="text-center text-muted-foreground">Looking up the entry…</div> : entry ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Current amount</span><span className="font-mono font-bold">{ghs(current ?? 0)}</span></div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Correct amount (GH₵)</Label>
                      <Input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Reason</Label>
                      <Textarea value={reason} onChange={e => setReason(e.target.value)} required className="resize-none text-xs h-20" placeholder="e.g. keying error on the original booklet" />
                    </div>
                  </>
                ) : <div className="text-center text-rose-600 font-semibold">No {type} entry for this writer on that game.</div>}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" size="sm" disabled={submitting || !entry || !amount || reason.trim().length < 5}>
                {submitting ? "Submitting…" : "Submit request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
