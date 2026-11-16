import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { fmtGHS } from "@/lib/utils";
import { getServerNow } from "@/lib/time-sync";
import {
  Truck, UserCheck, Warehouse, Users, PackageOpen, AlertTriangle, BellRing,
  Settings2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Boxes, CheckCircle2,
} from "lucide-react";

/**
 * Inventory -> Thermal Rolls.
 *
 * Rolls are bought by the box, held in the office store, allotted to agents,
 * and handed by agents to their writers. Every balance on this screen is
 * computed by the server from those movements when it is asked, and the
 * screen re-asks every 30 seconds and after every change, so two people
 * working at once see the same stock.
 */

/* ── data ────────────────────────────────────────────────────────────────── */

type Summary = {
  purchased: number; boxesPurchased: number; totalCost: string; costPerRoll: string;
  allotted: number; distributed: number; storeBalance: number; withAgents: number;
  lowStockThreshold: number; isLow: boolean; alertActive: boolean; lastAlertAt: string | null;
};
type Purchase = {
  id: string; purchaseDate: string; boxes: number; rollsPerBox: number; totalRolls: number;
  totalCost: string; costPerRoll: string; cumulativeRolls: number; supplier: string | null;
  notes: string | null; enteredBy: string | null;
};
type Allotment = {
  id: string; allottedDate: string; quantity: number; notes: string | null;
  agentId: string; agentCode: string; agencyName: string; enteredBy: string | null;
};
type Distribution = {
  id: string; distributedDate: string; quantity: number; notes: string | null;
  agentId: string; agentCode: string; agencyName: string;
  writerId: string; writerCode: string; writerName: string; enteredBy: string | null;
};
type Balances = {
  agencies: { agentId: string; agentCode: string; agencyName: string; allotted: number; distributed: number; balance: number; lastAllotted: string | null }[];
  writers: { writerId: string; writerCode: string; writerName: string; agentId: string; received: number; lastReceived: string | null }[];
};
type AgencyWriters = { holding: number; writers: { writerId: string; writerCode: string; writerName: string; received: number }[] };

const BASE = "/api/inventory/thermal-rolls";
const KEY = ["thermal-rolls"] as const;
const REFRESH_MS = 30_000;

const get = <T,>(path: string) => () => customFetch<T>(`${BASE}${path}`, { method: "GET" });
const post = <T,>(path: string, body: unknown, method = "POST") =>
  customFetch<T>(`${BASE}${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

function errorText(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string } })?.data;
  return data?.error ?? fallback;
}

const n = (v: number) => v.toLocaleString("en-GB");
const rollsLabel = (v: number) => `${n(v)} roll${v === 1 ? "" : "s"}`;
const today = () => getServerNow().toISOString().slice(0, 10);
const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/* ── small pieces ────────────────────────────────────────────────────────── */

function Figure({ label, value, sub, icon, tone = "default" }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; tone?: "default" | "good" | "low";
}) {
  const ring = tone === "low"
    ? "border-rose-300/80 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-950/20"
    : "border-border/80 bg-card";
  const iconCls = tone === "low"
    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
    : tone === "good" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-primary/10 text-primary dark:bg-muted dark:text-foreground";
  return (
    <div className={`rounded-2xl border p-5 shadow-sm min-w-0 ${ring}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground truncate">{label}</span>
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${iconCls}`}>{icon}</span>
      </div>
      <div className={`mt-2 text-2xl font-black tracking-tight tabular-nums truncate ${tone === "low" ? "text-rose-600 dark:text-rose-400" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function Pager({ page, totalPages, onPage, total, pageSize, noun }: {
  page: number; totalPages: number; onPage: (p: number) => void; total: number; pageSize: number; noun: string;
}) {
  if (total === 0) return null;
  const list: (number | "…")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) list.push(i);
    else if (list[list.length - 1] !== "…") list.push("…");
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = "h-8 w-8 inline-flex items-center justify-center rounded-lg border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none";
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t bg-muted/20">
      <span className="text-xs text-muted-foreground">
        Showing <span className="font-semibold text-foreground tabular-nums">{from}–{to}</span> of <span className="font-semibold text-foreground tabular-nums">{n(total)}</span> {noun}
      </span>
      {totalPages > 1 && (
        <nav className="flex items-center gap-1" aria-label={`${noun} pages`}>
          <button type="button" aria-label="First page" className={btn} disabled={page === 1} onClick={() => onPage(1)}><ChevronsLeft className="w-4 h-4" /></button>
          <button type="button" aria-label="Previous page" className={btn} disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft className="w-4 h-4" /></button>
          {list.map((p, i) => p === "…" ? <span key={`g${i}`} className="px-1 text-xs text-muted-foreground">…</span> : (
            <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? "page" : undefined}
              className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-semibold tabular-nums ${p === page ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{p}</button>
          ))}
          <button type="button" aria-label="Next page" className={btn} disabled={page === totalPages} onClick={() => onPage(page + 1)}><ChevronRight className="w-4 h-4" /></button>
          <button type="button" aria-label="Last page" className={btn} disabled={page === totalPages} onClick={() => onPage(totalPages)}><ChevronsRight className="w-4 h-4" /></button>
        </nav>
      )}
    </div>
  );
}

function usePaged<T>(rows: T[] | undefined, size = 10) {
  const [page, setPage] = useState(1);
  const total = rows?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safe = Math.min(page, totalPages);
  return { page: safe, setPage, totalPages, total, size, rows: (rows ?? []).slice((safe - 1) * size, safe * size) };
}

function TableShell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="border border-border/80 rounded-2xl overflow-hidden bg-card/65 shadow-sm">
      <div className="max-h-[32rem] overflow-auto thin-scroll [&>div]:overflow-visible [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]">
        {children}
      </div>
      {footer}
    </div>
  );
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return <TableRow><TableCell colSpan={cols} className="text-center py-12 text-muted-foreground text-xs italic">{text}</TableCell></TableRow>;
}

function LoadingRow({ cols }: { cols: number }) {
  return <TableRow><TableCell colSpan={cols} className="py-10"><Skeleton className="h-6 w-1/2 mx-auto" /></TableCell></TableRow>;
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-bold">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A positive whole number from a text box, or null while it is blank or wrong. */
const wholeNumber = (s: string) => (/^\d+$/.test(s.trim()) && Number(s) > 0 ? Number(s) : null);

/* ── dialogs ─────────────────────────────────────────────────────────────── */

function PurchaseDialog({ open, onOpenChange, store, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; store: number; onSaved: () => void;
}) {
  const [f, setF] = useState({ purchaseDate: today(), boxes: "", rollsPerBox: "", totalCost: "", supplier: "", notes: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ purchaseDate: today(), boxes: "", rollsPerBox: "", totalCost: "", supplier: "", notes: "" }); }, [open]);

  const boxes = wholeNumber(f.boxes);
  const rpb = wholeNumber(f.rollsPerBox);
  const cost = f.totalCost.trim() === "" ? null : Number(f.totalCost);
  const rolls = boxes && rpb ? boxes * rpb : null;
  const valid = !!f.purchaseDate && rolls !== null && cost !== null && Number.isFinite(cost) && cost >= 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await post("/purchases", {
        purchaseDate: f.purchaseDate, boxes, rollsPerBox: rpb, totalCost: cost,
        supplier: f.supplier.trim() || null, notes: f.notes.trim() || null,
      });
      toast.success(`Recorded ${rollsLabel(rolls!)} (${n(boxes!)} box${boxes === 1 ? "" : "es"})`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err, "Could not record the purchase"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="w-4 h-4" /> Record a purchase</DialogTitle>
          <DialogDescription>Rolls are counted from the boxes: boxes × rolls in each box.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Purchase date" htmlFor="tr-date">
            <Input id="tr-date" type="date" value={f.purchaseDate} max={today()} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} />
          </Field>
          <Field label="Total cost (GH₵)" htmlFor="tr-cost">
            <Input id="tr-cost" inputMode="decimal" placeholder="0.00" value={f.totalCost} onChange={(e) => setF({ ...f, totalCost: e.target.value.replace(/[^0-9.]/g, "") })} />
          </Field>
          <Field label="Boxes bought" htmlFor="tr-boxes">
            <Input id="tr-boxes" inputMode="numeric" placeholder="e.g. 10" value={f.boxes} onChange={(e) => setF({ ...f, boxes: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label="Rolls in each box" htmlFor="tr-rpb">
            <Input id="tr-rpb" inputMode="numeric" placeholder="e.g. 50" value={f.rollsPerBox} onChange={(e) => setF({ ...f, rollsPerBox: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label="Supplier (optional)" htmlFor="tr-supplier">
            <Input id="tr-supplier" value={f.supplier} maxLength={120} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
          </Field>
          <Field label="Notes (optional)" htmlFor="tr-notes">
            <Input id="tr-notes" value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        <div className="rounded-xl border bg-muted/40 p-3 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Rolls</div><div className="font-black tabular-nums">{rolls !== null ? n(rolls) : "—"}</div></div>
          <div><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Per roll</div><div className="font-black tabular-nums">{rolls && cost !== null && Number.isFinite(cost) ? fmtGHS(cost / rolls) : "—"}</div></div>
          <div><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Store after</div><div className="font-black tabular-nums">{n(store + (rolls ?? 0))}</div></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!valid || saving}>{saving ? "Saving…" : "Record purchase"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllotDialog({ open, onOpenChange, store, agencies, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; store: number; agencies: Balances["agencies"]; onSaved: () => void;
}) {
  const [f, setF] = useState({ agentId: "", allottedDate: today(), quantity: "", notes: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ agentId: "", allottedDate: today(), quantity: "", notes: "" }); }, [open]);

  const qty = wholeNumber(f.quantity);
  const over = qty !== null && qty > store;
  const valid = !!f.agentId && !!f.allottedDate && qty !== null && !over;
  const agency = agencies.find((a) => a.agentId === f.agentId);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await post("/allotments", { agentId: f.agentId, allottedDate: f.allottedDate, quantity: qty, notes: f.notes.trim() || null });
      toast.success(`Allotted ${rollsLabel(qty!)} to ${agency?.agencyName ?? "the agency"}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err, "Could not record the allotment"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackageOpen className="w-4 h-4" /> Allot rolls to an agency</DialogTitle>
          <DialogDescription>Moves rolls from the office store to the agency. {rollsLabel(store)} in store.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Agency" htmlFor="ta-agent" hint={agency ? `Holds ${rollsLabel(agency.balance)} now` : undefined}>
            <Select value={f.agentId} onValueChange={(v) => setF({ ...f, agentId: v })}>
              <SelectTrigger id="ta-agent"><SelectValue placeholder="Choose an agency" /></SelectTrigger>
              <SelectContent>
                {agencies.map((a) => <SelectItem key={a.agentId} value={a.agentId}>{a.agentCode} — {a.agencyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date" htmlFor="ta-date">
              <Input id="ta-date" type="date" value={f.allottedDate} max={today()} onChange={(e) => setF({ ...f, allottedDate: e.target.value })} />
            </Field>
            <Field label="Rolls" htmlFor="ta-qty" hint={over ? <span className="text-rose-600 font-semibold">More than the {n(store)} in store</span> : qty ? `Store after: ${n(store - qty)}` : undefined}>
              <Input id="ta-qty" inputMode="numeric" placeholder="0" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor="ta-notes">
            <Input id="ta-notes" value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!valid || saving}>{saving ? "Saving…" : "Allot rolls"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DistributeDialog({ open, onOpenChange, agencies, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; agencies: Balances["agencies"]; onSaved: () => void;
}) {
  const [f, setF] = useState({ agentId: "", writerId: "", distributedDate: today(), quantity: "", notes: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ agentId: "", writerId: "", distributedDate: today(), quantity: "", notes: "" }); }, [open]);

  const roster = useQuery({
    queryKey: [...KEY, "agency-writers", f.agentId],
    queryFn: get<AgencyWriters>(`/agencies/${f.agentId}/writers`),
    enabled: open && !!f.agentId,
  });
  const holding = roster.data?.holding ?? 0;
  const qty = wholeNumber(f.quantity);
  const over = qty !== null && qty > holding;
  const valid = !!f.writerId && !!f.distributedDate && qty !== null && !over && !roster.isFetching;
  const writer = roster.data?.writers.find((w) => w.writerId === f.writerId);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await post("/distributions", { writerId: f.writerId, distributedDate: f.distributedDate, quantity: qty, notes: f.notes.trim() || null });
      toast.success(`Gave ${rollsLabel(qty!)} to ${writer?.writerName ?? "the writer"}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err, "Could not record the handover"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserCheck className="w-4 h-4" /> Give rolls to a writer</DialogTitle>
          <DialogDescription>Moves rolls from an agency's stock to one of its writers.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Agency" htmlFor="td-agent" hint={f.agentId ? (roster.isFetching ? "Checking stock…" : `Holds ${rollsLabel(holding)}`) : undefined}>
            <Select value={f.agentId} onValueChange={(v) => setF({ ...f, agentId: v, writerId: "" })}>
              <SelectTrigger id="td-agent"><SelectValue placeholder="Choose an agency" /></SelectTrigger>
              <SelectContent>
                {agencies.map((a) => <SelectItem key={a.agentId} value={a.agentId}>{a.agentCode} — {a.agencyName} · {n(a.balance)} held</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Writer" htmlFor="td-writer" hint={writer ? `Has received ${rollsLabel(writer.received)} so far` : undefined}>
            <Select value={f.writerId} onValueChange={(v) => setF({ ...f, writerId: v })} disabled={!f.agentId || !roster.data}>
              <SelectTrigger id="td-writer">
                <SelectValue placeholder={!f.agentId ? "Choose the agency first" : roster.data?.writers.length === 0 ? "This agency has no active writers" : "Choose a writer"} />
              </SelectTrigger>
              <SelectContent>
                {roster.data?.writers.map((w) => <SelectItem key={w.writerId} value={w.writerId}>{w.writerCode} — {w.writerName}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date" htmlFor="td-date">
              <Input id="td-date" type="date" value={f.distributedDate} max={today()} onChange={(e) => setF({ ...f, distributedDate: e.target.value })} />
            </Field>
            <Field label="Rolls" htmlFor="td-qty" hint={over ? <span className="text-rose-600 font-semibold">Agency holds only {n(holding)}</span> : undefined}>
              <Input id="td-qty" inputMode="numeric" placeholder="0" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value.replace(/\D/g, "") })} />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor="td-notes">
            <Input id="td-notes" value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!valid || saving}>{saving ? "Saving…" : "Give rolls"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ThresholdDialog({ open, onOpenChange, current, store, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; current: number; store: number; onSaved: () => void;
}) {
  const [value, setValue] = useState(String(current));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setValue(String(current)); }, [open, current]);
  const v = /^\d+$/.test(value.trim()) ? Number(value) : null;

  const save = async () => {
    if (v === null) return;
    setSaving(true);
    try {
      await post("/settings", { lowStockThreshold: v }, "PUT");
      toast.success(`Low-stock alert set at ${rollsLabel(v)}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err, "Could not save the alert level"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BellRing className="w-4 h-4" /> Low-stock alert</DialogTitle>
          <DialogDescription>
            When the office store falls to this many rolls, every director, administrator and cashier is alerted in Notifications.
          </DialogDescription>
        </DialogHeader>
        <Field label="Alert at (rolls)" htmlFor="tt-value" hint={v !== null ? (store <= v ? `The store (${n(store)}) is already at or below this - an alert goes out when you save.` : `${n(store - v)} rolls above the line now.`) : undefined}>
          <Input id="tt-value" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={v === null || saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── the tab ─────────────────────────────────────────────────────────────── */

type Sub = "purchases" | "allotments" | "distributions" | "balances";

export function ThermalRollsManager({ role }: { role: string | undefined }) {
  const qc = useQueryClient();
  const canRecord = role === "cashier" || role === "administrator";
  const canSetAlert = role === "director" || role === "administrator";

  const [sub, setSub] = useState<Sub>("purchases");
  const [dialog, setDialog] = useState<null | "purchase" | "allot" | "distribute" | "threshold">(null);
  const [writerAgency, setWriterAgency] = useState("_all");

  const opts = { refetchInterval: REFRESH_MS, refetchOnWindowFocus: true } as const;
  const summary = useQuery({ queryKey: [...KEY, "summary"], queryFn: get<Summary>("/summary"), ...opts });
  const purchases = useQuery({ queryKey: [...KEY, "purchases"], queryFn: get<Purchase[]>("/purchases"), ...opts });
  const allotments = useQuery({ queryKey: [...KEY, "allotments"], queryFn: get<Allotment[]>("/allotments"), ...opts });
  const distributions = useQuery({ queryKey: [...KEY, "distributions"], queryFn: get<Distribution[]>("/distributions"), ...opts });
  const balances = useQuery({ queryKey: [...KEY, "balances"], queryFn: get<Balances>("/balances"), ...opts });

  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const s = summary.data;
  const store = s?.storeBalance ?? 0;
  const agencies = balances.data?.agencies ?? [];

  const pPurchases = usePaged(purchases.data);
  const pAllotments = usePaged(allotments.data);
  const pDistributions = usePaged(distributions.data);
  const pAgencies = usePaged(agencies);
  const writerRows = useMemo(
    () => (balances.data?.writers ?? []).filter((w) => writerAgency === "_all" || w.agentId === writerAgency),
    [balances.data, writerAgency],
  );
  const pWriters = usePaged(writerRows);
  const agencyById = useMemo(() => new Map(agencies.map((a) => [a.agentId, a])), [agencies]);

  const action = sub === "purchases"
    ? { label: "Record purchase", icon: <Truck className="w-4 h-4 mr-1.5" />, open: () => setDialog("purchase") }
    : sub === "allotments"
      ? { label: "Allot to agency", icon: <PackageOpen className="w-4 h-4 mr-1.5" />, open: () => setDialog("allot") }
      : sub === "distributions"
        ? { label: "Give to writer", icon: <UserCheck className="w-4 h-4 mr-1.5" />, open: () => setDialog("distribute") }
        : null;

  return (
    <div className="space-y-6">
      {/* ── Stock at a glance ── */}
      <div className="grid grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-4 gap-4">
        {summary.isLoading || !s ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[7.25rem] rounded-2xl" />)
        ) : (
          <>
            <Figure label="In the office store" value={rollsLabel(s.storeBalance)} sub={s.isLow ? `At or below the ${n(s.lowStockThreshold)}-roll alert line` : `Alert at ${n(s.lowStockThreshold)} rolls`} icon={<Warehouse className="w-4 h-4" />} tone={s.isLow ? "low" : "good"} />
            <Figure label="Purchased to date" value={rollsLabel(s.purchased)} sub={`${n(s.boxesPurchased)} box${s.boxesPurchased === 1 ? "" : "es"} · ${fmtGHS(s.totalCost)}`} icon={<Boxes className="w-4 h-4" />} />
            <Figure label="Held by agencies" value={rollsLabel(s.withAgents)} sub={`${n(s.allotted)} allotted in all`} icon={<PackageOpen className="w-4 h-4" />} />
            <Figure label="Given to writers" value={rollsLabel(s.distributed)} sub={`Average cost ${fmtGHS(s.costPerRoll)} a roll`} icon={<Users className="w-4 h-4" />} />
          </>
        )}
      </div>

      {/* ── Low-stock line ── */}
      {s && (
        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border px-5 py-4 ${s.isLow ? "border-rose-300/80 bg-rose-50/70 dark:border-rose-500/40 dark:bg-rose-950/20" : "border-border/80 bg-card/60"}`}>
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${s.isLow ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
              {s.isLow ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold">
                {s.isLow ? `Low stock — ${rollsLabel(s.storeBalance)} left in the store` : "Stock is above the alert line"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Directors, administrators and cashiers are alerted in Notifications when the store reaches {rollsLabel(s.lowStockThreshold)}.
                {s.lastAlertAt && ` Last alert: ${new Date(s.lastAlertAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`}
              </p>
            </div>
          </div>
          {canSetAlert && (
            <Button size="sm" variant="outline" className="rounded-xl text-xs font-bold shrink-0" onClick={() => setDialog("threshold")}>
              <Settings2 className="w-3.5 h-3.5 mr-1.5" /> Alert level
            </Button>
          )}
        </div>
      )}

      {/* ── Sub tabs and the action for each ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-3">
        <div className="flex flex-wrap bg-muted/50 p-1 border rounded-xl gap-1">
          {([
            { id: "purchases", label: "Purchases" },
            { id: "allotments", label: "Allotments to agencies" },
            { id: "distributions", label: "Distribution to writers" },
            { id: "balances", label: "Balances" },
          ] as { id: Sub; label: string }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${sub === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {canRecord && action && (
          <Button size="sm" onClick={action.open} className="rounded-xl font-bold text-xs uppercase self-start md:self-auto">
            {action.icon}{action.label}
          </Button>
        )}
      </div>

      {sub === "purchases" && (
        <TableShell footer={<Pager page={pPurchases.page} totalPages={pPurchases.totalPages} onPage={pPurchases.setPage} total={pPurchases.total} pageSize={pPurchases.size} noun="purchases" />}>
          <Table className="min-w-[56rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">Purchase Date</TableHead>
                <TableHead className="text-right font-bold">Quantity Purchased</TableHead>
                <TableHead className="text-right font-bold">Total Cost</TableHead>
                <TableHead className="text-right font-bold">Cost / Roll</TableHead>
                <TableHead className="text-right font-bold">Total Stock</TableHead>
                <TableHead className="pl-8 font-bold">Supplier · Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.isLoading ? <LoadingRow cols={6} /> : pPurchases.total === 0 ? <EmptyRow cols={6} text="No thermal roll purchases recorded yet." /> : pPurchases.rows.map((p) => (
                <TableRow key={p.id} className="hover:bg-muted/20">
                  <TableCell className="text-xs font-semibold whitespace-nowrap">{fmtDate(p.purchaseDate)}</TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap">
                    <div className="font-mono font-bold">{n(p.boxes)} box{p.boxes === 1 ? "" : "es"}</div>
                    <div className="text-[10px] text-muted-foreground">× {n(p.rollsPerBox)} = {rollsLabel(p.totalRolls)}</div>
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono font-semibold whitespace-nowrap">{fmtGHS(p.totalCost)}</TableCell>
                  <TableCell className="text-xs text-right font-mono text-emerald-600 dark:text-emerald-400 font-extrabold whitespace-nowrap">{fmtGHS(p.costPerRoll)}</TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap">
                    <div className="font-mono font-black">{rollsLabel(p.cumulativeRolls)}</div>
                    <div className="text-[10px] text-muted-foreground">bought to date</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground pl-8 max-w-xs">
                    <div className="truncate text-foreground/80">{p.supplier ?? "—"}</div>
                    {p.notes && <div className="truncate text-[11px]">{p.notes}</div>}
                    {p.enteredBy && <div className="text-[10px]">by {p.enteredBy}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}

      {sub === "allotments" && (
        <TableShell footer={<Pager page={pAllotments.page} totalPages={pAllotments.totalPages} onPage={pAllotments.setPage} total={pAllotments.total} pageSize={pAllotments.size} noun="allotments" />}>
          <Table className="min-w-[44rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">Date</TableHead>
                <TableHead className="font-bold">Agency</TableHead>
                <TableHead className="text-right font-bold">Rolls Allotted</TableHead>
                <TableHead className="text-right font-bold">Agency Holds Now</TableHead>
                <TableHead className="pl-8 font-bold">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allotments.isLoading ? <LoadingRow cols={5} /> : pAllotments.total === 0 ? <EmptyRow cols={5} text="No rolls allotted to agencies yet." /> : pAllotments.rows.map((a) => (
                <TableRow key={a.id} className="hover:bg-muted/20">
                  <TableCell className="text-xs font-semibold whitespace-nowrap">{fmtDate(a.allottedDate)}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-mono font-bold bg-muted/60 px-2 py-0.5 rounded-md border">{a.agentCode}</span>
                    <span className="text-[11px] text-muted-foreground ml-2">{a.agencyName}</span>
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono font-extrabold">{n(a.quantity)}</TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">{n(agencyById.get(a.agentId)?.balance ?? 0)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground pl-8 max-w-xs">
                    <div className="truncate">{a.notes ?? "—"}</div>
                    {a.enteredBy && <div className="text-[10px]">by {a.enteredBy}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}

      {sub === "distributions" && (
        <TableShell footer={<Pager page={pDistributions.page} totalPages={pDistributions.totalPages} onPage={pDistributions.setPage} total={pDistributions.total} pageSize={pDistributions.size} noun="handovers" />}>
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold">Date</TableHead>
                <TableHead className="font-bold">Writer</TableHead>
                <TableHead className="font-bold">From Agency</TableHead>
                <TableHead className="text-right font-bold">Rolls Given</TableHead>
                <TableHead className="pl-8 font-bold">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {distributions.isLoading ? <LoadingRow cols={5} /> : pDistributions.total === 0 ? <EmptyRow cols={5} text="No rolls given to writers yet." /> : pDistributions.rows.map((d) => (
                <TableRow key={d.id} className="hover:bg-muted/20">
                  <TableCell className="text-xs font-semibold whitespace-nowrap">{fmtDate(d.distributedDate)}</TableCell>
                  <TableCell className="text-xs">
                    <div className="font-semibold">{d.writerName}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{d.writerCode}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="font-mono font-bold">{d.agentCode}</span>
                    <span className="text-[11px] text-muted-foreground ml-2">{d.agencyName}</span>
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono font-extrabold">{n(d.quantity)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground pl-8 max-w-xs">
                    <div className="truncate">{d.notes ?? "—"}</div>
                    {d.enteredBy && <div className="text-[10px]">by {d.enteredBy}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}

      {sub === "balances" && (
        <div className="grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3 space-y-3 min-w-0">
            <h3 className="text-sm font-bold flex items-center gap-2"><PackageOpen className="w-4 h-4 text-muted-foreground" /> Agency stock</h3>
            <TableShell footer={<Pager page={pAgencies.page} totalPages={pAgencies.totalPages} onPage={pAgencies.setPage} total={pAgencies.total} pageSize={pAgencies.size} noun="agencies" />}>
              <Table className="min-w-[36rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-bold">Agency</TableHead>
                    <TableHead className="text-right font-bold">Allotted</TableHead>
                    <TableHead className="text-right font-bold">To Writers</TableHead>
                    <TableHead className="text-right font-bold">Holding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.isLoading ? <LoadingRow cols={4} /> : pAgencies.total === 0 ? <EmptyRow cols={4} text="No agencies yet." /> : pAgencies.rows.map((a) => (
                    <TableRow key={a.agentId} className="hover:bg-muted/20">
                      <TableCell className="text-xs">
                        <span className="font-mono font-black">{a.agentCode}</span>
                        <span className="text-[11px] text-muted-foreground ml-2">{a.agencyName}</span>
                        {a.lastAllotted && <div className="text-[10px] text-muted-foreground">Last allotted {fmtDate(a.lastAllotted)}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">{n(a.allotted)}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-amber-600 dark:text-amber-400 font-bold">{n(a.distributed)}</TableCell>
                      <TableCell className={`text-xs text-right font-mono font-black ${a.balance === 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"}`}>{n(a.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableShell>
          </div>
          <div className="xl:col-span-2 space-y-3 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold flex items-center gap-2"><Users className="w-4 h-4 text-muted-foreground" /> Rolls received by writers</h3>
              <Select value={writerAgency} onValueChange={(v) => { setWriterAgency(v); pWriters.setPage(1); }}>
                <SelectTrigger className="h-8 w-44 text-xs" aria-label="Filter writers by agency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All agencies</SelectItem>
                  {agencies.map((a) => <SelectItem key={a.agentId} value={a.agentId}>{a.agentCode} — {a.agencyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <TableShell footer={<Pager page={pWriters.page} totalPages={pWriters.totalPages} onPage={pWriters.setPage} total={pWriters.total} pageSize={pWriters.size} noun="writers" />}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-bold">Writer</TableHead>
                    <TableHead className="text-right font-bold">Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.isLoading ? <LoadingRow cols={2} /> : pWriters.total === 0 ? <EmptyRow cols={2} text="No writer has received rolls yet." /> : pWriters.rows.map((w) => (
                    <TableRow key={w.writerId} className="hover:bg-muted/20">
                      <TableCell className="text-xs">
                        <div className="font-semibold">{w.writerName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{w.writerCode}{w.lastReceived ? ` · last ${fmtDate(w.lastReceived)}` : ""}</div>
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono font-black">{n(w.received)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableShell>
          </div>
        </div>
      )}

      <PurchaseDialog open={dialog === "purchase"} onOpenChange={(v) => setDialog(v ? "purchase" : null)} store={store} onSaved={refresh} />
      <AllotDialog open={dialog === "allot"} onOpenChange={(v) => setDialog(v ? "allot" : null)} store={store} agencies={agencies} onSaved={refresh} />
      <DistributeDialog open={dialog === "distribute"} onOpenChange={(v) => setDialog(v ? "distribute" : null)} agencies={agencies} onSaved={refresh} />
      {s && <ThresholdDialog open={dialog === "threshold"} onOpenChange={(v) => setDialog(v ? "threshold" : null)} current={s.lowStockThreshold} store={store} onSaved={refresh} />}
    </div>
  );
}
