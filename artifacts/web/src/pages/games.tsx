import { useState } from "react";
import {
  useListGames, useCreateGame, useUpdateGame, useDeleteGame,
  getListGamesQueryKey, Game,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const EMPTY_FORM = { name: "", dayOfWeek: "", isActive: true };

export function Games() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: games, isLoading } = useListGames();
  const createMutation = useCreateGame();
  const updateMutation = useUpdateGame();
  const deleteMutation = useDeleteGame();

  const [createOpen, setCreateOpen] = useState(false);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const gameList = Array.isArray(games) ? games : [];
  const invalidate = () => qc.invalidateQueries({ queryKey: getListGamesQueryKey() });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        data: {
          name: form.name,
          dayOfWeek: form.dayOfWeek !== "" ? Number(form.dayOfWeek) : null,
          isActive: form.isActive,
        }
      });
      toast({ title: "Game created" });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      invalidate();
    } catch {
      toast({ title: "Failed to create game", variant: "destructive" });
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
          dayOfWeek: form.dayOfWeek !== "" ? Number(form.dayOfWeek) : null,
          isActive: form.isActive,
        }
      });
      toast({ title: "Game updated" });
      setEditGame(null);
      invalidate();
    } catch {
      toast({ title: "Failed to update game", variant: "destructive" });
    }
  };

  const handleDelete = async (g: Game) => {
    if (!confirm(`Delete "${g.name}"? This cannot be undone.`)) return;
    try {
      await deleteMutation.mutateAsync({ id: g.id });
      toast({ title: "Game deleted" });
      invalidate();
    } catch {
      toast({ title: "Failed to delete game", variant: "destructive" });
    }
  };

  const openEdit = (g: Game) => {
    setEditGame(g);
    setForm({
      name: g.name,
      dayOfWeek: g.dayOfWeek != null ? String(g.dayOfWeek) : "",
      isActive: g.isActive,
    });
  };

  const GameForm = ({ onSubmit, isPending }: { onSubmit: (e: React.FormEvent) => void; isPending: boolean }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Game Name</Label>
        <Input
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required
          className="h-9 text-sm"
          placeholder="e.g. Monday Special, Evening Draw"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Day of Week (leave blank to apply every day)</Label>
        <select
          value={form.dayOfWeek}
          onChange={e => setForm(f => ({ ...f, dayOfWeek: e.target.value }))}
          className="w-full h-9 rounded border border-input bg-background px-3 text-sm"
        >
          <option value="">Every Day</option>
          {DAY_LABELS.map((d, i) => (
            <option key={i} value={String(i)}>{d}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={form.isActive}
          onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
        />
        <Label className="text-xs">Active</Label>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { setCreateOpen(false); setEditGame(null); }}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Games Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define games and assign them to specific days. The active game for today appears on the dashboard.
          </p>
        </div>
        <Button
          size="sm"
          className="bg-accent hover:bg-accent/90 text-white font-semibold"
          onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }}
        >
          + Add Game
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Game Name</TableHead>
              <TableHead>Day Assigned</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
            ) : gameList.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No games yet. Add your first game.</TableCell></TableRow>
            ) : gameList.map(g => (
              <TableRow key={g.id}>
                <TableCell className="font-medium text-sm">🎮 {g.name}</TableCell>
                <TableCell className="text-sm">
                  {g.dayOfWeek != null ? DAY_LABELS[g.dayOfWeek] : (
                    <span className="text-muted-foreground italic">Every day</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={g.isActive ? "default" : "secondary"} className="text-xs">
                    {g.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEdit(g)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDelete(g)}>Delete</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Game</DialogTitle></DialogHeader>
          <GameForm onSubmit={handleCreate} isPending={createMutation.isPending} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editGame} onOpenChange={open => !open && setEditGame(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Game</DialogTitle></DialogHeader>
          <GameForm onSubmit={handleEdit} isPending={updateMutation.isPending} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
