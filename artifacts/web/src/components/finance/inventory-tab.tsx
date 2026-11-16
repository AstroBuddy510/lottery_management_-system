import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListAgents, getListAgentsQueryKey } from "@workspace/api-client-react";
import { Boxes, ClipboardList, Package, ScrollText } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions, StatTile } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, finGet, finSend, ghs, fmtDate, fmtDateTime, todayAccra, type MoneyAccount } from "@/lib/finance-api";
import { EmptyRow, Field, FormDialog, Note, isMoney } from "./shared";

type Batch = { id: string; batchDate: string; quantity: number; totalCost: number; unitCost: number; description: string | null; supplier: string | null; invoiceRef: string | null; serialFrom: string | null; serialTo: string | null; costConfirmed: boolean; costConfirmedAt: string | null; costConfirmedBy: string | null; paid: number; payable: number };
type Purchase = { id: string; purchaseDate: string; boxes: number; rollsPerBox: number; totalRolls: number; totalCost: number; supplier: string | null; invoiceRef: string | null; paid: number; payable: number };
type Inv = {
  booklets: { batches: Batch[]; quantities: Record<string, number>; avgCost: number; totalCost: number; consumedCost: number; writtenOffCost: number; stockValue: number; paid: number; payable: number; unconfirmedBatches: number };
  thermal: { purchases: Purchase[]; quantities: Record<string, number>; avgCost: number; totalCost: number; usedCost: number; stockValue: number; paid: number; payable: number };
  adjustments: Array<{ id: string; adjustment_type: string; quantity: number; agent_code: string | null; occurred_on: string; note: string; entered_by_name: string; created_at: string }>;
};

const ADJ: Record<string, string> = { return_to_store: "Returned to store", damaged: "Damaged", lost: "Lost", count_correction: "Count correction" };
const qty = (v: number) => v.toLocaleString("en-GB");

function inventoryReport(d: Inv): TableReport {
  const b = d.booklets; const t = d.thermal;
  return {
    title: "Inventory Valuation",
    fileName: `inventory-${todayAccra()}`,
    orientation: "landscape",
    summary: [
      `Booklets in stock: ${qty(b.quantities.remaining)} at ${ghs(b.avgCost)} average = ${ghs(b.stockValue)}${b.unconfirmedBatches ? " (cost unconfirmed)" : ""}`,
      `Thermal rolls in stock: ${qty(t.quantities.remaining)} = ${ghs(t.stockValue)}`,
      `Owed to suppliers: ${ghs(b.payable + t.payable)}`,
    ],
    sections: [
      { heading: "Booklet batches", columns: [{ header: "Date" }, { header: "Supplier · invoice" }, { header: "Quantity", align: "right" }, { header: "Unit cost", align: "right" }, { header: "Total cost", align: "right" }, { header: "Paid", align: "right" }, { header: "Owed", align: "right" }, { header: "Cost" }],
        rows: b.batches.map((x) => [fmtDate(x.batchDate), `${x.supplier ?? "—"} · ${x.invoiceRef ?? "—"}`, qty(x.quantity), ghs(x.unitCost), ghs(x.totalCost), ghs(x.paid), ghs(x.payable), x.costConfirmed ? "Confirmed" : "UNCONFIRMED"]) },
      { heading: "Booklet movements", columns: [{ header: "" }, { header: "Booklets", align: "right" }, { header: "At cost", align: "right" }],
        rows: [["Purchased", qty(b.quantities.purchased), ghs(b.totalCost)], ["Used (gross entries)", qty(b.quantities.consumed), ghs(b.consumedCost)], ["Damaged or lost", qty(b.quantities.damaged + b.quantities.lost), ghs(b.writtenOffCost)], ["In stock", qty(b.quantities.remaining), ghs(b.stockValue)], ["of which in the store", qty(b.quantities.inStore), ""], ["of which with agencies", qty(b.quantities.withAgents), ""]] },
      { heading: "Thermal roll purchases", columns: [{ header: "Date" }, { header: "Supplier" }, { header: "Rolls", align: "right" }, { header: "Total cost", align: "right" }, { header: "Paid", align: "right" }, { header: "Owed", align: "right" }],
        rows: t.purchases.map((x) => [fmtDate(x.purchaseDate), x.supplier ?? "—", qty(x.totalRolls), ghs(x.totalCost), ghs(x.paid), ghs(x.payable)]) },
    ],
  };
}

export function InventoryTab({ role }: { role?: string }) {
  const isDirector = role === "director";
  const isMgmt = isDirector || role === "administrator";
  const q = useQuery({ queryKey: [...FIN_KEY, "inventory"], queryFn: finGet<Inv>("/inventory") });
  const [confirm, setConfirm] = useState<Batch | null>(null);
  const [details, setDetails] = useState<Batch | null>(null);
  const [pay, setPay] = useState<{ type: "booklet_batch" | "thermal_purchase"; id: string; label: string; payable: number } | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const d = q.data;
  const adjPaged = usePaged(d?.adjustments, 15);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile label="Booklets in stock" value={d ? qty(d.booklets.quantities.remaining) : "…"} sub={d ? `${ghs(d.booklets.stockValue)} at cost` : ""} icon={ScrollText} tone={d && d.booklets.unconfirmedBatches ? "warn" : "default"} />
        <StatTile label="Booklets used" value={d ? qty(d.booklets.quantities.consumed) : "…"} sub={d ? `${ghs(d.booklets.consumedCost)} expensed` : ""} />
        <StatTile label="Thermal rolls in stock" value={d ? qty(d.thermal.quantities.remaining) : "…"} sub={d ? `${ghs(d.thermal.stockValue)} at cost` : ""} icon={Boxes} />
        <StatTile label="Owed to suppliers" value={d ? ghs(d.booklets.payable + d.thermal.payable) : "…"} sub="Purchases not yet paid for" tone="out" />
      </div>
      {d && d.booklets.unconfirmedBatches > 0 && (
        <Note tone="bad">
          {d.booklets.unconfirmedBatches} booklet batch{d.booklets.unconfirmedBatches === 1 ? " has" : "es have"} a cost that has not been checked against the supplier's invoice.
          The batch of {qty(d.booklets.batches.find((b) => !b.costConfirmed)?.quantity ?? 0)} booklets is on file at a total of {ghs(d.booklets.batches.find((b) => !b.costConfirmed)?.totalCost ?? 0)}, which cannot be its real cost.
          Stock value, booklet expense and the supplier payable all depend on it, so they are not reliable until the director confirms it with the invoice. Nothing has been assumed.
        </Note>
      )}
      <Note>
        Booklets and thermal rolls are held as stock at what they cost and expensed as they are used: a booklet when a gross entry records it,
        a thermal roll when an agent hands it to a writer. Damaged and lost booklets are written off when recorded. Cost is the weighted average of all purchases.
      </Note>

      <Panel title="Booklet batches" subtitle="Each purchase, its cost checked against the invoice, and what is still owed to the supplier." icon={Package}
        actions={d && <ReportActions label="the inventory valuation" onPdf={() => exportReportPdf(inventoryReport(d))} onPrint={() => printReport(inventoryReport(d))} />}>
        <ScrollTable maxHeight="28rem" minWidth="72rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Supplier · invoice</TableHead>
                <TableHead>Serials</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Total cost</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.booklets.batches ?? []).map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-xs">{fmtDate(b.batchDate)}<div className="text-[11px] text-muted-foreground max-w-[12rem] truncate">{b.description}</div></TableCell>
                  <TableCell className="text-xs">{b.supplier ?? "—"}<div className="text-[11px] text-muted-foreground">{b.invoiceRef ?? "no invoice ref"}</div></TableCell>
                  <TableCell className="text-[11px] font-mono">{b.serialFrom ? `${b.serialFrom} – ${b.serialTo ?? "?"}` : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{qty(b.quantity)}</TableCell>
                  <TableCell className="text-right font-mono">{ghs(b.unitCost)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{ghs(b.totalCost)}</TableCell>
                  <TableCell className="text-right font-mono">{ghs(b.payable)}</TableCell>
                  <TableCell className="text-xs">{b.costConfirmed ? <span className="font-semibold text-emerald-600">Confirmed{b.costConfirmedBy ? ` · ${b.costConfirmedBy}` : ""}</span> : <span className="font-bold text-rose-600">Unconfirmed</span>}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {isMgmt && <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setDetails(b)}>Details</Button>}
                      {isDirector && !b.costConfirmed && <Button size="sm" className="h-7 text-[11px]" onClick={() => setConfirm(b)}>Confirm cost</Button>}
                      {b.costConfirmed && b.payable > 0.005 && <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setPay({ type: "booklet_batch", id: b.id, label: `${qty(b.quantity)} booklets, ${fmtDate(b.batchDate)}`, payable: b.payable })}>Pay supplier</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!q.isLoading && (d?.booklets.batches ?? []).length === 0 && <EmptyRow cols={9}>No booklet purchases recorded.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        {d && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-px border-t bg-border text-xs">
            {[["Purchased", d.booklets.quantities.purchased], ["Issued to agencies", d.booklets.quantities.issuedToAgents], ["Returned", d.booklets.quantities.returned], ["Used", d.booklets.quantities.consumed], ["Damaged / lost", d.booklets.quantities.damaged + d.booklets.quantities.lost], ["In the store", d.booklets.quantities.inStore]].map(([l, v]) => (
              <div key={String(l)} className="bg-card px-4 py-3"><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{l}</div><div className="font-mono font-bold">{qty(Number(v))}</div></div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Thermal roll purchases" subtitle="Bought by the box (Inventory › Thermal Rolls); what each cost and what is still owed." icon={Boxes}>
        <ScrollTable maxHeight="22rem" minWidth="52rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Rolls</TableHead>
                <TableHead className="text-right">Total cost</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.thermal.purchases ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">{fmtDate(p.purchaseDate)}</TableCell>
                  <TableCell className="text-xs">{p.supplier ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{qty(p.totalRolls)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{ghs(p.totalCost)}</TableCell>
                  <TableCell className="text-right font-mono">{ghs(p.paid)}</TableCell>
                  <TableCell className="text-right font-mono">{ghs(p.payable)}</TableCell>
                  <TableCell className="text-right">{p.payable > 0.005 && <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setPay({ type: "thermal_purchase", id: p.id, label: `${qty(p.totalRolls)} thermal rolls, ${fmtDate(p.purchaseDate)}`, payable: p.payable })}>Pay supplier</Button>}</TableCell>
                </TableRow>
              ))}
              {!q.isLoading && (d?.thermal.purchases ?? []).length === 0 && <EmptyRow cols={7}>No thermal roll purchases.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
      </Panel>

      <Panel title="Booklet adjustments" subtitle="Returns to the store, damage, loss and stock-count corrections." icon={ClipboardList}
        actions={<Button size="sm" className="h-8 text-xs font-bold" onClick={() => setAdjOpen(true)}>Record adjustment</Button>}>
        <ScrollTable maxHeight="22rem" minWidth="48rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Where</TableHead>
                <TableHead className="text-right">Booklets</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjPaged.rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs">{fmtDate(a.occurred_on)}</TableCell>
                  <TableCell className="text-xs font-semibold">{ADJ[a.adjustment_type] ?? a.adjustment_type}</TableCell>
                  <TableCell className="text-xs">{a.agent_code ?? "Store"}</TableCell>
                  <TableCell className="text-right font-mono">{qty(a.quantity)}</TableCell>
                  <TableCell className="text-xs max-w-[18rem] truncate" title={a.note}>{a.note}</TableCell>
                  <TableCell className="text-xs">{a.entered_by_name} · {fmtDateTime(a.created_at)}</TableCell>
                </TableRow>
              ))}
              {!q.isLoading && (d?.adjustments ?? []).length === 0 && <EmptyRow cols={6}>No adjustments recorded.</EmptyRow>}
            </TableBody>
          </Table>
        </ScrollTable>
        <Pager page={adjPaged.page} totalPages={adjPaged.totalPages} onPage={adjPaged.setPage} total={adjPaged.total} size={adjPaged.size} noun="adjustments" />
      </Panel>

      {confirm && <ConfirmCostDialog b={confirm} onClose={() => setConfirm(null)} />}
      {details && <DetailsDialog b={details} onClose={() => setDetails(null)} />}
      {pay && <PaySupplierDialog item={pay} onClose={() => setPay(null)} />}
      <AdjustmentDialog open={adjOpen} onOpenChange={setAdjOpen} />
    </div>
  );
}

function ConfirmCostDialog({ b, onClose }: { b: Batch; onClose: () => void }) {
  const [mode, setMode] = useState<"total" | "unit">("unit");
  const [value, setValue] = useState("");
  const [invoiceRef, setInvoiceRef] = useState(b.invoiceRef ?? "");
  const [reason, setReason] = useState("");
  const total = mode === "total" ? Number(value) : Math.round(Number(value) * b.quantity * 100) / 100;
  const ok = /^\d{1,9}(\.\d{1,4})?$/.test(value.trim()) && total > 0 && invoiceRef.trim().length >= 2 && reason.trim().length >= 5;
  return (
    <FormDialog open onOpenChange={(v) => { if (!v) onClose(); }} title="Confirm the batch's cost" submitLabel={`Confirm ${ok ? ghs(total) : ""}`} successMessage="Cost confirmed and recorded"
      description={<>{qty(b.quantity)} booklets bought on {fmtDate(b.batchDate)}, on file at a total of {ghs(b.totalCost)}. Enter the cost from the supplier's invoice. Both figures are kept; this can be done once.</>}
      disabled={!ok}
      onSubmit={() => finSend(`/inventory/booklet-batches/${b.id}/confirm-cost`, { totalCost: total.toFixed(2), invoiceRef, reason })}>
      <div className="grid grid-cols-2 gap-2">
        {(["unit", "total"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${mode === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>{m === "unit" ? "Cost per booklet" : "Total for the batch"}</button>
        ))}
      </div>
      <Field label={mode === "unit" ? "Cost per booklet (GH₵)" : "Total cost (GH₵)"} hint={ok ? `${qty(b.quantity)} × ${ghs(total / b.quantity)} = ${ghs(total)}` : undefined}>
        <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
      </Field>
      <Field label="Supplier invoice number"><Input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} /></Field>
      <Field label="Note"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Checked against the printer's invoice dated 25 May 2026" rows={2} /></Field>
    </FormDialog>
  );
}

function DetailsDialog({ b, onClose }: { b: Batch; onClose: () => void }) {
  const [supplier, setSupplier] = useState(b.supplier ?? "");
  const [invoiceRef, setInvoiceRef] = useState(b.invoiceRef ?? "");
  const [serialFrom, setSerialFrom] = useState(b.serialFrom ?? "");
  const [serialTo, setSerialTo] = useState(b.serialTo ?? "");
  return (
    <FormDialog open onOpenChange={(v) => { if (!v) onClose(); }} title="Batch details" submitLabel="Save" successMessage="Saved"
      onSubmit={() => finSend(`/inventory/booklet-batches/${b.id}/details`, { supplier, invoiceRef, serialFrom, serialTo })}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Invoice number"><Input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} /></Field>
        <Field label="First serial"><Input value={serialFrom} onChange={(e) => setSerialFrom(e.target.value)} /></Field>
        <Field label="Last serial"><Input value={serialTo} onChange={(e) => setSerialTo(e.target.value)} /></Field>
      </div>
    </FormDialog>
  );
}

function PaySupplierDialog({ item, onClose }: { item: { type: string; id: string; label: string; payable: number }; onClose: () => void }) {
  const accounts = useQuery({ queryKey: [...FIN_KEY, "accounts"], queryFn: finGet<MoneyAccount[]>("/accounts") });
  const [amount, setAmount] = useState(item.payable.toFixed(2));
  const [paidOn, setPaidOn] = useState(todayAccra());
  const [method, setMethod] = useState("bank");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const ok = isMoney(amount) && Number(amount) <= item.payable + 0.005 && accountId;
  return (
    <FormDialog open onOpenChange={(v) => { if (!v) onClose(); }} title="Pay the supplier" submitLabel="Record payment" successMessage="Payment recorded"
      description={`${item.label}. Still owed: ${ghs(item.payable)}.`} disabled={!ok}
      onSubmit={() => finSend(`/inventory/${item.type}/${item.id}/payments`, { amount, paidOn, method, accountId, reference: reference || null })}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (GH₵)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Paid on"><Input type="date" value={paidOn} max={todayAccra()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        <Field label="Method">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["cash", "momo", "bank", "cheque", "transfer"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Paid from">
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>{(accounts.data ?? []).filter((a) => a.isActive).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque, transfer or receipt number" /></Field>
    </FormDialog>
  );
}

function AdjustmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const agents = useListAgents(undefined, { query: { queryKey: getListAgentsQueryKey(), enabled: open } });
  const [type, setType] = useState("damaged");
  const [quantity, setQuantity] = useState("");
  const [agentId, setAgentId] = useState("_store");
  const [occurredOn, setOccurredOn] = useState(todayAccra());
  const [note, setNote] = useState("");
  const qn = Number(quantity);
  const ok = Number.isInteger(qn) && qn !== 0 && (type === "count_correction" || qn > 0) && note.trim().length >= 5 && (type !== "return_to_store" || agentId !== "_store");
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Record a booklet adjustment" submitLabel="Record" successMessage="Adjustment recorded" disabled={!ok}
      onSubmit={() => finSend("/inventory/booklet-adjustments", { adjustmentType: type, quantity: qn, agentId: agentId === "_store" ? null : agentId, occurredOn, note })}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="What happened">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(ADJ).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Booklets" hint={type === "count_correction" ? "Negative when the count found fewer than the books." : undefined}><Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        <Field label={type === "return_to_store" ? "Returned by" : "Where"}>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {type !== "return_to_store" && <SelectItem value="_store">Office store</SelectItem>}
              {(Array.isArray(agents.data) ? agents.data : []).map((a) => <SelectItem key={a.id} value={a.id}>{a.fullCode}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date"><Input type="date" value={occurredOn} max={todayAccra()} onChange={(e) => setOccurredOn(e.target.value)} /></Field>
      </div>
      <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
    </FormDialog>
  );
}
