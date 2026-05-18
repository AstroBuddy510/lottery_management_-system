import { useState } from "react";
import {
  useGetSettings, useCreateSettings,
  useListTimeWindows, useCreateTimeWindow, useUpdateTimeWindow, useDeleteTimeWindow,
  getGetSettingsQueryKey, getListTimeWindowsQueryKey,
  TimeWindow,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Settings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading: loadingSettings } = useGetSettings();
  const { data: windows, isLoading: loadingWindows } = useListTimeWindows();
  const createSettingsMutation = useCreateSettings();
  const createWindowMutation = useCreateTimeWindow();
  const updateWindowMutation = useUpdateTimeWindow();
  const deleteWindowMutation = useDeleteTimeWindow();

  const [settingsForm, setSettingsForm] = useState({ commissionPct: "", reservePct: "", effectiveDate: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [windowOpen, setWindowOpen] = useState(false);
  const [editWindow, setEditWindow] = useState<TimeWindow | null>(null);
  const [windowForm, setWindowForm] = useState({ dayOfWeek: "", windowOpen: "", windowClose: "", isActive: true });

  const handleCreateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createSettingsMutation.mutateAsync({
        data: {
          commissionPct: String(Number(settingsForm.commissionPct) / 100),
          reservePct: String(Number(settingsForm.reservePct) / 100),
          effectiveDate: settingsForm.effectiveDate,
        }
      });
      toast({ title: "Settings updated" });
      setSettingsOpen(false);
      qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    } catch {
      toast({ title: "Failed to update settings", variant: "destructive" });
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
        }
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
        }
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
    setWindowForm({
      dayOfWeek: w.dayOfWeek != null ? String(w.dayOfWeek) : "",
      windowOpen: w.windowOpen,
      windowClose: w.windowClose,
      isActive: w.isActive,
    });
  };

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">System Settings</CardTitle>
              <CardDescription className="text-xs mt-1">Commission and reserve percentages applied to calculations.</CardDescription>
            </div>
            <Button size="sm" onClick={() => {
              setSettingsForm({
                commissionPct: settings ? String((Number(settings.commissionPct) * 100).toFixed(2)) : "",
                reservePct: settings ? String((Number(settings.reservePct) * 100).toFixed(2)) : "",
                effectiveDate: settings?.effectiveDate?.split("T")[0] ?? "",
              });
              setSettingsOpen(true);
            }}>Update</Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingSettings ? <p className="text-sm text-muted-foreground">Loading...</p> : !settings ? (
            <p className="text-sm text-muted-foreground">No settings configured.</p>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              <div><div className="text-xs text-muted-foreground mb-0.5">Commission</div><div className="text-lg font-bold">{(Number(settings.commissionPct) * 100).toFixed(2)}%</div></div>
              <div><div className="text-xs text-muted-foreground mb-0.5">Reserve</div><div className="text-lg font-bold">{(Number(settings.reservePct) * 100).toFixed(2)}%</div></div>
              <div><div className="text-xs text-muted-foreground mb-0.5">Effective Date</div><div className="text-lg font-bold">{settings.effectiveDate?.split("T")[0]}</div></div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Cashier Time Windows</CardTitle>
              <CardDescription className="text-xs mt-1">Hours during which cashiers can collect payments.</CardDescription>
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
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
                ) : !Array.isArray(windows) || windows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">No time windows.</TableCell></TableRow>
                ) : windows.map(w => (
                  <TableRow key={w.id}>
                    <TableCell className="text-sm">{w.dayOfWeek != null ? DAY_LABELS[w.dayOfWeek] : "All Days"}</TableCell>
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

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update System Settings</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateSettings} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Commission % (e.g. 5 for 5%)</Label>
              <Input type="number" step="0.01" min="0" max="100" value={settingsForm.commissionPct} onChange={e => setSettingsForm(f => ({ ...f, commissionPct: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reserve % (e.g. 3 for 3%)</Label>
              <Input type="number" step="0.01" min="0" max="100" value={settingsForm.reservePct} onChange={e => setSettingsForm(f => ({ ...f, reservePct: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Effective Date</Label>
              <Input type="date" value={settingsForm.effectiveDate} onChange={e => setSettingsForm(f => ({ ...f, effectiveDate: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createSettingsMutation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={windowOpen} onOpenChange={setWindowOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Time Window</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateWindow} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Day of Week (leave blank for all days)</Label>
              <select value={windowForm.dayOfWeek} onChange={e => setWindowForm(f => ({ ...f, dayOfWeek: e.target.value }))} className="w-full h-9 rounded border border-input bg-background px-3 text-sm">
                <option value="">All Days</option>
                {DAY_LABELS.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Opens</Label><Input type="time" value={windowForm.windowOpen} onChange={e => setWindowForm(f => ({ ...f, windowOpen: e.target.value }))} required className="h-9 text-sm" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Closes</Label><Input type="time" value={windowForm.windowClose} onChange={e => setWindowForm(f => ({ ...f, windowClose: e.target.value }))} required className="h-9 text-sm" /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={windowForm.isActive} onCheckedChange={v => setWindowForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setWindowOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createWindowMutation.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editWindow} onOpenChange={open => !open && setEditWindow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Time Window</DialogTitle></DialogHeader>
          <form onSubmit={handleEditWindow} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Day of Week</Label>
              <select value={windowForm.dayOfWeek} onChange={e => setWindowForm(f => ({ ...f, dayOfWeek: e.target.value }))} className="w-full h-9 rounded border border-input bg-background px-3 text-sm">
                <option value="">All Days</option>
                {DAY_LABELS.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Opens</Label><Input type="time" value={windowForm.windowOpen} onChange={e => setWindowForm(f => ({ ...f, windowOpen: e.target.value }))} required className="h-9 text-sm" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Closes</Label><Input type="time" value={windowForm.windowClose} onChange={e => setWindowForm(f => ({ ...f, windowClose: e.target.value }))} required className="h-9 text-sm" /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={windowForm.isActive} onCheckedChange={v => setWindowForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditWindow(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateWindowMutation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
