import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ClipboardCheck, Plus } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, finGet, finSend, ghsSigned, fmtDate, fmtDateTime, todayAccra, type MoneyAccount } from "@/lib/finance-api";
import { EmptyRow, Field, FormDialog } from "./shared";

type Check = {
  id: string; account_name: string; account_code: string; as_of: string; statement_balance: string; book_balance: string;
  difference: string; source: string; note: string | null; entered_by_name: string | null;
};

function checksReport(rows: Check[]): TableReport {
  return {
    title: "Balance Checks",
    fileName: `balance-checks-${todayAccra()}`,
    summary: [`${rows.length} counts and statements recorded against the books`, `${rows.filter((r) => Math.abs(Number(r.difference)) >= 0.005).length} with a difference`],
    sections: [{
      columns: [{ header: "When" }, { header: "Account" }, { header: "Counted / statement", align: "right" }, { header: "Book", align: "right" }, { header: "Difference", align: "right" }, { header: "By" }, { header: "Note" }],
      rows: rows.map((r) => [fmtDateTime(r.as_of), r.account_name, ghsSigned(r.statement_balance), ghsSigned(r.book_balance), ghsSigned(r.difference), r.entered_by_name ?? "—", r.note ?? ""]),
    }],
  };
}

export function AccountsTab({ role }: { role?: string }) {
  const isDirector = role === "director";
  const accounts = useQuery({ queryKey: [...FIN_KEY, "accounts"], queryFn: finGet<MoneyAccount[]>("/accounts") });
  const checks = useQuery({ queryKey: [...FIN_KEY, "checks"], queryFn: finGet<Check[]>("/balance-checks") });
  const [addOpen, setAddOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const paged = usePaged(checks.data, 15);

  return (
    <div className="space-y-5">
      <Panel
        title="Money accounts"
        subtitle="The places the company's money actually sits. Cash on hand and the Paystack balance are built in; add each bank account so its money is counted."
        icon={Building2}
        actions={
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-bold" onClick={() => setCheckOpen(true)}><ClipboardCheck className="h-3.5 w-3.5" /> {role === "cashier" ? "Record cash count" : "Record a balance"}</Button>
            {isDirector && <Button size="sm" className="h-8 gap-1.5 text-xs font-bold" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add account</Button>}
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
          {(accounts.data ?? []).map((a) => (
            <div key={a.id} className={`rounded-2xl border p-4 ${a.isActive ? "bg-background" : "bg-muted/40 opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold truncate">{a.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{[a.institution, a.accountRef].filter(Boolean).join(" · ") || (a.isSystem ? "Built in" : a.code)}</div>
                </div>
                <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{a.kind}</span>
              </div>
              <div className={`mt-3 text-2xl font-black font-mono ${a.balance < 0 ? "text-rose-600" : ""}`}>{ghsSigned(a.balance)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {a.openingBalance !== 0 ? <>Opened at {ghsSigned(a.openingBalance)} on {fmtDate(a.openingDate)} · </> : null}{a.entries} entries
              </div>
              {a.balance < 0 && <div className="mt-2 text-[11px] font-semibold text-rose-600">Below zero on the books: money left this account that was never recorded coming in.</div>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Balance checks"
        subtitle="Cash counted in the till and bank statement balances, set against the books on the day they were taken. A difference stays on record."
        icon={ClipboardCheck}
        actions={checks.data && checks.data.length > 0 && <ReportActions label="the balance checks" onPdf={() => exportReportPdf(checksReport(checks.data!))} onPrint={() => printReport(checksReport(checks.data!))} />}
      >
        <ScrollTable maxHeight="28rem" minWidth="52rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Counted / statement</TableHead>
                <TableHead className="text-right">Book</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((c) => {
                const d = Number(c.difference);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs">{fmtDateTime(c.as_of)}</TableCell>
                    <TableCell className="text-xs font-semibold">{c.account_name}</TableCell>
                    <TableCell className="text-right font-mono">{ghsSigned(c.statement_balance)}</TableCell>
                    <TableCell className="text-right font-mono">{ghsSigned(c.book_balance)}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${Math.abs(d) < 0.005 ? "text-emerald-600" : "text-rose-600"}`}>{Math.abs(d) < 0.005 ? "Agrees" : ghsSigned(d)}</TableCell>
                    <TableCell className="text-xs">{c.entered_by_name ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-[16rem] truncate" title={c.note ?? ""}>{c.note ?? ""}</TableCell>
                  </TableRow>
                );
              })}
              {!checks.isLoading && (checks.data ?? []).length === 0 && <EmptyRow cols={7}>No counts or statements recorded yet.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="checks" />
      </Panel>

      {isDirector && <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} />}
      <CheckDialog open={checkOpen} onOpenChange={setCheckOpen} accounts={(accounts.data ?? []).filter((a) => a.isActive && (role !== "cashier" || a.code === "CASH"))} />
    </div>
  );
}

function AddAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("bank");
  const [institution, setInstitution] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingDate, setOpeningDate] = useState(todayAccra());
  const [notes, setNotes] = useState("");
  const opening = openingBalance.trim() === "" ? "0" : openingBalance.trim();
  const ok = name.trim().length >= 2 && /^-?\d{1,11}(\.\d{1,2})?$/.test(opening);
  return (
    <FormDialog
      open={open} onOpenChange={onOpenChange} title="Add a money account" submitLabel="Add account" successMessage="Account added"
      description="Its opening balance is what the account held on the opening date, from the bank statement. Everything after that comes from the cash book."
      disabled={!ok}
      onSubmit={() => finSend("/accounts", { name, kind, institution: institution || null, accountRef: accountRef || null, openingBalance: opening, openingDate: Number(opening) !== 0 ? openingDate : null, notes: notes || null })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GCB operating account" /></Field>
        <Field label="Type">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bank">Bank account</SelectItem>
              <SelectItem value="momo">MoMo merchant wallet</SelectItem>
              <SelectItem value="cash">Cash (safe, petty cash)</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Bank or provider"><Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. GCB Bank" /></Field>
        <Field label="Account number (last digits)" hint="Store only the last four digits."><Input value={accountRef} onChange={(e) => setAccountRef(e.target.value)} placeholder="****1234" /></Field>
        <Field label="Opening balance (GH₵)"><Input inputMode="decimal" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Opening balance date" className="col-span-2"><Input type="date" value={openingDate} max={todayAccra()} onChange={(e) => setOpeningDate(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
    </FormDialog>
  );
}

function CheckDialog({ open, onOpenChange, accounts }: { open: boolean; onOpenChange: (v: boolean) => void; accounts: MoneyAccount[] }) {
  const [accountId, setAccountId] = useState("");
  const [statementBalance, setStatementBalance] = useState("");
  const [note, setNote] = useState("");
  const acc = accounts.find((a) => a.id === accountId);
  const ok = accountId && /^-?\d{1,11}(\.\d{1,2})?$/.test(statementBalance.trim());
  return (
    <FormDialog
      open={open} onOpenChange={onOpenChange} title="Record an actual balance" submitLabel="Record" successMessage="Balance recorded against the books"
      description="Count the cash, or read the closing balance off the bank statement. The books' figure is captured alongside it, so any difference is fixed on record."
      disabled={!ok}
      onSubmit={() => finSend("/balance-checks", { accountId, statementBalance: statementBalance.trim(), note: note || null })}
    >
      <Field label="Account" hint={acc ? `The books say ${ghsSigned(acc.balance)} right now.` : undefined}>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
          <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Counted / statement balance (GH₵)"><Input inputMode="decimal" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} placeholder="0.00" /></Field>
      <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. End-of-day count, or statement date" rows={2} /></Field>
      {acc && /^-?\d+(\.\d{1,2})?$/.test(statementBalance.trim()) && (
        <p className="text-xs font-semibold">Difference: {ghsSigned(Number(statementBalance) - acc.balance)}</p>
      )}
    </FormDialog>
  );
}

