import { useState } from "react";
import {
  useGetSettings, useCreateSettings,
  useListTimeWindows, useCreateTimeWindow, useUpdateTimeWindow, useDeleteTimeWindow,
  useListGames, useCreateGame, useUpdateGame, useDeleteGame,
  getGetSettingsQueryKey, getListTimeWindowsQueryKey, getListGamesQueryKey,
  TimeWindow, Game,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pctDisplay(raw: string | undefined) {
  if (!raw) return "—";
  return `${(Number(raw) * 100).toFixed(2)}%`;
}
function pctToDecimal(input: string) {
  return String(Number(input) / 100);
}
function decimalToPct(raw: string | undefined) {
  if (!raw) return "";
  return String((Number(raw) * 100).toFixed(4));
}

type RateKey = "agentCommissionPct" | "writerCommissionPct" | "reservePct";
const RATES: { key: RateKey; label: string; description: string; color: string }[] = [
  { key: "agentCommissionPct", label: "Agent Commission", description: "Percentage of gross sales paid to the agent.", color: "text-blue-600" },
  { key: "writerCommissionPct", label: "Writer Commission", description: "Percentage of gross sales paid to the writer.", color: "text-emerald-600" },
  { key: "reservePct", label: "Reserve", description: "Percentage of net gross set aside into the reserve fund.", color: "text-violet-600" },
];

const EMPTY_GAME = { name: "", dayOfWeek: "", isActive: true };

export function Settings() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // ── Settings data ──
  const { data: settings, isLoading: loadingSettings } = useGetSettings();
  const { data: windows, isLoading: loadingWindows } = useListTimeWindows();
  const { data: games, isLoading: loadingGames } = useListGames();

  // ── Mutations ──
  const createSettingsMutation = useCreateSettings();
  const createWindowMutation = useCreateTimeWindow();
  const updateWindowMutation = useUpdateTimeWindow();
  const deleteWindowMutation = useDeleteTimeWindow();
  const createGameMutation = useCreateGame();
  const updateGameMutation = useUpdateGame();
  const deleteGameMutation = useDeleteGame();

  // ── Rates state ──
  const [ratesOpen, setRatesOpen] = useState(false);
  const [ratesForm, setRatesForm] = useState({
    commissionPct: "", agentCommissionPct: "", writerCommissionPct: "", reservePct: "", effectiveDate: "",
  });

  // ── Time window state ──
  const [windowOpen, setWindowOpen] = useState(false);
  const [editWindow, setEditWindow] = useState<TimeWindow | null>(null);
  const [windowForm, setWindowForm] = useState({ dayOfWeek: "", windowOpen: "", windowClose: "", isActive: true });

  // ── Game state ──
  const [gameCreateOpen, setGameCreateOpen] = useState(false);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [gameForm, setGameForm] = useState(EMPTY_GAME);

  const gameList = Array.isArray(games) ? games : [];

  // ─────────── Handlers ───────────

  const openRatesDialog = () => {
    setRatesForm({
      commissionPct: decimalToPct(settings?.commissionPct),
      agentCommissionPct: decimalToPct(settings?.agentCommissionPct),
      writerCommissionPct: decimalToPct(settings?.writerCommissionPct),
      reservePct: decimalToPct(settings?.reservePct),
      effectiveDate: settings?.effectiveDate?.split("T")[0] ?? "",
    });
    setRatesOpen(true);
  };

  const handleSaveRates = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createSettingsMutation.mutateAsync({
        data: {
          commissionPct: pctToDecimal(ratesForm.commissionPct),
          agentCommissionPct: pctToDecimal(ratesForm.agentCommissionPct),
          writerCommissionPct: pctToDecimal(ratesForm.writerCommissionPct),
          reservePct: pctToDecimal(ratesForm.reservePct),
          effectiveDate: ratesForm.effectiveDate,
        },
      });
      toast({ title: "Commission rates updated" });
      setRatesOpen(false);
      qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    } catch {
      toast({ title: "Failed to update rates", variant: "destructive" });
    }
  };

  const handleCreateWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createWindowMutation.mutateAsync({
        data: {
          dayOfWeek: windowForm.dayOfWeek !== "" ? Number(windowForm.dayOfWeek) : null,
          windowOpen: windowForm.windowOpen,
          windowClose: windowForm.windowClose,
          isActive: windowForm.isActive,
        },
      });
      toast({ title: "Time window created" });
      setWindowOpen(false);
      setWindowForm({ dayOfWeek: "", windowOpen: "", windowClose: "", isActive: true });
      qc.invalidateQueries({ queryKey: getListTimeWindowsQueryKey() });
    } catch {
      toast({ title: "Failed to create time window", variant: "destructive" });
    }
  };

  const handleEditWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editWindow) return;
    try {
      await updateWindowMutation.mutateAsync({
        id: editWindow.id,
        data: {
          dayOfWeek: windowForm.dayOfWeek !== "" ? Number(windowForm.dayOfWeek) : null,
          windowOpen: windowForm.windowOpen,
          windowClose: windowForm.windowClose,
          isActive: windowForm.isActive,
        },
      });
      toast({ title: "Time window updated" });
      setEditWindow(null);
      qc.invalidateQueries({ queryKey: getListTimeWindowsQueryKey() });
    } catch {
      toast({ title: "Failed to update time window", variant: "destructive" });
    }
  };

  const handleDeleteWindow = async (w: TimeWindow) => {
    if (!confirm("Delete this time window?")) return;
    try {
      await deleteWindowMutation.mutateAsync({ id: w.id });
      toast({ title: "Time window deleted" });
      qc.invalidateQueries({ queryKey: getListTimeWindowsQueryKey() });
    } catch {
      toast({ title: "Failed to delete time window", variant: "destructive" });
    }
  };

  const openEditWindow = (w: TimeWindow) => {
    setEditWindow(w);
    setWindowForm({ dayOfWeek: w.dayOfWeek != null ? String(w.dayOfWeek) : "", windowOpen: w.windowOpen, windowClose: w.windowClose, isActive: w.isActive });
  };

  const handleCreateGame = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createGameMutation.mutateAsync({
        data: { name: gameForm.name, dayOfWeek: gameForm.dayOfWeek !== "" ? Number(gameForm.dayOfWeek) : null, isActive: gameForm.isActive },
      });
      toast({ title: "Game created" });
      setGameCreateOpen(false);
      setGameForm(EMPTY_GAME);
      qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
    } catch {
      toast({ title: "Failed to create game", variant: "destructive" });
    }
  };

  const handleEditGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editGame) return;
    try {
      await updateGameMutation.mutateAsync({
        id: editGame.id,
        data: { name: gameForm.name, dayOfWeek: gameForm.dayOfWeek !== "" ? Number(gameForm.dayOfWeek) : null, isActive: gameForm.isActive },
      });
      toast({ title: "Game updated" });
      setEditGame(null);
      qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
    } catch {
      toast({ title: "Failed to update game", variant: "destructive" });
    }
  };

  const handleDeleteGame = async (g: Game) => {
    if (!confirm(`Delete "${g.name}"? This cannot be undone.`)) return;
    try {
      await deleteGameMutation.mutateAsync({ id: g.id });
      toast({ title: "Game deleted" });
      qc.invalidateQueries({ queryKey: getListGamesQueryKey() });
    } catch {
      toast({ title: "Failed to delete game", variant: "destructive" });
    }
  };

  const openEditGame = (g: Game) => {
    setEditGame(g);
    setGameForm({ name: g.name, dayOfWeek: g.dayOfWeek != null ? String(g.dayOfWeek) : "", isActive: g.isActive });
  };

  // ─────────── Sub-forms ───────────

  const WindowForm = ({ onSubmit, onCancel, isPending }: { onSubmit: (e: React.FormEvent) => void; onCancel: () => void; isPending: boolean }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Day of Week (leave blank for all days)</Label>
        <select value={windowForm.dayOfWeek} onChange={e => setWindowForm(f => ({ ...f, dayOfWeek: e.target.value }))} className="w-full h-9 rounded border border-input bg-background px-3 text-sm">
          <option value="">All Days</option>
          {DAY_SHORT.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Opens</Label>
          <Input type="time" value={windowForm.windowOpen} onChange={e => setWindowForm(f => ({ ...f, windowOpen: e.target.value }))} required className="h-9 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Closes</Label>
          <Input type="time" value={windowForm.windowClose} onChange={e => setWindowForm(f => ({ ...f, windowClose: e.target.value }))} required className="h-9 text-sm" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={windowForm.isActive} onCheckedChange={v => setWindowForm(f => ({ ...f, isActive: v }))} />
        <Label className="text-xs">Active</Label>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </form>
  );

  const GameForm = ({ onSubmit, onCancel, isPending }: { onSubmit: (e: React.FormEvent) => void; onCancel: () => void; isPending: boolean }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Game Name</Label>
        <Input value={gameForm.name} onChange={e => setGameForm(f => ({ ...f, name: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. Monday Special, Evening Draw" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Day of Week (leave blank to run every day)</Label>
        <select value={gameForm.dayOfWeek} onChange={e => setGameForm(f => ({ ...f, dayOfWeek: e.target.value }))} className="w-full h-9 rounded border border-input bg-background px-3 text-sm">
          <option value="">Every Day</option>
          {DAY_FULL.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={gameForm.isActive} onCheckedChange={v => setGameForm(f => ({ ...f, isActive: v }))} />
        <Label className="text-xs">Active</Label>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </form>
  );

  // ─────────── Render ───────────

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage commission rates, reserve percentages, cashier hours, and games.
        </p>
      </div>

      <Tabs defaultValue="rates">
        <TabsList className="mb-4">
          <TabsTrigger value="rates">Commission Rates</TabsTrigger>
          <TabsTrigger value="hours">Cashier Hours</TabsTrigger>
          <TabsTrigger value="games">Games</TabsTrigger>
        </TabsList>

        {/* ── Commission Rates ── */}
        <TabsContent value="rates" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Commission & Reserve Rates</CardTitle>
                  <CardDescription className="text-xs mt-1">
                    These percentages are applied when running daily calculations.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={openRatesDialog} disabled={loadingSettings}>
                  {loadingSettings ? "Loading…" : "Update Rates"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!settings ? (
                <p className="text-sm text-muted-foreground">No rates configured yet.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {RATES.map(({ key, label, description, color }) => (
                      <div key={key} className="rounded-lg border bg-muted/30 p-4 space-y-1">
                        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</div>
                        <div className={`text-3xl font-bold ${color}`}>{pctDisplay(settings[key])}</div>
                        <div className="text-xs text-muted-foreground leading-snug">{description}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground border-t">
                    <span>Effective from: <span className="font-medium text-foreground">{settings.effectiveDate?.split("T")[0]}</span></span>
                    <span>Overall commission: <span className="font-medium text-foreground">{pctDisplay(settings.commissionPct)}</span></span>
                    <span className="ml-auto">Last updated: <span className="font-medium text-foreground">{settings.updatedAt ? new Date(settings.updatedAt).toLocaleDateString() : "—"}</span></span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground px-1">
            Each update creates a new record with the new effective date. The most recent record is always used for calculations.
          </p>
        </TabsContent>

        {/* ── Cashier Hours ── */}
        <TabsContent value="hours">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Cashier Time Windows</CardTitle>
                  <CardDescription className="text-xs mt-1">Hours during which cashiers are permitted to collect payments.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setWindowOpen(true)}>Add Window</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Opens</TableHead>
                      <TableHead>Closes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingWindows ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
                    ) : !Array.isArray(windows) || windows.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No time windows configured.</TableCell></TableRow>
                    ) : windows.map(w => (
                      <TableRow key={w.id}>
                        <TableCell className="text-sm font-medium">{w.dayOfWeek != null ? DAY_SHORT[w.dayOfWeek] : "All Days"}</TableCell>
                        <TableCell className="text-sm font-mono">{w.windowOpen}</TableCell>
                        <TableCell className="text-sm font-mono">{w.windowClose}</TableCell>
                        <TableCell><Badge variant={w.isActive ? "default" : "secondary"} className="text-xs">{w.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEditWindow(w)}>Edit</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDeleteWindow(w)}>Delete</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Games ── */}
        <TabsContent value="games">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Games Management</CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Define games and assign them to specific days. The active game for today appears on the dashboard.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => { setGameForm(EMPTY_GAME); setGameCreateOpen(true); }}>+ Add Game</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Game Name</TableHead>
                      <TableHead>Day Assigned</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-28"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingGames ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
                    ) : gameList.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No games yet. Add your first game.</TableCell></TableRow>
                    ) : gameList.map(g => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium text-sm">🎮 {g.name}</TableCell>
                        <TableCell className="text-sm">
                          {g.dayOfWeek != null ? DAY_FULL[g.dayOfWeek] : <span className="text-muted-foreground italic">Every day</span>}
                        </TableCell>
                        <TableCell><Badge variant={g.isActive ? "default" : "secondary"} className="text-xs">{g.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEditGame(g)}>Edit</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDeleteGame(g)}>Delete</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ── */}

      <Dialog open={ratesOpen} onOpenChange={setRatesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Commission Rates</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveRates} className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commission & Reserve Rates</p>
              {RATES.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{label} % <span className="text-muted-foreground">(e.g. 5 for 5%)</span></Label>
                  <div className="relative">
                    <Input type="number" step="0.01" min="0" max="100" value={ratesForm[key]} onChange={e => setRatesForm(f => ({ ...f, [key]: e.target.value }))} required className="h-9 text-sm pr-8" placeholder="0.00" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Calculation Engine</p>
              <div className="space-y-1">
                <Label className="text-xs">Overall Commission % <span className="text-muted-foreground">(used in daily calculations)</span></Label>
                <div className="relative">
                  <Input type="number" step="0.01" min="0" max="100" value={ratesForm.commissionPct} onChange={e => setRatesForm(f => ({ ...f, commissionPct: e.target.value }))} required className="h-9 text-sm pr-8" placeholder="0.00" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Effective Date</Label>
              <Input type="date" value={ratesForm.effectiveDate} onChange={e => setRatesForm(f => ({ ...f, effectiveDate: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setRatesOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createSettingsMutation.isPending}>{createSettingsMutation.isPending ? "Saving…" : "Save Rates"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={windowOpen} onOpenChange={setWindowOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Time Window</DialogTitle></DialogHeader>
          <WindowForm onSubmit={handleCreateWindow} onCancel={() => setWindowOpen(false)} isPending={createWindowMutation.isPending} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editWindow} onOpenChange={open => !open && setEditWindow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Time Window</DialogTitle></DialogHeader>
          <WindowForm onSubmit={handleEditWindow} onCancel={() => setEditWindow(null)} isPending={updateWindowMutation.isPending} />
        </DialogContent>
      </Dialog>

      <Dialog open={gameCreateOpen} onOpenChange={setGameCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Game</DialogTitle></DialogHeader>
          <GameForm onSubmit={handleCreateGame} onCancel={() => setGameCreateOpen(false)} isPending={createGameMutation.isPending} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editGame} onOpenChange={open => !open && setEditGame(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Game</DialogTitle></DialogHeader>
          <GameForm onSubmit={handleEditGame} onCancel={() => setEditGame(null)} isPending={updateGameMutation.isPending} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
