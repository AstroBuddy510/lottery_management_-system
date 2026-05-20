import { useState } from "react";
import {
  useListGames,
  useCreateGame,
  useUpdateGame,
  useDeleteGame,
  getListGamesQueryKey,
} from "@workspace/api-client-react";
import type { Game } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  offline: { label: "Offline", className: "bg-secondary text-secondary-foreground" },
  live:    { label: "Live",    className: "bg-green-600 text-white" },
  closed:  { label: "Closed",  className: "bg-destructive text-destructive-foreground" },
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toLocalDatetimeInput(iso: string | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface GameFormState {
  name: string;
  description: string;
  goLiveAt: string;
  closeAt: string;
}

const EMPTY_FORM: GameFormState = { name: "", description: "", goLiveAt: "", closeAt: "" };

/* ─── GameForm extracted outside Games to prevent remount-on-every-keystroke ── */

interface GameFormProps {
  form: GameFormState;
  setForm: React.Dispatch<React.SetStateAction<GameFormState>>;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
}

function GameForm({ form, setForm, onSubmit, isPending, submitLabel, onCancel }: GameFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Game Name *</Label>
        <Input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          placeholder="e.g. Evening Draw, Midday Special"
          className="h-9 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Description</Label>
        <Textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Optional notes about this game"
          className="text-sm resize-none"
          rows={2}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Goes Live *</Label>
          <Input
            type="datetime-local"
            value={form.goLiveAt}
            onChange={(e) => setForm((f) => ({ ...f, goLiveAt: e.target.value }))}
            required
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Closes At *</Label>
          <Input
            type="datetime-local"
            value={form.closeAt}
            onChange={(e) => setForm((f) => ({ ...f, closeAt: e.target.value }))}
            required
            className="h-9 text-sm"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The game will stay <strong>offline</strong> until you manually toggle it live. It will auto-close when the close time is reached.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ─── stat card ────────────────────────────────────────────────────────────── */

function StatPill({ label, count, dot }: { label: string; count: number; dot: string }) {
  return (
    <div className="flex items-center gap-3 bg-card border rounded-xl px-5 py-4 flex-1">
      <span className={`w-3 h-3 rounded-full flex-shrink-0 ${dot}`} />
      <div>
        <div className="text-2xl font-bold leading-none">{count}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </div>
    </div>
  );
}

/* ─── main component ───────────────────────────────────────────────────────── */

export function Games() {
  const qc = useQueryClient();
  const { data: games, isLoading } = useListGames({
    query: { queryKey: getListGamesQueryKey(), refetchInterval: 60_000 },
  });
  const createMutation = useCreateGame();
  const updateMutation = useUpdateGame();
  const deleteMutation = useDeleteGame();

  const [createOpen, setCreateOpen] = useState(false);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [form, setForm] = useState<GameFormState>(EMPTY_FORM);

  const gameList = Array.isArray(games) ? games : [];
  const invalidate = () => qc.invalidateQueries({ queryKey: getListGamesQueryKey() });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.goLiveAt || !form.closeAt) {
      toast.error("Please set both go-live and close times.");
      return;
    }
    try {
      const created = await createMutation.mutateAsync({
        data: {
          name: form.name,
          description: form.description || undefined,
          goLiveAt: new Date(form.goLiveAt).toISOString(),
          closeAt: new Date(form.closeAt).toISOString(),
        },
      });
      toast.success(`Game created — event ${(created as Game).eventNumber}`);
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      invalidate();
    } catch {
      toast.error("Failed to create game.");
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editGame) return;
    try {
      await updateMutation.mutateAsync({
        id: editGame.id,
        data: {
          name: form.name,
          description: form.description || null,
          goLiveAt: form.goLiveAt ? new Date(form.goLiveAt).toISOString() : undefined,
          closeAt: form.closeAt ? new Date(form.closeAt).toISOString() : undefined,
        },
      });
      toast.success("Game updated.");
      setEditGame(null);
      invalidate();
    } catch {
      toast.error("Failed to update game.");
    }
  };

  const handleToggleLive = async (g: Game) => {
    if (g.status === "closed") return;
    const newStatus = g.status === "live" ? "offline" : "live";
    try {
      await updateMutation.mutateAsync({
        id: g.id,
        data: { status: newStatus as "offline" | "live" },
      });
      toast.success(
        newStatus === "live" ? `"${g.name}" is now live.` : `"${g.name}" set to offline.`,
      );
      invalidate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update status.";
      toast.error(msg);
    }
  };

  const handleDelete = async (g: Game) => {
    if (!confirm(`Delete "${g.name}" (${g.eventNumber})? This cannot be undone.`)) return;
    try {
      await deleteMutation.mutateAsync({ id: g.id });
      toast.success("Game deleted.");
      invalidate();
    } catch {
      toast.error("Failed to delete game.");
    }
  };

  const openEdit = (g: Game) => {
    setEditGame(g);
    setForm({
      name: g.name,
      description: g.description ?? "",
      goLiveAt: toLocalDatetimeInput(g.goLiveAt),
      closeAt: toLocalDatetimeInput(g.closeAt),
    });
  };

  const liveCount    = gameList.filter((g) => g.status === "live").length;
  const offlineCount = gameList.filter((g) => g.status === "offline").length;
  const closedCount  = gameList.filter((g) => g.status === "closed").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Games</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Each game gets a unique event number. Toggle a game live when you're ready — it auto-closes at the scheduled time.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-accent hover:bg-accent/90 text-white font-semibold shrink-0"
          onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }}
        >
          + Add Game
        </Button>
      </div>

      {/* Stats strip */}
      <div className="flex gap-3">
        <StatPill label="Live"    count={liveCount}    dot="bg-green-500 ring-2 ring-green-300 animate-pulse" />
        <StatPill label="Offline" count={offlineCount} dot="bg-muted-foreground/40" />
        <StatPill label="Closed"  count={closedCount}  dot="bg-destructive/60" />
      </div>

      {/* Game grid */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading games…</div>
      ) : gameList.length === 0 ? (
        <div className="text-center py-16 border rounded-xl text-muted-foreground">
          <div className="text-3xl mb-2">🎮</div>
          <div className="font-medium text-sm">No games yet</div>
          <div className="text-xs mt-1">Add your first game to get started</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {gameList.map((g) => {
            const cfg = STATUS_CONFIG[g.status] ?? STATUS_CONFIG.offline;
            const isClosed = g.status === "closed";
            return (
              <div
                key={g.id}
                className="border rounded-xl bg-card p-5 flex flex-col gap-4 hover:shadow-md transition-shadow"
              >
                {/* Top row: indicator + badge + event number */}
                <div className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        g.status === "live"
                          ? "bg-green-500 ring-2 ring-green-300 animate-pulse"
                          : g.status === "closed"
                          ? "bg-destructive/60"
                          : "bg-muted-foreground/40"
                      }`}
                    />
                    <Badge className={`text-[10px] px-2 py-0 h-5 font-semibold ${cfg.className}`}>
                      {cfg.label}
                    </Badge>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground border rounded px-1.5 py-0.5 bg-muted">
                    {g.eventNumber}
                  </span>
                </div>

                {/* Name + description */}
                <div className="flex-1">
                  <div className="font-semibold text-base leading-tight">{g.name}</div>
                  {g.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{g.description}</p>
                  )}
                </div>

                {/* Timestamps */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-muted/50 rounded-lg px-3 py-2">
                    <div className="text-muted-foreground font-medium mb-0.5">Goes live</div>
                    <div className="font-mono font-semibold text-foreground/80">{formatDateTime(g.goLiveAt)}</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg px-3 py-2">
                    <div className="text-muted-foreground font-medium mb-0.5">Closes at</div>
                    <div className="font-mono font-semibold text-foreground/80">{formatDateTime(g.closeAt)}</div>
                  </div>
                </div>

                {/* Footer: toggle + actions */}
                <div className="flex items-center justify-between pt-1 border-t">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={g.status === "live"}
                      onCheckedChange={() => handleToggleLive(g)}
                      disabled={isClosed || updateMutation.isPending}
                      aria-label={`Toggle ${g.name} live`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {isClosed ? "Closed" : g.status === "live" ? "Live" : "Go Live"}
                    </span>
                  </div>
                  {!isClosed && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEdit(g)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs px-2 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(g)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Game</DialogTitle>
          </DialogHeader>
          <GameForm
            form={form}
            setForm={setForm}
            onSubmit={handleCreate}
            isPending={createMutation.isPending}
            submitLabel="Create Game"
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editGame} onOpenChange={(open) => !open && setEditGame(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit Game
              {editGame && (
                <span className="ml-2 text-xs font-mono text-muted-foreground font-normal">
                  {editGame.eventNumber}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <GameForm
            form={form}
            setForm={setForm}
            onSubmit={handleEdit}
            isPending={updateMutation.isPending}
            submitLabel="Save Changes"
            onCancel={() => setEditGame(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
