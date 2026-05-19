import { useState } from "react";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeactivateUser, useRegeneratePin,
  getListUsersQueryKey, getGetMeQueryKey, User, UserInput, UserUpdate,
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

const AVATAR_COLORS = [
  "bg-blue-600","bg-emerald-600","bg-violet-600","bg-orange-500","bg-pink-600","bg-teal-600",
];

function UserAvatar({ name, picture }: { name: string; picture?: string | null }) {
  const initials = name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  if (picture) {
    return (
      <img
        src={picture}
        alt={name}
        className="w-8 h-8 rounded-full object-cover ring-1 ring-border flex-shrink-0"
        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
      {initials || "?"}
    </div>
  );
}

type CreateForm = { fullName: string; phone: string; role: string };
type EditForm = { fullName: string; phone: string; role: string; profilePicture: string };

export function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: users, isLoading } = useListUsers({});

  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deactivateMutation = useDeactivateUser();
  const regenPinMutation = useRegeneratePin();

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({ fullName: "", phone: "", role: "cashier" });
  const [editForm, setEditForm] = useState<EditForm>({ fullName: "", phone: "", role: "", profilePicture: "" });
  const [newPin, setNewPin] = useState<{ pin: string; name: string } | null>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
    qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await createMutation.mutateAsync({ data: createForm as UserInput });
      setCreateOpen(false);
      setCreateForm({ fullName: "", phone: "", role: "cashier" });
      invalidateAll();
      setNewPin({ pin: result.pin, name: result.fullName });
    } catch {
      toast({ title: "Failed to create user", variant: "destructive" });
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    try {
      const patch: UserUpdate = {};
      if (editForm.fullName.trim()) patch.fullName = editForm.fullName.trim();
      if (editForm.phone.trim()) patch.phone = editForm.phone.trim();
      if (editForm.role) patch.role = editForm.role as UserUpdate["role"];
      patch.profilePicture = editForm.profilePicture.trim() || null;
      await updateMutation.mutateAsync({ id: editUser.id, data: patch });
      toast({ title: "User updated successfully" });
      setEditUser(null);
      invalidateAll();
    } catch {
      toast({ title: "Failed to update user", variant: "destructive" });
    }
  };

  const handleDeactivate = async (u: User) => {
    if (!confirm(`Deactivate ${u.fullName}?`)) return;
    try {
      await deactivateMutation.mutateAsync({ id: u.id });
      toast({ title: "User deactivated" });
      invalidateAll();
    } catch {
      toast({ title: "Failed to deactivate user", variant: "destructive" });
    }
  };

  const handleRegeneratePin = async (u: User) => {
    if (!confirm(`Regenerate PIN for ${u.fullName}? Their current PIN will stop working immediately.`)) return;
    try {
      const result = await regenPinMutation.mutateAsync({ id: u.id });
      setNewPin({ pin: result.pin, name: u.fullName });
    } catch {
      toast({ title: "Failed to regenerate PIN", variant: "destructive" });
    }
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setEditForm({
      fullName: u.fullName,
      phone: u.phone ?? "",
      role: u.role,
      profilePicture: u.profilePicture ?? "",
    });
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Users</h1>
        <Button size="sm" className="bg-accent hover:bg-accent/90 text-white font-semibold" onClick={() => setCreateOpen(true)}>
          + Add User
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="w-44"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : !Array.isArray(users) || users.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No users found.</TableCell></TableRow>
            ) : users.map(u => (
              <TableRow key={u.id} className={!u.isActive ? "opacity-50" : ""}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <UserAvatar name={u.fullName} picture={u.profilePicture} />
                    <span className="font-medium text-sm">{u.fullName}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground font-mono">{u.phone ?? "—"}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{ROLE_LABELS[u.role] ?? u.role}</Badge></TableCell>
                <TableCell><Badge variant={u.isActive ? "default" : "secondary"} className="text-xs">{u.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEdit(u)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-amber-600" onClick={() => handleRegeneratePin(u)}>Reset PIN</Button>
                    {u.isActive && <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDeactivate(u)}>Deactivate</Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">A 4-digit PIN will be auto-generated. Record it and share it with the user — it will only be shown once.</p>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input value={createForm.fullName} onChange={e => setCreateForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" placeholder="Jane Doe" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone Number</Label>
              <Input type="tel" value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. 0244123456" maxLength={10} />
              <p className="text-xs text-muted-foreground">Ghana number — 10 digits starting with 0</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={createForm.role} onValueChange={v => setCreateForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>Create &amp; Generate PIN</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={open => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            {/* Profile picture preview */}
            {editForm.profilePicture && (
              <div className="flex justify-center">
                <img src={editForm.profilePicture} alt="Profile preview" className="w-20 h-20 rounded-full object-cover ring-2 ring-border" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone Number</Label>
              <Input type="tel" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="h-9 text-sm" placeholder="e.g. 0244123456" maxLength={10} />
              <p className="text-xs text-muted-foreground">Ghana number — 10 digits starting with 0</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Profile Picture URL <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={editForm.profilePicture}
                onChange={e => setEditForm(f => ({ ...f, profilePicture: e.target.value }))}
                className="h-9 text-sm"
                placeholder="https://example.com/photo.jpg"
              />
              <p className="text-xs text-muted-foreground">Paste a direct link to a profile photo. Leave blank to use initials avatar.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditUser(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* PIN Display Dialog */}
      <Dialog open={!!newPin} onOpenChange={open => !open && setNewPin(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>PIN Generated</DialogTitle></DialogHeader>
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              The PIN for <span className="font-semibold text-foreground">{newPin?.name}</span> is:
            </p>
            <div className="text-5xl font-mono font-bold tracking-[0.3em] text-primary select-all">{newPin?.pin}</div>
            <p className="text-xs text-destructive font-medium">Record this PIN now — it will not be shown again.</p>
          </div>
          <DialogFooter>
            <Button className="w-full" onClick={() => setNewPin(null)}>I have recorded the PIN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
