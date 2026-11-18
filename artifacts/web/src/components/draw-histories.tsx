import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { CheckCircle2, Gavel, History, Loader2, MessageSquareText, Settings, XCircle } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { ALERTS_KEY } from "@/lib/use-alerts";
import { useToast } from "@/hooks/use-toast";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { cn } from "@/lib/utils";

export type DrawRow = {
  id: string; name: string; event_number: string; status: string; close_at: string;
  winning_numbers: string | null; machine_numbers: string | null;
  result_id: string | null; processed_at: string | null; processed_by_name: string | null;
  total_tickets: number | null; total_winners: number | null; total_payouts: string | null; sms_notifications_sent: boolean | null;
  calc_rows: number; gross: string; wins: string; calculated_at: string | null;
};
export type Correction = {
  id: string; game_id: string; old_winning: string; old_machine: string; new_winning: string; new_machine: string;
  reason: string; status: "pending" | "approved" | "rejected" | "applied";
  requested_by: string; requested_by_name: string; requested_at: string;
  decided_by_name: string | null; decided_at: string | null; decision_note: string | null;
  reversed: { payoutsRemoved: number; payoutTotal: string; ticketsReturned: number; winnersReturned: number } | null;
  applied_by_name: string | null; applied_at: string | null;
};
export type DrawsHistory = { draws: DrawRow[]; corrections: Correction[] };

export const DRAWS_KEY = ["/api/draws/history"] as const;
export const fetchDraws = () => customFetch<DrawsHistory>("/api/draws/history", { method: "GET" });
const send = <T,>(path: string, body: unknown) =>
  customFetch<T>(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const errorText = (e: unknown, fallback: string) => (e as { data?: { error?: string } })?.data?.error ?? fallback;

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Accra" }) : "—");
const fmtDateTime = (v?: string | null) => (v ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" }) : "—");
const ghs = (v: unknown) => `GH₵ ${Number(v ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const splitNumbers = (s?: string | null) => (s ?? "").split(/[^0-9]+/).filter(Boolean);

/** Five numbers as balls, winning in amber and machine in indigo. */
export function NumberBalls({ numbers, kind, changedFrom }: { numbers: string | null; kind: "winning" | "machine"; changedFrom?: string | null }) {
  const list = splitNumbers(numbers);
  const before = changedFrom ? splitNumbers(changedFrom) : null;
  if (!list.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex gap-1">
      {list.map((n, i) => (
        <span key={i} title={before && before[i] !== n ? `Was ${before[i] ?? "—"}` : undefined}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black tabular-nums shadow-sm",
            kind === "winning" ? "bg-amber-400 text-amber-950" : "bg-indigo-600 text-white",
            before && before[i] !== n && "ring-2 ring-rose-500 ring-offset-1 ring-offset-background",
          )}>
          {n.padStart(2, "0")}
        </span>
      ))}
    </span>
  );
}

/** Where a draw stands, for the history list and the Run Draws check. */
export function drawState(d: DrawRow, open?: Correction | null): { label: string; tone: string } {
  if (open?.status === "pending") return { label: "Correction awaiting director", tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" };
  if (open?.status === "approved") return { label: "Correction approved · re-run due", tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" };
  if (d.result_id && d.sms_notifications_sent) return { label: "Completed · payouts notified", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" };
  if (d.result_id) return { label: "Completed", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" };
  return { label: "Calculated", tone: "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300" };
}

const C_STATUS: Record<Correction["status"], { label: string; cls: string }> = {
  pending: { label: "Awaiting director", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  approved: { label: "Approved · re-run due", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  applied: { label: "Applied", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "Rejected", cls: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400" },
};

function historyReport(draws: DrawRow[], corrections: Correction[]): TableReport {
  const pad = (s: string | null) => splitNumbers(s).map((n) => n.padStart(2, "0")).join("  ") || "-";
  return {
    title: "Draw Histories",
    fileName: `draw-histories-${new Date().toISOString().slice(0, 10)}`,
    orientation: "landscape",
    summary: [`${draws.length} draws run`, `${corrections.filter((c) => c.status === "applied").length} corrected after running`],
    sections: [
      {
        heading: "Draws",
        columns: [{ header: "Draw date" }, { header: "Event" }, { header: "Game" }, { header: "Winning numbers" }, { header: "Machine numbers" }, { header: "Winners", align: "right" }, { header: "Payouts", align: "right" }, { header: "Run by" }, { header: "SMS" }],
        rows: draws.map((d) => [fmtDate(d.close_at), d.event_number, d.name, pad(d.winning_numbers), pad(d.machine_numbers), String(d.total_winners ?? 0), ghs(d.total_payouts), d.processed_by_name ?? "-", d.sms_notifications_sent ? "Sent" : "Not yet"]),
      },
      ...(corrections.length ? [{
        heading: "Corrections",
        columns: [{ header: "Requested" }, { header: "Event" }, { header: "Winning: was / now" }, { header: "Machine: was / now" }, { header: "Reason" }, { header: "Status" }, { header: "Decided by" }],
        rows: corrections.map((c) => {
          const g = draws.find((d) => d.id === c.game_id);
          return [fmtDateTime(c.requested_at), g?.event_number ?? "", `${pad(c.old_winning)} / ${pad(c.new_winning)}`, `${pad(c.old_machine)} / ${pad(c.new_machine)}`, c.reason, C_STATUS[c.status].label, c.decided_by_name ?? "-"];
        }),
      }] : []),
    ],
  };
}

/**
 * Draw Histories: every draw that has run, its winning and machine numbers
 * side by side, and the correction flow - an administrator proposes new
 * numbers, the director approves, and the draw is unlocked for one re-run.
 */
export function DrawHistories() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const isDirector = user?.role === "director";
  const q = useQuery({ queryKey: DRAWS_KEY, queryFn: fetchDraws, refetchInterval: 30_000 });
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<DrawRow | null>(null);
  const [decide, setDecide] = useState<Correction | null>(null);
  const draws = q.data?.draws ?? [];
  const corrections = q.data?.corrections ?? [];
  const openByGame = useMemo(() => new Map(corrections.filter((c) => c.status === "pending" || c.status === "approved").map((c) => [c.game_id, c])), [corrections]);
  const lastAppliedByGame = useMemo(() => {
    const m = new Map<string, Correction>();
    for (const c of corrections) if (c.status === "applied" && !m.has(c.game_id)) m.set(c.game_id, c);
    return m;
  }, [corrections]);
  const filtered = draws.filter((d) => !search || `${d.name} ${d.event_number}`.toLowerCase().includes(search.toLowerCase()));
  const paged = usePaged(filtered, 15, search);
  const pending = corrections.filter((c) => c.status === "pending");
  const corrPaged = usePaged(corrections, 10);

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <Panel title={isDirector ? "Corrections waiting for your approval" : "Corrections waiting for the director"} subtitle="Approving puts the draw back to unsettled and unlocks one re-run with the corrected numbers." icon={Gavel}>
          <div className="divide-y">
            {pending.map((c) => {
              const g = draws.find((d) => d.id === c.game_id);
              return (
                <div key={c.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-sm font-bold">{g?.name ?? "Draw"} <span className="font-mono text-xs text-muted-foreground">#{g?.event_number}</span></div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                      <span className="flex items-center gap-1.5">Winning <NumberBalls numbers={c.new_winning} kind="winning" changedFrom={c.old_winning} /></span>
                      <span className="flex items-center gap-1.5">Machine <NumberBalls numbers={c.new_machine} kind="machine" changedFrom={c.old_machine} /></span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">Was {c.old_winning} / {c.old_machine} · proposed by {c.requested_by_name}, {fmtDateTime(c.requested_at)} · “{c.reason}”</div>
                  </div>
                  {isDirector && c.requested_by !== user?.id && (
                    <Button size="sm" className="shrink-0 gap-1.5" onClick={() => setDecide(c)}><Gavel className="h-3.5 w-3.5" /> Decide</Button>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel
        title="Draw histories"
        subtitle={isAdmin ? "Every draw that has run. The gear proposes a correction to a draw's numbers; it takes effect only once the director approves." : "Every draw that has run, with its declared numbers."}
        icon={History}
        actions={
          <>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search game or event…" className="h-8 w-[200px] text-xs" />
            {draws.length > 0 && <ReportActions label="the draw histories" onPdf={() => exportReportPdf(historyReport(filtered, corrections))} onPrint={() => printReport(historyReport(filtered, corrections))} />}
          </>
        }
      >
        <ScrollTable maxHeight="36rem" minWidth="66rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Draw</TableHead>
                <TableHead>Winning numbers</TableHead>
                <TableHead>Machine numbers</TableHead>
                <TableHead className="text-right">Winners · payouts</TableHead>
                <TableHead>Run</TableHead>
                <TableHead>State</TableHead>
                {isAdmin && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((d) => {
                const open = openByGame.get(d.id) ?? null;
                const st = drawState(d, open);
                const applied = lastAppliedByGame.get(d.id);
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="text-sm font-semibold">{d.name}</div>
                      <div className="text-[11px] text-muted-foreground"><span className="font-mono">#{d.event_number}</span> · {fmtDate(d.close_at)}</div>
                    </TableCell>
                    <TableCell><NumberBalls numbers={d.winning_numbers} kind="winning" changedFrom={applied?.old_winning} /></TableCell>
                    <TableCell><NumberBalls numbers={d.machine_numbers} kind="machine" changedFrom={applied?.old_machine} /></TableCell>
                    <TableCell className="text-right font-mono text-xs">{d.total_winners ?? 0} · {ghs(d.total_payouts)}</TableCell>
                    <TableCell className="text-xs">{d.processed_by_name ?? "—"}<div className="text-[11px] text-muted-foreground">{fmtDateTime(d.processed_at ?? d.calculated_at)}</div></TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider whitespace-nowrap", st.tone)}>{st.label}</span>
                      {d.sms_notifications_sent && <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><MessageSquareText className="h-3 w-3" /> SMS sent</div>}
                      {applied && <div className="mt-1 text-[10px] text-rose-600">Corrected {fmtDate(applied.applied_at)}</div>}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!!open || !d.result_id}
                          title={open ? "A correction is already in progress" : !d.result_id ? "Waiting for its re-run" : "Propose a correction to this draw's numbers"}
                          aria-label={`Correct the numbers for ${d.name}`} onClick={() => setEdit(d)}>
                          <Settings className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {!q.isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={isAdmin ? 7 : 6} className="py-10 text-center text-xs text-muted-foreground">No draws have been run yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="draws" />
      </Panel>

      {corrections.length > 0 && (
        <Panel title="Correction log" subtitle="Every correction proposed, who decided it, what approval undid, and when the re-run applied it." icon={Settings}>
          <ScrollTable maxHeight="28rem" minWidth="70rem">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Draw</TableHead>
                  <TableHead>Winning: was → now</TableHead>
                  <TableHead>Machine: was → now</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Proposed · decided · applied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corrPaged.rows.map((c) => {
                  const g = draws.find((d) => d.id === c.game_id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs"><b>{g?.name}</b> <span className="font-mono text-muted-foreground">#{g?.event_number}</span></TableCell>
                      <TableCell className="font-mono text-[11px]">{c.old_winning} → <b>{c.new_winning}</b></TableCell>
                      <TableCell className="font-mono text-[11px]">{c.old_machine} → <b>{c.new_machine}</b></TableCell>
                      <TableCell className="max-w-[16rem] truncate text-xs" title={c.reason}>{c.reason}</TableCell>
                      <TableCell><span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider whitespace-nowrap", C_STATUS[c.status].cls)}>{C_STATUS[c.status].label}</span></TableCell>
                      <TableCell className="text-[11px]">
                        <div>{c.requested_by_name}, {fmtDateTime(c.requested_at)}</div>
                        {c.decided_by_name && <div className="text-muted-foreground">{c.status === "rejected" ? "Rejected" : "Approved"} by {c.decided_by_name}{c.decision_note ? ` - ${c.decision_note}` : ""}</div>}
                        {c.reversed && <div className="text-muted-foreground">Undid {c.reversed.payoutsRemoved} unclaimed payout(s), {ghs(c.reversed.payoutTotal)}; {c.reversed.ticketsReturned} ticket(s) back to active</div>}
                        {c.applied_at && <div className="text-emerald-700 dark:text-emerald-400">Re-run by {c.applied_by_name}, {fmtDateTime(c.applied_at)}</div>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollTable>
          <Pager page={corrPaged.page} totalPages={corrPaged.totalPages} onPage={corrPaged.setPage} total={corrPaged.total} size={corrPaged.size} noun="corrections" />
        </Panel>
      )}

      {edit && <CorrectionDialog draw={edit} onClose={() => setEdit(null)} />}
      {decide && <DecideDialog c={decide} draw={draws.find((d) => d.id === decide.game_id)} onClose={() => setDecide(null)} />}
    </div>
  );
}

function NumberInputs({ label, values, onChange, kind, idPrefix }: { label: string; values: string[]; onChange: (v: string[]) => void; kind: "winning" | "machine"; idPrefix: string }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="flex gap-2">
        {values.map((v, i) => (
          <Input key={i} id={`${idPrefix}-${i}`} inputMode="numeric" maxLength={2} value={v} placeholder={`#${i + 1}`}
            onChange={(e) => {
              const clean = e.target.value.replace(/\D/g, "").slice(0, 2);
              if (clean && Number(clean) > 90) return;
              const copy = [...values]; copy[i] = clean; onChange(copy);
              if (clean.length === 2) document.getElementById(`${idPrefix}-${i + 1}`)?.focus();
            }}
            className={cn("h-10 w-12 rounded-xl text-center text-sm font-bold", kind === "winning" ? "focus-visible:ring-amber-400" : "focus-visible:ring-indigo-500")} />
        ))}
      </div>
    </div>
  );
}

const valid = (list: string[]) => list.every((v) => /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 90);

function CorrectionDialog({ draw, onClose }: { draw: DrawRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [win, setWin] = useState(() => { const s = splitNumbers(draw.winning_numbers); return Array.from({ length: 5 }, (_, i) => s[i] ?? ""); });
  const [mach, setMach] = useState(() => { const s = splitNumbers(draw.machine_numbers); return Array.from({ length: 5 }, (_, i) => s[i] ?? ""); });
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [error, setError] = useState<string | null>(null);
  const norm = (l: string[]) => l.map((v) => String(Number(v))).join(",");
  const changed = norm(win) !== norm(splitNumbers(draw.winning_numbers)) || norm(mach) !== norm(splitNumbers(draw.machine_numbers));
  const ok = valid(win) && valid(mach) && changed && reason.trim().length >= 10;
  const m = useMutation({
    mutationFn: () => send(`/api/draws/${draw.id}/corrections`, { winningNumbers: norm(win), machineNumbers: norm(mach), reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: DRAWS_KEY }); qc.invalidateQueries({ queryKey: ALERTS_KEY }); toast({ title: "Correction committed - waiting for the director's approval" }); onClose(); },
    onError: (e) => { setError(errorText(e, "The correction was not committed")); setStep("edit"); },
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !m.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings className="h-4 w-4" /> Correct draw numbers — {draw.name}</DialogTitle>
          <DialogDescription>
            #{draw.event_number}, drawn {fmtDate(draw.close_at)}. Nothing changes when you commit: the director approves first. Approval sets the draw back to unsettled -
            its unclaimed wins are re-decided - and unlocks one re-run with these numbers, after which payouts and SMS can go out again.
          </DialogDescription>
        </DialogHeader>
        {step === "edit" ? (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/30 px-4 py-3 text-xs space-y-1.5">
              <div className="font-semibold">Recorded now</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5"><span className="flex items-center gap-1.5">Winning <NumberBalls numbers={draw.winning_numbers} kind="winning" /></span><span className="flex items-center gap-1.5">Machine <NumberBalls numbers={draw.machine_numbers} kind="machine" /></span></div>
            </div>
            <div className="space-y-4">
              <NumberInputs label="Corrected winning numbers" values={win} onChange={setWin} kind="winning" idPrefix="cw" />
              <NumberInputs label="Corrected machine numbers" values={mach} onChange={setMach} kind="machine" idPrefix="cm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Reason and authority</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Machine number 4 keyed as 41; the NLA results sheet for this draw shows 14." />
            </div>
            {!changed && <p className="text-xs text-muted-foreground">Change at least one number.</p>}
            {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-400">{error}</p>}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p>Commit this correction for the director's approval?</p>
            <div className="rounded-xl border px-4 py-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">Winning <NumberBalls numbers={norm(win)} kind="winning" changedFrom={draw.winning_numbers} /></div>
              <div className="flex flex-wrap items-center gap-2">Machine <NumberBalls numbers={norm(mach)} kind="machine" changedFrom={draw.machine_numbers} /></div>
              <div className="text-muted-foreground">“{reason}”</div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => (step === "confirm" ? setStep("edit") : onClose())} disabled={m.isPending}>{step === "confirm" ? "Back" : "Cancel"}</Button>
          {step === "edit"
            ? <Button disabled={!ok} onClick={() => { setError(null); setStep("confirm"); }}>Review</Button>
            : <Button disabled={m.isPending} onClick={() => m.mutate()} className="gap-1.5">{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Commit for approval</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({ c, draw, onClose }: { c: Correction; draw?: DrawRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => send<{ reversed?: { payoutsRemoved: number; ticketsReturned: number } }>(`/api/draw-corrections/${c.id}/decide`, { decision, note: note || null }),
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast({ title: decision === "approve" ? `Approved - ${r.reversed?.ticketsReturned ?? 0} ticket(s) back to unsettled; the draw is unlocked for its re-run` : "Correction rejected" });
      onClose();
    },
    onError: (e) => setError(errorText(e, "The decision was not saved")),
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !m.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Gavel className="h-4 w-4" /> Draw correction — {draw?.name}</DialogTitle>
          <DialogDescription>Proposed by {c.requested_by_name}: “{c.reason}”</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border px-4 py-3 space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">Winning <NumberBalls numbers={c.new_winning} kind="winning" changedFrom={c.old_winning} /> <span className="text-muted-foreground">was {c.old_winning}</span></div>
            <div className="flex flex-wrap items-center gap-2">Machine <NumberBalls numbers={c.new_machine} kind="machine" changedFrom={c.old_machine} /> <span className="text-muted-foreground">was {c.old_machine}</span></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([["approve", CheckCircle2], ["reject", XCircle]] as const).map(([d, Icon]) => (
              <button key={d} type="button" onClick={() => setDecision(d)} className={cn("flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold capitalize", decision === d ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}><Icon className="h-3.5 w-3.5" />{d}</button>
            ))}
          </div>
          {decision === "approve" && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Approving removes this draw's unclaimed payouts and returns its tickets to unsettled, then changes its numbers. The administrator re-runs it with exactly these numbers, which settles the tickets again and re-opens payouts and SMS.
            </p>
          )}
          <div className="space-y-1.5"><Label className="text-xs font-semibold">{decision === "reject" ? "Reason (required)" : "Note"}</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
          {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={m.isPending}>Cancel</Button>
          <Button disabled={m.isPending || (decision === "reject" && note.trim().length < 3)} onClick={() => m.mutate()} className="gap-1.5">
            {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{decision === "approve" ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
