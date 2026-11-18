import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, HandCoins, PiggyBank, Plus, Trophy, Undo2 } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions, StatTile } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, FIN_REFRESH_MS, finGet, finSend, ghs, ghsSigned, fmtDate, fmtDateTime, todayAccra, type MoneyAccount } from "@/lib/finance-api";
import { EmptyRow, Field, FormDialog, Note, isMoney } from "./shared";
import { cn } from "@/lib/utils";

type Bucket = { n: number; amount: number };
type Summary = {
  totalObligations: number;
  byStatus: Record<"unclaimed" | "claimed" | "review" | "paid" | "expired" | "withheld", Bucket>;
  paid: number; expiredReleased: number; outstandingLiability: number; reserveBalance: number; reserveAvailable: number;
  contributions: { received: number; refunded: number; applied: number; held: number };
  shortfall: number;
};
type Win = {
  id: string; amount: string; status: string; payout_status: string; game_name: string; event_number: string; win_date: string; deadline: string;
  claimed_at: string | null; paid_at: string | null; released_at: string | null; ticket_number: string; writer_code: string; writer_name: string; agent_code: string;
};
type Contribution = {
  id: string; entry_type: string; refund_of: string | null; amount: string; contributor_type: string; contributor_name: string; method: string;
  account_name: string; purpose: string; reference: string | null; received_by_name: string; received_at: string; refunded: boolean;
  payout_request_id: string | null; ticket_number: string | null; payout_status: string | null;
};
type WinningsData = { summary: Summary; register: Win[]; contributions: Contribution[] };
type ReserveData = {
  totals: { contributed: number; drawn: number; drawnAuto: number; drawnManual: number; superseded: number; balance: number };
  months: Array<{ period_date: string; total_contributed: string; total_allocated: string; balance: string }>;
  draws: Array<{ id: string; allocation_date: string; amount_drawn: string; reason: string | null; source: string; superseded_at: string | null; superseded_reason: string | null; writer_code: string; writer_name: string; game_name: string | null }>;
  checks: { summaryContributed: number; summaryDrawn: number; contributedAgrees: boolean; drawnAgrees: boolean };
  collectedFromAgencies: number;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  unclaimed: { label: "Unclaimed", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  claimed: { label: "Claimed", cls: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400" },
  review: { label: "Under review", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  paid: { label: "Paid", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  expired: { label: "Expired", cls: "border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  withheld: { label: "Withheld", cls: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400" },
};
const StatusBadge = ({ s }: { s: string }) => (
  <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider", STATUS[s]?.cls)}>{STATUS[s]?.label ?? s}</span>
);

const ALL = "_all";

function registerReport(rows: Win[], s: Summary, filter: string): TableReport {
  return {
    title: filter === "expired" ? "Expired / Unclaimed Winnings" : "Winnings Register",
    fileName: `winnings-${filter === ALL ? "register" : filter}-${todayAccra()}`,
    orientation: "landscape",
    summary: [
      `Total obligations: ${ghs(s.totalObligations)}`,
      `Paid: ${ghs(s.paid)} · Outstanding: ${ghs(s.outstandingLiability)}`,
      `Expired and released to income: ${ghs(s.expiredReleased)}`,
    ],
    sections: [{
      columns: [{ header: "Ticket" }, { header: "Draw" }, { header: "Writer" }, { header: "Won" }, { header: "Claim by" }, { header: "Status" }, { header: "Paid / released" }, { header: "Amount", align: "right" }],
      rows: rows.map((w) => [w.ticket_number, `${w.game_name} #${w.event_number}`, `${w.writer_code} · ${w.writer_name}`, fmtDate(w.win_date), fmtDate(new Date(new Date(w.deadline).getTime() - 1).toISOString()), STATUS[w.status]?.label ?? w.status, w.paid_at ? fmtDate(w.paid_at) : w.released_at ? fmtDate(w.released_at) : "—", ghs(w.amount)]),
      totals: ["Total", "", "", "", "", "", "", ghs(rows.reduce((t, w) => t + Number(w.amount), 0))],
    }],
  };
}

function reserveReport(d: ReserveData): TableReport {
  return {
    title: "Reserve Fund Ledger",
    fileName: `reserve-ledger-${todayAccra()}`,
    orientation: "landscape",
    summary: [`Set aside by draws: ${ghs(d.totals.contributed)}`, `Drawn to cover deficits: ${ghs(d.totals.drawn)}`, `Balance: ${ghsSigned(d.totals.balance)}`, `Superseded duplicate draws (not counted): ${ghs(d.totals.superseded)}`],
    sections: [
      { heading: "By month", columns: [{ header: "Month" }, { header: "Set aside", align: "right" }, { header: "Drawn", align: "right" }, { header: "Net", align: "right" }],
        rows: d.months.map((m) => [new Date(`${m.period_date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }), ghs(m.total_contributed), ghs(m.total_allocated), ghsSigned(m.balance)]),
        totals: ["Total", ghs(d.totals.contributed), ghs(d.totals.drawn), ghsSigned(d.totals.balance)] },
      { heading: "Draws on the reserve", columns: [{ header: "Day" }, { header: "Writer" }, { header: "Draw" }, { header: "Kind" }, { header: "Standing" }, { header: "Amount", align: "right" }],
        rows: d.draws.map((r) => [fmtDate(r.allocation_date), `${r.writer_code} · ${r.writer_name}`, r.game_name ?? "—", r.source === "auto" ? "Automatic" : "Applied by hand", r.superseded_at ? "Superseded - not counted" : "Counts", ghs(r.amount_drawn)]),
        totals: ["Standing draws", "", "", "", "", ghs(d.totals.drawn)] },
      ...(d.draws.some((r) => r.superseded_at) ? [{
        heading: "Superseded draws and why",
        columns: [{ header: "Day" }, { header: "Writer" }, { header: "Reason" }, { header: "Amount", align: "right" as const }],
        rows: d.draws.filter((r) => r.superseded_at).map((r) => [fmtDate(r.allocation_date), r.writer_code, r.superseded_reason ?? "", ghs(r.amount_drawn)]),
      }] : []),
    ],
  };
}

export function WinningsTab({ role }: { role?: string }) {
  const isMgmt = role === "director" || role === "administrator";
  const q = useQuery({ queryKey: [...FIN_KEY, "winnings"], queryFn: finGet<WinningsData>("/winnings"), refetchInterval: FIN_REFRESH_MS });
  const reserve = useQuery({ queryKey: [...FIN_KEY, "reserve"], queryFn: finGet<ReserveData>("/reserve"), enabled: isMgmt });
  const [filter, setFilter] = useState<string>(ALL);
  const [contribOpen, setContribOpen] = useState(false);
  const [refund, setRefund] = useState<Contribution | null>(null);
  const s = q.data?.summary;
  const register = useMemo(() => (q.data?.register ?? []).filter((w) => filter === ALL || w.status === filter), [q.data, filter]);
  const paged = usePaged(register, 20, filter);
  const contribs = usePaged(q.data?.contributions, 15);
  const drawsPaged = usePaged(reserve.data?.draws, 15);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
        <StatTile label="Total obligations" value={s ? ghs(s.totalObligations) : "…"} sub="Every POS win declared" icon={Trophy} />
        <StatTile label="Paid" value={s ? ghs(s.paid) : "…"} sub={s ? `${s.byStatus.paid.n} wins` : ""} tone="in" />
        <StatTile label="Outstanding liability" value={s ? ghs(s.outstandingLiability) : "…"} sub="Unclaimed, claimed or in review" tone="warn" />
        <StatTile label="Reserve available" value={s ? ghsSigned(s.reserveBalance) : "…"} sub="From the reserve ledger" icon={PiggyBank} tone={s && s.reserveBalance < 0 ? "bad" : "default"} />
        <StatTile label="Contributions held" value={s ? ghs(s.contributions.held) : "…"} sub="Cash put up, not yet applied" icon={HandCoins} />
        <StatTile label="Reserve shortfall" value={s ? ghs(s.shortfall) : "…"} sub="Liability the reserve and contributions do not cover" tone={s && s.shortfall > 0 ? "bad" : "in"} icon={AlertTriangle} />
      </div>
      <Note>
        A POS win can be claimed until the end of the 15th day after its draw. Once that passes unclaimed, the win leaves the
        liability and is recorded once as <b>Expired/Unclaimed Winnings Income</b>, with its win date, deadline and release date -
        never counted as owed and as income at the same time, and never mixed into ticket sales.
        {s && s.expiredReleased > 0 && <> Released so far: <b>{ghs(s.expiredReleased)}</b> ({s.byStatus.expired.n} wins).</>}
      </Note>

      <Panel
        title="Winnings register"
        subtitle="Every POS win, where it stands, and when it was paid or released."
        icon={Trophy}
        actions={
          <>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All wins</SelectItem>
                {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}{s ? ` · ${s.byStatus[k as keyof Summary["byStatus"]]?.n ?? 0}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {s && <ReportActions label="the winnings register" onPdf={() => exportReportPdf(registerReport(register, s, filter))} onPrint={() => printReport(registerReport(register, s, filter))} />}
          </>
        }
      >
        <ScrollTable maxHeight="32rem" minWidth="64rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Draw</TableHead>
                <TableHead>Writer</TableHead>
                <TableHead>Won</TableHead>
                <TableHead>Claim by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Paid / released</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-[11px]">{w.ticket_number}</TableCell>
                  <TableCell className="text-xs">{w.game_name} <span className="font-mono text-muted-foreground">#{w.event_number}</span></TableCell>
                  <TableCell className="text-xs">{w.writer_code}<span className="text-muted-foreground"> · {w.writer_name}</span></TableCell>
                  <TableCell className="text-xs">{fmtDate(w.win_date)}</TableCell>
                  <TableCell className="text-xs">{fmtDate(new Date(new Date(w.deadline).getTime() - 1).toISOString())}</TableCell>
                  <TableCell><StatusBadge s={w.status} /></TableCell>
                  <TableCell className="text-xs">{w.paid_at ? fmtDate(w.paid_at) : w.released_at ? `Released ${fmtDate(w.released_at)}` : "—"}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{ghs(w.amount)}</TableCell>
                </TableRow>
              ))}
              {!q.isLoading && register.length === 0 && <EmptyRow cols={8}>No wins in this view.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="wins" />
      </Panel>

      <Panel
        title="Shortfall contributions"
        subtitle="Cash writers or others put up to clear wins the reserve could not cover. Recorded as money received for that purpose - not as income."
        icon={HandCoins}
        actions={<Button size="sm" className="h-8 gap-1.5 text-xs font-bold" onClick={() => setContribOpen(true)}><Plus className="h-3.5 w-3.5" /> Record contribution</Button>}
      >
        <ScrollTable maxHeight="26rem" minWidth="60rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>For ticket</TableHead>
                <TableHead>Method · account</TableHead>
                <TableHead>Received by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {role === "director" && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contribs.rows.map((c) => (
                <TableRow key={c.id} className={c.entry_type === "refund" ? "bg-muted/30" : ""}>
                  <TableCell className="text-xs">{fmtDateTime(c.received_at)}</TableCell>
                  <TableCell className="text-xs">{c.contributor_name}<span className="text-muted-foreground"> · {c.contributor_type}</span></TableCell>
                  <TableCell className="text-xs max-w-[16rem] truncate" title={c.purpose}>{c.entry_type === "refund" ? <b className="text-rose-600">Refund: </b> : null}{c.purpose}</TableCell>
                  <TableCell className="font-mono text-[11px]">{c.ticket_number ?? "—"}{c.payout_status === "paid" && <CheckCircle2 className="inline ml-1 h-3 w-3 text-emerald-600" />}</TableCell>
                  <TableCell className="text-xs">{c.method} · {c.account_name}</TableCell>
                  <TableCell className="text-xs">{c.received_by_name}</TableCell>
                  <TableCell className={`text-right font-mono font-bold ${c.entry_type === "refund" ? "text-orange-600" : "text-emerald-600"}`}>{c.entry_type === "refund" ? "−" : "+"}{ghs(c.amount)}</TableCell>
                  {role === "director" && (
                    <TableCell>
                      {c.entry_type === "contribution" && !c.refunded && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Refund" aria-label="Refund this contribution" onClick={() => setRefund(c)}><Undo2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!q.isLoading && (q.data?.contributions ?? []).length === 0 && <EmptyRow cols={role === "director" ? 8 : 7}>No contributions recorded.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={contribs.page} totalPages={contribs.totalPages} onPage={contribs.setPage} total={contribs.total} size={contribs.size} noun="entries" />
      </Panel>

      {isMgmt && reserve.data && <ReservePanel d={reserve.data} paged={drawsPaged} />}

      <ContributionDialog open={contribOpen} onOpenChange={setContribOpen} role={role} wins={(q.data?.register ?? []).filter((w) => ["unclaimed", "claimed", "review"].includes(w.status))} />
      {refund && <RefundDialog c={refund} onClose={() => setRefund(null)} />}
    </div>
  );
}

function ReservePanel({ d, paged }: { d: ReserveData; paged: ReturnType<typeof usePaged<ReserveData["draws"][number]>> }) {
  const agrees = d.checks.contributedAgrees && d.checks.drawnAgrees;
  return (
    <Panel
      title="Reserve ledger"
      subtitle="Set aside by every calculated draw, less every draw on it still standing. The month-by-month summary is rebuilt from these two records, never kept separately."
      icon={PiggyBank}
      actions={<ReportActions label="the reserve ledger" onPdf={() => exportReportPdf(reserveReport(d))} onPrint={() => printReport(reserveReport(d))} />}
    >
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-border">
        {[
          ["Set aside by draws", ghs(d.totals.contributed)],
          ["Drawn automatically", ghs(d.totals.drawnAuto)],
          ["Applied by hand", ghs(d.totals.drawnManual)],
          ["Balance", ghsSigned(d.totals.balance)],
          ["Collected from agencies", ghs(d.collectedFromAgencies)],
        ].map(([l, v]) => (
          <div key={l} className="bg-card p-4"><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{l}</div><div className="mt-1 font-mono text-lg font-black">{v}</div></div>
        ))}
      </div>
      <div className="px-5 py-3 border-t space-y-2">
        <Note tone={agrees ? "ok" : "bad"}>
          {agrees
            ? <>The reserve summary agrees with the ledger to the pesewa: {ghs(d.checks.summaryContributed)} set aside, {ghs(d.checks.summaryDrawn)} drawn.</>
            : <>The reserve summary does not agree with the ledger (summary {ghs(d.checks.summaryContributed)} / {ghs(d.checks.summaryDrawn)}; ledger {ghs(d.totals.contributed)} / {ghs(d.totals.drawn)}). Investigate before relying on the balance.</>}
        </Note>
        {d.totals.superseded > 0 && <Note tone="warn">{ghs(d.totals.superseded)} of draws are superseded - a draw calculated more than once drew again for the same deficit. They stay on record below and are not counted.</Note>}
        {d.totals.balance < 0 && <Note tone="bad">More has been drawn from the reserve than the draws have set aside. The difference, {ghs(-d.totals.balance)}, was covered by money that was never in the reserve.</Note>}
      </div>
      <ScrollTable maxHeight="26rem" minWidth="56rem">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Writer</TableHead>
              <TableHead>Draw</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Standing</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.rows.map((r) => (
              <TableRow key={r.id} className={r.superseded_at ? "opacity-60" : ""}>
                <TableCell className="text-xs">{fmtDate(r.allocation_date)}</TableCell>
                <TableCell className="text-xs">{r.writer_code}<span className="text-muted-foreground"> · {r.writer_name}</span></TableCell>
                <TableCell className="text-xs">{r.game_name ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.source === "auto" ? "Automatic" : "Applied by hand"}</TableCell>
                <TableCell className="text-xs max-w-[18rem] truncate" title={r.superseded_reason ?? ""}>{r.superseded_at ? <span className="font-semibold text-rose-600">Superseded</span> : "Counts"}</TableCell>
                <TableCell className={`text-right font-mono font-bold ${r.superseded_at ? "line-through" : ""}`}>{ghs(r.amount_drawn)}</TableCell>
              </TableRow>
            ))}
            {d.draws.length === 0 && <EmptyRow cols={6}>No draws on the reserve yet.</EmptyRow>}
          </TableBody>
        </Table>
      </ScrollTable>
      <Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="draws" />
    </Panel>
  );
}

function ContributionDialog({ open, onOpenChange, role, wins }: { open: boolean; onOpenChange: (v: boolean) => void; role?: string; wins: Win[] }) {
  const accounts = useQuery({ queryKey: [...FIN_KEY, "accounts"], queryFn: finGet<MoneyAccount[]>("/accounts"), enabled: open });
  const usable = (accounts.data ?? []).filter((a) => a.isActive && (role !== "cashier" || a.code === "CASH"));
  const [amount, setAmount] = useState("");
  const [contributorType, setType] = useState("writer");
  const [contributorName, setName] = useState("");
  const [method, setMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [payoutRequestId, setPayout] = useState("_none");
  const [reference, setReference] = useState("");
  const account = accountId || usable.find((a) => a.code === "CASH")?.id || "";
  const ok = isMoney(amount) && contributorName.trim().length >= 2 && purpose.trim().length >= 5 && account;
  return (
    <FormDialog
      open={open} onOpenChange={onOpenChange} title="Record a shortfall contribution" submitLabel="Record" successMessage="Contribution recorded" wide
      description="Money handed in towards wins the reserve could not cover. It is booked into the cash book as a contribution, not as income."
      disabled={!ok}
      onSubmit={() => finSend("/winnings/contributions", {
        amount, contributorType, contributorName, method, accountId: account, purpose,
        payoutRequestId: payoutRequestId === "_none" ? null : payoutRequestId, reference: reference || null,
      })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (GH₵)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Who is paying">
          <Select value={contributorType} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["writer", "agent", "staff", "director", "other"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Name" className="col-span-2"><Input value={contributorName} onChange={(e) => setName(e.target.value)} placeholder="e.g. VS-AB-BN · Kofi Mensah" /></Field>
        <Field label="Method">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["cash", "momo", "bank", "transfer"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Into account">
          <Select value={account} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>{usable.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Towards a winning ticket (optional)" className="col-span-2">
          <Select value={payoutRequestId} onValueChange={setPayout}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">Not for a particular ticket</SelectItem>
              {wins.slice(0, 200).map((w) => <SelectItem key={w.id} value={w.id}>{w.ticket_number} · {w.writer_code} · {ghs(w.amount)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt or MoMo ref" /></Field>
        <Field label="Date"><Input value={fmtDate(todayAccra())} disabled /></Field>
      </div>
      <Field label="Purpose"><Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Towards the 16 Nov deficit on VS-AB-BN's sales" rows={2} /></Field>
    </FormDialog>
  );
}

function RefundDialog({ c, onClose }: { c: Contribution; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <FormDialog open onOpenChange={(v) => { if (!v) onClose(); }} title="Refund contribution" submitLabel="Refund" successMessage="Refund recorded"
      description={<>Returns {ghs(c.amount)} to {c.contributor_name}. Recorded as a second entry; the original stays.</>}
      disabled={reason.trim().length < 5}
      onSubmit={() => finSend(`/winnings/contributions/${c.id}/refund`, { reason })}>
      <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
    </FormDialog>
  );
}
