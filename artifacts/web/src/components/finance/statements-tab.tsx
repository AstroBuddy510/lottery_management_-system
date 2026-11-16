import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileStack, FileText, Landmark, TrendingUp, Waves } from "lucide-react";
import { Panel, ReportActions } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exportReportPdf, printReport, type TableReport, type TableReportSection } from "@/lib/table-report";
import { FIN_KEY, finGet, ghsSigned, fmtDate, fmtDateTime, todayAccra, monthStartAccra, categoryLabel } from "@/lib/finance-api";
import { Field, Note } from "./shared";
import type { Check } from "./reconciliation-tab";
import { cn } from "@/lib/utils";

type Line = { label: string; amount: number; note?: string; strong?: boolean; indent?: boolean };
type Flow = { category: string; in: number; out: number; net: number };
type Statements = {
  income: { from: string; to: string; lines: Line[]; net: number; memo: Line[]; caveats: string[] };
  cash: { from: string; to: string; opening: number; operating: Flow[]; operatingNet: number; financing: Flow[]; financingNet: number; other: Flow[]; otherNet: number; transfersNet: number; netChange: number; closing: number };
  position: { asAt: string; assets: Line[]; totalAssets: number; liabilities: Line[]; totalLiabilities: number; equity: number; funds: Line[]; caveats: string[] };
};

const AMT = { header: "GH₵", align: "right" as const };
const money = (v: number) => ghsSigned(v).replace("GH₵ ", "");

export function incomeSection(s: Statements): TableReportSection {
  return { heading: `Income statement, ${fmtDate(s.income.from)} – ${fmtDate(s.income.to)}`, columns: [{ header: "" }, AMT, { header: "Note" }],
    rows: s.income.lines.map((l) => [`${l.indent ? "    " : ""}${l.label}`, money(l.amount), l.note ?? ""]),
    totals: ["Net profit / (loss)", money(s.income.net), ""] };
}
export function cashSection(s: Statements): TableReportSection {
  const flows = (title: string, f: Flow[]) => f.map((x) => [`    ${categoryLabel(x.category)}`, money(x.net), `in ${money(x.in)} · out ${money(x.out)}`]).concat(f.length ? [] : [[`    No ${title.toLowerCase()} movements`, "", ""]]);
  return { heading: `Cash flow, ${fmtDate(s.cash.from)} – ${fmtDate(s.cash.to)}`, columns: [{ header: "" }, AMT, { header: "" }],
    rows: [
      ["Cash, bank and Paystack at the start", money(s.cash.opening), ""],
      ["Operating", "", ""], ...flows("Operating", s.cash.operating), ["Net from operating", money(s.cash.operatingNet), ""],
      ["Financing", "", ""], ...flows("Financing", s.cash.financing), ["Net from financing", money(s.cash.financingNet), ""],
      ...(s.cash.other.length ? [["Other", "", ""], ...flows("Other", s.cash.other)] : []),
      ["Net change", money(s.cash.netChange), ""],
    ],
    totals: ["Cash, bank and Paystack at the end", money(s.cash.closing), ""] };
}
export function positionSection(s: Statements): TableReportSection {
  return { heading: `Financial position at ${fmtDateTime(s.position.asAt)}`, columns: [{ header: "" }, AMT, { header: "Note" }],
    rows: [
      ["Assets", "", ""], ...s.position.assets.map((l) => [`    ${l.label}`, money(l.amount), l.note ?? ""]), ["Total assets", money(s.position.totalAssets), ""],
      ["Liabilities", "", ""], ...s.position.liabilities.map((l) => [`    ${l.label}`, money(l.amount), l.note ?? ""]), ["Total liabilities", money(s.position.totalLiabilities), ""],
      ["Of the money held, set aside in funds:", "", ""], ...s.position.funds.map((l) => [`    ${l.label}`, money(l.amount), "part of the money above, not extra"]),
    ],
    totals: ["Net assets (equity)", money(s.position.equity), ""] };
}

function report(title: string, file: string, s: Statements, sections: TableReportSection[], extra: string[] = []): TableReport {
  return {
    title, fileName: `${file}-${s.income.from}-to-${s.income.to}`,
    summary: [`Net profit / (loss): ${ghsSigned(s.income.net)}`, `Cash at the end: ${ghsSigned(s.cash.closing)}`, `Net assets: ${ghsSigned(s.position.equity)}`, ...extra, ...s.income.caveats, ...s.position.caveats],
    meta: [{ label: "Period", value: `${fmtDate(s.income.from)} – ${fmtDate(s.income.to)}` }],
    sections,
  };
}

function Statement({ lines, total, totalLabel }: { lines: Line[]; total?: number; totalLabel?: string }) {
  return (
    <div className="divide-y">
      {lines.map((l, i) => (
        <div key={i} className={cn("flex items-baseline justify-between gap-4 px-5 py-2", l.strong && "bg-muted/30")}>
          <div className={cn("min-w-0", l.indent && "pl-4")}>
            <div className={cn("text-sm", l.strong ? "font-black" : "font-medium")}>{l.label}</div>
            {l.note && <div className="text-[11px] text-muted-foreground">{l.note}</div>}
          </div>
          <div className={cn("shrink-0 font-mono text-sm tabular-nums", l.strong ? "font-black" : "font-semibold", l.amount < 0 && "text-orange-600 dark:text-orange-400")}>{ghsSigned(l.amount)}</div>
        </div>
      ))}
      {total !== undefined && (
        <div className="flex items-baseline justify-between gap-4 px-5 py-3 bg-muted/50">
          <div className="text-sm font-black">{totalLabel}</div>
          <div className={cn("font-mono text-base font-black", total < 0 ? "text-rose-600" : "text-emerald-600 dark:text-emerald-400")}>{ghsSigned(total)}</div>
        </div>
      )}
    </div>
  );
}

export function StatementsTab() {
  const [from, setFrom] = useState(monthStartAccra());
  const [to, setTo] = useState(todayAccra());
  const q = useQuery({ queryKey: [...FIN_KEY, "statements", from, to], queryFn: finGet<Statements>(`/statements?from=${from}&to=${to}`) });
  const checks = useQuery({ queryKey: [...FIN_KEY, "checks"], queryFn: finGet<{ ranAt: string; checks: Check[] }>("/checks") });
  const s = q.data;
  const pack = () => {
    if (!s) return null;
    const c = checks.data?.checks ?? [];
    const checkSection: TableReportSection = { heading: `Reconciliation checks, run ${checks.data ? fmtDateTime(checks.data.ranAt) : "—"}`,
      columns: [{ header: "Area" }, { header: "Check" }, { header: "Result" }, { header: "Detail" }],
      rows: c.map((x) => [x.area, x.title, x.status === "ok" ? "Agrees" : x.status === "warn" ? "Attention" : "FAILS", x.detail]) };
    return report("Month-end Finance Pack", "month-end-pack", s, [incomeSection(s), cashSection(s), positionSection(s), checkSection],
      [`Checks: ${c.filter((x) => x.status === "ok").length} agree, ${c.filter((x) => x.status === "warn").length} need attention, ${c.filter((x) => x.status === "fail").length} fail`]);
  };

  return (
    <div className="space-y-5">
      <Panel title="Statements" subtitle="Income statement and cash flow for the period; financial position as it stands now. Every figure comes from the same records as the rest of this page." icon={FileStack}
        actions={s && <Button size="sm" className="h-8 gap-1.5 text-xs font-bold" onClick={() => { const p = pack(); if (p) void exportReportPdf(p); }}><FileText className="h-3.5 w-3.5" /> Month-end pack (PDF)</Button>}>
        <div className="flex flex-wrap items-end gap-3 px-5 py-3">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" /></Field>
          <Field label="To"><Input type="date" value={to} min={from} max={todayAccra()} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" /></Field>
          <div className="flex gap-1.5 pb-0.5">
            {[["This month", monthStartAccra(), todayAccra()], ["This year", `${todayAccra().slice(0, 4)}-01-01`, todayAccra()]].map(([l, f, t]) => (
              <Button key={l} size="sm" variant="outline" className="h-9 text-xs" onClick={() => { setFrom(f); setTo(t); }}>{l}</Button>
            ))}
          </div>
          {s && <div className="ml-auto"><ReportActions label="all three statements" onPdf={() => exportReportPdf(report("Financial Statements", "financial-statements", s, [incomeSection(s), cashSection(s), positionSection(s)]))} onPrint={() => printReport(report("Financial Statements", "financial-statements", s, [incomeSection(s), cashSection(s), positionSection(s)]))} /></div>}
        </div>
        {s && [...s.income.caveats, ...s.position.caveats].length > 0 && (
          <div className="px-5 pb-4 space-y-2">{[...new Set([...s.income.caveats, ...s.position.caveats])].map((c) => <Note key={c} tone="warn">{c}</Note>)}</div>
        )}
      </Panel>

      {s && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Panel title="Income statement" subtitle={`${fmtDate(s.income.from)} – ${fmtDate(s.income.to)}, on the accruals basis`} icon={TrendingUp}
            actions={<ReportActions label="the income statement" onPdf={() => exportReportPdf(report("Income Statement", "income-statement", s, [incomeSection(s)]))} onPrint={() => printReport(report("Income Statement", "income-statement", s, [incomeSection(s)]))} />}>
            <Statement lines={s.income.lines.slice(0, -1)} total={s.income.net} totalLabel="Net profit / (loss) for the period" />
            <div className="border-t px-5 py-3 text-[11px] text-muted-foreground">
              {s.income.memo.map((m) => <div key={m.label}>{m.label}: <b className="font-mono">{ghsSigned(m.amount)}</b></div>)}
            </div>
          </Panel>

          <Panel title="Cash flow" subtitle="Straight from the cash book. Moving money between the company's own accounts is left out." icon={Waves}
            actions={<ReportActions label="the cash flow" onPdf={() => exportReportPdf(report("Cash Flow Statement", "cash-flow", s, [cashSection(s)]))} onPrint={() => printReport(report("Cash Flow Statement", "cash-flow", s, [cashSection(s)]))} />}>
            <Statement lines={[
              { label: "Cash, bank and Paystack at the start", amount: s.cash.opening, strong: true },
              ...s.cash.operating.map((f) => ({ label: categoryLabel(f.category), amount: f.net, indent: true })),
              { label: "Net from operating", amount: s.cash.operatingNet, strong: true },
              ...s.cash.financing.map((f) => ({ label: categoryLabel(f.category), amount: f.net, indent: true })),
              { label: "Net from financing", amount: s.cash.financingNet, strong: true },
              ...s.cash.other.map((f) => ({ label: categoryLabel(f.category), amount: f.net, indent: true })),
            ]} total={s.cash.closing} totalLabel="Cash, bank and Paystack at the end" />
          </Panel>

          <Panel className="xl:col-span-2" title="Financial position" subtitle={`As it stands now (${fmtDateTime(s.position.asAt)}). Net assets is what remains when what is owed is taken from what is held.`} icon={Landmark}
            actions={<ReportActions label="the financial position" onPdf={() => exportReportPdf(report("Statement of Financial Position", "financial-position", s, [positionSection(s)]))} onPrint={() => printReport(report("Statement of Financial Position", "financial-position", s, [positionSection(s)]))} />}>
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x">
              <div><div className="px-5 pt-4 pb-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground">Assets</div><Statement lines={s.position.assets} total={s.position.totalAssets} totalLabel="Total assets" /></div>
              <div><div className="px-5 pt-4 pb-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground">Liabilities</div><Statement lines={s.position.liabilities} total={s.position.totalLiabilities} totalLabel="Total liabilities" /></div>
            </div>
            <div className="flex items-baseline justify-between border-t px-5 py-4 bg-primary/5">
              <span className="text-base font-black">Net assets (equity)</span>
              <span className={cn("font-mono text-xl font-black", s.position.equity < 0 ? "text-rose-600" : "")}>{ghsSigned(s.position.equity)}</span>
            </div>
            <div className="border-t px-5 py-3 text-[11px] text-muted-foreground">
              Of the money held, set aside in funds: {s.position.funds.map((f) => `${f.label} ${ghsSigned(f.amount)}`).join(" · ")}. These divide the money above; they are not added to it.
            </div>
          </Panel>
        </div>
      )}
      {q.isError && <Note tone="bad">The statements could not be prepared. Try again.</Note>}
    </div>
  );
}
