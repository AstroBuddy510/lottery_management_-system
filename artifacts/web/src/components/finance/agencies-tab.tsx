import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, FileText, Gavel, Scale } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions, StatTile } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, finGet, finSend, apiGet, ghs, fmtDate, fmtDateTime, todayAccra, monthStartAccra } from "@/lib/finance-api";
import { EmptyRow, Field, FormDialog, Note } from "./shared";
import { cn } from "@/lib/utils";

type Opening = { id: string; amount: string; direction: "agency_owes" | "company_owes"; as_of: string; basis: string; status: string; proposed_by: string; proposed_by_name: string; proposed_at: string; decided_by_name: string | null; decided_at: string | null };
type Agency = {
  id: string; code: string; agencyName: string | null; agentName: string; status: string;
  stored: number; firstRecorded: number | null; ledgerFromInception: number;
  derived: { balance: number; asOf: string } | null;
  approvedOpening: Opening | null; proposedOpening: Opening | null;
  commission: { earned: number; earnedClosed: number; paid: number; pending: number; available: number };
};
type Statement = {
  confirmed: boolean; opening: { amount: number; direction: string; asOf: string; basis: string } | null;
  from: string; to: string; broughtForward: number; carriedForward: number;
  lines: Array<{ day: string; kind: string; label: string; ref: string | null; gross: number | null; commission: number | null; wins: number | null; reserve: number | null; effect: number; balance: number }>;
};

/** A balance in words: who owes whom. Positive = the company owes the agency. */
export function owing(v: number) {
  if (Math.abs(v) < 0.005) return "Clear";
  return v < 0 ? `Agency owes ${ghs(-v)}` : `Company owes ${ghs(v)}`;
}
const owingCls = (v: number) => (Math.abs(v) < 0.005 ? "text-muted-foreground" : v < 0 ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400");

function agenciesReport(rows: Agency[]): TableReport {
  return {
    title: "Agency Balances",
    fileName: `agency-balances-${todayAccra()}`,
    orientation: "landscape",
    summary: [
      `${rows.filter((r) => r.approvedOpening).length} of ${rows.length} agencies on a confirmed opening balance`,
      `Owed to the company: ${ghs(rows.filter((r) => r.stored < 0).reduce((s, r) => s - r.stored, 0))}`,
      `Owed by the company: ${ghs(rows.filter((r) => r.stored > 0).reduce((s, r) => s + r.stored, 0))}`,
    ],
    sections: [{
      columns: [{ header: "Agency" }, { header: "Opening balance" }, { header: "Balance" }, { header: "Commission available", align: "right" }],
      rows: rows.map((r) => [
        `${r.code} · ${r.agencyName ?? r.agentName}`,
        r.approvedOpening ? `${r.approvedOpening.direction === "agency_owes" ? "Agency owed" : "Company owed"} ${ghs(r.approvedOpening.amount)} at ${fmtDate(r.approvedOpening.as_of)}` : "UNCONFIRMED",
        owing(r.stored) + (r.approvedOpening ? "" : " (unconfirmed)"),
        ghs(r.commission.available),
      ]),
    }],
  };
}

function statementReport(a: Agency, s: Statement): TableReport {
  return {
    title: `Agency Statement — ${a.code}`,
    fileName: `statement-${a.code}-${s.from}-to-${s.to}`,
    orientation: "landscape",
    summary: [
      `${a.agencyName ?? ""} (${a.agentName})`,
      s.opening ? `Opening balance: ${s.opening.direction === "agency_owes" ? "agency owed" : "company owed"} ${ghs(s.opening.amount)} at ${fmtDate(s.opening.asOf)}` : "Opening balance not yet confirmed",
      `Brought forward: ${owing(s.broughtForward)} · Carried forward: ${owing(s.carriedForward)}`,
    ],
    meta: [{ label: "Period", value: `${fmtDate(s.from)} – ${fmtDate(s.to)}` }],
    sections: [{
      columns: [{ header: "Date" }, { header: "Item" }, { header: "Gross", align: "right" }, { header: "Commission", align: "right" }, { header: "Wins", align: "right" }, { header: "Reserve", align: "right" }, { header: "Effect", align: "right" }, { header: "Balance" }],
      rows: [
        [fmtDate(s.from), "Balance brought forward", "", "", "", "", "", owing(s.broughtForward)],
        ...s.lines.map((l) => [fmtDate(l.day), l.kind === "draw" ? `Draw ${l.label}${l.ref ? ` #${l.ref}` : ""}` : `${l.label}${l.ref ? ` ${l.ref}` : ""}`,
          l.gross === null ? "" : ghs(l.gross), l.commission === null ? "" : ghs(l.commission), l.wins === null ? "" : ghs(l.wins), l.reserve === null ? "" : ghs(l.reserve),
          (l.effect >= 0 ? "+" : "−") + ghs(Math.abs(l.effect)), owing(l.balance)]),
      ],
      totals: ["", "Balance carried forward", "", "", "", "", "", owing(s.carriedForward)],
    }],
  };
}

export function AgenciesTab() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: [...FIN_KEY, "agencies"], queryFn: finGet<Agency[]>("/agencies") });
  const [propose, setPropose] = useState<Agency | null>(null);
  const [decide, setDecide] = useState<Agency | null>(null);
  const [statement, setStatement] = useState<Agency | null>(null);
  const rows = q.data ?? [];
  const paged = usePaged(rows, 15);
  const unconfirmed = rows.filter((r) => !r.approvedOpening).length;
  const owedToCo = rows.filter((r) => r.stored < 0).reduce((s, r) => s - r.stored, 0);
  const owedByCo = rows.filter((r) => r.stored > 0).reduce((s, r) => s + r.stored, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile label="Owed to the company" value={ghs(owedToCo)} sub="Agencies in debt" icon={Scale} tone="warn" />
        <StatTile label="Owed by the company" value={ghs(owedByCo)} sub="Agencies in credit" />
        <StatTile label="Opening balances confirmed" value={`${rows.length - unconfirmed} of ${rows.length}`} sub={unconfirmed ? `${unconfirmed} awaiting confirmation` : "All confirmed"} icon={CheckCircle2} tone={unconfirmed ? "bad" : "in"} />
        <StatTile label="Commission available" value={ghs(rows.reduce((s, r) => s + Math.max(0, r.commission.available), 0))} sub="Completed weeks, not yet paid or requested" />
      </div>
      {unconfirmed > 0 && (
        <Note tone="warn">
          An agency's balance from before this system is an <b>opening balance</b>: an amount, which way it is owed, the date it is as at and what it rests on,
          proposed by one person and approved by another. Until then its balance is the figure stored on the old screens and is marked <b>unconfirmed</b> -
          the reference figures beside it (the first balance the system recorded, and what the draws and payments alone add up to) are there to help decide it,
          not to be adopted without checking the books from the manual period.
        </Note>
      )}
      <Panel
        title="Agency balances"
        subtitle="Positive balances are owed by the company to the agency; the direction is always said in words."
        icon={Building2}
        actions={rows.length > 0 && <ReportActions label="the agency balances" onPdf={() => exportReportPdf(agenciesReport(rows))} onPrint={() => printReport(agenciesReport(rows))} />}
      >
        <ScrollTable maxHeight="36rem" minWidth="70rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency</TableHead>
                <TableHead>Opening balance</TableHead>
                <TableHead>Balance now</TableHead>
                <TableHead>For reference</TableHead>
                <TableHead className="text-right">Commission available</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-semibold">{a.code}</div>
                    <div className="text-[11px] text-muted-foreground">{a.agencyName ?? "—"} · {a.agentName}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {a.approvedOpening ? (
                      <>
                        <div className="font-semibold">{a.approvedOpening.direction === "agency_owes" ? "Agency owed" : "Company owed"} {ghs(a.approvedOpening.amount)}</div>
                        <div className="text-[11px] text-muted-foreground">at {fmtDate(a.approvedOpening.as_of)} · approved by {a.approvedOpening.decided_by_name}</div>
                      </>
                    ) : <span className="font-bold text-rose-600">Unconfirmed</span>}
                    {a.proposedOpening && (
                      <div className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        Proposed: {a.proposedOpening.direction === "agency_owes" ? "agency owes" : "company owes"} {ghs(a.proposedOpening.amount)} by {a.proposedOpening.proposed_by_name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className={cn("font-mono text-sm font-bold", owingCls(a.stored))}>
                    {owing(a.stored)}
                    {!a.approvedOpening && <div className="text-[10px] font-sans font-bold uppercase text-rose-600">stored figure, unconfirmed</div>}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {!a.approvedOpening ? (
                      <>
                        <div>First recorded: {a.firstRecorded === null ? "—" : owing(a.firstRecorded)}</div>
                        <div>Draws &amp; payments alone: {owing(a.ledgerFromInception)}</div>
                      </>
                    ) : `Ledger since ${fmtDate(a.approvedOpening.as_of)}`}
                  </TableCell>
                  <TableCell className="text-right font-mono">{ghs(a.commission.available)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setStatement(a)}><FileText className="h-3 w-3" /> Statement</Button>
                      {a.proposedOpening && a.proposedOpening.proposed_by !== user?.id && (
                        <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setDecide(a)}><Gavel className="h-3 w-3" /> Decide</Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setPropose(a)}>{a.approvedOpening ? "Revise opening" : "Set opening"}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!q.isLoading && rows.length === 0 && <EmptyRow cols={6}>No agencies.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="agencies" />
      </Panel>
      {propose && <ProposeDialog a={propose} onClose={() => setPropose(null)} />}
      {decide && decide.proposedOpening && <DecideDialog a={decide} o={decide.proposedOpening} onClose={() => setDecide(null)} />}
      {statement && <StatementDialog a={statement} onClose={() => setStatement(null)} />}
    </div>
  );
}

function ProposeDialog({ a, onClose }: { a: Agency; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"agency_owes" | "company_owes" | "">("");
  const [asOf, setAsOf] = useState("");
  const [basis, setBasis] = useState("");
  const ok = /^\d{1,11}(\.\d{1,2})?$/.test(amount.trim()) && direction && asOf && basis.trim().length >= 10;
  return (
    <FormDialog
      open onOpenChange={(v) => { if (!v) onClose(); }} wide title={`Opening balance — ${a.code}`} submitLabel="Propose for approval" successMessage="Proposed; waiting for a second person to approve"
      description="What the agency owed, or was owed, at the end of the date given, from the books of the manual period. A second person approves it before it takes effect; from then on the balance is this figure plus every draw and payment after that date."
      disabled={!ok}
      onSubmit={() => finSend(`/agencies/${a.id}/opening`, { amount: amount.trim(), direction, asOf, basis })}
    >
      <Note>
        Stored on the old screens: <b>{owing(a.stored)}</b>. First balance the system recorded: <b>{a.firstRecorded === null ? "none" : owing(a.firstRecorded)}</b>.
        Draws and payments in this system alone: <b>{owing(a.ledgerFromInception)}</b>. These are for reference - the opening figure must come from the manual records.
      </Note>
      <Field label="Which way is it owed?">
        <div className="grid grid-cols-2 gap-2">
          {([["agency_owes", "The agency owes the company"], ["company_owes", "The company owes the agency"]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setDirection(v)}
              className={cn("rounded-xl border px-3 py-2.5 text-left text-xs font-semibold", direction === v ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>{l}</button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (GH₵)" hint="Without a sign - the choice above says which way."><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <Field label="As at the end of" hint="Draws and payments after this date are added to it."><Input type="date" value={asOf} max={todayAccra()} onChange={(e) => setAsOf(e.target.value)} /></Field>
      </div>
      <Field label="What it rests on"><Textarea value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="e.g. Manual ledger book 3, page 41, balance agreed and signed with the agent on 14 Nov 2026" rows={3} /></Field>
    </FormDialog>
  );
}

function DecideDialog({ a, o, onClose }: { a: Agency; o: Opening; onClose: () => void }) {
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [note, setNote] = useState("");
  return (
    <FormDialog
      open onOpenChange={(v) => { if (!v) onClose(); }} title={`Approve opening balance — ${a.code}`} submitLabel={decision === "approve" ? "Approve" : "Reject"} successMessage={decision === "approve" ? "Approved; the agency's balance now follows the ledger" : "Rejected"}
      description={<>{o.proposed_by_name} proposes: <b>{o.direction === "agency_owes" ? "the agency owes the company" : "the company owes the agency"} {ghs(o.amount)}</b> as at {fmtDate(o.as_of)}.</>}
      disabled={decision === "reject" && note.trim().length < 3}
      onSubmit={() => finSend(`/agency-openings/${o.id}/decide`, { decision, note: note || null })}
    >
      <Note>Rests on: {o.basis}</Note>
      <Note tone="warn">On approval the agency's balance becomes this figure plus every draw and payment after {fmtDate(o.as_of)} - currently stored as {owing(a.stored)}. Both figures are kept in the audit trail.</Note>
      <div className="grid grid-cols-2 gap-2">
        {(["approve", "reject"] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDecision(d)} className={cn("rounded-xl border px-3 py-2 text-xs font-bold capitalize", decision === d ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>{d}</button>
        ))}
      </div>
      <Field label={decision === "reject" ? "Reason (required)" : "Note"}><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
    </FormDialog>
  );
}

export function StatementDialog({ a, onClose }: { a: Pick<Agency, "id" | "code" | "agencyName" | "agentName">; onClose: () => void }) {
  const [from, setFrom] = useState(monthStartAccra());
  const [to, setTo] = useState(todayAccra());
  const q = useQuery({ queryKey: [...FIN_KEY, "statement", a.id, from, to], queryFn: apiGet<Statement>(`/finance/agencies/${a.id}/statement?from=${from}&to=${to}`) });
  const s = q.data;
  const full = { ...a, stored: 0, firstRecorded: null, ledgerFromInception: 0, derived: null, approvedOpening: null, proposedOpening: null, status: "", commission: { earned: 0, earnedClosed: 0, paid: 0, pending: 0, available: 0 } } as Agency;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto thin-scroll">
        <DialogHeader>
          <DialogTitle>Account statement — {a.code}</DialogTitle>
          <DialogDescription>{a.agencyName ?? ""} · {a.agentName}. Every draw and payment, with the running balance.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" /></Field>
          <div className="ml-auto">{s && <ReportActions label="the statement" onPdf={() => exportReportPdf(statementReport(full, s))} onPrint={() => printReport(statementReport(full, s))} />}</div>
        </div>
        {s && !s.confirmed && <Note tone="warn">This agency's opening balance is not yet confirmed, so the statement starts from zero at its first draw.</Note>}
        {s && (
          <ScrollTable maxHeight="28rem" minWidth="60rem">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Wins</TableHead>
                  <TableHead className="text-right">Effect</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/30">
                  <TableCell className="text-xs">{fmtDate(s.from)}</TableCell>
                  <TableCell className="text-xs font-semibold" colSpan={4}>Balance brought forward</TableCell>
                  <TableCell className={cn("text-right font-mono text-xs font-bold", owingCls(s.broughtForward))}>{owing(s.broughtForward)}</TableCell>
                </TableRow>
                {s.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{fmtDate(l.day)}</TableCell>
                    <TableCell className="text-xs">{l.kind === "draw" ? `Draw · ${l.label}` : l.label}{l.ref && <span className="font-mono text-muted-foreground"> {l.ref}</span>}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{l.gross === null ? "" : ghs(l.gross)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{l.wins === null ? "" : ghs(l.wins)}</TableCell>
                    <TableCell className={cn("text-right font-mono text-xs font-bold", l.effect < 0 ? "text-amber-600" : "text-sky-600")}>{l.effect >= 0 ? "+" : "−"}{ghs(Math.abs(l.effect))}</TableCell>
                    <TableCell className={cn("text-right font-mono text-xs font-bold", owingCls(l.balance))}>{owing(l.balance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell />
                  <TableCell className="text-xs font-black" colSpan={4}>Balance carried forward</TableCell>
                  <TableCell className={cn("text-right font-mono text-xs font-black", owingCls(s.carriedForward))}>{owing(s.carriedForward)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </ScrollTable>
        )}
        <p className="text-[11px] text-muted-foreground">A draw adds to what the agency owes when its writers' sales, less commission, wins and reserve, come out positive, and reduces it when they come out negative. Money the agency pays in reduces what it owes; money paid out to it increases it. Generated {fmtDateTime(new Date().toISOString())}.</p>
      </DialogContent>
    </Dialog>
  );
}
