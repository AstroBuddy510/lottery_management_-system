import { useState, useEffect } from "react";
import { getServerNow } from "../lib/time-sync";
import {
  useListGames,
  useCreateGame,
  useUpdateGame,
  useDeleteGame,
  useListGameTemplates,
  getListGamesQueryKey,
  useGetSettings,
  customFetch,
  getGetSettingsQueryKey,
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
import { useAuth } from "@/lib/auth";
import { generateGameEventReportPDF } from "@/lib/pdf-generator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

interface CountdownTimerProps {
  closeAt: string;
  status: string;
  className?: string;
}

export function CountdownTimer({ closeAt, status, className }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (status !== "live") return;

    const calculateTimeLeft = () => {
      const closeTime = new Date(closeAt).getTime();
      const diff = closeTime - getServerNow().getTime();
      return diff > 0 ? diff : 0;
    };

    setTimeLeft(calculateTimeLeft());

    const interval = setInterval(() => {
      const diff = calculateTimeLeft();
      setTimeLeft(diff);
      if (diff <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [closeAt, status]);

  if (status !== "live" || timeLeft <= 0) return null;

  const hours = Math.floor(timeLeft / (1000 * 60 * 60));
  const mins = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((timeLeft % (1000 * 60)) / 1000);

  if (hours < 24) {
    return (
      <span className={className || "flex items-center gap-1.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50/75 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/40 px-2 py-0.5 rounded-lg animate-pulse"}>
        <Clock className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: "6s" }} />
        {hours > 0 ? `${hours}h ` : ""}{mins}m {secs}s left
      </span>
    );
  }
  return null;
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
  const activeTemplates = templateList.filter(t => t.isActive);

  const matchingTemplates = activeTemplates.filter(
    (t) => dayOfWeek === null || t.dayOfWeek === dayOfWeek || t.dayOfWeek === 7
  );

  const otherTemplates = activeTemplates.filter(
    (t) => dayOfWeek !== null && t.dayOfWeek !== dayOfWeek && t.dayOfWeek !== 7
  );

  const handleSelectTemplate = (templateId: string) => {
    const selectedTmpl = activeTemplates.find(t => t.id === templateId);
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
        <Label className="text-xs font-medium">Game Template *</Label>
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
            {activeTemplates.length === 0 ? (
              <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/60 rounded px-3 py-2 font-medium">
                No active templates configured. Please configure templates in Settings first.
              </div>
            ) : (
              <select
                value={activeTemplates.find(t => t.name === form.name)?.id || ""}
                onChange={(e) => handleSelectTemplate(e.target.value)}
                required
                className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">-- Choose Template --</option>
                {dayOfWeek === null ? (
                  activeTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))
                ) : (
                  <>
                    {matchingTemplates.length > 0 && (
                      <optgroup label={`Scheduled for ${DAY_NAMES[dayOfWeek]} (or Everyday)`}>
                        {matchingTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {otherTemplates.length > 0 && (
                      <optgroup label="Other Templates">
                        {otherTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </>
                )}
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
  const { user } = useAuth();
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), staleTime: 0 } });
  const folderColor = settings?.folderColor ?? "#10b981";
  const isAdminOrDirector = user?.role === "administrator" || user?.role === "director";

  const { data: games, isLoading } = useListGames({
    query: { queryKey: getListGamesQueryKey(), refetchInterval: 60_000 },
  });
  const createMutation = useCreateGame();
  const updateMutation = useUpdateGame();
  const deleteMutation = useDeleteGame();

  const [createOpen, setCreateOpen] = useState(false);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [form, setForm] = useState<GameFormState>(EMPTY_FORM);
  const [gameToClose, setGameToClose] = useState<Game | null>(null);
  const [isClosingGame, setIsClosingGame] = useState(false);

  const [closedSearch, setClosedSearch] = useState("");
  const [closedDate, setClosedDate] = useState("");
  const [showAllClosed, setShowAllClosed] = useState(false);
  const [closedPage, setClosedPage] = useState(1);
  const itemsPerPage = 6;

  // Folder Expansion State
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const toggleFolder = (key: string) => {
    setExpandedFolders(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Auditing Board Dialog State
  const [selectedGameForAudit, setSelectedGameForAudit] = useState<Game | null>(null);
  const [auditReport, setAuditReport] = useState<any | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Folder Explorer Dialog State for grid/icon views
  const [selectedFolderForView, setSelectedFolderForView] = useState<any | null>(null);

  const handleOpenAudit = async (g: Game) => {
    if (!isAdminOrDirector) {
      toast.error("Access denied. Only Administrators and Directors can view audit ledgers.");
      return;
    }
    setSelectedGameForAudit(g);
    setLoadingAudit(true);
    try {
      const data = await customFetch<any>(`/api/reports/game/${g.id}`);
      setAuditReport(data);
    } catch {
      toast.error("Failed to load game audit details.");
      setAuditReport(null);
    } finally {
      setLoadingAudit(false);
    }
  };

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

  const handleConfirmClose = async () => {
    if (!gameToClose) return;
    setIsClosingGame(true);
    try {
      await customFetch(`/api/games/${gameToClose.id}/close`, {
        method: "POST",
      });
      toast.success(`Game "${gameToClose.name}" has been manually closed.`);
      setGameToClose(null);
      invalidate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to close game.";
      toast.error(msg);
    } finally {
      setIsClosingGame(false);
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
    const isGrossClosed = g.status === "live" && new Date(g.closeAt) <= getServerNow();

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
                isClosed
                  ? "bg-rose-500/60"
                  : isGrossClosed
                  ? "bg-amber-500 ring-4 ring-amber-500/20 animate-pulse"
                  : g.status === "live"
                  ? "bg-green-500 ring-4 ring-green-500/20 animate-pulse"
                  : "bg-muted-foreground/30"
              }`}
            />
            <Badge className={`text-[9px] uppercase tracking-wider px-2 py-0 h-5 font-bold ${
              isClosed
                ? cfg.className
                : isGrossClosed
                ? "bg-amber-600 text-white dark:bg-amber-700"
                : cfg.className
            }`}>
              {isGrossClosed ? "Gross Closed" : cfg.label}
            </Badge>
            <CountdownTimer closeAt={g.closeAt} status={g.status} />
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
              {isClosed ? "Closed" : isGrossClosed ? "Gross Closed" : g.status === "live" ? "Live" : "Offline"}
            </span>
            {!isClosed && isAdminOrDirector && (
              <Button
                size="icon"
                variant="destructive"
                className="h-6 w-6 rounded-md bg-rose-600 hover:bg-rose-700 hover:text-white text-white shrink-0 ml-1 shadow-xs transition-all duration-200 hover:scale-105"
                onClick={() => setGameToClose(g)}
                title="Manual Close (Kill Switch)"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
              </Button>
            )}
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

            {(() => {
              // Helper to generate the monthly range label
              const getMonthRangeLabel = (year: number, monthZeroIndexed: number): string => {
                const monthNames = [
                  "January", "February", "March", "April", "May", "June", 
                  "July", "August", "September", "October", "November", "December"
                ];
                const mName = monthNames[monthZeroIndexed];
                const lastDay = new Date(year, monthZeroIndexed + 1, 0).getDate();
                const pad = (n: number) => String(n).padStart(2, "0");
                return `01 ${mName} ${year} – ${pad(lastDay)} ${mName} ${year}`;
              };

              // Group filteredClosedGames by year and month
              interface MonthlyGroup {
                monthKey: string;
                monthName: string;
                rangeLabel: string;
                games: Game[];
              }

              const monthlyGroups = filteredClosedGames.reduce<Record<string, MonthlyGroup>>((acc, g) => {
                const d = new Date(g.closeAt);
                const y = d.getFullYear();
                const m = d.getMonth();
                const key = `${y}-${String(m + 1).padStart(2, "0")}`;
                if (!acc[key]) {
                  const monthNames = [
                    "January", "February", "March", "April", "May", "June", 
                    "July", "August", "September", "October", "November", "December"
                  ];
                  acc[key] = {
                    monthKey: key,
                    monthName: `${monthNames[m]} ${y}`,
                    rangeLabel: getMonthRangeLabel(y, m),
                    games: [],
                  };
                }
                acc[key].games.push(g);
                return acc;
              }, {});

              const sortedGroupKeys = Object.keys(monthlyGroups).sort((a, b) => b.localeCompare(a));
              
              // Sort games chronologically within each month folder by close date (newest last)
              sortedGroupKeys.forEach((k) => {
                monthlyGroups[k].games.sort((a, b) => new Date(a.closeAt).getTime() - new Date(b.closeAt).getTime());
              });

              if (sortedGroupKeys.length === 0) {
                return (
                  <div className="text-center py-16 border rounded-xl text-muted-foreground bg-card">
                    <div className="text-3xl mb-2">🔒</div>
                    <div className="font-medium text-sm">No closed games found</div>
                    <div className="text-xs mt-1">Adjust search terms, date filters, or toggle older games to find archived records.</div>
                  </div>
                );
              }

              const viewType = settings?.folderViewType ?? "large";

              if (sortedGroupKeys.length === 0) {
                return (
                  <div className="text-center py-16 border rounded-xl text-muted-foreground bg-card">
                    <div className="text-3xl mb-2">🔒</div>
                    <div className="font-medium text-sm">No closed games found</div>
                    <div className="text-xs mt-1">Adjust search terms, date filters, or toggle older games to find archived records.</div>
                  </div>
                );
              }

              if (viewType === "details" || viewType === "content") {
                const isContentMode = viewType === "content";
                return (
                  <div className="space-y-4 animate-in fade-in-50 duration-200">
                    {sortedGroupKeys.map((key) => {
                      const group = monthlyGroups[key];
                      const isExpanded = !!expandedFolders[key];
                      return (
                        <div key={key} className={`border border-border/40 rounded-2xl bg-card/65 backdrop-blur-sm hover:shadow-md transition-all duration-300 ${isContentMode ? "p-5" : "p-4"}`}>
                          <div
                            onClick={() => toggleFolder(key)}
                            className="flex items-center justify-between cursor-pointer select-none group"
                          >
                            <div className="flex items-center gap-4">
                              <div className="relative shrink-0">
                                <svg viewBox="0 0 100 80" className={`${isContentMode ? "w-16 h-14" : "w-14 h-12"} drop-shadow-sm transition-transform duration-300 group-hover:scale-105`} xmlns="http://www.w3.org/2000/svg">
                                  <defs>
                                    <linearGradient id={`frontGrad-${key}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
                                      <stop offset="100%" stopColor="#000000" stopOpacity="0.15" />
                                    </linearGradient>
                                  </defs>
                                  <path d="M 4,14 L 4,8 A 4,4 0 0 1 8,4 L 32,4 A 4,4 0 0 1 36,8 L 42,14 L 92,14 A 4,4 0 0 1 96,18 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={folderColor} />
                                  <path d="M 4,14 L 4,8 A 4,4 0 0 1 8,4 L 32,4 A 4,4 0 0 1 36,8 L 42,14 L 92,14 A 4,4 0 0 1 96,18 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={`url(#frontGrad-${key})`} opacity="0.3" />
                                  <path d="M 4,20 A 4,4 0 0 1 8,16 L 92,16 A 4,4 0 0 1 96,20 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={folderColor} />
                                  <path d="M 4,20 A 4,4 0 0 1 8,16 L 92,16 A 4,4 0 0 1 96,20 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={`url(#frontGrad-${key})`} opacity="0.2" />
                                  <rect x="4" y="66" width="92" height="3" fill="#000000" opacity="0.15" rx="0.5" />
                                </svg>
                              </div>
                              <div>
                                <h3 className="font-bold text-sm tracking-tight text-foreground flex items-center gap-2">
                                  {group.monthName}
                                  <Badge variant="secondary" className="text-[10px] h-4.5 px-1.5 font-semibold">
                                    {group.games.length} {group.games.length === 1 ? "game" : "games"}
                                  </Badge>
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5 font-medium">{group.rangeLabel}</p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
                              <span className="text-[11px] font-medium uppercase tracking-wider hidden sm:inline">
                                {isExpanded ? "Collapse" : "Expand"}
                              </span>
                              <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? "rotate-90" : ""}`} />
                            </div>
                          </div>
                          
                          {isExpanded && (
                            <div className="mt-4 pl-4 sm:pl-8 border-l border-dashed border-border/80 ml-6 space-y-2 animate-in slide-in-from-top-2 duration-200">
                              <div className="border border-border/40 rounded-xl overflow-hidden bg-background/30">
                                <Table>
                                  <TableHeader className="bg-muted/30">
                                    <TableRow>
                                      <TableHead className="w-32 font-semibold text-xs">Event Number</TableHead>
                                      <TableHead className="font-semibold text-xs">Game Name</TableHead>
                                      <TableHead className="font-semibold text-xs">Close Date</TableHead>
                                      <TableHead className="text-right font-semibold text-xs">Action</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {group.games.map((g) => (
                                      <TableRow key={g.id} className="hover:bg-muted/15 border-b border-border/20 last:border-0">
                                        <TableCell className="font-mono font-bold text-xs">
                                          {isAdminOrDirector ? (
                                            <button
                                              onClick={() => handleOpenAudit(g)}
                                              className="text-primary hover:underline hover:text-primary/95 text-left font-bold"
                                            >
                                              #{g.eventNumber}
                                            </button>
                                          ) : (
                                            <span className="text-muted-foreground font-semibold">#{g.eventNumber}</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="font-semibold text-xs sm:text-sm">{g.name}</TableCell>
                                        <TableCell className="text-xs font-mono text-muted-foreground">{formatDateTime(g.closeAt)}</TableCell>
                                        <TableCell className="text-right">
                                          {isAdminOrDirector ? (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="h-7 text-[11px] px-2.5 rounded-lg border-border/85"
                                              onClick={() => handleOpenAudit(g)}
                                            >
                                              View Audit Ledger
                                            </Button>
                                          ) : (
                                            <span className="text-[10px] text-muted-foreground italic font-medium">Restricted</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // Otherwise it's a grid/icon view (extra_large, large, medium, small, list, tiles)
              let gridClass = "grid gap-4 ";
              let svgClass = "drop-shadow-sm transition-transform duration-300 group-hover:scale-105 ";
              let cardClass = "border border-border/40 rounded-xl bg-card/65 backdrop-blur-sm hover:shadow-md transition-all duration-300 p-4 flex cursor-pointer select-none group ";

              if (viewType === "extra_large") {
                gridClass += "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6";
                svgClass += "w-20 h-16 mx-auto";
                cardClass += "flex-col items-center text-center justify-center p-6";
              } else if (viewType === "large") {
                gridClass += "grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4";
                svgClass += "w-16 h-13 mx-auto";
                cardClass += "flex-col items-center text-center justify-center p-5";
              } else if (viewType === "medium") {
                gridClass += "grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3";
                svgClass += "w-12 h-10 mx-auto";
                cardClass += "flex-col items-center text-center justify-center p-3.5";
              } else if (viewType === "small") {
                gridClass += "grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2";
                svgClass += "w-8 h-7";
                cardClass += "flex-row items-center gap-2 p-2";
              } else if (viewType === "list") {
                gridClass += "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2";
                svgClass += "w-6 h-5";
                cardClass += "flex-row items-center gap-2 p-2";
              } else if (viewType === "tiles") {
                gridClass += "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4";
                svgClass += "w-12 h-10";
                cardClass += "flex-row items-center gap-4 p-4";
              }

              return (
                <div className={`${gridClass} animate-in fade-in-50 duration-200`}>
                  {sortedGroupKeys.map((key) => {
                    const group = monthlyGroups[key];
                    const isGridVertical = ["extra_large", "large", "medium"].includes(viewType);
                    
                    return (
                      <div
                        key={key}
                        onClick={() => setSelectedFolderForView(group)}
                        className={cardClass}
                      >
                        <div className="relative shrink-0">
                          <svg viewBox="0 0 100 80" className={svgClass} xmlns="http://www.w3.org/2000/svg">
                            <defs>
                              <linearGradient id={`frontGrad-grid-${key}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
                                <stop offset="100%" stopColor="#000000" stopOpacity="0.15" />
                              </linearGradient>
                            </defs>
                            <path d="M 4,14 L 4,8 A 4,4 0 0 1 8,4 L 32,4 A 4,4 0 0 1 36,8 L 42,14 L 92,14 A 4,4 0 0 1 96,18 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={folderColor} />
                            <path d="M 4,14 L 4,8 A 4,4 0 0 1 8,4 L 32,4 A 4,4 0 0 1 36,8 L 42,14 L 92,14 A 4,4 0 0 1 96,18 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={`url(#frontGrad-grid-${key})`} opacity="0.3" />
                            <path d="M 4,20 A 4,4 0 0 1 8,16 L 92,16 A 4,4 0 0 1 96,20 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={folderColor} />
                            <path d="M 4,20 A 4,4 0 0 1 8,16 L 92,16 A 4,4 0 0 1 96,20 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={`url(#frontGrad-grid-${key})`} opacity="0.2" />
                            <rect x="4" y="66" width="92" height="3" fill="#000000" opacity="0.15" rx="0.5" />
                          </svg>
                          {!isGridVertical && viewType !== "tiles" && (
                            <span className="absolute -top-1.5 -right-1.5 bg-secondary text-secondary-foreground text-[8px] font-bold h-4 px-1 rounded-full flex items-center justify-center">
                              {group.games.length}
                            </span>
                          )}
                        </div>

                        <div className={`flex flex-col min-w-0 ${isGridVertical ? "mt-3 w-full" : "text-left"}`}>
                          <div className={`font-bold tracking-tight text-foreground truncate flex items-center justify-between ${
                            viewType === "extra_large" ? "text-base" : "text-sm"
                          }`}>
                            <span className="truncate">{group.monthName}</span>
                            {isGridVertical && (
                              <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1 shrink-0 font-semibold">
                                {group.games.length}
                              </Badge>
                            )}
                          </div>
                          
                          {(viewType === "extra_large" || viewType === "large" || viewType === "tiles") && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 font-medium truncate">
                              {group.rangeLabel}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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

      {/* Event Audit Board Dialog */}
      <Dialog open={!!selectedGameForAudit} onOpenChange={(open) => {
        if (!open) {
          setSelectedGameForAudit(null);
          setAuditReport(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  Event Audit Ledger
                  {selectedGameForAudit && (
                    <Badge variant="outline" className="text-xs font-mono">
                      #{selectedGameForAudit.eventNumber}
                    </Badge>
                  )}
                </DialogTitle>
                {selectedGameForAudit && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedGameForAudit.name} • Closed at {formatDateTime(selectedGameForAudit.closeAt)}
                  </p>
                )}
                {selectedGameForAudit && (selectedGameForAudit.closedAt || selectedGameForAudit.closeType) && (
                  <div className="mt-2 text-xs flex flex-wrap items-center gap-2 bg-muted/65 dark:bg-muted/15 border rounded-lg px-2.5 py-1.5 w-fit">
                    <span className="font-semibold text-foreground/80">Closure Audit:</span>
                    <Badge variant={selectedGameForAudit.closeType === "manual" ? "destructive" : "secondary"} className="text-[9px] font-bold px-1.5 py-0 uppercase tracking-wider">
                      {selectedGameForAudit.closeType === "manual" ? "Manual Close" : "Auto Close"}
                    </Badge>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-muted-foreground">
                      Time: <span className="font-mono font-medium text-foreground">{formatDateTime(selectedGameForAudit.closedAt || selectedGameForAudit.closeAt)}</span>
                    </span>
                    {selectedGameForAudit.closeType === "manual" && selectedGameForAudit.closedByName && (
                      <>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">
                          Authorized By: <span className="font-semibold text-foreground">{selectedGameForAudit.closedByName}</span>
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
              {auditReport && (
                <Button
                  size="sm"
                  onClick={() => {
                    if (selectedGameForAudit && auditReport) {
                      generateGameEventReportPDF(
                        selectedGameForAudit.name,
                        selectedGameForAudit.eventNumber,
                        selectedGameForAudit.closeAt,
                        auditReport.totals,
                        auditReport.agents,
                        auditReport.writers
                      );
                    }
                  }}
                  className="bg-accent hover:bg-accent/90 text-white font-semibold flex items-center gap-1.5 shrink-0"
                >
                  <Archive className="w-4 h-4" />
                  Export to PDF
                </Button>
              )}
            </div>
          </DialogHeader>

          {loadingAudit ? (
            <div className="text-center py-12 text-muted-foreground text-sm font-medium">
              Loading audit calculations...
            </div>
          ) : !auditReport ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No calculations found for this event.
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <div className="rounded-xl border bg-muted/20 p-3 space-y-1">
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Gross Sales</div>
                  <div className="text-sm sm:text-base font-bold font-mono">GH₵ {Number(auditReport.totals.grossSales).toFixed(2)}</div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3 space-y-1">
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Commission</div>
                  <div className="text-sm sm:text-base font-bold font-mono text-amber-600 dark:text-amber-400">GH₵ {Number(auditReport.totals.commissionAmount).toFixed(2)}</div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3 space-y-1">
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Net Gross</div>
                  <div className="text-sm sm:text-base font-bold font-mono text-teal-600 dark:text-teal-400">GH₵ {Number(auditReport.totals.netGross).toFixed(2)}</div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3 space-y-1">
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Wins Paid</div>
                  <div className="text-sm sm:text-base font-bold font-mono text-rose-600 dark:text-rose-400">GH₵ {Number(auditReport.totals.winsAmount).toFixed(2)}</div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3 space-y-1">
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Reserve Fund</div>
                  <div className="text-sm sm:text-base font-bold font-mono text-indigo-600 dark:text-indigo-400">GH₵ {Number(auditReport.totals.reserveAmount).toFixed(2)}</div>
                </div>
                <div className={`rounded-xl border p-3 space-y-1 ${Number(auditReport.totals.writerBalance) < 0 ? 'bg-rose-50/20 border-rose-100 dark:bg-rose-950/10' : 'bg-green-50/20 border-green-100 dark:bg-green-950/10'}`}>
                  <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Net Balance</div>
                  <div className={`text-sm sm:text-base font-bold font-mono ${Number(auditReport.totals.writerBalance) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-green-600 dark:text-green-400'}`}>
                    GH₵ {Number(auditReport.totals.writerBalance).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Tabs for agent/writer details */}
              <Tabs defaultValue="agents" className="space-y-4">
                <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
                  <TabsTrigger value="agents">Agent Contributions</TabsTrigger>
                  <TabsTrigger value="writers">Writer Performance</TabsTrigger>
                </TabsList>

                <TabsContent value="agents" className="space-y-3">
                  <div className="border border-border/40 rounded-xl overflow-hidden bg-background/30">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="font-semibold text-xs">Agent Code</TableHead>
                          <TableHead className="font-semibold text-xs">Gross Sales</TableHead>
                          <TableHead className="font-semibold text-xs">Commission</TableHead>
                          <TableHead className="font-semibold text-xs">Net Gross</TableHead>
                          <TableHead className="font-semibold text-xs">Wins Paid</TableHead>
                          <TableHead className="font-semibold text-xs">Reserve Fund</TableHead>
                          <TableHead className="font-semibold text-xs text-right">Net Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditReport.agents && auditReport.agents.length > 0 ? (
                          auditReport.agents.map((a: any) => (
                            <TableRow key={a.agent.id} className="hover:bg-muted/10 border-b border-border/20 last:border-0">
                              <TableCell className="font-semibold text-xs">
                                {a.agent.fullCode}
                                <span className="text-muted-foreground block text-[10px] font-normal">{a.agent.agencyName || a.agent.ownerName}</span>
                              </TableCell>
                              <TableCell className="font-mono text-xs">GH₵ {Number(a.totals.grossSales).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs text-amber-600 dark:text-amber-400">GH₵ {Number(a.totals.commissionAmount).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs text-teal-600 dark:text-teal-400">GH₵ {Number(a.totals.netGross).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs text-rose-600 dark:text-rose-400">GH₵ {Number(a.totals.winsAmount).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs text-indigo-600 dark:text-indigo-400">GH₵ {Number(a.totals.reserveAmount).toFixed(2)}</TableCell>
                              <TableCell className={`font-mono text-xs text-right font-bold ${Number(a.totals.writerBalance) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-green-600 dark:text-green-400'}`}>
                                GH₵ {Number(a.totals.writerBalance).toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-6 text-xs text-muted-foreground italic">No agent calculation data found.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="writers" className="space-y-3">
                  <div className="border border-border/40 rounded-xl overflow-hidden bg-background/30">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="font-semibold text-xs">Writer Code & Name</TableHead>
                          <TableHead className="font-semibold text-xs">Gross Sales</TableHead>
                          <TableHead className="font-semibold text-xs">Commission</TableHead>
                          <TableHead className="font-semibold text-xs">Net Gross</TableHead>
                          <TableHead className="font-semibold text-xs">Wins Paid</TableHead>
                          <TableHead className="font-semibold text-xs text-right">Net Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditReport.writers && auditReport.writers.length > 0 ? (
                          auditReport.writers.map((w: any) => (
                            <TableRow key={w.writer.id} className="hover:bg-muted/10 border-b border-border/20 last:border-0">
                              <TableCell className="font-semibold text-xs">
                                {w.writer.fullCode}
                                <span className="text-muted-foreground block text-[10px] font-normal">{w.writer.fullName}</span>
                              </TableCell>
                              <TableCell className="font-mono text-xs">GH₵ {Number(w.totals.grossSales).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs text-amber-600 dark:text-amber-400">GH₵ {Number(w.totals.commissionAmount).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs text-teal-600 dark:text-teal-400">GH₵ {Number(w.totals.netGross).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs text-rose-600 dark:text-rose-400">GH₵ {Number(w.totals.winsAmount).toFixed(2)}</TableCell>
                              <TableCell className={`font-mono text-xs text-right font-bold ${Number(w.totals.writerBalance) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-green-600 dark:text-green-400'}`}>
                                GH₵ {Number(w.totals.writerBalance).toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground italic">No writer calculation data found.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Folder Contents Dialog (for grid/icon views) */}
      <Dialog open={!!selectedFolderForView} onOpenChange={open => !open && setSelectedFolderForView(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg viewBox="0 0 100 80" className="w-6 h-5 shrink-0" xmlns="http://www.w3.org/2000/svg">
                <path d="M 4,14 L 4,8 A 4,4 0 0 1 8,4 L 32,4 A 4,4 0 0 1 36,8 L 42,14 L 92,14 A 4,4 0 0 1 96,18 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={folderColor} />
                <path d="M 4,20 A 4,4 0 0 1 8,16 L 92,16 A 4,4 0 0 1 96,20 L 96,72 A 4,4 0 0 1 92,76 L 8,76 A 4,4 0 0 1 4,72 Z" fill={folderColor} />
              </svg>
              <span>{selectedFolderForView?.monthName} Archive</span>
              <Badge variant="secondary" className="text-xs">
                {selectedFolderForView?.games.length} {selectedFolderForView?.games.length === 1 ? "game" : "games"}
              </Badge>
            </DialogTitle>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">{selectedFolderForView?.rangeLabel}</p>
          </DialogHeader>

          <div className="mt-4 border border-border/40 rounded-xl overflow-hidden bg-background/30 max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="bg-muted/30 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="w-32 font-semibold text-xs bg-muted/80">Event Number</TableHead>
                  <TableHead className="font-semibold text-xs bg-muted/80">Game Name</TableHead>
                  <TableHead className="font-semibold text-xs bg-muted/80">Close Date</TableHead>
                  <TableHead className="text-right font-semibold text-xs bg-muted/80">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedFolderForView?.games.map((g: Game) => (
                  <TableRow key={g.id} className="hover:bg-muted/15 border-b border-border/20 last:border-0">
                    <TableCell className="font-mono font-bold text-xs">
                      {isAdminOrDirector ? (
                        <button
                          onClick={() => {
                            setSelectedFolderForView(null);
                            handleOpenAudit(g);
                          }}
                          className="text-primary hover:underline hover:text-primary/95 text-left font-bold"
                        >
                          #{g.eventNumber}
                        </button>
                      ) : (
                        <span className="text-muted-foreground font-semibold">#{g.eventNumber}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-xs sm:text-sm">{g.name}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{formatDateTime(g.closeAt)}</TableCell>
                    <TableCell className="text-right">
                      {isAdminOrDirector ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] px-2.5 rounded-lg border-border/85"
                          onClick={() => {
                            setSelectedFolderForView(null);
                            handleOpenAudit(g);
                          }}
                        >
                          View Audit Ledger
                        </Button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic font-medium">Restricted</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="pt-2">
            <Button size="sm" onClick={() => setSelectedFolderForView(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Close / Kill Switch Confirmation Dialog */}
      <Dialog open={!!gameToClose} onOpenChange={(open) => {
        if (!open) setGameToClose(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-destructive flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600" />
              Emergency Game Closure Confirmation
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              You are about to execute a manual close (kill switch) on this game event. This action is irreversible and will immediately stop all entry submissions.
            </p>
          </DialogHeader>

          {gameToClose && (
            <div className="bg-muted/40 dark:bg-muted/10 border border-border/50 rounded-xl p-4 space-y-3">
              <div className="flex gap-3.5 items-start">
                {gameToClose.logoUrl ? (
                  <img src={gameToClose.logoUrl} alt={gameToClose.name} className="w-10 h-10 object-contain rounded-lg bg-background p-1 border border-border/40 shrink-0" />
                ) : (
                  <div
                    className="w-10 h-10 rounded-lg text-white flex items-center justify-center font-extrabold text-xs shadow shrink-0"
                    style={{ background: getGameGradient(gameToClose.name) }}
                  >
                    {gameToClose.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm text-foreground leading-snug">{gameToClose.name}</h4>
                  <p className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-bold mt-0.5">Event #{gameToClose.eventNumber}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div>
                  <span className="text-[10px] text-muted-foreground block font-medium">Current Status</span>
                  <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">{gameToClose.status}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block font-medium">Scheduled Close</span>
                  <span className="font-mono text-foreground text-[10px] font-semibold">{formatDateTime(gameToClose.closeAt)}</span>
                </div>
              </div>

              {gameToClose.description && (
                <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-2 mt-1 leading-relaxed">
                  <span className="font-medium text-foreground block mb-0.5 text-[10px]">Description</span>
                  {gameToClose.description}
                </div>
              )}

              <div className="border-t border-border/40 pt-2 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-medium">Triggered By:</span>
                  <span className="font-semibold text-foreground">{user?.fullName || user?.role}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-medium">Execution Time:</span>
                  <span className="font-mono font-semibold text-foreground">{new Date().toLocaleString("en-GB")}</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGameToClose(null)}
              className="rounded-xl font-medium"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmClose}
              disabled={isClosingGame}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl flex items-center gap-1.5"
            >
              {isClosingGame ? "Executing Closure..." : "Confirm Close Event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
