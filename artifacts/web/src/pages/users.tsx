import { Fragment, useState, useMemo, useRef } from "react";
import {
  useListUsers, useCreateUser, useUpdateUser, useDeactivateUser, useRegeneratePin,
  useListAgents, useCreateAgent, useUpdateAgent, useUpdateMyPhoto,
  useListWriters, useCreateWriter, useUpdateWriter,
  useListAgencyStaff, useCreateAgencyStaff, useUpdateAgencyStaff, useDeleteAgencyStaff,
  useListCompanyStaff, useCreateCompanyStaff, useUpdateCompanyStaff, useDeleteCompanyStaff,
  getListUsersQueryKey, getGetMeQueryKey, getListAgentsQueryKey, getListWritersQueryKey,
  getListAgencyStaffQueryKey, getListCompanyStaffQueryKey,
  User, UserInput, UserUpdate, AgentWithUser, Writer, AgencyStaff, CompanyStaff,
  AgencyStaffInput, CompanyStaffInput,
} from "@workspace/api-client-react";
import { ProfilePhotoInput } from "@/components/profile-photo-input";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

function resizeImageToDataUrl(file: File, maxPx = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── Writers sub-section (inside Agents tab) ─────────────────────────────────

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
  const [editForm, setEditForm] = useState({ fullName: "", isActive: true });

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
      await updateMutation.mutateAsync({ id: editWriter.id, data: { fullName: editForm.fullName, isActive: editForm.isActive } });
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
                <td className="py-1"><Badge variant={w.isActive ? "default" : "secondary"} className="text-xs h-4 px-1">{w.isActive ? "Active" : "Inactive"}</Badge></td>
                <td className="py-1 text-right">
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setEditWriter(w); setEditForm({ fullName: w.fullName, isActive: w.isActive }); }}>Edit</Button>
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
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editWriter} onOpenChange={open => !open && setEditWriter(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Writer — {editWriter?.fullCode}</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={editForm.isActive} onCheckedChange={v => setEditForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-sm">{editForm.isActive ? "Active" : "Inactive"}</Label>
            </div>
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

// ─── Users tab ───────────────────────────────────────────────────────────────

type CreateForm = { fullName: string; phone: string; role: string };
type EditForm = { fullName: string; phone: string; role: string; profilePicture: string | null };

function UsersTab() {
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
  const [editForm, setEditForm] = useState<EditForm>({ fullName: "", phone: "", role: "", profilePicture: null });
  const [newPin, setNewPin] = useState<{ pin: string; name: string } | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoTarget, setPhotoTarget] = useState<User | null>(null);

  const handlePhotoClick = (e: React.MouseEvent, u: User) => {
    e.stopPropagation();
    setPhotoTarget(u);
    photoInputRef.current?.click();
  };

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !photoTarget) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 320);
      await updateMutation.mutateAsync({ id: photoTarget.id, data: { profilePicture: dataUrl } });
      invalidateAll();
      toast({ title: `Photo updated for ${photoTarget.fullName}` });
    } catch {
      toast({ title: "Failed to upload photo", variant: "destructive" });
    } finally {
      setPhotoTarget(null);
    }
  };

  const filtered = useMemo(() => {
    let list = Array.isArray(users) ? users : [];
    if (roleFilter !== "all") list = list.filter(u => u.role === roleFilter);
    if (statusFilter === "active") list = list.filter(u => u.isActive);
    if (statusFilter === "inactive") list = list.filter(u => !u.isActive);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.fullName.toLowerCase().includes(q) ||
        (u.phone ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [users, roleFilter, statusFilter, search]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
    qc.invalidateQueries({ queryKey: getListAgentsQueryKey({}) });
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
      patch.profilePicture = editForm.profilePicture || null;
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

  const handleDelete = async (u: User) => {
    if (!confirm(`Are you sure you want to permanently delete user ${u.fullName}? This action cannot be undone. If they have active transaction history, they will be deactivated instead.`)) return;
    try {
      const res = await deactivateMutation.mutateAsync({ id: u.id });
      const isDeleted = (res as any)?.deleted;
      if (isDeleted) {
        toast({
          title: "User deleted",
          description: `Successfully deleted user ${u.fullName} and their agent profile.`,
        });
      } else {
        toast({
          title: "User deactivated",
          description: `User ${u.fullName} has active transaction history and was deactivated instead.`,
        });
      }
      invalidateAll();
    } catch {
      toast({ title: "Failed to delete user", variant: "destructive" });
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
    setEditForm({ fullName: u.fullName, phone: u.phone ?? "", role: u.role, profilePicture: u.profilePicture ?? null });
  };

  return (
    <>
      {/* ── Filter toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="pl-8 h-9 text-sm bg-slate-50"
          />
        </div>

        {/* Role filter */}
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-40 text-sm bg-slate-50">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Status pills */}
        <div className="flex items-center gap-1.5">
          {([
            ["all",      "All",      "bg-slate-800 text-white",    "bg-white text-slate-500 border hover:bg-slate-50"],
            ["active",   "Active",   "bg-emerald-500 text-white",  "bg-white text-slate-500 border hover:bg-emerald-50"],
            ["inactive", "Inactive", "bg-slate-400 text-white",    "bg-white text-slate-400 border hover:bg-slate-50"],
          ] as [typeof statusFilter, string, string, string][]).map(([f, label, active, inactive]) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${statusFilter === f ? active : inactive}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Result count + Add button */}
        <div className="ml-auto flex items-center gap-3">
          {(search || roleFilter !== "all" || statusFilter !== "all") && (
            <span className="text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
          )}
          <Button size="sm" className="bg-accent hover:bg-accent/90 text-white font-semibold" onClick={() => setCreateOpen(true)}>
            + Add User
          </Button>
        </div>
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
              <TableHead className="w-44">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">{search || roleFilter !== "all" || statusFilter !== "all" ? "No users match your filters." : "No users found."}</TableCell></TableRow>
            ) : filtered.map(u => (
              <TableRow key={u.id} className={!u.isActive ? "opacity-50" : ""}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={e => handlePhotoClick(e, u)}
                      className="relative group flex-shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="Click to upload profile photo"
                    >
                      <UserAvatar name={u.fullName} picture={u.profilePicture} />
                      <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                      </span>
                    </button>
                    <span className="font-medium text-sm">{u.fullName}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground font-mono">{u.phone ?? "—"}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{ROLE_LABELS[u.role] ?? u.role}</Badge></TableCell>
                <TableCell><Badge variant={u.isActive ? "default" : "secondary"} className="text-xs">{u.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.lastLogin
                    ? `${new Date(u.lastLogin).toLocaleDateString()} ${new Date(u.lastLogin).toLocaleTimeString()}`
                    : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEdit(u)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-amber-600" onClick={() => handleRegeneratePin(u)}>Reset PIN</Button>
                    {u.isActive && <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDeactivate(u)}>Deactivate</Button>}
                    <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(u)}>Delete</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Hidden file input for inline avatar upload */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoFile}
      />

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
              <Label className="text-xs">Profile Photo <span className="text-muted-foreground">(optional)</span></Label>
              <div className="flex justify-center py-1">
                <ProfilePhotoInput
                  value={editForm.profilePicture}
                  onChange={v => setEditForm(f => ({ ...f, profilePicture: v }))}
                  name={editForm.fullName}
                  size={80}
                />
              </div>
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
    </>
  );
}

// ─── Ghana city presets ───────────────────────────────────────────────────────

const GHANA_CITIES = [
  { name: "Accra",              lat: 5.6037,  lng: -0.1870 },
  { name: "Kumasi",             lat: 6.6885,  lng: -1.6244 },
  { name: "Tamale",             lat: 9.4008,  lng: -0.8393 },
  { name: "Sekondi-Takoradi",   lat: 4.9016,  lng: -1.7558 },
  { name: "Cape Coast",         lat: 5.1315,  lng: -1.2795 },
  { name: "Koforidua",          lat: 6.0940,  lng: -0.2601 },
  { name: "Sunyani",            lat: 7.3349,  lng: -2.3269 },
  { name: "Techiman",           lat: 7.5896,  lng: -1.9385 },
  { name: "Ho",                 lat: 6.6011,  lng:  0.4703 },
  { name: "Bolgatanga",         lat: 10.7856, lng: -0.8514 },
  { name: "Wa",                 lat: 10.0601, lng: -2.5099 },
  { name: "Tema",               lat: 5.6698,  lng: -0.0166 },
  { name: "Other / Custom",     lat: null,    lng: null    },
] as const;

type CityName = typeof GHANA_CITIES[number]["name"];

const DEBT_STATUS_CFG = {
  "active-clear": { label: "Active — Clear",    cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  "active-debt":  { label: "Active — Has Debt", cls: "bg-amber-100 text-amber-700 border-amber-200"     },
  "closed":       { label: "Closed",            cls: "bg-slate-100 text-slate-500 border-slate-200"      },
} as const;

function agencyStatusOf(a: AgentWithUser): keyof typeof DEBT_STATUS_CFG {
  if (a.status === "closed") return "closed";
  if (parseFloat(a.outstandingDebt ?? "0") > 0) return "active-debt";
  return "active-clear";
}

// ─── Agents tab ──────────────────────────────────────────────────────────────

type CreateAgentForm = {
  fullName: string; phone: string;
  profilePhoto: string | null;
  agentCode: string; agencyName: string;
  city: CityName | ""; location: string;
  lat: string; lng: string;
  status: "active" | "closed"; outstandingDebt: string;
};
type EditAgentForm = {
  isActive: boolean; agencyName: string;
  city: CityName | ""; location: string;
  lat: string; lng: string;
  status: "active" | "closed"; outstandingDebt: string;
  profilePhoto: string | null;
};

const CREATE_DEFAULTS: CreateAgentForm = {
  fullName: "", phone: "",
  profilePhoto: null,
  agentCode: "", agencyName: "",
  city: "", location: "", lat: "", lng: "",
  status: "active", outstandingDebt: "",
};

function AgentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: agents, isLoading } = useListAgents({});
  const { data: usersRaw } = useListUsers({});
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const createMutation = useCreateAgent();
  const updateMutation = useUpdateAgent();
  const regenPinMutation = useRegeneratePin();

  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<AgentWithUser | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateAgentForm>(CREATE_DEFAULTS);
  const [editForm, setEditForm] = useState<EditAgentForm>({
    isActive: true, agencyName: "", city: "", location: "", lat: "", lng: "", status: "active", outstandingDebt: "", profilePhoto: null,
  });

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [generatedPin, setGeneratedPin] = useState<string>("");
  const [newPin, setNewPin] = useState<{ pin: string; name: string } | null>(null);

  const [agentSearch, setAgentSearch] = useState("");
  const [agentStatusFilter, setAgentStatusFilter] = useState<"all" | "active-clear" | "active-debt" | "closed">("all");

  const [locatingCreate, setLocatingCreate] = useState(false);
  const [locatingEdit,   setLocatingEdit]   = useState(false);
  const geocodeTimerCreate = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeTimerEdit   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const availableUsers = useMemo(() => {
    if (!usersRaw || !agents) return [];
    const agentUserIds = new Set(agents.map(a => a.userId));
    return usersRaw.filter(u => !agentUserIds.has(u.id));
  }, [usersRaw, agents]);

  const filteredAgents = useMemo(() => {
    let list = Array.isArray(agents) ? agents : [];
    if (agentStatusFilter !== "all") list = list.filter(a => agencyStatusOf(a) === agentStatusFilter);
    if (agentSearch.trim()) {
      const q = agentSearch.toLowerCase();
      list = list.filter(a =>
        (a.agencyName ?? "").toLowerCase().includes(q) ||
        a.fullCode.toLowerCase().includes(q) ||
        a.user.fullName.toLowerCase().includes(q) ||
        (a.location ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [agents, agentStatusFilter, agentSearch]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListAgentsQueryKey({}) });
    qc.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
    qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const apiErrMsg = (err: unknown, fallback: string) =>
    (err as { data?: { error?: string } })?.data?.error ?? fallback;

  const applyCity = (cityName: CityName | "", setter: (fn: (f: any) => any) => void) => {
    const city = GHANA_CITIES.find(c => c.name === cityName);
    setter(f => ({
      ...f,
      city: cityName,
      location: cityName && cityName !== "Other / Custom" ? cityName : f.location,
      lat: city?.lat != null ? String(city.lat) : "",
      lng: city?.lng != null ? String(city.lng) : "",
    }));
  };

  const isCustomCity = (city: string) => !city || city === "Other / Custom";

  const geocodeLocation = async (
    locationText: string,
    setter: (fn: (f: any) => any) => void,
    setLocating: (v: boolean) => void,
  ) => {
    const text = locationText.trim();
    if (!text) return;
    const query = `${text}, Ghana`;
    setLocating(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=gh`,
        { headers: { "Accept-Language": "en" } },
      );
      const results: { lat: string; lon: string; display_name: string }[] = await res.json();
      if (!results.length) return; // silently skip — user may still be typing
      const { lat, lon } = results[0];
      setter(f => ({ ...f, lat: parseFloat(lat).toFixed(6), lng: parseFloat(lon).toFixed(6) }));
    } catch {
      // silently ignore network errors during auto-geocode
    } finally {
      setLocating(false);
    }
  };

  const scheduleGeocode = (
    text: string,
    setter: (fn: (f: any) => any) => void,
    setLocating: (v: boolean) => void,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!text.trim()) return;
    timerRef.current = setTimeout(() => geocodeLocation(text, setter, setLocating), 900);
  };

  const handleUserSelectChange = async (val: string) => {
    if (val === "new") {
      setSelectedUserId(null);
      setGeneratedPin("");
      setCreateForm(prev => ({
        ...prev,
        fullName: "",
        phone: "",
        profilePhoto: null,
      }));
      return;
    }

    const u = availableUsers.find(user => user.id === val);
    if (!u) return;

    setSelectedUserId(val);
    setCreateForm(prev => ({
      ...prev,
      fullName: u.fullName,
      phone: u.phone ?? "",
      profilePhoto: u.profilePicture ?? null,
    }));

    // Trigger PIN regeneration for this existing user
    try {
      const res = await regenPinMutation.mutateAsync({ id: val });
      setGeneratedPin(res.pin);
    } catch {
      toast({ title: "Failed to generate new PIN for the selected user", variant: "destructive" });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let finalUserId = selectedUserId;
      let finalPin = generatedPin;

      if (!finalUserId) {
        // Create a new user
        const { id: newUserId, pin: generatedPinVal } = await createUserMutation.mutateAsync({
          data: {
            fullName: createForm.fullName.trim(),
            phone: createForm.phone.trim(),
            role: "agent",
          },
        });
        finalUserId = newUserId;
        finalPin = generatedPinVal;

        if (createForm.profilePhoto) {
          await updateUserMutation.mutateAsync({ id: newUserId, data: { profilePicture: createForm.profilePhoto } });
        }
      } else {
        // Link to an existing user: update role to "agent", sync name/phone/photo
        await updateUserMutation.mutateAsync({
          id: finalUserId,
          data: {
            fullName: createForm.fullName.trim(),
            phone: createForm.phone.trim(),
            role: "agent",
            profilePicture: createForm.profilePhoto,
          },
        });
      }

      const debt = parseFloat(createForm.outstandingDebt || "0");
      await createMutation.mutateAsync({
        data: {
          userId: finalUserId,
          agentCode: createForm.agentCode.toUpperCase(),
          agencyName: createForm.agencyName || undefined,
          location: createForm.location || undefined,
          lat: createForm.lat ? parseFloat(createForm.lat) : undefined,
          lng: createForm.lng ? parseFloat(createForm.lng) : undefined,
          status: createForm.status,
          outstandingDebt: debt > 0 ? String(debt) : "0",
        },
      });

      // Display the PIN success dialog
      setNewPin({ pin: finalPin, name: createForm.fullName.trim() });
      setCreateOpen(false);
      setCreateForm(CREATE_DEFAULTS);
      setSelectedUserId(null);
      setGeneratedPin("");
      invalidate();
    } catch (err: unknown) {
      toast({ title: apiErrMsg(err, "Failed to register agent"), variant: "destructive" });
    }
  };

  const openEdit = (a: AgentWithUser) => {
    // Only match city if agent has real coordinates
    const cityMatch = a.lat && a.lng
      ? GHANA_CITIES.find(c => c.lat != null && Math.abs(c.lat - parseFloat(a.lat!)) < 0.001)
      : undefined;
    setEditAgent(a);
    setEditForm({
      isActive: a.isActive,
      agencyName: a.agencyName ?? "",
      city: cityMatch?.name ?? "",
      location: a.location ?? "",
      lat: a.lat ?? "",
      lng: a.lng ?? "",
      status: (a.status as "active" | "closed") ?? "active",
      outstandingDebt: parseFloat(a.outstandingDebt ?? "0") > 0 ? a.outstandingDebt : "",
      profilePhoto: a.user?.profilePicture ?? null,
    });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAgent) return;
    try {
      const debt = parseFloat(editForm.outstandingDebt || "0");
      await updateMutation.mutateAsync({
        id: editAgent.id,
        data: {
          isActive: editForm.isActive,
          agencyName: editForm.agencyName || undefined,
          location: editForm.location || undefined,
          lat: editForm.lat ? parseFloat(editForm.lat) : undefined,
          lng: editForm.lng ? parseFloat(editForm.lng) : undefined,
          status: editForm.status,
          outstandingDebt: String(debt > 0 ? debt : 0),
        },
      });
      // Sync photo back to user profile
      if (editAgent.user?.id) {
        await updateUserMutation.mutateAsync({
          id: editAgent.user.id,
          data: { profilePicture: editForm.profilePhoto },
        });
      }
      toast({ title: "Agent updated" });
      setEditAgent(null);
      invalidate();
    } catch (err: unknown) {
      toast({ title: apiErrMsg(err, "Failed to update agent"), variant: "destructive" });
    }
  };

  return (
    <>
      {/* ── Filter toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <Input
            value={agentSearch}
            onChange={e => setAgentSearch(e.target.value)}
            placeholder="Search agency, code, agent or location…"
            className="pl-8 h-9 text-sm bg-slate-50"
          />
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-1.5">
          {([
            ["all",          "All",       "bg-slate-800 text-white",   "bg-white text-slate-500 border hover:bg-slate-50"],
            ["active-clear", "Clear",     "bg-emerald-500 text-white", "bg-white text-slate-500 border hover:bg-emerald-50"],
            ["active-debt",  "Has Debt",  "bg-amber-500 text-white",   "bg-white text-slate-500 border hover:bg-amber-50"],
            ["closed",       "Closed",    "bg-slate-400 text-white",   "bg-white text-slate-400 border hover:bg-slate-50"],
          ] as [typeof agentStatusFilter, string, string, string][]).map(([f, label, active, inactive]) => (
            <button
              key={f}
              onClick={() => setAgentStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${agentStatusFilter === f ? active : inactive}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Result count + Add button */}
        <div className="ml-auto flex items-center gap-3">
          {(agentSearch || agentStatusFilter !== "all") && (
            <span className="text-xs text-muted-foreground">{filteredAgents.length} result{filteredAgents.length !== 1 ? "s" : ""}</span>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>Add Agency</Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Agency</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Debt</TableHead>
              <TableHead className="w-20">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">Loading...</TableCell></TableRow>
            ) : filteredAgents.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">{agentSearch || agentStatusFilter !== "all" ? "No agents match your filters." : "No agents found."}</TableCell></TableRow>
            ) : filteredAgents.map(a => {
              const st = agencyStatusOf(a);
              const cfg = DEBT_STATUS_CFG[st];
              const debt = parseFloat(a.outstandingDebt ?? "0");
              return (
                <Fragment key={a.id}>
                  <TableRow
                    className={`cursor-pointer hover:bg-muted/50 transition-colors${!a.isActive ? " opacity-50" : ""}`}
                    onClick={() => openEdit(a)}
                  >
                    <TableCell onClick={e => { e.stopPropagation(); setExpanded(expanded === a.id ? null : a.id); }} className="cursor-default">
                      <button
                        className="text-muted-foreground hover:text-foreground text-xs w-5 h-5 flex items-center justify-center"
                        aria-label={expanded === a.id ? "Collapse writers" : "Expand writers"}
                        tabIndex={-1}
                      >
                        {expanded === a.id ? "▼" : "▶"}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-sm font-medium">{a.fullCode}</TableCell>
                    <TableCell className="text-sm font-medium">{a.agencyName ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.user?.fullName ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.location ?? "—"}</TableCell>
                    <TableCell>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
                        {cfg.label}
                      </span>
                    </TableCell>
                    <TableCell className={`text-sm font-mono ${debt > 0 ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>
                      {debt > 0 ? `GHS ${debt.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEdit(a)}>Edit</Button>
                    </TableCell>
                  </TableRow>
                  {expanded === a.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/30 px-8 py-2">
                        <WritersSection agentId={a.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ── Create Agent Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Agency</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">Creates the agent user account and registers the agency in one step.</p>
          <form onSubmit={handleCreate} className="space-y-4">
            {/* Agent user details */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent Login Details</p>
              
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Link to Existing User <span className="text-muted-foreground">(Optional)</span></Label>
                <Select value={selectedUserId || "new"} onValueChange={handleUserSelectChange}>
                  <SelectTrigger className="h-9 text-sm bg-background">
                    <SelectValue placeholder="Create New User" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Create New User (Default)</SelectItem>
                    {availableUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.fullName} ({u.phone ?? "No phone"}) — {ROLE_LABELS[u.role] ?? u.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-center pb-1 pt-1">
                <ProfilePhotoInput
                  value={createForm.profilePhoto}
                  onChange={v => setCreateForm(f => ({ ...f, profilePhoto: v }))}
                  name={createForm.fullName}
                  size={72}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">Full Name</Label>
                  <Input value={createForm.fullName} onChange={e => setCreateForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. Pedro Mensah" />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">Phone Number</Label>
                  <Input value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} required className="h-9 text-sm font-mono" placeholder="0244000001" />
                  {!selectedUserId && (
                    <p className="text-[11px] text-muted-foreground">A 4-digit PIN will be auto-generated and shown after registration.</p>
                  )}
                </div>
                {selectedUserId && (
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-medium text-amber-600">Auto-Generated PIN (Active Immediately)</Label>
                    <div className="flex gap-2">
                      <Input value={generatedPin || "Generating PIN..."} readOnly className="h-9 text-sm font-mono bg-amber-500/5 border-amber-300/40 text-amber-700 font-bold select-all" />
                      {regenPinMutation.isPending && (
                        <span className="flex items-center text-xs text-muted-foreground animate-pulse">Generating...</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">A new 4-digit PIN has been generated for this user. Copy and save it now.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Agent code + agency */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Agent Code <span className="text-muted-foreground">(2 chars)</span></Label>
                <Input value={createForm.agentCode} onChange={e => setCreateForm(f => ({ ...f, agentCode: e.target.value.toUpperCase() }))} required maxLength={2} className="h-9 text-sm font-mono" placeholder="PA" />
                <p className="text-[11px] text-muted-foreground">Full code: VS-{createForm.agentCode || "XX"}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Agency Name</Label>
                <Input value={createForm.agencyName} onChange={e => setCreateForm(f => ({ ...f, agencyName: e.target.value }))} className="h-9 text-sm" placeholder="e.g. Pedro Agency" />
              </div>
            </div>

            {/* Location */}
            <div className="space-y-1.5">
              <Label className="text-xs">City / Area</Label>
              <Select value={createForm.city} onValueChange={v => applyCity(v as CityName, setCreateForm)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select city…" /></SelectTrigger>
                <SelectContent>{GHANA_CITIES.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Physical Location <span className="text-muted-foreground">(street / neighbourhood)</span></Label>
                {locatingCreate && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" strokeOpacity=".3"/><path d="M21 12a9 9 0 0 1-9 9"/></svg>
                    Locating…
                  </span>
                )}
              </div>
              <Input
                value={createForm.location}
                onChange={e => {
                  const val = e.target.value;
                  setCreateForm(f => ({ ...f, location: val }));
                  scheduleGeocode(val, setCreateForm, setLocatingCreate, geocodeTimerCreate);
                }}
                className="h-9 text-sm"
                placeholder="e.g. Teshie, Adenta, Fotobi…"
              />
              <p className="text-[11px] text-muted-foreground">Type the specific neighbourhood — coordinates update automatically.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Latitude</Label>
                <Input type="number" step="any" value={createForm.lat} onChange={e => setCreateForm(f => ({ ...f, lat: e.target.value }))} className="h-9 text-sm font-mono" placeholder="5.6037" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Longitude</Label>
                <Input type="number" step="any" value={createForm.lng} onChange={e => setCreateForm(f => ({ ...f, lng: e.target.value }))} className="h-9 text-sm font-mono" placeholder="-0.1870" />
              </div>
            </div>

            {/* Status + Debt */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Initial Status</Label>
                <Select value={createForm.status} onValueChange={v => setCreateForm(f => ({ ...f, status: v as "active" | "closed" }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Initial Outstanding Debt <span className="text-muted-foreground">(GHS)</span></Label>
                <Input type="number" min="0" step="0.01" value={createForm.outstandingDebt} onChange={e => setCreateForm(f => ({ ...f, outstandingDebt: e.target.value }))} className="h-9 text-sm" placeholder="0.00" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => { setCreateOpen(false); setCreateForm(CREATE_DEFAULTS); setSelectedUserId(null); setGeneratedPin(""); }}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending || (!selectedUserId && createUserMutation.isPending) || (selectedUserId && regenPinMutation.isPending) || !createForm.fullName.trim() || !createForm.phone.trim() || createForm.agentCode.length !== 2}>Register Agency</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Agent Dialog ── */}
      <Dialog open={!!editAgent} onOpenChange={open => !open && setEditAgent(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Agency — {editAgent?.fullCode}</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 space-y-0.5">
              <div>Agent: <span className="text-foreground font-medium">{editAgent?.user?.fullName}</span></div>
              <div className="font-mono text-xs">{editAgent?.user?.phone}</div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Profile Photo <span className="text-muted-foreground">(optional)</span></Label>
              <div className="flex justify-center py-1">
                <ProfilePhotoInput
                  value={editForm.profilePhoto}
                  onChange={v => setEditForm(f => ({ ...f, profilePhoto: v }))}
                  name={editAgent?.user?.fullName ?? ""}
                  size={80}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Agency Name</Label>
                <Input value={editForm.agencyName} onChange={e => setEditForm(f => ({ ...f, agencyName: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">City / Area</Label>
                <Select value={editForm.city} onValueChange={v => applyCity(v as CityName, setEditForm)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select city…" /></SelectTrigger>
                  <SelectContent>{GHANA_CITIES.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Physical Location</Label>
                  {locatingEdit && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" strokeOpacity=".3"/><path d="M21 12a9 9 0 0 1-9 9"/></svg>
                      Locating…
                    </span>
                  )}
                </div>
                <Input
                  value={editForm.location}
                  onChange={e => {
                    const val = e.target.value;
                    setEditForm(f => ({ ...f, location: val }));
                    scheduleGeocode(val, setEditForm, setLocatingEdit, geocodeTimerEdit);
                  }}
                  className="h-9 text-sm"
                  placeholder="e.g. Teshie, Adenta, Fotobi…"
                />
                <p className="text-[11px] text-muted-foreground">Type the specific neighbourhood — coordinates update automatically.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Latitude</Label>
                <Input type="number" step="any" value={editForm.lat} onChange={e => setEditForm(f => ({ ...f, lat: e.target.value }))} className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Longitude</Label>
                <Input type="number" step="any" value={editForm.lng} onChange={e => setEditForm(f => ({ ...f, lng: e.target.value }))} className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Operational Status</Label>
                <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v as "active" | "closed" }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Outstanding Debt (GHS)</Label>
                <Input type="number" min="0" step="0.01" value={editForm.outstandingDebt} onChange={e => setEditForm(f => ({ ...f, outstandingDebt: e.target.value }))} className="h-9 text-sm" placeholder="0.00" />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Switch checked={editForm.isActive} onCheckedChange={v => setEditForm(f => ({ ...f, isActive: v }))} />
              <Label className="text-sm">System account {editForm.isActive ? "active" : "inactive"}</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditAgent(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending || updateUserMutation.isPending}>Save Changes</Button>
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
    </>
  );
}

// ─── Agency Staff tab ─────────────────────────────────────────────────────────

function AgencyStaffTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: agents } = useListAgents({});
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  const { data: staff, isLoading } = useListAgencyStaff(selectedAgentId, {
    query: { queryKey: getListAgencyStaffQueryKey(selectedAgentId), enabled: !!selectedAgentId }
  });

  const createMutation = useCreateAgencyStaff();
  const updateMutation = useUpdateAgencyStaff();
  const deleteMutation = useDeleteAgencyStaff();

  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<AgencyStaff | null>(null);
  const [form, setForm] = useState({ name: "", salary: "", allowances: "", bonuses: "" });
  const [editForm, setEditForm] = useState({ name: "", salary: "", allowances: "", bonuses: "" });

  const invalidate = () => { if (selectedAgentId) qc.invalidateQueries({ queryKey: getListAgencyStaffQueryKey(selectedAgentId) }); };

  const selectedAgent = useMemo(() => {
    const list = Array.isArray(agents) ? agents : [];
    return list.find(a => a.id === selectedAgentId);
  }, [agents, selectedAgentId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId) return;
    try {
      await createMutation.mutateAsync({
        agentId: selectedAgentId,
        data: {
          name: form.name.trim(),
          salary: form.salary || "0",
          allowances: form.allowances || "0",
          bonuses: form.bonuses || "0",
        }
      });
      toast({ title: "Staff member added" });
      setAddOpen(false);
      setForm({ name: "", salary: "", allowances: "", bonuses: "" });
      invalidate();
    } catch {
      toast({ title: "Failed to add staff member", variant: "destructive" });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem || !selectedAgentId) return;
    try {
      await updateMutation.mutateAsync({
        agentId: selectedAgentId,
        id: editItem.id,
        data: {
          name: editForm.name.trim() || undefined,
          salary: editForm.salary || undefined,
          allowances: editForm.allowances || undefined,
          bonuses: editForm.bonuses || undefined,
        }
      });
      toast({ title: "Staff member updated" });
      setEditItem(null);
      invalidate();
    } catch {
      toast({ title: "Failed to update staff member", variant: "destructive" });
    }
  };

  const handleDelete = async (s: AgencyStaff) => {
    if (!confirm(`Delete staff member "${s.name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ agentId: selectedAgentId, id: s.id });
      toast({ title: "Staff member deleted" });
      invalidate();
    } catch {
      toast({ title: "Failed to delete staff member", variant: "destructive" });
    }
  };

  const openEdit = (s: AgencyStaff) => {
    setEditItem(s);
    setEditForm({ name: s.name, salary: s.salary, allowances: s.allowances, bonuses: s.bonuses });
  };

  const agentsList = Array.isArray(agents) ? agents : [];
  const staffList = Array.isArray(staff) ? staff : [];

  return (
    <>
      {/* Agent selection */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="space-y-1.5 flex-1 min-w-56 max-w-sm">
          <Label className="text-xs font-medium">Select Agency</Label>
          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
            <SelectTrigger className="h-9 text-sm bg-slate-50">
              <SelectValue placeholder="Choose an agency…" />
            </SelectTrigger>
            <SelectContent>
              {agentsList.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.fullCode} — {a.agencyName || a.user?.fullName || "Unnamed"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedAgentId && (
          <Button size="sm" className="bg-accent hover:bg-accent/90 text-white font-semibold" onClick={() => setAddOpen(true)}>+ Add Staff</Button>
        )}
      </div>

      {!selectedAgentId ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Select an agency above to view and manage its staff.</div>
      ) : isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading staff…</div>
      ) : staffList.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No staff members for {selectedAgent?.agencyName || "this agency"} yet.</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Salary (GHS)</TableHead>
                <TableHead className="text-right">Allowances (GHS)</TableHead>
                <TableHead className="text-right">Bonuses (GHS)</TableHead>
                <TableHead className="text-right font-semibold">Total (GHS)</TableHead>
                <TableHead className="w-32">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staffList.map(s => {
                const total = parseFloat(s.salary) + parseFloat(s.allowances) + parseFloat(s.bonuses);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-sm">{s.name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{parseFloat(s.salary).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-blue-600">{parseFloat(s.allowances).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-600">{parseFloat(s.bonuses).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold text-primary">{total.toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => openEdit(s)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-destructive" onClick={() => handleDelete(s)}>Delete</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Staff Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Staff — {selectedAgent?.agencyName || selectedAgent?.fullCode}</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Staff Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. Kwame Mensah" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Salary (GHS)</Label>
                <Input type="number" min="0" step="0.01" value={form.salary} onChange={e => setForm(f => ({ ...f, salary: e.target.value }))} className="h-9 text-sm font-mono" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Allowances</Label>
                <Input type="number" min="0" step="0.01" value={form.allowances} onChange={e => setForm(f => ({ ...f, allowances: e.target.value }))} className="h-9 text-sm font-mono" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bonuses</Label>
                <Input type="number" min="0" step="0.01" value={form.bonuses} onChange={e => setForm(f => ({ ...f, bonuses: e.target.value }))} className="h-9 text-sm font-mono" placeholder="0.00" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>Add Staff</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Dialog */}
      <Dialog open={!!editItem} onOpenChange={open => !open && setEditItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Staff — {editItem?.name}</DialogTitle></DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Staff Name</Label>
              <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required className="h-9 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Salary (GHS)</Label>
                <Input type="number" min="0" step="0.01" value={editForm.salary} onChange={e => setEditForm(f => ({ ...f, salary: e.target.value }))} className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Allowances</Label>
                <Input type="number" min="0" step="0.01" value={editForm.allowances} onChange={e => setEditForm(f => ({ ...f, allowances: e.target.value }))} className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bonuses</Label>
                <Input type="number" min="0" step="0.01" value={editForm.bonuses} onChange={e => setEditForm(f => ({ ...f, bonuses: e.target.value }))} className="h-9 text-sm font-mono" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditItem(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Company Staff tab ────────────────────────────────────────────────────────

function CompanyStaffTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: staff, isLoading } = useListCompanyStaff();
  const createMutation = useCreateCompanyStaff();
  const updateMutation = useUpdateCompanyStaff();
  const deleteMutation = useDeleteCompanyStaff();

  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<CompanyStaff | null>(null);
  const [form, setForm] = useState({ fullName: "", position: "", salary: "", allowances: "", bonuses: "", profilePicture: null as string | null });
  const [editForm, setEditForm] = useState({ fullName: "", position: "", salary: "", allowances: "", bonuses: "", profilePicture: null as string | null });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListCompanyStaffQueryKey() });
  const staffList = Array.isArray(staff) ? staff : [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        data: {
          fullName: form.fullName.trim(),
          position: form.position.trim(),
          salary: form.salary || "0",
          allowances: form.allowances || "0",
          bonuses: form.bonuses || "0",
          profilePicture: form.profilePicture,
        }
      });
      toast({ title: "Company staff member added" });
      setAddOpen(false);
      setForm({ fullName: "", position: "", salary: "", allowances: "", bonuses: "", profilePicture: null });
      invalidate();
    } catch {
      toast({ title: "Failed to add company staff", variant: "destructive" });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    try {
      await updateMutation.mutateAsync({
        id: editItem.id,
        data: {
          fullName: editForm.fullName.trim() || undefined,
          position: editForm.position.trim() || undefined,
          salary: editForm.salary || undefined,
          allowances: editForm.allowances || undefined,
          bonuses: editForm.bonuses || undefined,
          profilePicture: editForm.profilePicture,
        }
      });
      toast({ title: "Staff member updated" });
      setEditItem(null);
      invalidate();
    } catch {
      toast({ title: "Failed to update staff member", variant: "destructive" });
    }
  };

  const handleToggleStatus = async (s: CompanyStaff) => {
    const newStatus = s.status === "active" ? "suspended" : "active";
    if (!confirm(`${newStatus === "suspended" ? "Suspend" : "Reactivate"} ${s.fullName}?`)) return;
    try {
      await updateMutation.mutateAsync({ id: s.id, data: { status: newStatus } });
      toast({ title: `${s.fullName} ${newStatus === "suspended" ? "suspended" : "reactivated"}` });
      invalidate();
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleDelete = async (s: CompanyStaff) => {
    if (!confirm(`Permanently delete ${s.fullName}?`)) return;
    try {
      await deleteMutation.mutateAsync({ id: s.id });
      toast({ title: "Staff member deleted" });
      invalidate();
    } catch {
      toast({ title: "Failed to delete staff", variant: "destructive" });
    }
  };

  const openEdit = (s: CompanyStaff) => {
    setEditItem(s);
    setEditForm({ fullName: s.fullName, position: s.position, salary: s.salary, allowances: s.allowances, bonuses: s.bonuses, profilePicture: s.profilePicture ?? null });
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Internal company employees — manage payroll, positions and status.</p>
        <Button size="sm" className="bg-accent hover:bg-accent/90 text-white font-semibold" onClick={() => setAddOpen(true)}>+ Add Staff</Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading company staff…</div>
      ) : staffList.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No company staff members yet. Click "+ Add Staff" to begin.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {staffList.map(s => {
            const total = parseFloat(s.salary) + parseFloat(s.allowances) + parseFloat(s.bonuses);
            const initials = s.fullName.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
            const color = AVATAR_COLORS[s.fullName.charCodeAt(0) % AVATAR_COLORS.length];
            const isSuspended = s.status === "suspended";
            return (
              <Card key={s.id} className={`overflow-hidden transition-all hover:shadow-md ${isSuspended ? "opacity-60" : ""}`}>
                <CardContent className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-center gap-3">
                    {s.profilePicture ? (
                      <img src={s.profilePicture} alt={s.fullName} className="w-12 h-12 rounded-full object-cover ring-2 ring-border flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className={`w-12 h-12 rounded-full ${color} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>{initials || "?"}</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{s.fullName}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.position}</p>
                    </div>
                    <Badge variant={isSuspended ? "secondary" : "default"} className="text-[10px] flex-shrink-0">{isSuspended ? "Suspended" : "Active"}</Badge>
                  </div>
                  {/* Financials */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground font-medium">Salary</p>
                      <p className="text-sm font-mono font-semibold">{parseFloat(s.salary).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground font-medium">Allowance</p>
                      <p className="text-sm font-mono font-semibold text-blue-600">{parseFloat(s.allowances).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground font-medium">Bonus</p>
                      <p className="text-sm font-mono font-semibold text-emerald-600">{parseFloat(s.bonuses).toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="border-t pt-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">Total: GHS {total.toFixed(2)}</span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => openEdit(s)}>Edit</Button>
                      <Button size="sm" variant="ghost" className={`h-6 text-xs px-2 ${isSuspended ? "text-emerald-600" : "text-amber-600"}`} onClick={() => handleToggleStatus(s)}>{isSuspended ? "Activate" : "Suspend"}</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-destructive" onClick={() => handleDelete(s)}>Delete</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Company Staff Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Company Staff</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="flex justify-center pb-1">
              <ProfilePhotoInput
                value={form.profilePicture}
                onChange={v => setForm(f => ({ ...f, profilePicture: v }))}
                name={form.fullName}
                size={72}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Full Name</Label>
                <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" placeholder="Jane Mensah" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Position</Label>
                <Input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} required className="h-9 text-sm" placeholder="e.g. Accountant" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Salary (GHS)</Label>
                <Input type="number" min="0" step="0.01" value={form.salary} onChange={e => setForm(f => ({ ...f, salary: e.target.value }))} className="h-9 text-sm font-mono" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Allowances</Label>
                <Input type="number" min="0" step="0.01" value={form.allowances} onChange={e => setForm(f => ({ ...f, allowances: e.target.value }))} className="h-9 text-sm font-mono" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bonuses</Label>
                <Input type="number" min="0" step="0.01" value={form.bonuses} onChange={e => setForm(f => ({ ...f, bonuses: e.target.value }))} className="h-9 text-sm font-mono" placeholder="0.00" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>Add Staff</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Company Staff Dialog */}
      <Dialog open={!!editItem} onOpenChange={open => !open && setEditItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Staff — {editItem?.fullName}</DialogTitle></DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="flex justify-center pb-1">
              <ProfilePhotoInput
                value={editForm.profilePicture}
                onChange={v => setEditForm(f => ({ ...f, profilePicture: v }))}
                name={editForm.fullName}
                size={72}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Full Name</Label>
                <Input value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} required className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Position</Label>
                <Input value={editForm.position} onChange={e => setEditForm(f => ({ ...f, position: e.target.value }))} required className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Salary (GHS)</Label>
                <Input type="number" min="0" step="0.01" value={editForm.salary} onChange={e => setEditForm(f => ({ ...f, salary: e.target.value }))} className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Allowances</Label>
                <Input type="number" min="0" step="0.01" value={editForm.allowances} onChange={e => setEditForm(f => ({ ...f, allowances: e.target.value }))} className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bonuses</Label>
                <Input type="number" min="0" step="0.01" value={editForm.bonuses} onChange={e => setEditForm(f => ({ ...f, bonuses: e.target.value }))} className="h-9 text-sm font-mono" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditItem(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export function Users() {
  const { user } = useAuth();
  const role = user?.role ?? "";
  const isAdmin = role === "administrator";

  // Admins default to "users" tab, Director/Cashier default to "company-staff"
  const defaultTab = isAdmin ? "users" : "company-staff";

  // Dynamic header based on role
  const heading = isAdmin ? "Users & Agents" : "Company Staff";
  const subHeading = isAdmin
    ? "Manage system users, agent accounts, agency staff and company employees."
    : "View and manage internal company staff members.";

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{heading}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{subHeading}</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-4">
          {isAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="agents">Agents</TabsTrigger>}
          {isAdmin && <TabsTrigger value="agency-staff">Agency Staff</TabsTrigger>}
          <TabsTrigger value="company-staff">Company Staff</TabsTrigger>
        </TabsList>

        {isAdmin && (
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="agents">
            <AgentsTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="agency-staff">
            <AgencyStaffTab />
          </TabsContent>
        )}

        <TabsContent value="company-staff">
          <CompanyStaffTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
