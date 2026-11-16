import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Lock, Plus } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, finGet, finSend, ghs, ghsSigned, fmtDateTime, todayAccra, type Fund } from "@/lib/finance-api";
import { EmptyRow, Field, FormDialog, Note, isMoney } from "./shared";

type Movement = { id: string; fund_code: string; entry_type: string; delta: string; reason: string; reference: string | null; source_type: string | null; occurred_at: string; authorised_by_name: string | null };
type FundsData = { funds: Fund[]; movements: Movement[] };

function fundsReport(d: FundsData): TableReport {
  const names = new Map(d.funds.map((f) => [f.code, f.name]));
  return {
    title: "Funds and Allocations",
    fileName: `funds-${todayAccra()}`,
    summary: d.funds.map((f) => `${f.name}: ${ghsSigned(f.balance)}`),
    sections: [
      { heading: "Funds", columns: [{ header: "Fund" }, { header: "Allocated", align: "right" }, { header: "Used / released", align: "right" }, { header: "Balance", align: "right" }],
        rows: d.funds.map((f) => [f.name, ghs(f.allocated), ghs(f.used), ghsSigned(f.balance)]) },
      { heading: "Movements", columns: [{ header: "When" }, { header: "Fund" }, { header: "Type" }, { header: "Reason" }, { header: "Authorised by" }, { header: "Amount", align: "right" }],
        rows: d.movements.map((m) => [fmtDateTime(m.occurred_at), names.get(m.fund_code) ?? m.fund_code, m.entry_type, m.reason, m.authorised_by_name ?? "—", ghsSigned(m.delta)]) },
    ],
  };
}

export function FundsTab({ role }: { role?: string }) {
  const isDirector = role === "director";
  const q = useQuery({ queryKey: [...FIN_KEY, "funds"], queryFn: finGet<FundsData>("/funds") });
  const [createOpen, setCreateOpen] = useState(false);
  const [moveFund, setMoveFund] = useState<{ fund: Fund; type: "allocate" | "release" } | null>(null);
  const names = new Map((q.data?.funds ?? []).map((f) => [f.code, f.name]));
  const paged = usePaged(q.data?.movements, 20);

  return (
    <div className="space-y-5">
      <Note>
        A fund is money set aside inside the company's accounts - it is never extra money. Allocating GH₵20,000 to salaries out of
        GH₵50,000 in the bank leaves GH₵50,000 in the bank, GH₵20,000 of it promised to salaries and GH₵30,000 free.
      </Note>
      <Panel
        title="Funds"
        subtitle="The Salary Provision Fund is allocated and spent from Staff Payroll; the Reserve comes from the draw calculations. Other funds are set here by the director."
        icon={Lock}
        actions={
          <>
            {isDirector && <Button size="sm" className="h-8 gap-1.5 text-xs font-bold" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> New fund</Button>}
            {q.data && <ReportActions label="the funds" onPdf={() => exportReportPdf(fundsReport(q.data!))} onPrint={() => printReport(fundsReport(q.data!))} />}
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
          {(q.data?.funds ?? []).map((f) => (
            <div key={f.code} className="rounded-2xl border p-4 bg-background flex flex-col">
              <div className="font-bold">{f.name}</div>
              {f.description && <div className="text-[11px] text-muted-foreground mt-0.5">{f.description}</div>}
              <div className={`mt-3 text-2xl font-black font-mono ${f.balance < 0 ? "text-rose-600" : ""}`}>{ghsSigned(f.balance)}</div>
              <div className="text-[11px] text-muted-foreground">Allocated {ghs(f.allocated)} · used or released {ghs(f.used)}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {f.code === "SALARY" && <Link href="/staffs-employees" className="text-xs font-bold text-primary hover:underline">Allocate from Staff Payroll →</Link>}
                {f.code === "RESERVE" && <Link href="/reserve" className="text-xs font-bold text-primary hover:underline">Open the Reserve Fund →</Link>}
                {!f.isSystem && isDirector && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMoveFund({ fund: f, type: "allocate" })}>Allocate</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={f.balance <= 0} onClick={() => setMoveFund({ fund: f, type: "release" })}>Release</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Fund movements" subtitle="Every allocation, release and draw on a fund, with who authorised it." icon={Lock}>
        <ScrollTable maxHeight="30rem" minWidth="48rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Fund</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Authorised by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{fmtDateTime(m.occurred_at)}</TableCell>
                  <TableCell className="text-xs font-semibold">{names.get(m.fund_code) ?? m.fund_code}</TableCell>
                  <TableCell className="text-xs capitalize">{m.entry_type}</TableCell>
                  <TableCell className="text-xs max-w-[20rem] truncate" title={m.reason}>{m.reason}</TableCell>
                  <TableCell className="text-xs">{m.authorised_by_name ?? "—"}</TableCell>
                  <TableCell className={`text-right font-mono font-bold ${Number(m.delta) < 0 ? "text-orange-600" : "text-emerald-600"}`}>{ghsSigned(m.delta)}</TableCell>
                </TableRow>
              ))}
              {!q.isLoading && (q.data?.movements ?? []).length === 0 && <EmptyRow cols={6}>No movements yet.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="movements" />
      </Panel>

      {isDirector && <CreateFundDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {moveFund && <MoveDialog fund={moveFund.fund} type={moveFund.type} onClose={() => setMoveFund(null)} />}
    </div>
  );
}

function CreateFundDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New fund" submitLabel="Create fund" successMessage="Fund created" disabled={name.trim().length < 3}
      onSubmit={() => finSend("/funds", { name, description: description || null })}>
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office rent" /></Field>
      <Field label="What it is for"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
    </FormDialog>
  );
}

function MoveDialog({ fund, type, onClose }: { fund: Fund; type: "allocate" | "release"; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  return (
    <FormDialog
      open onOpenChange={(v) => { if (!v) onClose(); }}
      title={type === "allocate" ? `Allocate to ${fund.name}` : `Release from ${fund.name}`}
      submitLabel={type === "allocate" ? "Allocate" : "Release"} successMessage={type === "allocate" ? "Allocated" : "Released"}
      description={type === "allocate" ? "Sets aside money the company already holds. Refused if it would set aside more than is unallocated." : `Returns money to general use. The fund holds ${ghsSigned(fund.balance)}.`}
      disabled={!isMoney(amount) || reason.trim().length < 5}
      onSubmit={() => finSend(`/funds/${fund.code}/movements`, { entryType: type, amount, reason, reference: reference || null })}
    >
      <Field label="Amount (GH₵)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
      <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
      <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
    </FormDialog>
  );
}
