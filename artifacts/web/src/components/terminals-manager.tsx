import { useEffect, useMemo, useState } from "react";
import {
  useListTerminals,
  useCreateTerminal,
  useAssignTerminal,
  useListTerminalAssignments,
  useReturnTerminalAssignment,
  getListTerminalsQueryKey,
  getListTerminalAssignmentsQueryKey,
  type TerminalWithStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Smartphone, UserCheck, RotateCcw } from "lucide-react";

/**
 * How recently the holder must have sold for a terminal to read as active.
 *
 * Matches the server default. Sixty minutes rather than "today", because a
 * terminal that sold at 9am and has been silent since is the thing a
 * supervisor wants to notice, and "sold today" would hide exactly that.
 */
const ACTIVE_WINDOW_MINUTES = 60;

/** The whole point of the indicator is that it moves without a page reload. */
const REFRESH_MS = 30_000;

type SubTab = "registry" | "history";

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Three states, not two.
 *
 * Green and red were what was asked for, and they are what a held terminal
 * gets. An unissued device in a drawer is given its own grey state instead of
 * being coloured red, so that red keeps meaning the one condition worth acting
 * on: issued to a writer, and not selling. Collapsing the two would make half
 * the estate permanently red and the colour would stop being read.
 */
function StatusDot({ terminal }: { terminal: TerminalWithStatus }) {
  if (!terminal.writerId) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block" aria-hidden="true" />
        <span className="text-xs font-semibold text-slate-500">In stock</span>
      </span>
    );
  }
  if (terminal.isActive) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block animate-pulse" aria-hidden="true" />
        <span className="text-xs font-semibold text-emerald-700">Active</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" aria-hidden="true" />
      <span className="text-xs font-semibold text-red-700">Inactive</span>
    </span>
  );
}

export function TerminalsManager({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>("registry");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const params = { activeWindowMinutes: ACTIVE_WINDOW_MINUTES };
  const { data: terminals, isLoading } = useListTerminals(params, {
    query: { queryKey: getListTerminalsQueryKey(params), refetchInterval: REFRESH_MS, refetchOnWindowFocus: true },
  });
  const { data: history } = useListTerminalAssignments({}, {
    query: { queryKey: getListTerminalAssignmentsQueryKey({}), refetchInterval: REFRESH_MS },
  });

  const { allWriters, agentList } = useWriterLookup();

  const list: TerminalWithStatus[] = Array.isArray(terminals) ? terminals : [];
  const historyList = Array.isArray(history) ? history : [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/inventory/terminals"] });
    qc.invalidateQueries({ queryKey: ["/api/inventory/terminal-assignments"] });
  };

  const createTerminal = useCreateTerminal();
  const assignTerminal = useAssignTerminal();
  const returnAssignment = useReturnTerminalAssignment();

  const [form, setForm] = useState({ serialNumber: "", brand: "", model: "", imei: "", notes: "" });
  const [assignForm, setAssignForm] = useState({ terminalId: "", agentId: "", writerId: "", notes: "" });

  /** Only unheld, usable devices can be handed out. */
  const assignable = useMemo(
    () => list.filter(t => !t.writerId && t.status !== "lost" && t.status !== "retired"),
    [list],
  );

  /**
   * Writers who already hold a device.
   *
   * The writer picker lists only unassigned writers, so swapping a device is
   * two deliberate steps - Return the old terminal, then assign the new one -
   * rather than one action that quietly pulls a terminal out of someone's
   * hands as a side effect.
   */
  const heldWriterIds = useMemo(
    () => new Set(list.filter(t => t.writerId).map(t => t.writerId as string)),
    [list],
  );

  const selectedAgent = useMemo(
    () => agentList.find(a => a.id === assignForm.agentId),
    [agentList, assignForm.agentId],
  );

  /**
   * The chosen agent's roster, split three ways.
   *
   * Only `eligible` is offered. The other two exist so an empty picker can say
   * which of the two reasons emptied it, instead of leaving an operator
   * staring at "no writers" for an agency they know has six.
   *
   * Inactive writers are excluded because the server refuses them with a 409 -
   * offering a choice that is guaranteed to fail is worse than not offering it.
   */
  const agentRoster = useMemo(() => {
    const empty = { eligible: [] as typeof allWriters, held: [] as typeof allWriters, inactive: [] as typeof allWriters };
    if (!assignForm.agentId) return empty;
    const mine = allWriters.filter(w => w.agentId === assignForm.agentId);
    return {
      eligible: mine
        .filter(w => w.isActive && !heldWriterIds.has(w.id))
        .sort((a, b) => a.fullCode.localeCompare(b.fullCode)),
      held: mine.filter(w => w.isActive && heldWriterIds.has(w.id)),
      inactive: mine.filter(w => !w.isActive),
    };
  }, [allWriters, assignForm.agentId, heldWriterIds]);

  /**
   * The writer picked in the dialog, resolved to their full record. This fills
   * the read-only details below the picker - the operator confirms a name
   * rather than trusting they chose the right row out of seventy-odd codes.
   */
  const selectedWriter = useMemo(
    () => agentRoster.eligible.find(w => w.id === assignForm.writerId),
    [agentRoster, assignForm.writerId],
  );

  /*
   * The table refreshes every 30 seconds, so a writer chosen here can stop
   * being eligible while the dialog is open - someone else hands them a
   * terminal. Drop the stale choice rather than submitting an assignment the
   * operator can no longer see the basis for.
   */
  useEffect(() => {
    if (assignForm.writerId && !agentRoster.eligible.some(w => w.id === assignForm.writerId)) {
      setAssignForm(f => ({ ...f, writerId: "" }));
    }
  }, [agentRoster, assignForm.writerId]);

  const activeCount = list.filter(t => t.writerId && t.isActive).length;
  const inactiveCount = list.filter(t => t.writerId && !t.isActive).length;
  const stockCount = list.filter(t => !t.writerId).length;

  const submitRegister = async () => {
    const imei = form.imei.replace(/[\s-]/g, "");
    if (!form.serialNumber.trim() || !form.brand.trim() || !form.model.trim()) {
      toast.error("Serial number, brand and model are all required");
      return;
    }
    if (!/^\d{14,17}$/.test(imei)) {
      toast.error("IMEI must be 14 to 17 digits, numbers only");
      return;
    }
    try {
      await createTerminal.mutateAsync({
        data: {
          serialNumber: form.serialNumber.trim(),
          brand: form.brand.trim(),
          model: form.model.trim(),
          imei,
          notes: form.notes.trim() || undefined,
        },
      });
      toast.success(`Terminal ${form.serialNumber.trim()} registered`);
      setForm({ serialNumber: "", brand: "", model: "", imei: "", notes: "" });
      setRegisterOpen(false);
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to register terminal");
    }
  };

  const submitAssign = async () => {
    if (!assignForm.terminalId || !assignForm.writerId) {
      toast.error("Pick both a terminal and a writer");
      return;
    }
    try {
      await assignTerminal.mutateAsync({
        data: {
          terminalId: assignForm.terminalId,
          writerId: assignForm.writerId,
          notes: assignForm.notes.trim() || undefined,
        },
      });
      toast.success(`Terminal assigned to ${selectedWriter?.fullCode ?? "writer"}`);
      setAssignForm({ terminalId: "", agentId: "", writerId: "", notes: "" });
      setAssignOpen(false);
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to assign terminal");
    }
  };

  /**
   * Open the assignment dialog, optionally with the terminal already chosen.
   *
   * Always resets first: an abandoned attempt must not leave a half-made
   * selection behind for the next operator to submit by accident.
   */
  const openAssignFor = (terminalId: string) => {
    setAssignForm({ terminalId, agentId: "", writerId: "", notes: "" });
    setAssignOpen(true);
  };

  const handleReturn = async (assignmentId: string, serial: string) => {
    try {
      await returnAssignment.mutateAsync({ id: assignmentId, data: {} });
      toast.success(`Terminal ${serial} returned to stock`);
      invalidate();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Failed to record return");
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-tab nav + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-3">
        <div className="flex bg-muted/50 p-1 border rounded-xl gap-1">
          {([["registry", "Terminal Registry"], ["history", "Assignment History"]] as [SubTab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSubTab(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                subTab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {canManage && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl text-xs font-bold uppercase"
              onClick={() => openAssignFor("")}
            >
              <UserCheck className="w-4 h-4 mr-1.5" />
              Assign to Writer
            </Button>
            <Button size="sm" className="rounded-xl text-xs font-bold uppercase" onClick={() => setRegisterOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              Register Terminal
            </Button>
          </div>
        )}
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-3 gap-3">
        {([
          ["Active", activeCount, "text-emerald-700", "bg-emerald-50 border-emerald-200"],
          ["Inactive", inactiveCount, "text-red-700", "bg-red-50 border-red-200"],
          ["In stock", stockCount, "text-slate-600", "bg-slate-50 border-slate-200"],
        ] as [string, number, string, string][]).map(([label, count, text, box]) => (
          <div key={label} className={`rounded-xl border px-4 py-3 ${box}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold font-mono ${text}`}>{count}</p>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Active means the holding writer has sold within the last {ACTIVE_WINDOW_MINUTES} minutes. Sales are
        recorded against the writer rather than the device, so this reflects the writer's
        activity on their issued terminal. Refreshes every {REFRESH_MS / 1000} seconds.
      </p>

      {subTab === "registry" && (
        <div className="border border-border/80 rounded-2xl overflow-hidden bg-card/65 shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="font-bold">Status</TableHead>
                <TableHead className="font-bold">Serial Number</TableHead>
                <TableHead className="font-bold">Brand / Model</TableHead>
                <TableHead className="font-bold">IMEI</TableHead>
                <TableHead className="font-bold">Assigned Writer</TableHead>
                <TableHead className="font-bold">Last Sale</TableHead>
                <TableHead className="font-bold">Registered</TableHead>
                {canManage && <TableHead className="font-bold text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 8 : 7} className="text-center py-12">
                    <Skeleton className="h-6 w-1/2 mx-auto" />
                  </TableCell>
                </TableRow>
              ) : list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 8 : 7} className="text-center py-12 text-muted-foreground text-xs italic">
                    No POS terminals registered yet.
                  </TableCell>
                </TableRow>
              ) : list.map(t => (
                <TableRow key={t.id}>
                  <TableCell><StatusDot terminal={t} /></TableCell>
                  <TableCell className="font-mono text-sm font-semibold">{t.serialNumber}</TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{t.brand}</div>
                    <div className="text-xs text-muted-foreground">{t.model}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.imei}</TableCell>
                  <TableCell className="text-sm">
                    {t.writerId ? (
                      <>
                        <div className="font-mono font-medium">{t.writerCode}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.writerName}{t.agencyName ? ` · ${t.agencyName}` : ""}
                        </div>
                      </>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Unassigned</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {t.writerId ? timeAgo(t.lastSaleAt) : "—"}
                    {t.writerId && (t.salesToday ?? 0) > 0 && (
                      <div className="text-[10px]">{t.salesToday} today</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(t.registeredAt)}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {t.assignmentId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px]"
                          onClick={() => handleReturn(t.assignmentId!, t.serialNumber)}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          Return
                        </Button>
                      ) : t.status === "lost" || t.status === "retired" ? (
                        <span className="text-[11px] text-muted-foreground capitalize">{t.status}</span>
                      ) : (
                        /* Assign from the row itself. Reaching the dialog from
                           the toolbar meant finding the same serial again in a
                           dropdown, having just read it off this line. */
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px]"
                          onClick={() => openAssignFor(t.id)}
                        >
                          <UserCheck className="w-3 h-3 mr-1" />
                          Assign
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {subTab === "history" && (
        <div className="border border-border/80 rounded-2xl overflow-hidden bg-card/65 shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="font-bold">Terminal</TableHead>
                <TableHead className="font-bold">Writer</TableHead>
                <TableHead className="font-bold">Agency</TableHead>
                <TableHead className="font-bold">Assigned</TableHead>
                <TableHead className="font-bold">Returned</TableHead>
                <TableHead className="font-bold">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyList.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs italic">
                    No terminals have been assigned yet.
                  </TableCell>
                </TableRow>
              ) : historyList.map(h => (
                <TableRow key={h.id}>
                  <TableCell className="text-sm">
                    <div className="font-mono font-medium">{h.terminalSerialNumber}</div>
                    <div className="text-xs text-muted-foreground">{h.terminalBrand} {h.terminalModel}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-mono font-medium">{h.writerCode}</div>
                    <div className="text-xs text-muted-foreground">{h.writerName}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{h.agencyName ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(h.assignedAt)}</TableCell>
                  <TableCell className="text-xs">
                    {h.returnedAt
                      ? <span className="text-muted-foreground">{fmtDate(h.returnedAt)}</span>
                      : <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200">Current</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">{h.notes ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ─── Register dialog ─── */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-4 h-4" /> Register POS Terminal
            </DialogTitle>
            <DialogDescription>
              The registration date is recorded automatically when you save.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="terminal-serial">Serial Number</Label>
              <Input
                id="terminal-serial"
                value={form.serialNumber}
                onChange={e => setForm({ ...form, serialNumber: e.target.value })}
                placeholder="Serial number printed on the device"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="terminal-brand">Brand</Label>
                <Input
                  id="terminal-brand"
                  value={form.brand}
                  onChange={e => setForm({ ...form, brand: e.target.value })}
                  placeholder="e.g. Sunmi"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="terminal-model">Model</Label>
                <Input
                  id="terminal-model"
                  value={form.model}
                  onChange={e => setForm({ ...form, model: e.target.value })}
                  placeholder="e.g. V2 Pro"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="terminal-imei">IMEI Number</Label>
              <Input
                id="terminal-imei"
                value={form.imei}
                onChange={e => setForm({ ...form, imei: e.target.value })}
                placeholder="15 digits — dial *#06# on the device"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="terminal-notes">Notes (optional)</Label>
              <Input
                id="terminal-notes"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Anything worth recording about this unit"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>Cancel</Button>
            <Button onClick={submitRegister} disabled={createTerminal.isPending}>
              {createTerminal.isPending ? "Saving…" : "Register Terminal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Assign dialog ─── */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-4 h-4" /> Assign Terminal to Writer
            </DialogTitle>
            <DialogDescription>
              Pick the terminal, then the agency, then one of that agency's writers.
              A writer holds one terminal at a time, so only writers without one are
              offered.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="assign-terminal">Terminal</Label>
              <Select value={assignForm.terminalId} onValueChange={v => setAssignForm({ ...assignForm, terminalId: v })}>
                <SelectTrigger id="assign-terminal">
                  <SelectValue placeholder={assignable.length ? "Choose an unassigned terminal" : "No terminals in stock"} />
                </SelectTrigger>
                <SelectContent>
                  {assignable.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.serialNumber} — {t.brand} {t.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 2: agency. Choosing one clears any writer already picked,
                so a stale selection from another agency cannot be submitted. */}
            <div className="space-y-1.5">
              <Label htmlFor="assign-agent">Agency</Label>
              <Select
                value={assignForm.agentId}
                onValueChange={v => setAssignForm({ ...assignForm, agentId: v, writerId: "" })}
              >
                <SelectTrigger id="assign-agent">
                  <SelectValue placeholder="Choose an agency" />
                </SelectTrigger>
                <SelectContent>
                  {agentList.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.fullCode} — {a.agencyName ?? a.user?.fullName ?? "Agency"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 3: writer, drawn only from the chosen agency and only from
                those not already holding a device. */}
            <div className="space-y-1.5">
              <Label htmlFor="assign-writer">Writer</Label>
              <Select
                value={assignForm.writerId}
                onValueChange={v => setAssignForm({ ...assignForm, writerId: v })}
                disabled={!assignForm.agentId || agentRoster.eligible.length === 0}
              >
                <SelectTrigger id="assign-writer">
                  <SelectValue
                    placeholder={
                      !assignForm.agentId
                        ? "Choose an agency first"
                        : agentRoster.eligible.length === 0
                          ? "No writers available in this agency"
                          : `Choose from ${agentRoster.eligible.length} available writer${agentRoster.eligible.length !== 1 ? "s" : ""}`
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {agentRoster.eligible.map(w => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.fullCode} — {w.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Say why the list is short, rather than leaving an operator to
                  wonder where an agency's writers went. */}
              {assignForm.agentId && agentRoster.eligible.length === 0 && (
                <p className="text-[11px] text-amber-700">
                  {agentRoster.held.length > 0 && `All ${agentRoster.held.length} active writer${agentRoster.held.length !== 1 ? "s" : ""} in this agency already hold a terminal — return one first. `}
                  {agentRoster.inactive.length > 0 && `${agentRoster.inactive.length} inactive writer${agentRoster.inactive.length !== 1 ? "s are" : " is"} not eligible. `}
                  {agentRoster.held.length === 0 && agentRoster.inactive.length === 0 && "This agency has no writers registered."}
                </p>
              )}
              {assignForm.agentId && agentRoster.eligible.length > 0 && (agentRoster.held.length > 0 || agentRoster.inactive.length > 0) && (
                <p className="text-[11px] text-muted-foreground">
                  Not shown: {[
                    agentRoster.held.length > 0 ? `${agentRoster.held.length} already holding a terminal` : null,
                    agentRoster.inactive.length > 0 ? `${agentRoster.inactive.length} inactive` : null,
                  ].filter(Boolean).join(", ")}.
                </p>
              )}
            </div>

            {/* Auto-populated from the chosen writer, read-only on purpose:
                it is there to confirm the right person, not to be edited. */}
            {selectedWriter && (
              <div className="rounded-xl border bg-muted/40 px-4 py-3 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Writer details</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Code</span>
                  <span className="font-mono font-medium">{selectedWriter.fullCode}</span>
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{selectedWriter.fullName}</span>
                  <span className="text-muted-foreground">Phone</span>
                  <span className="font-mono">{selectedWriter.phone ?? "not set"}</span>
                  <span className="text-muted-foreground">Agency</span>
                  <span>{selectedAgent?.agencyName ?? selectedAgent?.fullCode ?? "—"}</span>
                  <span className="text-muted-foreground">Model</span>
                  <span className="capitalize">{selectedWriter.operationModel}</span>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="assign-notes">Notes (optional)</Label>
              <Input
                id="assign-notes"
                value={assignForm.notes}
                onChange={e => setAssignForm({ ...assignForm, notes: e.target.value })}
                placeholder="Condition handed over, accessories, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={submitAssign} disabled={assignTerminal.isPending}>
              {assignTerminal.isPending ? "Assigning…" : "Assign Terminal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
