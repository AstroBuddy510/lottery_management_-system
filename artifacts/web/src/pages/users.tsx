import { useState } from "react";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeactivateUser,
  getListUsersQueryKey, User, UserInput, UserUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const ROLES = [
  { value: "director", label: "Director" },
  { value: "administrator", label: "Administrator" },
  { value: "cashier", label: "Cashier" },
  { value: "gross_entry", label: "Gross Entry" },
  { value: "wins_entry", label: "Wins Entry" },
  { value: "agent", label: "Agent" },
];

const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLES.map(r => [r.value, r.label]));

type CreateForm = { fullName: string; email: string; password: string; role: string };
type EditForm = { fullName: string; role: string };

export function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: users, isLoading } = useListUsers({});

  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deactivateMutation = useDeactivateUser();

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({ fullName: "", email: "", password: "", role: "cashier" });
  const [editForm, setEditForm] = useState<EditForm>({ fullName: "", role: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListUsersQueryKey({}) });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ data: createForm as UserInput });
      toast({ title: "User created" });
      setCreateOpen(false);
      setCreateForm({ fullName: "", email: "", password: "", role: "cashier" });
      invalidate();
    } catch {
      toast({ title: "Failed to create user", variant: "destructive" });
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    try {
      await updateMutation.mutateAsync({ id: editUser.id, data: editForm as UserUpdate });
      toast({ title: "User updated" });
      setEditUser(null);
      invalidate();
    } catch {
      toast({ title: "Failed to update user", variant: "destructive" });
    }
  };

  const handleDeactivate = async (u: User) => {
    if (!confirm(`Deactivate ${u.fullName}?`)) return;
    try {
      await deactivateMutation.mutateAsync({ id: u.id });
      toast({ title: "User deactivated" });
      invalidate();
    } catch {
      toast({ title: "Failed to deactivate user", variant: "destructive" });
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Users</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>Add User</Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : !Array.isArray(users) || users.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No users found.</TableCell></TableRow>
            ) : users.map(u => (
              <TableRow key={u.id} className={!u.isActive ? "opacity-50" : ""}>
                <TableCell className="font-medium text-sm">{u.fullName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{ROLE_LABELS[u.role] ?? u.role}</Badge></TableCell>
                <TableCell><Badge variant={u.isActive ? "default" : "secondary"} className="text-xs">{u.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setEditUser(u); setEditForm({ fullName: u.fullName, role: u.role }); }}>Edit</Button>
                    {u.isActive && <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDeactivate(u)}>Deactivate</Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={createForm.fullName} onChange={e => setCreateForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} required className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Password</Label><Input type="password" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} required className="h-9 text-sm" /></div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={createForm.role} onValueChange={v => setCreateForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editUser} onOpenChange={open => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5"><Label className="text-xs">Full Name</Label><Input value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" /></div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditUser(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
