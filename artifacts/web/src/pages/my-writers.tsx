import { useState } from "react";
import { useGetMyAgent, getGetMyAgentQueryKey, useListWriters, useCreateWriter, useUpdateWriter, getListWritersQueryKey, Writer } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

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
  const [createForm, setCreateForm] = useState({ writerCode: "", fullName: "" });
  const [editForm, setEditForm] = useState({ fullName: "", isActive: true });

  const invalidate = () => agent?.id && qc.invalidateQueries({ queryKey: getListWritersQueryKey(agent.id, {}) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent?.id) return;
    try {
      await createMutation.mutateAsync({
        agentId: agent.id,
        data: { writerCode: createForm.writerCode.trim().toUpperCase(), fullName: createForm.fullName.trim() },
      });
      toast.success("Writer added successfully");
      setAddOpen(false);
      setCreateForm({ writerCode: "", fullName: "" });
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? err?.response?.data?.error ?? "Failed to add writer");
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editWriter) return;
    try {
      await updateMutation.mutateAsync({
        id: editWriter.id,
        data: { fullName: editForm.fullName.trim() || undefined, isActive: editForm.isActive },
      });
      toast.success("Writer updated");
      setEditWriter(null);
      invalidate();
    } catch {
      toast.error("Failed to update writer");
    }
  };

  const activeCount = writerList.filter(w => w.isActive).length;

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
        <div className="flex items-center gap-3 max-w-xl mx-auto md:max-w-2xl">
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

      <div className="px-4 pt-4 max-w-xl mx-auto md:max-w-2xl space-y-4">
        {/* Agent badge */}
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-2xl px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">Your agent code</div>
            <div className="text-lg font-bold font-mono text-primary">{agent.fullCode}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Writers active</div>
            <div className="text-2xl font-bold">{activeCount}</div>
          </div>
        </div>

        {/* Writer cards */}
        {writersLoading ? (
          [1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)
        ) : writerList.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <div className="text-4xl mb-3">👥</div>
            <div className="font-medium text-sm">No writers yet</div>
            <div className="text-xs mt-1">Tap Add to register your first writer</div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {writerList.map(w => (
              <div key={w.id} className={`bg-card border border-border rounded-2xl px-4 py-3.5 flex items-center gap-3 ${!w.isActive ? "opacity-60" : ""}`}>
                <Avatar name={w.fullName} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{w.fullName}</div>
                  <div className="text-xs font-mono text-muted-foreground mt-0.5">{w.fullCode}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    w.isActive
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {w.isActive ? "Active" : "Inactive"}
                  </span>
                  <button
                    onClick={() => { setEditWriter(w); setEditForm({ fullName: w.fullName, isActive: w.isActive }); }}
                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95"
                  >
                    <EditIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Writer Dialog */}
      <Dialog open={addOpen} onOpenChange={o => { if (!o) setCreateForm({ writerCode: "", fullName: "" }); setAddOpen(o); }}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
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
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1 h-11 rounded-xl font-semibold" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding…" : "Add Writer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Writer Dialog */}
      <Dialog open={!!editWriter} onOpenChange={o => !o && setEditWriter(null)}>
        <DialogContent className="max-w-sm mx-4 rounded-2xl">
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
              <Button type="submit" className="flex-1 h-11 rounded-xl font-semibold" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
