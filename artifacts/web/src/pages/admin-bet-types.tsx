import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2, Search, ChevronUp, ChevronDown, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bet setups.
 *
 * The mechanic is the load-bearing field. The multiplier says what one
 * winning line is worth; the mechanic says what a line IS - a pair, a triple,
 * a banker and its partner - and so how many lines a selection buys and how a
 * draw settles it. Change the mechanic and the whole bet changes.
 */

interface MechanicSpec {
  mechanic: string;
  label: string;
  minNumbers: number;
  maxNumbers: number;
  needsBanker: boolean;
  defaultMultiplier: number;
  blurb: string;
}

interface BetType {
  id: string;
  name: string;
  code: string;
  description: string | null;
  mechanic: string;
  minNumbers: number;
  maxNumbers: number;
  minStake: string;
  maxStake: string;
  payoutMultiplier: string;
  isActive: boolean;
  ticketCount: number;
}

type SortKey = "name" | "multiplier" | "stakeCount" | "stakeAmount" | "status";

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

const EMPTY = {
  name: "", code: "", description: "",
  mechanic: "direct_two", minNumbers: 2, maxNumbers: 2,
  minStake: 0.1, maxStake: 50,
  payoutMultiplier: 240, isActive: true,
};

/** "0.1 / 50", or "0 / 0" where nothing has been set — as the reference reads. */
const range = (a: number | string, b: number | string) => `${Number(a)} / ${Number(b)}`;

export function AdminBetTypes() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BetType | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState("25");
  // Deactivated setups are history, not choices. Kept one click away rather
  // than interleaved, where near-identical names read as duplicates.
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  const { data: betTypes, isLoading } = useQuery<BetType[]>({
    queryKey: ["/api/bet-types"],
    queryFn: async () => {
      const res = await fetch("/api/bet-types", { headers: authHeaders() });
      return res.json();
    },
  });

  const { data: mechanics } = useQuery<MechanicSpec[]>({
    queryKey: ["/api/bet-types/mechanics"],
    queryFn: async () => {
      const res = await fetch("/api/bet-types/mechanics", { headers: authHeaders() });
      return res.json();
    },
  });

  const spec = mechanics?.find((m) => m.mechanic === form.mechanic);
  const specFor = (mechanic: string) => mechanics?.find((m) => m.mechanic === mechanic);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        code: form.code.toUpperCase(),
        description: form.description || undefined,
        mechanic: form.mechanic,
        minNumbers: form.minNumbers,
        maxNumbers: form.maxNumbers,
        minStake: Number(form.minStake),
        maxStake: Number(form.maxStake),
        payoutMultiplier: Number(form.payoutMultiplier),
        isActive: form.isActive,
      };
      const res = await fetch(editing ? `/api/bet-types/${editing.id}` : "/api/bet-types", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      return data;
    },
    onSuccess: () => {
      toast({ title: editing ? "Bet setup updated" : "Bet setup added" });
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["/api/bet-types"] });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/bet-types/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not update");
      return res.json();
    },
    onSuccess: (_d, v) => {
      toast({
        title: v.isActive ? "Activated" : "Deactivated",
        description: v.isActive ? undefined : "Writers can no longer sell this. Tickets already placed are unaffected.",
      });
      qc.invalidateQueries({ queryKey: ["/api/bet-types"] });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (b: BetType) => {
      const res = await fetch(`/api/bet-types/${b.id}`, { method: "DELETE", headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete");
      return data;
    },
    onSuccess: (d) => {
      toast({ title: `${d.code} deleted` });
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["/api/bet-types"] });
    },
    onError: (e: Error) => toast({ title: "Not deleted", description: e.message, variant: "destructive" }),
  });

  const confirmDelete = (b: BetType) => {
    if (b.ticketCount > 0) {
      toast({
        title: `${b.code} has tickets sold on it`,
        description: "Deactivate it instead — writers stop seeing it and the tickets stay readable.",
        variant: "destructive",
      });
      return;
    }
    if (!confirm(`Delete ${b.name} (${b.code})?\n\nNothing has been sold on it, so this removes it completely. You can add it again afterwards.`)) return;
    remove.mutate(b);
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setOpen(true);
  };

  const openEdit = (b: BetType) => {
    setEditing(b);
    setForm({
      name: b.name,
      code: b.code,
      description: b.description ?? "",
      mechanic: b.mechanic,
      minNumbers: b.minNumbers,
      maxNumbers: b.maxNumbers,
      minStake: Number(b.minStake),
      maxStake: Number(b.maxStake),
      payoutMultiplier: Number(b.payoutMultiplier),
      isActive: b.isActive,
    });
    setOpen(true);
  };

  // Picking a mechanic resets the range and odds to that mechanic's own,
  // which is nearly always wanted and is editable straight after.
  useEffect(() => {
    if (!spec || editing) return;
    setForm((f) =>
      f.mechanic === spec.mechanic
        ? { ...f, minNumbers: spec.minNumbers, maxNumbers: spec.maxNumbers, payoutMultiplier: spec.defaultMultiplier }
        : f,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.mechanic, mechanics]);

  const rows = useMemo(() => {
    let list = betTypes ?? [];
    if (!showInactive) list = list.filter((b) => b.isActive);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.code.toLowerCase().includes(q) ||
          (specFor(b.mechanic)?.label ?? "").toLowerCase().includes(q),
      );
    }
    const val = (b: BetType) => {
      switch (sort.key) {
        case "multiplier": return Number(b.payoutMultiplier);
        case "stakeCount": return b.minNumbers * 1000 + b.maxNumbers;
        case "stakeAmount": return Number(b.minStake) * 1000 + Number(b.maxStake);
        case "status": return b.isActive ? 1 : 0;
        default: return b.name.toLowerCase();
      }
    };
    const sorted = [...list].sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === "string" ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return pageSize === "all" ? sorted : sorted.slice(0, Number(pageSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betTypes, search, sort, pageSize, mechanics, showInactive]);

  const inactiveCount = (betTypes ?? []).filter((b) => !b.isActive).length;

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const SortHead = ({ label, k, className }: { label: string; k: SortKey; className?: string }) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 text-left font-semibold hover:text-foreground"
      >
        {label}
        <span className="flex flex-col -space-y-1.5">
          <ChevronUp className={cn("h-2.5 w-2.5", sort.key === k && sort.dir === "asc" ? "text-foreground" : "text-muted-foreground/40")} />
          <ChevronDown className={cn("h-2.5 w-2.5", sort.key === k && sort.dir === "desc" ? "text-foreground" : "text-muted-foreground/40")} />
        </span>
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-3">
      {/* ---- Title bar, as on the reference ------------------------------- */}
      <div className="flex items-center gap-2 rounded-t-lg border bg-muted/50 px-4 py-2.5">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-bold">Bet</span>
        <span className="text-sm italic text-muted-foreground">Setups</span>
        <Button size="sm" className="ml-auto h-8" onClick={openNew}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Show retired setups
          {inactiveCount > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
              {inactiveCount}
            </span>
          )}
        </label>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="h-9 pl-9"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <SortHead label="Bet Name" k="name" />
                  <SortHead label="Multiplier" k="multiplier" />
                  <SortHead label="Min/Max Stake #" k="stakeCount" />
                  <SortHead label="Min/Max Stake Amt" k="stakeAmount" />
                  <SortHead label="Status" k="status" />
                  <TableHead className="w-28 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                      {search
                        ? `Nothing matching "${search}".`
                        : showInactive
                          ? "No bet setups yet. Writers cannot sell anything until one is active."
                          : "No active bet setups. Writers cannot sell anything until one is active."}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((b) => {
                    const s = specFor(b.mechanic);
                    return (
                      <TableRow
                        key={b.id}
                        onClick={() => openEdit(b)}
                        className={cn("cursor-pointer", !b.isActive && "opacity-60")}
                      >
                        <TableCell className="py-3">
                          <div className="text-sm font-medium">{b.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-mono uppercase">{b.code}</span>
                            {/* A retired setup's mechanic is whatever it was
                                left on, which is not what it was sold as - so
                                do not state it as if it were current. */}
                            {b.isActive ? (
                              <>
                                {s ? ` · ${s.label}` : ""}
                                {s?.needsBanker ? " · banker" : ""}
                              </>
                            ) : (
                              <> · retired{b.ticketCount > 0 ? ` · ${b.ticketCount} ticket${b.ticketCount === 1 ? "" : "s"}` : ""}</>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-semibold tabular-nums">
                          x{Number(b.payoutMultiplier)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {range(b.minNumbers, b.maxNumbers)}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {range(b.minStake, b.maxStake)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggle.mutate({ id: b.id, isActive: !b.isActive })}
                            title={b.isActive ? "Click to deactivate" : "Click to activate"}
                            className={cn(
                              "rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white transition-opacity hover:opacity-85",
                              b.isActive ? "bg-emerald-600" : "bg-red-700",
                            )}
                          >
                            {b.isActive ? "Active" : "Inactive"}
                          </button>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => openEdit(b)}>
                              <Pencil className="mr-1 h-3 w-3" /> Edit
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive disabled:opacity-30"
                              disabled={b.ticketCount > 0 || remove.isPending}
                              title={
                                b.ticketCount > 0
                                  ? `${b.ticketCount} ticket${b.ticketCount === 1 ? "" : "s"} sold on this — deactivate it instead`
                                  : "Delete"
                              }
                              onClick={() => confirmDelete(b)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Select value={pageSize} onValueChange={setPageSize}>
          <SelectTrigger className="h-9 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="25">25</SelectItem>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Showing {rows.length} of {betTypes?.length ?? 0}
        </span>
      </div>

      {/* ---- Editor ------------------------------------------------------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add bet setup"}</DialogTitle>
            <DialogDescription className="text-xs">
              {editing
                ? "Changes apply to new tickets. Tickets already sold keep the terms they were sold on."
                : "Pick how it settles first — that sets everything else."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">How it settles</Label>
              <Select value={form.mechanic} onValueChange={(v) => setForm({ ...form, mechanic: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {mechanics?.map((m) => (
                    <SelectItem key={m.mechanic} value={m.mechanic}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {spec && <p className="text-[11px] text-muted-foreground">{spec.blurb}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Bet name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={spec?.label ?? "Direct 2"} className="h-10" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Code</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="D2" className="h-10 font-mono" />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs font-semibold">Multiplier (per winning line)</Label>
                <Input type="number" min={1} value={form.payoutMultiplier}
                  onChange={(e) => setForm({ ...form, payoutMultiplier: Number(e.target.value) })}
                  className="h-10 font-mono" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Min stake #</Label>
                <Input type="number" min={spec?.minNumbers ?? 0} max={spec?.maxNumbers ?? 40}
                  value={form.minNumbers}
                  onChange={(e) => setForm({ ...form, minNumbers: Number(e.target.value) })}
                  className="h-10 font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Max stake #</Label>
                <Input type="number" min={spec?.minNumbers ?? 0} max={spec?.maxNumbers ?? 40}
                  value={form.maxNumbers}
                  onChange={(e) => setForm({ ...form, maxNumbers: Number(e.target.value) })}
                  className="h-10 font-mono" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Min stake amount</Label>
                <Input type="number" min={0} step="0.1" value={form.minStake}
                  onChange={(e) => setForm({ ...form, minStake: Number(e.target.value) })}
                  className="h-10 font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Max stake amount</Label>
                <Input type="number" min={0} step="1" value={form.maxStake}
                  onChange={(e) => setForm({ ...form, maxStake: Number(e.target.value) })}
                  className="h-10 font-mono" />
              </div>
              <p className="col-span-2 -mt-1 text-[11px] text-muted-foreground">
                Stake amounts are PER LINE. Zero means no limit — which is what "0 / 0" shows in
                the table.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <div className="text-xs font-semibold">Active</div>
                <p className="text-[11px] text-muted-foreground">
                  Inactive setups disappear from the writer portal. Existing tickets still settle.
                </p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {editing ? (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={editing.ticketCount > 0 || remove.isPending}
                title={
                  editing.ticketCount > 0
                    ? `${editing.ticketCount} ticket${editing.ticketCount === 1 ? "" : "s"} sold on this — deactivate it instead`
                    : "Delete this bet setup"
                }
                onClick={() => confirmDelete(editing)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                disabled={!form.name.trim() || !form.code.trim() || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save changes" : "Add bet setup"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
