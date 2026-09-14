import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Pencil } from "lucide-react";
import { cn, fmtGHS } from "@/lib/utils";

/**
 * Bet types: what a line is, and what a line pays.
 *
 * The mechanic is the important field. The multiplier says what one winning
 * line is worth; the mechanic says what a line IS - a pair, a triple, a
 * banker and its partner - and therefore how many lines a selection buys and
 * how a draw settles it. Change the mechanic and the whole bet changes.
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
  payoutMultiplier: string;
  isActive: boolean;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

const EMPTY = {
  name: "", code: "", description: "",
  mechanic: "direct_two", minNumbers: 2, maxNumbers: 2,
  payoutMultiplier: 240, isActive: true,
};

export function AdminBetTypes() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BetType | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

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
      toast({ title: editing ? "Bet type updated" : "Bet type added" });
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["/api/bet-types"] });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  /** The active switch is its own call so the row toggles without a dialog. */
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
        title: v.isActive ? "Bet type activated" : "Bet type deactivated",
        description: v.isActive ? undefined : "Writers can no longer sell this. Tickets already placed are unaffected.",
      });
      qc.invalidateQueries({ queryKey: ["/api/bet-types"] });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

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
      payoutMultiplier: Number(b.payoutMultiplier),
      isActive: b.isActive,
    });
    setOpen(true);
  };

  // Picking a mechanic resets the range and odds to that mechanic's own, which
  // is almost always what is wanted and is editable straight after.
  useEffect(() => {
    if (!spec || editing) return;
    setForm((f) =>
      f.mechanic === spec.mechanic
        ? {
            ...f,
            minNumbers: spec.minNumbers,
            maxNumbers: spec.maxNumbers,
            payoutMultiplier: spec.defaultMultiplier,
          }
        : f,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.mechanic, mechanics]);

  const sample = spec ? Math.max(spec.minNumbers, 1) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Bet Types</h2>
          <p className="text-xs text-muted-foreground">
            Click any row to edit it. Stakes are quoted per line — a perm buys many lines from
            one selection.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" /> Add bet type
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>How it settles</TableHead>
                  <TableHead>Numbers</TableHead>
                  <TableHead className="text-right">Pays per line</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : !betTypes?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-xs text-muted-foreground">
                      No bet types yet. Writers cannot sell anything until one is active.
                    </TableCell>
                  </TableRow>
                ) : (
                  betTypes.map((b) => {
                    const s = specFor(b.mechanic);
                    return (
                      <TableRow
                        key={b.id}
                        onClick={() => openEdit(b)}
                        className={cn("cursor-pointer", !b.isActive && "opacity-55")}
                      >
                        <TableCell className="font-mono text-xs font-semibold">{b.code}</TableCell>
                        <TableCell className="text-xs font-medium">{b.name}</TableCell>
                        <TableCell>
                          <div className="text-xs">{s?.label ?? b.mechanic}</div>
                          <div className="text-[10px] text-muted-foreground">{s?.blurb}</div>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {b.minNumbers === b.maxNumbers ? b.minNumbers : `${b.minNumbers}–${b.maxNumbers}`}
                          {s?.needsBanker && (
                            <Badge variant="outline" className="ml-1.5 text-[9px]">
                              + banker
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold tabular-nums">
                          ×{Number(b.payoutMultiplier)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={b.isActive}
                            onCheckedChange={(v) => toggle.mutate({ id: b.id, isActive: v })}
                          />
                        </TableCell>
                        <TableCell>
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
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

      {/* ---- Editor ------------------------------------------------------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.code}` : "Add bet type"}</DialogTitle>
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
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mechanics?.map((m) => (
                    <SelectItem key={m.mechanic} value={m.mechanic}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {spec && <p className="text-[11px] text-muted-foreground">{spec.blurb}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={spec?.label ?? "Two Sure"}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Code</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="D2"
                  className="h-10 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Fewest numbers</Label>
                <Input
                  type="number"
                  min={spec?.minNumbers ?? 0}
                  max={spec?.maxNumbers ?? 40}
                  value={form.minNumbers}
                  onChange={(e) => setForm({ ...form, minNumbers: Number(e.target.value) })}
                  className="h-10 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Most numbers</Label>
                <Input
                  type="number"
                  min={spec?.minNumbers ?? 0}
                  max={spec?.maxNumbers ?? 40}
                  value={form.maxNumbers}
                  onChange={(e) => setForm({ ...form, maxNumbers: Number(e.target.value) })}
                  className="h-10 font-mono"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs font-semibold">Pays per winning line (×)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.payoutMultiplier}
                  onChange={(e) => setForm({ ...form, payoutMultiplier: Number(e.target.value) })}
                  className="h-10 font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  A GH₵1 line that wins pays {fmtGHS(Number(form.payoutMultiplier) || 0)}.
                  {spec && sample > 0 && form.mechanic === "perm_two" && (
                    <> Five numbers buy 10 lines — GH₵10 for the ticket.</>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <div className="text-xs font-semibold">Active</div>
                <p className="text-[11px] text-muted-foreground">
                  Inactive types disappear from the writer portal. Existing tickets still settle.
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.name.trim() || !form.code.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Add bet type"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
