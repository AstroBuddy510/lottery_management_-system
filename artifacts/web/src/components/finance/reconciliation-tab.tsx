import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Panel, ReportActions, StatTile } from "@/components/data-kit";
import { Button } from "@/components/ui/button";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, finGet, fmtDateTime, todayAccra } from "@/lib/finance-api";
import { cn } from "@/lib/utils";

export type Check = { id: string; area: string; title: string; status: "ok" | "warn" | "fail"; detail: string; action?: string };

const ICON = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle } as const;
const TONE = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-rose-600 dark:text-rose-400",
} as const;
const WORD = { ok: "Agrees", warn: "Needs attention", fail: "Does not agree" } as const;

function checksReport(c: Check[], ranAt: string): TableReport {
  return {
    title: "Reconciliation Checks",
    fileName: `reconciliation-${todayAccra()}`,
    orientation: "landscape",
    summary: [`${c.filter((x) => x.status === "ok").length} agree`, `${c.filter((x) => x.status === "warn").length} need attention`, `${c.filter((x) => x.status === "fail").length} do not agree`],
    meta: [{ label: "Run", value: fmtDateTime(ranAt) }],
    sections: [{ columns: [{ header: "Area" }, { header: "Check" }, { header: "Result" }, { header: "Detail" }, { header: "What to do" }],
      rows: c.map((x) => [x.area, x.title, WORD[x.status], x.detail, x.action ?? ""]) }],
  };
}

export function ReconciliationTab() {
  const q = useQuery({ queryKey: [...FIN_KEY, "checks"], queryFn: finGet<{ ranAt: string; checks: Check[] }>("/checks") });
  const c = q.data?.checks ?? [];
  const areas = [...new Set(c.map((x) => x.area))];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-4">
        <StatTile label="Agree" value={String(c.filter((x) => x.status === "ok").length)} icon={CheckCircle2} tone="in" />
        <StatTile label="Need attention" value={String(c.filter((x) => x.status === "warn").length)} icon={AlertTriangle} tone="warn" />
        <StatTile label="Do not agree" value={String(c.filter((x) => x.status === "fail").length)} icon={XCircle} tone={c.some((x) => x.status === "fail") ? "bad" : "muted"} />
      </div>
      <Panel
        title="Reconciliation"
        subtitle="Each check sets two records that must agree side by side, or looks for something that must not exist. Nothing here changes any data."
        icon={ShieldCheck}
        actions={
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-bold" disabled={q.isFetching} onClick={() => q.refetch()}><RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} /> Run again</Button>
            {q.data && <ReportActions label="the checks" onPdf={() => exportReportPdf(checksReport(c, q.data!.ranAt))} onPrint={() => printReport(checksReport(c, q.data!.ranAt))} />}
          </>
        }
      >
        {q.data && <div className="px-5 pt-3 text-[11px] text-muted-foreground">Run {fmtDateTime(q.data.ranAt)}</div>}
        <div className="p-5 space-y-5">
          {areas.map((area) => (
            <div key={area}>
              <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground">{area}</div>
              <div className="divide-y rounded-xl border">
                {c.filter((x) => x.area === area).map((x) => {
                  const Icon = ICON[x.status];
                  return (
                    <div key={x.id} className="flex items-start gap-3 px-4 py-3">
                      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE[x.status])} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold">{x.title}</span>
                          <span className={cn("text-[10px] font-black uppercase tracking-wider", TONE[x.status])}>{WORD[x.status]}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{x.detail}</div>
                        {x.action && <div className="text-xs font-medium mt-1">{x.action}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {q.isLoading && <div className="text-xs text-muted-foreground">Running the checks…</div>}
        </div>
      </Panel>
    </div>
  );
}
