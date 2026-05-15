import { useState } from "react";
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
  const [form, setForm] = useState({ writerCode: "", fullName: "" });
  const [editForm, setEditForm] = useState({ fullName: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWritersQueryKey(agentId) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ agentId, data: { writerCode: form.writerCode.toUpperCase(), fullName: form.fullName } });
      toast({ title: "Writer created" });
      setAddOpen(false);
      setForm({ writerCode: "", fullName: "" });
      invalidate();
    } catch {
      toast({ title: "Failed to create writer", variant: "destructive" });
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editWriter) return;
    try {
      await updateMutation.mutateAsync({ id: editWriter.id, data: { fullName: editForm.fullName } });
      toast({ title: "Writer updated" });
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
        <p className="text-xs text-muted-foreground">No writers.</p>
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
                <td className="py-1"><Badge variant={w.isActive ? "default" : "secondary"} className="text-xs h-4 px-1">{w.isActive ? "Active" : "Inactive"}</Badge></td>
                <td className="py-1 text-right">
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setEditWriter(w); setEditForm({ fullName: w.fullName }); }}>Edit</Button>
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
            <div className="space-y-1.5"><Label className="text-xs">Writer Code (4 chars)</Label><Input value={form.writerCode} onChange={e => setForm(f => ({ ...f, writerCode: e.target.value.toUpperCase() }))} required maxLength={4} className="h-9 text-sm" placeholder="CK01" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editWriter} onOpenChange={open => !open && setEditWriter(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Writer</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={editForm.fullName} onChange={e => setEditForm({ fullName: e.target.value })} required className="h-9 text-sm" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditWriter(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save</Button>
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
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : !Array.isArray(agents) || agents.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No agents found.</TableCell></TableRow>
            ) : agents.map(a => (
              <>
                <TableRow key={a.id} className={!a.isActive ? "opacity-50" : ""}>
                  <TableCell>
                    <button className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                      {expanded === a.id ? "▼" : "▶"}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-sm font-medium">{a.fullCode}</TableCell>
                  <TableCell className="text-sm">{a.user?.fullName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.user?.email ?? "—"}</TableCell>
                  <TableCell><Badge variant={a.isActive ? "default" : "secondary"} className="text-xs">{a.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditAgent(a); setEditIsActive(a.isActive); }}>Edit</Button>
                  </TableCell>
                </TableRow>
                {expanded === a.id && (
                  <TableRow key={`${a.id}-writers`}>
                    <TableCell colSpan={6} className="bg-muted/30 px-8 py-2">
                      <WritersSection agentId={a.id} />
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Agent</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Agent User (role=agent)</Label>
              <Select value={createForm.userId} onValueChange={v => setCreateForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select user..." /></SelectTrigger>
                <SelectContent>{agentRoleUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.fullName} — {u.email}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Agent Code (2 chars)</Label><Input value={createForm.agentCode} onChange={e => setCreateForm(f => ({ ...f, agentCode: e.target.value.toUpperCase() }))} required maxLength={2} className="h-9 text-sm" placeholder="PA" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending || !createForm.userId}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editAgent} onOpenChange={open => !open && setEditAgent(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Agent — {editAgent?.fullCode}</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
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
