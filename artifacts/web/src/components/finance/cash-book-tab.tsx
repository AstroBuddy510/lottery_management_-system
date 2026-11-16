import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, BookOpen, Plus, Undo2 } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions, DirectionBadge, SignedAmount, StatTile } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import {
  FIN_KEY, FIN_REFRESH_MS, finGet, finSend, ghs, ghsSigned, fmtDate, fmtDateTime, todayAccra, monthStartAccra,
  categoryLabel, CATEGORY_LABEL, type CashBookRow, type MoneyAccount,
} from "@/lib/finance-api";
import { EmptyRow, Field, FormDialog, Note, isMoney } from "./shared";

type CashBook = { rows: CashBookRow[]; totals: { opening: number; in: number; out: number; closing: number | null }; truncated: boolean };

const MANUAL = [
  ["owner_capital", "Capital introduced by the director (in)"],
  ["loan_received", "Loan received (in)"],
  ["other_income", "Other income (in)"],
  ["director_withdrawal", "Director withdrawal (out)"],
  ["loan_repayment", "Loan repayment (out)"],
  ["bank_charge", "Bank charge (out)"],
  ["other_expense", "Other expense (out)"],
] as const;

const ALL = "_all";

export function cashBookReport(data: CashBook, from: string, to: string, accountName: string): TableReport {
  return {
    title: "Cash Book",
    fileName: `cash-book-${from}-to-${to}`,
    orientation: "landscape",
    summary: [
      `Account: ${accountName}`,
      `Opening balance: ${ghsSigned(data.totals.opening)}`,
      `Received: ${ghs(data.totals.in)} · Paid: ${ghs(data.totals.out)}`,
      data.totals.closing === null ? "Closing balance: not shown for a filtered list" : `Closing balance: ${ghsSigned(data.totals.closing)}`,
    ],
    meta: [{ label: "Period", value: `${fmtDate(from)} – ${fmtDate(to)}` }],
    sections: [{
      columns: [{ header: "Date" }, { header: "Account" }, { header: "Category" }, { header: "Party" }, { header: "Reference" }, { header: "Method" }, { header: "In", align: "right" }, { header: "Out", align: "right" }],
      rows: [...data.rows].reverse().map((r) => [
        fmtDateTime(r.occurred_at), r.account_name, categoryLabel(r.category) + (r.reverses_id ? " (reversal)" : ""), r.party_label ?? "—",
        r.reference ?? "—", r.method, r.direction === "in" ? ghs(r.amount) : "", r.direction === "out" ? ghs(r.amount) : "",
      ]),
      totals: ["Totals", "", "", "", "", "", ghs(data.totals.in), ghs(data.totals.out)],
      empty: "No receipts or payments in this period.",
    }],
  };
}

export function CashBookTab({ role }: { role?: string }) {
  const canManage = role === "director" || role === "administrator";
  const isDirector = role === "director";
  const [from, setFrom] = useState(monthStartAccra());
  const [to, setTo] = useState(todayAccra());
  const [account, setAccount] = useState(ALL);
  const [direction, setDirection] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [manualOpen, setManualOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [reverseRow, setReverseRow] = useState<CashBookRow | null>(null);

  const accounts = useQuery({ queryKey: [...FIN_KEY, "accounts"], queryFn: finGet<MoneyAccount[]>("/accounts") });
  const qs = new URLSearchParams({ from, to });
  if (account !== ALL) qs.set("account", account);
  if (direction !== ALL) qs.set("direction", direction);
  if (category !== ALL) qs.set("category", category);
  const book = useQuery({ queryKey: [...FIN_KEY, "cash-book", qs.toString()], queryFn: finGet<CashBook>(`/cash-book?${qs}`), refetchInterval: FIN_REFRESH_MS });
  const rows = book.data?.rows ?? [];
  const paged = usePaged(rows, 25, qs.toString());
  const accountName = account === ALL ? "All accounts" : accounts.data?.find((a) => a.id === account)?.name ?? "—";
  const categories = useMemo(() => Object.keys(CATEGORY_LABEL), []);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile label="Opening balance" value={book.data ? ghsSigned(book.data.totals.opening) : "…"} sub={`at ${fmtDate(from)}`} icon={BookOpen} />
        <StatTile label="Received" value={book.data ? ghs(book.data.totals.in) : "…"} sub={`${rows.filter((r) => r.direction === "in").length} receipts`} tone="in" />
        <StatTile label="Paid out" value={book.data ? ghs(book.data.totals.out) : "…"} sub={`${rows.filter((r) => r.direction === "out").length} payments`} tone="out" />
        <StatTile label="Closing balance" value={!book.data ? "…" : book.data.totals.closing === null ? "—" : ghsSigned(book.data.totals.closing)} sub={book.data?.totals.closing === null ? "Clear the filters to see it" : `at ${fmtDate(to)}`} tone="default" />
      </div>

      <Panel
        title="Cash book"
        subtitle="Every receipt and payment, generated from the record that caused it. Nothing here is typed twice: a unit purchase, a settlement, an expense or a payout books itself."
        icon={BookOpen}
        actions={
          <>
            {canManage && <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-bold" onClick={() => setTransferOpen(true)}><ArrowRightLeft className="h-3.5 w-3.5" /> Transfer</Button>}
            {canManage && <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-bold" onClick={() => setManualOpen(true)}><Plus className="h-3.5 w-3.5" /> Other entry</Button>}
            {book.data && <ReportActions label="the cash book" onPdf={() => exportReportPdf(cashBookReport(book.data!, from, to, accountName))} onPrint={() => printReport(cashBookReport(book.data!, from, to, accountName))} />}
          </>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 border-b px-5 py-3">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" /></Field>
          <Field label="Account">
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All accounts</SelectItem>
                {(accounts.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Direction">
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>In and out</SelectItem>
                <SelectItem value="in">Received</SelectItem>
                <SelectItem value="out">Paid out</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {book.data?.truncated && <Note tone="warn" className="m-5">Showing the latest 5,000 entries. Narrow the dates to see the rest.</Note>}
        <ScrollTable maxHeight="34rem" minWidth="64rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Account · method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Handled by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {isDirector && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((r) => (
                <TableRow key={r.id} className={r.reverses_id ? "bg-muted/30" : ""}>
                  <TableCell className="text-xs">{fmtDateTime(r.occurred_at)}</TableCell>
                  <TableCell><DirectionBadge direction={r.direction} /></TableCell>
                  <TableCell>
                    <div className="text-xs font-semibold">{categoryLabel(r.category)}{r.reverses_id && <span className="ml-1 text-[10px] font-bold uppercase text-rose-600">reversal</span>}</div>
                    {r.memo && <div className="max-w-[18rem] truncate text-[11px] text-muted-foreground" title={r.memo}>{r.memo}</div>}
                  </TableCell>
                  <TableCell className="text-xs">{r.party_label ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.account_name}<span className="text-muted-foreground"> · {r.method}</span></TableCell>
                  <TableCell className="font-mono text-[11px]">{r.reference ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.handled_by_name ?? "System"}</TableCell>
                  <TableCell className="text-right"><SignedAmount direction={r.direction}>{ghs(r.amount).replace("GH₵ ", "GH₵")}</SignedAmount></TableCell>
                  {isDirector && (
                    <TableCell>
                      {(r.source_type === "manual" || r.source_type === "transfer") && !r.reverses_id && !r.leg.startsWith("rev") && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Reverse this entry" aria-label="Reverse this entry" onClick={() => setReverseRow(r)}><Undo2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!book.isLoading && rows.length === 0 && <EmptyRow cols={isDirector ? 9 : 8}>No receipts or payments in this period.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="entries" />
      </Panel>

      {canManage && <ManualEntryDialog open={manualOpen} onOpenChange={setManualOpen} accounts={accounts.data ?? []} />}
      {canManage && <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} accounts={accounts.data ?? []} />}
      {reverseRow && <ReverseDialog row={reverseRow} onClose={() => setReverseRow(null)} />}
    </div>
  );
}

function ManualEntryDialog({ open, onOpenChange, accounts }: { open: boolean; onOpenChange: (v: boolean) => void; accounts: MoneyAccount[] }) {
  const [category, setCategory] = useState<string>("owner_capital");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayAccra());
  const [method, setMethod] = useState("bank");
  const [reference, setReference] = useState("");
  const [partyLabel, setPartyLabel] = useState("");
  const [memo, setMemo] = useState("");
  const ok = accountId && isMoney(amount) && memo.trim().length >= 5;
  return (
    <FormDialog
      open={open} onOpenChange={onOpenChange} title="Record other money" submitLabel="Record entry" successMessage="Entry recorded in the cash book"
      description="For money no other screen records - capital, a loan, a bank charge. Sales, settlements, expenses, salaries and payouts book themselves and cannot be entered here."
      disabled={!ok}
      onSubmit={() => finSend("/cash-book/manual", { category, accountId, amount, occurredOn, method, reference: reference || null, partyLabel: partyLabel || null, memo })}
    >
      <Field label="What is it?">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{MANUAL.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account">
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>{accounts.filter((a) => a.isActive).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Amount (GH₵)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Date"><Input type="date" value={occurredOn} max={todayAccra()} onChange={(e) => setOccurredOn(e.target.value)} /></Field>
        <Field label="Method">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["cash", "bank", "momo", "cheque", "transfer"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Slip or statement ref" /></Field>
        <Field label="From / to"><Input value={partyLabel} onChange={(e) => setPartyLabel(e.target.value)} placeholder="Who paid or was paid" /></Field>
      </div>
      <Field label="Description"><Textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What this money was, in a sentence" rows={2} /></Field>
    </FormDialog>
  );
}

function TransferDialog({ open, onOpenChange, accounts }: { open: boolean; onOpenChange: (v: boolean) => void; accounts: MoneyAccount[] }) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayAccra());
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  const from = accounts.find((a) => a.id === fromId);
  const ok = fromId && toId && fromId !== toId && isMoney(amount) && memo.trim().length >= 5;
  return (
    <FormDialog
      open={open} onOpenChange={onOpenChange} title="Move money between accounts" submitLabel="Record transfer" successMessage="Transfer recorded"
      description="Banking the day's cash, topping up Paystack from the bank. One account goes down and the other up by the same amount; the company is no richer or poorer."
      disabled={!ok}
      onSubmit={() => finSend("/cash-book/transfer", { fromAccountId: fromId, toAccountId: toId, amount, occurredOn, reference: reference || null, memo })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" hint={from ? `Holds ${ghsSigned(from.balance)}` : undefined}>
          <Select value={fromId} onValueChange={setFromId}>
            <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>{accounts.filter((a) => a.isActive).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="To">
          <Select value={toId} onValueChange={setToId}>
            <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>{accounts.filter((a) => a.isActive && a.id !== fromId).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Amount (GH₵)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Date"><Input type="date" value={occurredOn} max={todayAccra()} onChange={(e) => setOccurredOn(e.target.value)} /></Field>
      </div>
      <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Deposit slip or transfer ref" /></Field>
      <Field label="Description"><Textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Banked Monday's takings" rows={2} /></Field>
    </FormDialog>
  );
}

function ReverseDialog({ row, onClose }: { row: CashBookRow; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      open onOpenChange={(v) => { if (!v) onClose(); }} title="Reverse this entry" submitLabel="Reverse" successMessage="Entry reversed"
      description={<>An equal and opposite entry is added; the original stays on the books. {categoryLabel(row.category)} of {ghs(row.amount)} on {fmtDate(row.occurred_at)}.</>}
      disabled={reason.trim().length < 5}
      onSubmit={() => finSend(`/cash-book/${row.id}/reverse`, { reason })}
    >
      <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it is being reversed" rows={2} /></Field>
    </FormDialog>
  );
}
