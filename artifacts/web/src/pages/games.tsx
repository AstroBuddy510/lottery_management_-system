import { useState } from "react";
import {
  useListGames,
  useCreateGame,
  useUpdateGame,
  useDeleteGame,
  useListGameTemplates,
  getListGamesQueryKey,
} from "@workspace/api-client-react";
import type { Game, GameTemplate } from "@workspace/api-client-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, ChevronLeft, ChevronRight, Play, Square, Archive, Clock, Calendar, AlertCircle } from "lucide-react";

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

function getGameGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue1 = Math.abs(hash % 360);
  const hue2 = (hue1 + 45) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 70%, 55%), hsl(${hue2}, 75%, 45%))`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface GameFormState {
  name: string;
  description: string;
  goLiveAt: string;
  closeAt: string;
  logoUrl: string;
}

const EMPTY_FORM: GameFormState = { name: "", description: "", goLiveAt: "", closeAt: "", logoUrl: "" };

/* ─── GameForm extracted outside Games to prevent remount-on-every-keystroke ── */

interface GameFormProps {
  form: GameFormState;
  setForm: React.Dispatch<React.SetStateAction<GameFormState>>;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  submitLabel: string;
  onCancel: () => void;
  isEdit?: boolean;
}

function GameForm({ form, setForm, onSubmit, isPending, submitLabel, onCancel, isEdit = false }: GameFormProps) {
  const { data: templates } = useListGameTemplates();
  const templateList = Array.isArray(templates) ? templates : [];

  const getSelectedDayOfWeek = () => {
    if (!form.goLiveAt) return null;
    const d = new Date(form.goLiveAt);
    if (isNaN(d.getTime())) return null;
    return d.getDay();
  };

  const dayOfWeek = getSelectedDayOfWeek();
  const filteredTemplates = templateList.filter(
    (t) => t.isActive && (dayOfWeek === null || t.dayOfWeek === dayOfWeek || t.dayOfWeek === 7)
  );

  const handleSelectTemplate = (templateId: string) => {
    const selectedTmpl = filteredTemplates.find(t => t.id === templateId);
    if (selectedTmpl) {
      setForm(f => ({
        ...f,
        name: selectedTmpl.name,
        description: selectedTmpl.description || "",
        logoUrl: selectedTmpl.logoUrl || "",
      }));
    } else {
      setForm(f => ({
        ...f,
        name: "",
        description: "",
        logoUrl: "",
      }));
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Game Name *</Label>
        {isEdit ? (
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            placeholder="e.g. Evening Draw, Midday Special"
            className="h-9 text-sm"
          />
        ) : (
          <div>
            {!form.goLiveAt ? (
              <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/60 rounded px-3 py-2 font-medium">
                Please select a "Goes Live" date first to view the templates scheduled for that day.
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/60 rounded px-3 py-2 font-medium">
                No templates configured for {dayOfWeek !== null ? DAY_NAMES[dayOfWeek] : "this day"}. Please configure templates in Settings.
              </div>
            ) : (
              <select
                value={filteredTemplates.find(t => t.name === form.name)?.id || ""}
                onChange={(e) => handleSelectTemplate(e.target.value)}
                required
                className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">-- Choose Template --</option>
                {filteredTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {form.logoUrl && (
        <div className="flex items-center gap-3 bg-muted/30 p-2.5 rounded-lg border">
          <img src={form.logoUrl} alt="Logo" className="w-10 h-10 object-contain rounded bg-muted p-1" />
          <div className="text-xs">
            <span className="font-semibold text-muted-foreground block">Associated Logo</span>
            <span className="text-foreground">Will be saved with this game.</span>
          </div>
        </div>
      )}

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

      <p className="text-xs text-muted-foreground">
        The game will stay <strong>offline</strong> until you manually toggle it live. It will auto-close when the close time is reached.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || (!isEdit && !form.name)}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ─── stat card ────────────────────────────────────────────────────────────── */

function StatPill({ label, count, activeColor, bgClass, icon }: { label: string; count: number; activeColor: string; bgClass: string; icon: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between border rounded-xl px-5 py-4 flex-1 bg-card/65 backdrop-blur-sm shadow-sm hover:shadow transition-all duration-300 relative overflow-hidden group ${bgClass}`}>
      <div className="space-y-1">
        <div className="text-2xl font-bold font-mono tracking-tight text-foreground">{count}</div>
        <div className="text-xs text-muted-foreground/80 font-semibold tracking-wider uppercase">{label}</div>
      </div>
      <div className={`p-2 rounded-xl bg-background border border-border/40 ${activeColor} shadow-xs`}>
        {icon}
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

  const [closedSearch, setClosedSearch] = useState("");
  const [closedDate, setClosedDate] = useState("");
  const [showAllClosed, setShowAllClosed] = useState(false);
  const [closedPage, setClosedPage] = useState(1);
  const itemsPerPage = 6;

  const handleSearchChange = (val: string) => {
    setClosedSearch(val);
    setClosedPage(1);
  };

  const handleDateChange = (val: string) => {
    setClosedDate(val);
    setClosedPage(1);
  };

  const handleToggleShowAll = (val: boolean) => {
    setShowAllClosed(val);
    setClosedPage(1);
  };

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
          logoUrl: form.logoUrl || undefined,
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
          logoUrl: form.logoUrl || null,
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
      logoUrl: g.logoUrl ?? "",
    });
  };

  const liveCount    = gameList.filter((g) => g.status === "live").length;
  const offlineCount = gameList.filter((g) => g.status === "offline").length;
  const closedCount  = gameList.filter((g) => g.status === "closed").length;

  const liveGames = gameList.filter((g) => g.status === "live");
  const offlineGames = gameList.filter((g) => g.status === "offline");

  const filteredClosedGames = gameList.filter((g) => {
    if (g.status !== "closed") return false;

    // 1. Clutter-free by default (hide older than 3 days)
    if (!showAllClosed) {
      const closedTime = new Date(g.closeAt).getTime();
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      if (closedTime < threeDaysAgo) return false;
    }

    // 2. Search
    if (closedSearch.trim()) {
      const q = closedSearch.toLowerCase().trim();
      const nameMatch = g.name.toLowerCase().includes(q);
      const numMatch = g.eventNumber.toLowerCase().includes(q);
      const descMatch = g.description?.toLowerCase().includes(q) ?? false;
      if (!nameMatch && !numMatch && !descMatch) return false;
    }

    // 3. Date
    if (closedDate) {
      const closeDateStr = new Date(g.closeAt).toISOString().split("T")[0];
      if (closeDateStr !== closedDate) return false;
    }

    return true;
  });

  const totalClosedItems = filteredClosedGames.length;
  const totalPages = Math.ceil(totalClosedItems / itemsPerPage) || 1;
  const currentPageSafe = Math.min(closedPage, totalPages) || 1;
  const paginatedClosedGames = filteredClosedGames.slice(
    (currentPageSafe - 1) * itemsPerPage,
    currentPageSafe * itemsPerPage
  );

  const renderGameCard = (g: Game) => {
    const cfg = STATUS_CONFIG[g.status] ?? STATUS_CONFIG.offline;
    const isClosed = g.status === "closed";

    const renderCountdown = () => {
      if (g.status !== "live") return null;
      const now = Date.now();
      const closeTime = new Date(g.closeAt).getTime();
      const timeLeft = closeTime - now;
      if (timeLeft <= 0) return null;

      const hours = Math.floor(timeLeft / (1000 * 60 * 60));
      const mins = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

      if (hours < 24) {
        return (
          <span className="flex items-center gap-1.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50/75 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/40 px-2 py-0.5 rounded-lg animate-pulse">
            <Clock className="w-3 h-3" />
            {hours}h {mins}m left
          </span>
        );
      }
      return null;
    };

    return (
      <div
        key={g.id}
        className="border border-border/40 rounded-2xl bg-card/75 backdrop-blur-sm p-5 flex flex-col gap-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden group"
      >
        {/* Hover subtle glow effect */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500/20 via-primary/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />

        {/* Top row: indicator + badge + event number */}
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                g.status === "live"
                  ? "bg-green-500 ring-4 ring-green-500/20 animate-pulse"
                  : g.status === "closed"
                  ? "bg-rose-500/60"
                  : "bg-muted-foreground/30"
              }`}
            />
            <Badge className={`text-[9px] uppercase tracking-wider px-2 py-0 h-5 font-bold ${cfg.className}`}>
              {cfg.label}
            </Badge>
            {renderCountdown()}
          </div>
          <span className="text-[10px] font-mono font-bold text-indigo-700 dark:text-indigo-400 border border-indigo-100/60 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 px-2.5 py-0.5 rounded-lg">
            Event #{g.eventNumber}
          </span>
        </div>

        {/* Name + description with logo */}
        <div className="flex gap-3.5 flex-1 items-start">
          {g.logoUrl ? (
            <img src={g.logoUrl} alt={g.name} className="w-12 h-12 object-contain rounded-xl bg-background p-1 border border-border/30 shrink-0 shadow-xs" />
          ) : (
            <div
              className="w-12 h-12 rounded-xl text-white flex items-center justify-center font-extrabold text-sm shadow shrink-0"
              style={{ background: getGameGradient(g.name) }}
            >
              {g.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm tracking-tight text-foreground leading-snug">{g.name}</div>
            {g.description && (
              <p className="text-[11px] text-muted-foreground/90 mt-1 line-clamp-2 leading-relaxed">{g.description}</p>
            )}
          </div>
        </div>

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/30 dark:bg-muted/10 border border-border/30 rounded-xl px-3 py-2 space-y-1">
            <div className="text-muted-foreground/80 font-medium flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-indigo-500/70" />
              <span>Goes Live</span>
            </div>
            <div className="font-mono font-bold text-foreground/90 text-[10px] leading-tight">{formatDateTime(g.goLiveAt)}</div>
          </div>
          <div className="bg-muted/30 dark:bg-muted/10 border border-border/30 rounded-xl px-3 py-2 space-y-1">
            <div className="text-muted-foreground/80 font-medium flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-rose-500/70" />
              <span>Closes At</span>
            </div>
            <div className="font-mono font-bold text-foreground/90 text-[10px] leading-tight">{formatDateTime(g.closeAt)}</div>
          </div>
        </div>

        {/* Footer: toggle + actions */}
        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          <div className="flex items-center gap-2">
            <Switch
              checked={g.status === "live"}
              onCheckedChange={() => handleToggleLive(g)}
              disabled={isClosed || updateMutation.isPending}
              aria-label={`Toggle ${g.name} live`}
              className="data-[state=checked]:bg-green-600"
            />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {isClosed ? "Closed" : g.status === "live" ? "Live" : "Offline"}
            </span>
          </div>
          {!isClosed && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2 rounded-lg hover:bg-muted/50" onClick={() => openEdit(g)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs px-2 text-destructive hover:text-destructive rounded-lg hover:bg-destructive/5"
                onClick={() => handleDelete(g)}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Games</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your lottery draw events. Separate game states using category tabs.
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
      <div className="flex gap-4">
        <StatPill
          label="Live"
          count={liveCount}
          activeColor="text-emerald-600 dark:text-emerald-400"
          bgClass="bg-emerald-50/10 dark:bg-emerald-950/5 border-emerald-100/50 dark:border-emerald-900/20"
          icon={<Play className="w-4.5 h-4.5 fill-current text-emerald-500 dark:text-emerald-400 animate-pulse" />}
        />
        <StatPill
          label="Offline"
          count={offlineCount}
          activeColor="text-slate-600 dark:text-slate-400"
          bgClass="bg-slate-50/10 dark:bg-slate-950/5 border-slate-200/50 dark:border-slate-800/40"
          icon={<Square className="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 fill-current" />}
        />
        <StatPill
          label="Closed"
          count={closedCount}
          activeColor="text-rose-600 dark:text-rose-400"
          bgClass="bg-rose-50/10 dark:bg-rose-950/5 border-rose-100/50 dark:border-rose-900/20"
          icon={<Archive className="w-4.5 h-4.5 text-rose-500 dark:text-rose-400" />}
        />
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading games…</div>
      ) : (
        <Tabs defaultValue="live" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="live" className="relative">
              Live
              {liveCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-black rounded-full bg-green-500 text-white leading-none">
                  {liveCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="offline">
              Offline
              {offlineCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-black rounded-full bg-slate-500 text-white leading-none">
                  {offlineCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="closed">
              Closed
              {closedCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-black rounded-full bg-rose-500 text-white leading-none">
                  {closedCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="space-y-4 outline-none">
            {liveGames.length === 0 ? (
              <div className="text-center py-16 border rounded-xl text-muted-foreground bg-card">
                <div className="text-3xl mb-2">🟢</div>
                <div className="font-medium text-sm">No live games</div>
                <div className="text-xs mt-1">There are currently no active games accepting entries.</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {liveGames.map(renderGameCard)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="offline" className="space-y-4 outline-none">
            {offlineGames.length === 0 ? (
              <div className="text-center py-16 border rounded-xl text-muted-foreground bg-card">
                <div className="text-3xl mb-2">⚙️</div>
                <div className="font-medium text-sm">No offline games</div>
                <div className="text-xs mt-1">No pending or offline games available.</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {offlineGames.map(renderGameCard)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="closed" className="space-y-4 outline-none">
            {/* Filter Panel */}
            <div className="bg-card border rounded-xl p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex-1 max-w-md relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search closed games..."
                    value={closedSearch}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9 h-9 text-sm rounded-xl"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-2 shrink-0">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Closed Date:</Label>
                    <Input
                      type="date"
                      value={closedDate}
                      onChange={(e) => handleDateChange(e.target.value)}
                      className="h-9 text-xs rounded-xl w-[155px]"
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      id="show-all-closed"
                      checked={showAllClosed}
                      onCheckedChange={handleToggleShowAll}
                    />
                    <Label htmlFor="show-all-closed" className="text-xs font-medium cursor-pointer whitespace-nowrap">
                      Show older completed games
                    </Label>
                  </div>
                </div>
              </div>
            </div>

            {paginatedClosedGames.length === 0 ? (
              <div className="text-center py-16 border rounded-xl text-muted-foreground bg-card">
                <div className="text-3xl mb-2">🔒</div>
                <div className="font-medium text-sm">No closed games found</div>
                <div className="text-xs mt-1">Adjust search terms, date filters, or toggle older games to find archived records.</div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {paginatedClosedGames.map(renderGameCard)}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t pt-4 mt-6">
                    <div className="text-xs text-muted-foreground">
                      Showing {(currentPageSafe - 1) * itemsPerPage + 1} to{" "}
                      {Math.min(currentPageSafe * itemsPerPage, totalClosedItems)} of{" "}
                      {totalClosedItems} completed games
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-xl px-2.5"
                        disabled={currentPageSafe === 1}
                        onClick={() => setClosedPage(currentPageSafe - 1)}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </Button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                        <Button
                          key={p}
                          variant={p === currentPageSafe ? "default" : "outline"}
                          size="sm"
                          className="h-8 w-8 rounded-xl p-0 font-medium"
                          onClick={() => setClosedPage(p)}
                        >
                          {p}
                        </Button>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-xl px-2.5"
                        disabled={currentPageSafe === totalPages}
                        onClick={() => setClosedPage(currentPageSafe + 1)}
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
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
            isEdit={true}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
