import { Fragment, useState } from "react";
import {
  useListAgents, useListUsers, useCreateAgent, useUpdateAgent,
  useListWriters, useCreateWriter, useUpdateWriter,
  getListAgentsQueryKey, getListWritersQueryKey,
  AgentWithUser, Writer,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { WriterLocationField, locationPayload } from "@/components/writer-location-field";
import { WriterMomoFields, useWriterMomoForm } from "@/components/writer-momo-fields";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

function WritersSection({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: writers, isLoading } = useListWriters(agentId, {}, {
    query: { queryKey: getListWritersQueryKey(agentId, {}), enabled: !!agentId }
  });
  const createMutation = useCreateWriter();
  const updateMutation = useUpdateWriter();

  const [addOpen, setAddOpen] = useState(false);
  const [editWriter, setEditWriter] = useState<Writer | null>(null);
  const [form, setForm] = useState({ writerCode: "", fullName: "", location: "", lat: "", lng: "" });
  const [editForm, setEditForm] = useState({ fullName: "", isActive: true, location: "", lat: "", lng: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWritersQueryKey(agentId) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        agentId,
        data: {
          writerCode: form.writerCode.toUpperCase(),
          fullName: form.fullName,
          ...locationPayload(form),
        },
      });
      toast({ title: "Writer created" });
      setAddOpen(false);
      setForm({ writerCode: "", fullName: "", location: "", lat: "", lng: "" });
      invalidate();
    } catch {
      toast({ title: "Failed to create writer", variant: "destructive" });
    }
  };

  const momo = useWriterMomoForm(editWriter?.id);
  const [momoTouched, setMomoTouched] = useState(false);
  const [savingMomo, setSavingMomo] = useState(false);

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editWriter) return;
    // An active writer must have a payout wallet (when this user may set one).
    if (momo.canEdit && editForm.isActive && !momo.valid) {
      setMomoTouched(true);
      toast({ title: momo.problem ?? "Add the writer's MoMo wallet", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: editWriter.id,
        data: {
          fullName: editForm.fullName,
          isActive: editForm.isActive,
          // Sent whether or not they changed, so a writer who predates the
          // location field - or who has an address but no pin - can be
          // completed here instead of being recreated.
          location: editForm.location.trim(),
          lat: editForm.lat,
          lng: editForm.lng,
        },
      });
      if (momo.canEdit && momo.dirty && momo.valid) {
        setSavingMomo(true);
        try {
          const name = await momo.save();
          toast({
            title: "Writer updated",
            description: name ? `MoMo wallet confirmed: ${name}` : "MoMo wallet saved. The network did not confirm the name - check the number with the writer.",
          });
        } catch (err) {
          toast({ title: (err as Error).message || "The MoMo wallet was not saved", variant: "destructive" });
          invalidate();
          return;
        } finally {
          setSavingMomo(false);
        }
      } else {
        toast({ title: "Writer updated" });
      }
      setEditWriter(null);
      invalidate();
    } catch {
      toast({ title: "Failed to update writer", variant: "destructive" });
    }
  };

  return (
    <div className="mt-2 mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Writers</span>
        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setAddOpen(true)}>Add Writer</Button>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading writers...</p>
      ) : !Array.isArray(writers) || writers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No writers yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b">
              <th className="text-left pb-1 font-medium">Code</th>
              <th className="text-left pb-1 font-medium">Name</th>
              <th className="text-left pb-1 font-medium">Status</th>
              <th className="pb-1 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {writers.map(w => (
              <tr key={w.id} className={`border-b last:border-0 ${!w.isActive ? "opacity-50" : ""}`}>
                <td className="py-1 font-mono text-xs">{w.fullCode}</td>
                <td className="py-1 text-xs">{w.fullName}</td>
                <td className="py-1">
                  <Badge variant={w.isActive ? "default" : "secondary"} className="text-xs h-4 px-1">{w.isActive ? "Active" : "Inactive"}</Badge>
                  {!(w as { momoNumber?: string | null }).momoNumber && (
                    <Badge variant="outline" title="No MoMo wallet: winning tickets cannot be paid"
                      className="ml-1 text-[10px] h-4 px-1 border-amber-300 bg-amber-50 text-amber-800">No MoMo</Badge>
                  )}
                </td>
                <td className="py-1 text-right">
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setMomoTouched(false); setEditWriter(w); setEditForm({ fullName: w.fullName, isActive: w.isActive, location: w.location ?? "", lat: w.lat ?? "", lng: w.lng ?? "" }); }}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Writer</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Writer Code (4 chars)</Label>
              <Input value={form.writerCode} onChange={e => setForm(f => ({ ...f, writerCode: e.target.value.toUpperCase() }))} required maxLength={4} className="h-9 text-sm font-mono" placeholder="CK01" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <WriterLocationField
              value={{ location: form.location, lat: form.lat, lng: form.lng }}
              onChange={v => setForm(f => ({ ...f, ...v }))}
            />
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editWriter} onOpenChange={open => !open && setEditWriter(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Writer — {editWriter?.fullCode}</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <WriterMomoFields form={momo} idPrefix="agents-edit-momo" touched={momoTouched} />
            <WriterLocationField
              id="agents-edit-writer-location"
              required={false}
              value={{ location: editForm.location, lat: editForm.lat, lng: editForm.lng }}
              onChange={v => setEditForm(f => ({ ...f, ...v }))}
            />
            <div className="flex items-center gap-3">
              <Switch checked={editForm.isActive} onCheckedChange={v => setEditForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-sm">{editForm.isActive ? "Active" : "Inactive"}</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditWriter(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending || savingMomo}>{updateMutation.isPending || savingMomo ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Agents() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: agents, isLoading } = useListAgents({});
  const { data: users } = useListUsers({});
  const createMutation = useCreateAgent();
  const updateMutation = useUpdateAgent();

  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<AgentWithUser | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ userId: "", agentCode: "" });
  const [editIsActive, setEditIsActive] = useState(true);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListAgentsQueryKey({}) });

  const agentRoleUsers = Array.isArray(users) ? users.filter(u => u.role === "agent" && u.isActive) : [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: { userId: createForm.userId, agentCode: createForm.agentCode.toUpperCase() } });
      toast({ title: "Agent created" });
      setCreateOpen(false);
      setCreateForm({ userId: "", agentCode: "" });
      invalidate();
    } catch {
      toast({ title: "Failed to create agent", variant: "destructive" });
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAgent) return;
    try {
      await updateMutation.mutateAsync({ id: editAgent.id, data: { isActive: editIsActive } });
      toast({ title: "Agent updated" });
      setEditAgent(null);
      invalidate();
    } catch {
      toast({ title: "Failed to update agent", variant: "destructive" });
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Agents</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>Add Agent</Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : !Array.isArray(agents) || agents.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No agents found.</TableCell></TableRow>
            ) : agents.map(a => (
              <Fragment key={a.id}>
                <TableRow className={!a.isActive ? "opacity-50" : ""}>
                  <TableCell>
                    <button className="text-muted-foreground hover:text-foreground text-xs w-5 h-5 flex items-center justify-center" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                      {expanded === a.id ? "▼" : "▶"}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-sm font-medium">{a.fullCode}</TableCell>
                  <TableCell className="text-sm">{a.user?.fullName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">{a.user?.phone ?? "—"}</TableCell>
                  <TableCell><Badge variant={a.isActive ? "default" : "secondary"} className="text-xs">{a.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditAgent(a); setEditIsActive(a.isActive); }}>Edit</Button>
                  </TableCell>
                </TableRow>
                {expanded === a.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30 px-8 py-2">
                      <WritersSection agentId={a.id} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Agent</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Agent User (must have role = Agent)</Label>
              <Select value={createForm.userId} onValueChange={v => setCreateForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select user..." /></SelectTrigger>
                <SelectContent>{agentRoleUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.fullName} — {u.phone ?? ""}</SelectItem>)}</SelectContent>
              </Select>
              {agentRoleUsers.length === 0 && (
                <p className="text-xs text-muted-foreground">No available agent-role users. Create a user with role "Agent" first.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Agent Code (2 chars)</Label>
              <Input value={createForm.agentCode} onChange={e => setCreateForm(f => ({ ...f, agentCode: e.target.value.toUpperCase() }))} required maxLength={2} className="h-9 text-sm font-mono" placeholder="PA" />
              <p className="text-xs text-muted-foreground">Full code will be VS-{createForm.agentCode || "XX"}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending || !createForm.userId || createForm.agentCode.length !== 2}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editAgent} onOpenChange={open => !open && setEditAgent(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Agent — {editAgent?.fullCode}</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <div>Name: <span className="text-foreground font-medium">{editAgent?.user?.fullName}</span></div>
              <div>Phone: <span className="text-foreground font-mono">{editAgent?.user?.phone}</span></div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={editIsActive} onCheckedChange={setEditIsActive} />
              <Label className="text-sm">{editIsActive ? "Active" : "Inactive"}</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditAgent(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
