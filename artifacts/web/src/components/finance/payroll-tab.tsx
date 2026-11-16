import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarCheck, Users } from "lucide-react";
import { Panel, ScrollTable, ReportActions, StatTile } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, finGet, finSend, ghs, fmtDateTime, todayAccra } from "@/lib/finance-api";
import { EmptyRow, Field, FormDialog, Note } from "./shared";
import { cn } from "@/lib/utils";

type Schedule = {
  id: string; period_month: number; period_year: number; status: string; total_amount: string; staff_count: number;
  prepared_by: string; prepared_by_name: string; submitted_at: string; note: string | null;
  decided_by_name: string | null; decided_at: string | null; decision_note: string | null; paid_amount: string; paid_count: number;
};
type Period = { period_year: number; period_month: number; staff: number; total: string; paid_count: number; unpaid: string };
type Data = { schedules: Schedule[]; periods: Period[]; provision: number; committedUnpaid: number; shortfall: number };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (m: number, y: number) => `${MONTHS[m - 1]} ${y}`;
const STATUS: Record<string, string> = {
  submitted: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rejected: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

function payrollReport(d: Data): TableReport {
  return {
    title: "Salary Schedules and Provision",
    fileName: `salary-schedules-${todayAccra()}`,
    summary: [`Salary Provision Fund: ${ghs(d.provision)}`, `Approved or awaiting, still unpaid: ${ghs(d.committedUnpaid)}`, d.shortfall > 0 ? `Short by ${ghs(d.shortfall)}` : "Provision covers what is committed"],
    sections: [{
      columns: [{ header: "Month" }, { header: "Status" }, { header: "Staff", align: "right" }, { header: "Scheduled", align: "right" }, { header: "Paid", align: "right" }, { header: "Prepared by" }, { header: "Decided by" }],
      rows: d.schedules.map((s) => [label(s.period_month, s.period_year), s.status, String(s.staff_count), ghs(s.total_amount), ghs(s.paid_amount), s.prepared_by_name, s.decided_by_name ?? "—"]),
    }],
  };
}

export function PayrollTab({ role }: { role?: string }) {
  const { user } = useAuth();
  const q = useQuery({ queryKey: [...FIN_KEY, "payroll"], queryFn: finGet<Data>("/salary-schedules") });
  const [submit, setSubmit] = useState<Period | null>(null);
  const [decide, setDecide] = useState<Schedule | null>(null);
  const d = q.data;
  const live = new Set((d?.schedules ?? []).filter((s) => s.status !== "rejected").map((s) => `${s.period_year}-${s.period_month}`));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-4">
        <StatTile label="Salary Provision Fund" value={d ? ghs(d.provision) : "…"} sub="Set aside by the director" icon={Users} />
        <StatTile label="Committed, unpaid" value={d ? ghs(d.committedUnpaid) : "…"} sub="Schedules approved or awaiting approval" tone="warn" />
        <StatTile label="Shortfall" value={d ? ghs(d.shortfall) : "…"} sub={d && d.shortfall > 0 ? "Allocate more before payday" : "The provision covers it"} tone={d && d.shortfall > 0 ? "bad" : "in"} />
      </div>
      {d && d.shortfall > 0 && <Note tone="bad">The Salary Provision Fund is {ghs(d.shortfall)} short of the salaries scheduled. The director allocates more from Staff Payroll › Salary Provision - out of money the company actually holds.</Note>}
      <Note>
        Each month: the director sets money aside in the Salary Provision Fund; the administrator generates the month in <Link href="/staffs-employees" className="font-bold underline">Staff Payroll</Link> and submits it here as a schedule;
        the director approves it; then the cashier pays each salary. A salary cannot be paid before its month's schedule is approved, nor by the person who approved it.
        Money not spent stays in the fund for the next month.
      </Note>

      <Panel title="Months to submit" subtitle="Salary lines generated in Staff Payroll, by month." icon={CalendarCheck}>
        <ScrollTable maxHeight="20rem" minWidth="40rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Staff</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Unpaid</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.periods ?? []).map((p) => (
                <TableRow key={`${p.period_year}-${p.period_month}`}>
                  <TableCell className="text-xs font-semibold">{label(p.period_month, p.period_year)}</TableCell>
                  <TableCell className="text-right font-mono">{p.staff} <span className="text-muted-foreground">({p.paid_count} paid)</span></TableCell>
                  <TableCell className="text-right font-mono">{ghs(p.total)}</TableCell>
                  <TableCell className="text-right font-mono">{ghs(p.unpaid)}</TableCell>
                  <TableCell className="text-right">
                    {live.has(`${p.period_year}-${p.period_month}`) ? <span className="text-[11px] text-muted-foreground">Schedule submitted</span>
                      : Number(p.unpaid) > 0 && (role === "administrator" || role === "director") ? <Button size="sm" className="h-7 text-[11px]" onClick={() => setSubmit(p)}>Submit for approval</Button> : null}
                  </TableCell>
                </TableRow>
              ))}
              {!q.isLoading && (d?.periods ?? []).length === 0 && <EmptyRow cols={5}>No salary months generated yet.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
      </Panel>

      <Panel title="Salary schedules" subtitle="Prepared, approved, paid." icon={CalendarCheck}
        actions={d && d.schedules.length > 0 && <ReportActions label="the salary schedules" onPdf={() => exportReportPdf(payrollReport(d))} onPrint={() => printReport(payrollReport(d))} />}>
        <ScrollTable maxHeight="26rem" minWidth="60rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Scheduled</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Prepared</TableHead>
                <TableHead>Decided</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.schedules ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs font-semibold">{label(s.period_month, s.period_year)}</TableCell>
                  <TableCell><span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase", STATUS[s.status])}>{s.status}</span></TableCell>
                  <TableCell className="text-right font-mono">{ghs(s.total_amount)} <span className="text-muted-foreground">· {s.staff_count}</span></TableCell>
                  <TableCell className="text-right font-mono">{ghs(s.paid_amount)} <span className="text-muted-foreground">· {s.paid_count}</span></TableCell>
                  <TableCell className="text-xs">{s.prepared_by_name}<div className="text-[11px] text-muted-foreground">{fmtDateTime(s.submitted_at)}</div></TableCell>
                  <TableCell className="text-xs">{s.decided_by_name ?? "—"}{s.decision_note && <div className="text-[11px] text-muted-foreground max-w-[14rem] truncate" title={s.decision_note}>{s.decision_note}</div>}</TableCell>
                  <TableCell className="text-right">{s.status === "submitted" && role === "director" && s.prepared_by !== user?.id && <Button size="sm" className="h-7 text-[11px]" onClick={() => setDecide(s)}>Decide</Button>}</TableCell>
                </TableRow>
              ))}
              {!q.isLoading && (d?.schedules ?? []).length === 0 && <EmptyRow cols={7}>No schedules submitted yet.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
      </Panel>

      {submit && (
        <SubmitDialog p={submit} provision={d?.provision ?? 0} onClose={() => setSubmit(null)} />
      )}
      {decide && <DecideDialog s={decide} provision={d?.provision ?? 0} onClose={() => setDecide(null)} />}
    </div>
  );
}

function SubmitDialog({ p, provision, onClose }: { p: Period; provision: number; onClose: () => void }) {
  const [note, setNote] = useState("");
  return (
    <FormDialog open onOpenChange={(v) => { if (!v) onClose(); }} title={`Submit ${label(p.period_month, p.period_year)} for approval`} submitLabel="Submit" successMessage="Submitted; the director has been notified"
      description={`${p.staff - p.paid_count} unpaid salaries, ${ghs(p.unpaid)}. The provision holds ${ghs(provision)}.`}
      onSubmit={() => finSend("/salary-schedules", { month: p.period_month, year: p.period_year, note: note || null })}>
      {Number(p.unpaid) > provision + 0.005 && <Note tone="warn">The provision is {ghs(Number(p.unpaid) - provision)} short. The director is told when this is submitted.</Note>}
      <Field label="Note for the director"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
    </FormDialog>
  );
}

function DecideDialog({ s, provision, onClose }: { s: Schedule; provision: number; onClose: () => void }) {
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [note, setNote] = useState("");
  return (
    <FormDialog open onOpenChange={(v) => { if (!v) onClose(); }} title={`Salary schedule — ${label(s.period_month, s.period_year)}`} submitLabel={decision === "approve" ? "Approve" : "Reject"} successMessage={decision === "approve" ? "Approved; the cashier can pay" : "Rejected"}
      description={`${s.staff_count} salaries, ${ghs(s.total_amount)}, prepared by ${s.prepared_by_name}. The provision holds ${ghs(provision)}.`}
      disabled={decision === "reject" && note.trim().length < 3}
      onSubmit={() => finSend(`/salary-schedules/${s.id}/decide`, { decision, note: note || null })}>
      {s.note && <Note>{s.note}</Note>}
      <div className="grid grid-cols-2 gap-2">
        {(["approve", "reject"] as const).map((x) => (
          <button key={x} type="button" onClick={() => setDecision(x)} className={cn("rounded-xl border px-3 py-2 text-xs font-bold capitalize", decision === x ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>{x}</button>
        ))}
      </div>
      <Field label={decision === "reject" ? "Reason (required)" : "Note"}><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
    </FormDialog>
  );
}
