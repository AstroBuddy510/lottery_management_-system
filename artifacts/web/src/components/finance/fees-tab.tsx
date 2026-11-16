import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Percent, RefreshCw } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions, StatTile } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, finGet, finSend, ghs, fmtDate, fmtDateTime, monthStartAccra, todayAccra, errorText } from "@/lib/finance-api";
import { EmptyRow, Field, FormDialog, Note } from "./shared";

type FeeRow = { id: string; reference: string; kind: string; source_type: string; gross: string; fee: string | null; captured_from: string; occurred_at: string; note: string | null; fee_set_by_name: string | null };
type Fees = { rows: FeeRow[]; totals: { count: number; gross: number; fees: number; unknown: number; collectionFees: number; transferFees: number } };

const SOURCE: Record<string, string> = { unit_purchase: "Unit purchase", agency_payment: "Agency payment", postpaid_ledger: "Postpaid settlement", payout_request: "POS win payout", commission_payout: "Commission payout" };

function feesReport(d: Fees, from: string, to: string): TableReport {
  return {
    title: "Payment Processing Fees",
    fileName: `paystack-fees-${from}-to-${to}`,
    summary: [`Fees charged: ${ghs(d.totals.fees)}`, `On collections: ${ghs(d.totals.collectionFees)} · on transfers: ${ghs(d.totals.transferFees)}`, `${d.totals.unknown} reference(s) still waiting for a figure`],
    meta: [{ label: "Period", value: `${fmtDate(from)} – ${fmtDate(to)}` }],
    sections: [{
      columns: [{ header: "Date" }, { header: "Reference" }, { header: "For" }, { header: "Gross", align: "right" }, { header: "Fee", align: "right" }, { header: "Net", align: "right" }, { header: "Source of figure" }],
      rows: d.rows.map((r) => [fmtDateTime(r.occurred_at), r.reference, SOURCE[r.source_type] ?? r.source_type, ghs(r.gross), r.fee === null ? "awaiting" : ghs(r.fee), r.fee === null ? "—" : ghs(Number(r.gross) - Number(r.fee)), r.captured_from]),
      totals: ["Totals", "", "", ghs(d.totals.gross), ghs(d.totals.fees), "", ""],
    }],
  };
}

export function FeesTab() {
  const [from, setFrom] = useState(monthStartAccra());
  const [to, setTo] = useState(todayAccra());
  const [setRow, setSetRow] = useState<FeeRow | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: [...FIN_KEY, "fees", from, to], queryFn: finGet<Fees>(`/fees?from=${from}&to=${to}`) });
  const sync = useMutation({
    mutationFn: () => finSend<{ checked: number; captured: number; stillUnknown: number; paystack: boolean }>("/fees/sync", {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: FIN_KEY });
      toast({ title: r.paystack ? `Asked Paystack about ${r.checked} reference(s); ${r.captured} fee(s) captured` : "Paystack is not configured here; references registered for manual figures" });
    },
    onError: (e) => toast({ title: errorText(e, "Sync failed"), variant: "destructive" }),
  });
  const paged = usePaged(q.data?.rows, 20, `${from}${to}`);
  const t = q.data?.totals;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile label="Fees charged" value={t ? ghs(t.fees) : "…"} sub="Booked as Payment Processing Fees" icon={Percent} tone="out" />
        <StatTile label="On collections" value={t ? ghs(t.collectionFees) : "…"} sub="MoMo unit purchases and settlements" />
        <StatTile label="On transfers" value={t ? ghs(t.transferFees) : "…"} sub="Win payouts and other transfers" />
        <StatTile label="Awaiting a figure" value={t ? String(t.unknown) : "…"} sub="Paystack did not report the fee" tone={t && t.unknown > 0 ? "warn" : "in"} />
      </div>
      <Note>
        Every fee here is the figure Paystack itself reported for that reference - never a percentage worked out here. Where Paystack
        did not say, the reference waits for the figure from the settlement report. Each reference is booked once, however many times
        it is synced or its webhook repeats.
      </Note>
      <Panel
        title="Payment processing fees"
        subtitle="Gross, fee and net for each Paystack collection and transfer."
        icon={Percent}
        actions={
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-bold" disabled={sync.isPending} onClick={() => sync.mutate()}>
              {sync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync with Paystack
            </Button>
            {q.data && <ReportActions label="the fees" onPdf={() => exportReportPdf(feesReport(q.data!, from, to))} onPrint={() => printReport(feesReport(q.data!, from, to))} />}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 border-b px-5 py-3 max-w-md">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" /></Field>
        </div>
        <ScrollTable maxHeight="32rem" minWidth="56rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>For</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Figure from</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{fmtDateTime(r.occurred_at)}</TableCell>
                  <TableCell className="font-mono text-[11px]">{r.reference}</TableCell>
                  <TableCell className="text-xs">{SOURCE[r.source_type] ?? r.source_type}</TableCell>
                  <TableCell className="text-right font-mono">{ghs(r.gross)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {r.fee === null
                      ? <Button size="sm" variant="outline" className="h-7 text-[11px] border-amber-500/40 text-amber-700" onClick={() => setSetRow(r)}>Enter from settlement</Button>
                      : <span className="text-orange-600 dark:text-orange-400 font-bold">{ghs(r.fee)}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.fee === null ? "—" : ghs(Number(r.gross) - Number(r.fee))}</TableCell>
                  <TableCell className="text-xs" title={r.note ?? ""}>{r.captured_from}{r.fee_set_by_name ? ` · ${r.fee_set_by_name}` : ""}</TableCell>
                </TableRow>
              ))}
              {!q.isLoading && (q.data?.rows ?? []).length === 0 && <EmptyRow cols={7}>No Paystack collections or transfers in this period.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="references" />
      </Panel>
      {setRow && <SetFeeDialog row={setRow} onClose={() => setSetRow(null)} />}
    </div>
  );
}

function SetFeeDialog({ row, onClose }: { row: FeeRow; onClose: () => void }) {
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  return (
    <FormDialog
      open onOpenChange={(v) => { if (!v) onClose(); }} title="Fee from the settlement report" submitLabel="Record fee" successMessage="Fee recorded"
      description={<>Reference <span className="font-mono">{row.reference}</span>, {ghs(row.gross)}. Enter the fee exactly as Paystack's settlement report shows it. Once recorded it cannot be changed.</>}
      disabled={!/^\d{1,9}(\.\d{1,2})?$/.test(fee.trim()) || note.trim().length < 5}
      onSubmit={() => finSend(`/fees/${row.id}/set`, { fee: fee.trim(), note })}
    >
      <Field label="Fee (GH₵)"><Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" /></Field>
      <Field label="Where the figure comes from"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Settlement report date and line" rows={2} /></Field>
    </FormDialog>
  );
}
