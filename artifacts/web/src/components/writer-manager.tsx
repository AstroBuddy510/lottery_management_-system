import { useState } from "react";
import {
  useListWriters, useCreateWriter, useUpdateWriter,
  getListWritersQueryKey, Writer,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

interface Props {
  agentId: string;
  agentFullCode: string;
  readOnly?: boolean;
}

type CreateForm = { writerCode: string; fullName: string };
type EditForm = { fullName: string; isActive: boolean };

export function WriterManager({ agentId, agentFullCode, readOnly = false }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: writers, isLoading } = useListWriters(agentId, {}, {
    query: { queryKey: getListWritersQueryKey(agentId, {}), enabled: !!agentId }
  });
  const writerList: Writer[] = Array.isArray(writers) ? writers : [];

  const createMutation = useCreateWriter();
  const updateMutation = useUpdateWriter();

  const [addOpen, setAddOpen] = useState(false);
  const [editWriter, setEditWriter] = useState<Writer | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({ writerCode: "", fullName: "" });
  const [editForm, setEditForm] = useState<EditForm>({ fullName: "", isActive: true });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWritersQueryKey(agentId, {}) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        agentId,
        data: { writerCode: createForm.writerCode.trim().toUpperCase(), fullName: createForm.fullName.trim() },
      });
      toast({ title: "Writer added successfully" });
      setAddOpen(false);
      setCreateForm({ writerCode: "", fullName: "" });
      invalidate();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Failed to add writer";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const openEdit = (w: Writer) => {
    setEditWriter(w);
    setEditForm({ fullName: w.fullName, isActive: w.isActive });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editWriter) return;
    try {
      await updateMutation.mutateAsync({
        id: editWriter.id,
        data: { fullName: editForm.fullName.trim() || undefined, isActive: editForm.isActive },
      });
      toast({ title: "Writer updated" });
      setEditWriter(null);
      invalidate();
    } catch {
      toast({ title: "Failed to update writer", variant: "destructive" });
    }
  };

  const activeCount = writerList.filter(w => w.isActive).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Writers</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeCount} active · {writerList.length} total under {agentFullCode}
          </p>
        </div>
        {!readOnly && (
          <Button size="sm" className="bg-accent hover:bg-accent/90 text-white font-semibold" onClick={() => setAddOpen(true)}>
            + Add Writer
          </Button>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Writer Code</TableHead>
              <TableHead>Full Name</TableHead>
              <TableHead>Status</TableHead>
              {!readOnly && <TableHead className="w-20"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={readOnly ? 3 : 4} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
            ) : writerList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={readOnly ? 3 : 4} className="text-center py-8 text-muted-foreground text-sm">
                  No writers yet.{!readOnly && " Click \"+ Add Writer\" to get started."}
                </TableCell>
              </TableRow>
            ) : writerList.map(w => (
              <TableRow key={w.id} className={!w.isActive ? "opacity-50" : ""}>
                <TableCell className="font-mono text-sm font-medium">{w.fullCode}</TableCell>
                <TableCell className="text-sm">{w.fullName}</TableCell>
                <TableCell>
                  <Badge variant={w.isActive ? "default" : "secondary"} className="text-xs">
                    {w.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEdit(w)}>
                      Edit
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Add Writer Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Writer</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            The writer's full code will be <span className="font-mono font-semibold">{agentFullCode}-XXXX</span> where XXXX is the code you enter below.
          </p>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Writer Code <span className="text-muted-foreground">(up to 6 characters)</span></Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground font-mono flex-shrink-0">{agentFullCode}-</span>
                <Input
                  value={createForm.writerCode}
                  onChange={e => setCreateForm(f => ({ ...f, writerCode: e.target.value.toUpperCase() }))}
                  required
                  maxLength={6}
                  className="h-9 text-sm font-mono uppercase"
                  placeholder="CK01"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input
                value={createForm.fullName}
                onChange={e => setCreateForm(f => ({ ...f, fullName: e.target.value }))}
                required
                className="h-9 text-sm"
                placeholder="e.g. Carlos King"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>Add Writer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Writer Dialog */}
      <Dialog open={!!editWriter} onOpenChange={open => !open && setEditWriter(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Writer</DialogTitle>
          </DialogHeader>
          {editWriter && (
            <p className="text-xs text-muted-foreground -mt-2 font-mono">{editWriter.fullCode}</p>
          )}
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input
                value={editForm.fullName}
                onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))}
                required
                className="h-9 text-sm"
              />
            </div>
            <div className="flex items-center gap-3 py-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditForm(f => ({ ...f, isActive: true }))}
                  className={`px-3 py-1 text-xs rounded-full border font-medium transition-colors ${editForm.isActive ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setEditForm(f => ({ ...f, isActive: false }))}
                  className={`px-3 py-1 text-xs rounded-full border font-medium transition-colors ${!editForm.isActive ? "bg-secondary text-secondary-foreground border-border" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  Inactive
                </button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditWriter(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
