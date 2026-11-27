import { useMemo, useRef, useState } from "react";
import { Search, Users, UserCheck, UserX, CreditCard } from "lucide-react";
import { Pager, usePaged } from "@/components/data-kit";
import { cn } from "@/lib/utils";
import { useGetMyAgent, getGetMyAgentQueryKey, useListWriters, useCreateWriter, useUpdateWriter, getListWritersQueryKey, Writer } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WriterLocationField, locationPayload } from "@/components/writer-location-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { IssuePinDialog, type IssuePinTarget } from "@/components/issue-pin-dialog";
import { ModelRequestsPanel } from "@/components/model-requests-panel";
import { WriterMomoFields, useWriterMomoForm } from "@/components/writer-momo-fields";

const WRITERS_PER_PAGE = 12;

const AVATAR_COLORS = [
  "bg-blue-600","bg-emerald-600","bg-violet-600","bg-orange-500",
  "bg-pink-600","bg-teal-600","bg-cyan-600","bg-rose-600",
];

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  const sz = size === "lg" ? "w-14 h-14 text-xl" : size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  return (
    <div className={`${sz} rounded-full ${color} flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {initials || "?"}
    </div>
  );
}

function Stat({ icon, tone, label, value, className }: { icon: React.ReactNode; tone: string; label: string; value: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border bg-card px-3 sm:px-4 py-3", className)}>
      <span className={cn("hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xl font-black tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export function MyWriters() {
  const qc = useQueryClient();

  const { data: agent, isLoading: agentLoading, isError } = useGetMyAgent({
    query: { queryKey: getGetMyAgentQueryKey() }
  });

  const { data: writers, isLoading: writersLoading } = useListWriters(agent?.id ?? "", {}, {
    query: { queryKey: getListWritersQueryKey(agent?.id ?? "", {}), enabled: !!agent?.id }
  });
  const writerList: Writer[] = Array.isArray(writers) ? writers : [];

  const createMutation = useCreateWriter();
  const updateMutation = useUpdateWriter();

  const [addOpen, setAddOpen] = useState(false);
  const [editWriter, setEditWriter] = useState<Writer | null>(null);
  const [pinWriter, setPinWriter] = useState<IssuePinTarget | null>(null);
  const [createForm, setCreateForm] = useState({ writerCode: "", fullName: "", phone: "", operationModel: "postpaid", location: "", lat: "", lng: "" });
  const [issued, setIssued] = useState<{ name: string; fullCode: string; pin: string } | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", isActive: true, location: "", lat: "", lng: "" });

  const invalidate = () => agent?.id && qc.invalidateQueries({ queryKey: getListWritersQueryKey(agent.id, {}) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent?.id) return;
    try {
      const created = await createMutation.mutateAsync({
        agentId: agent.id,
        data: {
          writerCode: createForm.writerCode.trim().toUpperCase(),
          fullName: createForm.fullName.trim(),
          phone: createForm.phone.trim(),
          operationModel: createForm.operationModel as "prepaid" | "postpaid",
          ...locationPayload(createForm),
        },
      });
      setAddOpen(false);
      setCreateForm({ writerCode: "", fullName: "", phone: "", operationModel: "postpaid", location: "", lat: "", lng: "" });
      invalidate();
      if (created?.pin) {
        // Shown once - only the hash is stored server-side.
        setIssued({ name: created.fullName, fullCode: created.fullCode, pin: created.pin });
      } else {
        toast.success("Writer added successfully");
      }
    } catch (err: any) {
      toast.error(err?.data?.error ?? err?.response?.data?.error ?? "Failed to add writer");
    }
  };

  const momo = useWriterMomoForm(editWriter?.id);
  const [momoTouched, setMomoTouched] = useState(false);
  const [savingMomo, setSavingMomo] = useState(false);

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editWriter) return;
    // An active writer must have a payout wallet; a deactivated one may not.
    if (editForm.isActive && !momo.valid) {
      setMomoTouched(true);
      toast.error(momo.problem ?? "Add the writer's MoMo wallet");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: editWriter.id,
        data: {
          fullName: editForm.fullName.trim() || undefined,
          isActive: editForm.isActive,
          // An agent can pin their own writers from here. Sent on every save so
          // the ones added before the field existed can be completed in place.
          location: editForm.location.trim(),
          lat: editForm.lat,
          lng: editForm.lng,
        },
      });
      if (momo.dirty && momo.valid) {
        setSavingMomo(true);
        try {
          const name = await momo.save();
          toast.success("Writer updated", {
            description: name ? `MoMo wallet confirmed: ${name}` : "MoMo wallet saved. The network did not confirm the name - check the number with the writer.",
          });
        } catch (err) {
          toast.error((err as Error).message || "The MoMo wallet was not saved");
          invalidate();
          return;
        } finally {
          setSavingMomo(false);
        }
      } else {
        toast.success("Writer updated");
      }
      setEditWriter(null);
      invalidate();
    } catch {
      toast.error("Failed to update writer");
    }
  };

  const activeCount = writerList.filter(w => w.isActive).length;
  const postpaidCount = writerList.filter(w => w.operationModel === "postpaid").length;

  // Search and status narrow the list; the pager then works on what is left.
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive" | "nomomo">("all");
  const hasMomo = (w: Writer) => !!(w as { momoNumber?: string | null }).momoNumber;
  const noMomoActive = writerList.filter(w => w.isActive && !hasMomo(w)).length;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return writerList
      .filter(w => status === "all" || (status === "active" ? w.isActive : status === "inactive" ? !w.isActive : !hasMomo(w)))
      .filter(w => !q || w.fullName.toLowerCase().includes(q) || w.fullCode.toLowerCase().includes(q) || (w.phone ?? "").includes(q));
  }, [writerList, query, status]);
  const paged = usePaged(filtered, WRITERS_PER_PAGE, `${query}|${status}`);
  const listRef = useRef<HTMLDivElement>(null);
  const goToPage = (p: number) => {
    paged.setPage(p);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    listRef.current?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // On a phone the list does not scroll on its own; bring its top into view.
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 80) listRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  if (agentLoading) {
    return (
      <div className="px-4 pt-5 space-y-4 max-w-xl mx-auto md:max-w-2xl">
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="px-4 pt-10 text-center max-w-xl mx-auto md:max-w-2xl">
        <div className="text-4xl mb-3">🔍</div>
        <div className="text-sm font-medium text-foreground">No agent profile found</div>
        <div className="text-xs text-muted-foreground mt-1">Contact your administrator to set up your agent account.</div>
      </div>
    );
  }

  return (
    <div className="pb-4">
      {/* Sticky header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border z-10 px-4 py-3">
        <div className="flex items-center gap-3 max-w-xl mx-auto md:max-w-3xl lg:max-w-5xl">
          <div className="flex-1">
            <h1 className="text-base font-semibold">My Writers</h1>
            <p className="text-xs text-muted-foreground">{activeCount} active · {writerList.length} total</p>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-xl text-sm font-semibold active:scale-95 transition-transform shadow-sm"
          >
            <PlusIcon /> Add
          </button>
        </div>
      </div>

      <div className="mx-auto w-[calc(100%-2rem)] max-w-xl md:max-w-3xl lg:max-w-5xl pt-4 space-y-4">
        {/* Agency at a glance */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
          <div className="col-span-3 sm:col-span-1 flex items-center justify-between gap-3 sm:block rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Agent code</div>
            <div className="sm:mt-1 text-lg font-black font-mono text-primary leading-tight">{agent.fullCode}</div>
          </div>
          <Stat icon={<UserCheck className="h-4 w-4" />} tone="text-emerald-600 bg-emerald-500/10" label="Active" value={activeCount} />
          <Stat icon={<UserX className="h-4 w-4" />} tone="text-slate-500 bg-slate-500/10" label="Inactive" value={writerList.length - activeCount} />
          <Stat icon={<CreditCard className="h-4 w-4" />} tone="text-indigo-600 bg-indigo-500/10" label="Postpaid" value={postpaidCount} />
        </div>

        {/* A writer with no wallet cannot be paid when a ticket wins. */}
        {noMomoActive > 0 && (
          <button type="button" onClick={() => setStatus("nomomo")}
            className="flex w-full items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-xs text-amber-900 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:text-amber-200 transition-colors">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            <span>
              <span className="font-semibold">{noMomoActive} active writer{noMomoActive === 1 ? " has" : "s have"} no MoMo wallet.</span>{" "}
              Their winning tickets cannot be paid out. Tap to list them, then use Edit to add a wallet.
            </span>
          </button>
        )}

        {/* Credit requests reach the agent here - previously they reached nobody. */}
        <ModelRequestsPanel />

        {/* Writers: search, status, a scrolling list and a pager */}
        <section className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Users className="h-4 w-4 text-muted-foreground shrink-0" />
              <h2 className="text-sm font-bold">Writers</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">{filtered.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-56 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search writers"
                  aria-label="Search writers" className="h-9 pl-8 text-xs rounded-lg" />
              </div>
              <div role="group" aria-label="Status" className="inline-flex h-9 items-center rounded-lg border bg-muted/40 p-0.5 shrink-0">
                {(["all", "active", "inactive", "nomomo"] as const).map(k => (
                  <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k}
                    className={cn("h-7 rounded-md px-2 sm:px-2.5 text-[11px] font-semibold capitalize transition-colors whitespace-nowrap",
                      status === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {k === "nomomo" ? "No MoMo" : k}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Column heads, desktop only */}
          <div className="hidden md:grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7rem_6rem_5.5rem] gap-3 border-b bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Writer</span><span>Phone</span><span>Model</span><span>Status</span><span className="text-right">Actions</span>
          </div>

          <div ref={listRef} className="max-h-[min(36rem,62vh)] overflow-y-auto overscroll-contain scroll-mt-40">
            {writersLoading ? (
              <div className="p-3 space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : writerList.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <div className="mt-3 font-medium text-sm text-foreground">No writers yet</div>
                <div className="text-xs mt-1">Tap Add to register your first writer</div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-14 text-center text-xs text-muted-foreground">No writers match this search.</div>
            ) : (
              <ul className="divide-y">
                {paged.rows.map(w => (
                  <li key={w.id}
                    className={cn("grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7rem_6rem_5.5rem] items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors",
                      !w.isActive && "opacity-60")}>
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={w.fullName} size="md" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{w.fullName}</div>
                        <div className="text-xs font-mono text-muted-foreground truncate">
                          {w.fullCode}
                        </div>
                      </div>
                    </div>
                    <span className="hidden md:block min-w-0">
                      <span className="block text-xs font-mono text-muted-foreground truncate">{w.phone || "—"}</span>
                      {!(w as { momoNumber?: string | null }).momoNumber && (
                        <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">No MoMo wallet</span>
                      )}
                    </span>
                    <span className="hidden md:block">
                      {w.operationModel ? (
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                          w.operationModel === "postpaid" ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" : "bg-muted text-muted-foreground")}>
                          {w.operationModel}
                        </span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </span>
                    <div className="flex items-center justify-end gap-1 md:contents">
                      {!(w as { momoNumber?: string | null }).momoNumber && (
                        <span title="No MoMo wallet: winning tickets cannot be paid" className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 md:hidden">No MoMo</span>
                      )}
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full md:justify-self-start",
                        w.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                        {w.isActive ? "Active" : "Inactive"}
                      </span>
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          title="Issue or reset sign-in PIN"
                          aria-label={`Issue or reset sign-in PIN for ${w.fullName}`}
                          onClick={() => setPinWriter({
                            id: w.id,
                            fullName: w.fullName,
                            fullCode: w.fullCode,
                            phone: w.phone ?? null,
                            hasPin: undefined,
                          })}
                          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="7.5" cy="15.5" r="5.5"/>
                            <path d="m21 2-9.6 9.6"/>
                            <path d="m15.5 7.5 3 3L22 7l-3-3"/>
                          </svg>
                        </button>
                        <button
                          title="Edit writer"
                          aria-label={`Edit ${w.fullName}`}
                          onClick={() => { setMomoTouched(false); setEditWriter(w); setEditForm({ fullName: w.fullName, isActive: w.isActive, location: w.location ?? "", lat: w.lat ?? "", lng: w.lng ?? "" }); }}
                          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95"
                        >
                          <EditIcon />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Pager page={paged.page} totalPages={paged.totalPages} onPage={goToPage} total={paged.total} size={paged.size} noun="writers" />
        </section>
      </div>

      <Dialog open={addOpen} onOpenChange={o => { if (!o) setCreateForm({ writerCode: "", fullName: "", phone: "", operationModel: "postpaid", location: "", lat: "", lng: "" }); setAddOpen(o); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Writer</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Full code will be <span className="font-mono font-semibold">{agent.fullCode}-XXXX</span>
          </p>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Writer Code <span className="text-muted-foreground">(up to 6 chars)</span></Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground font-mono flex-shrink-0">{agent.fullCode}-</span>
                <Input
                  value={createForm.writerCode}
                  onChange={e => setCreateForm(f => ({ ...f, writerCode: e.target.value.toUpperCase() }))}
                  required maxLength={6}
                  className="h-11 text-sm font-mono uppercase rounded-xl"
                  placeholder="CK01"
                  autoCapitalize="characters"
                  autoCorrect="off"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Full Name</Label>
              <Input
                value={createForm.fullName}
                onChange={e => setCreateForm(f => ({ ...f, fullName: e.target.value }))}
                required
                className="h-11 text-sm rounded-xl"
                placeholder="e.g. Carlos King"
                autoComplete="name"
              />
            </div>
            <WriterLocationField
              value={{ location: createForm.location, lat: createForm.lat, lng: createForm.lng }}
              onChange={v => setCreateForm(f => ({ ...f, ...v }))}
            />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Phone Number</Label>
              <Input
                type="tel"
                value={createForm.phone}
                onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                required
                className="h-11 text-sm rounded-xl"
                placeholder="024XXXXXXX"
                autoComplete="tel"
              />
              <p className="text-[11px] text-muted-foreground">Used to sign in to the writer portal.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Operation Model</Label>
              <select
                value={createForm.operationModel}
                onChange={e => setCreateForm(f => ({ ...f, operationModel: e.target.value }))}
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              >
                <option value="postpaid">Postpaid (settle daily)</option>
                <option value="prepaid">Prepaid (buy tokens up front)</option>
              </select>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1 h-11 rounded-xl font-semibold" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding…" : "Add Writer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issued} onOpenChange={o => !o && setIssued(null)}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-5 sm:p-6">
          <DialogHeader><DialogTitle>Writer added</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Give this PIN to {issued?.name}. It is shown only once and cannot be
            retrieved later — if it is lost, reset the PIN instead.
          </p>
          <div className="rounded-xl border bg-muted/50 p-4 text-center space-y-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Writer ID</div>
              <div className="font-mono font-semibold">{issued?.fullCode}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">PIN</div>
              <div className="text-3xl font-mono font-bold tracking-[0.3em]">{issued?.pin}</div>
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full h-11 rounded-xl font-semibold" onClick={() => setIssued(null)}>
              I have recorded it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IssuePinDialog writer={pinWriter} onClose={() => setPinWriter(null)} />

      <Dialog open={!!editWriter} onOpenChange={o => !o && setEditWriter(null)}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Writer</DialogTitle></DialogHeader>
          {editWriter && <p className="text-xs text-muted-foreground font-mono">{editWriter.fullCode}</p>}
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Full Name</Label>
              <Input
                value={editForm.fullName}
                onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))}
                required
                className="h-11 text-sm rounded-xl"
                autoComplete="name"
              />
            </div>
            <WriterMomoFields form={momo} idPrefix="my-writers-momo" touched={momoTouched} />
            <WriterLocationField
              id="my-writers-edit-location"
              required={false}
              value={{ location: editForm.location, lat: editForm.lat, lng: editForm.lng }}
              onChange={v => setEditForm(f => ({ ...f, ...v }))}
            />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Status</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditForm(f => ({ ...f, isActive: true }))}
                  className={`flex-1 py-2.5 text-sm rounded-xl border font-medium transition-colors ${editForm.isActive ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setEditForm(f => ({ ...f, isActive: false }))}
                  className={`flex-1 py-2.5 text-sm rounded-xl border font-medium transition-colors ${!editForm.isActive ? "bg-secondary text-secondary-foreground border-border" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  Inactive
                </button>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setEditWriter(null)}>Cancel</Button>
              <Button type="submit" className="flex-1 h-11 rounded-xl font-semibold" disabled={updateMutation.isPending || savingMomo}>
                {updateMutation.isPending || savingMomo ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
