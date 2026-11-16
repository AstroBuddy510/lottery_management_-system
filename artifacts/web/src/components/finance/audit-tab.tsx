import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions } from "@/components/data-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, finGet, fmtDateTime, todayAccra } from "@/lib/finance-api";
import { EmptyRow } from "./shared";

type AuditRow = { id: string; at: string; actor_name: string | null; actor_role: string | null; action: string; entity: string; entity_id: string | null; detail: unknown; note: string | null };

const describe = (r: AuditRow) => {
  const d = r.detail && typeof r.detail === "object" ? JSON.stringify(r.detail) : "";
  return [r.note, d.length > 2 ? d : ""].filter(Boolean).join(" · ");
};

function auditReport(rows: AuditRow[]): TableReport {
  return {
    title: "Finance Audit Trail",
    fileName: `finance-audit-${todayAccra()}`,
    orientation: "landscape",
    summary: [`${rows.length} actions recorded`],
    sections: [{
      columns: [{ header: "When" }, { header: "Who" }, { header: "Action" }, { header: "Record" }, { header: "Detail" }],
      rows: rows.map((r) => [fmtDateTime(r.at), `${r.actor_name ?? "System"}${r.actor_role ? ` (${r.actor_role})` : ""}`, r.action, `${r.entity}${r.entity_id ? ` ${r.entity_id.slice(0, 8)}` : ""}`, describe(r).slice(0, 240)]),
    }],
  };
}

export function AuditTab() {
  const q = useQuery({ queryKey: [...FIN_KEY, "audit"], queryFn: finGet<AuditRow[]>("/audit") });
  const paged = usePaged(q.data, 25);
  return (
    <Panel
      title="Audit trail"
      subtitle="Every financial action taken in this system - who, when, what changed. Nothing in it can be edited or deleted."
      icon={History}
      actions={q.data && q.data.length > 0 && <ReportActions label="the audit trail" onPdf={() => exportReportPdf(auditReport(q.data!))} onPrint={() => printReport(auditReport(q.data!))} />}
    >
      <ScrollTable maxHeight="36rem" minWidth="60rem">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{fmtDateTime(r.at)}</TableCell>
                <TableCell className="text-xs">{r.actor_name ?? "System"}{r.actor_role && <span className="text-muted-foreground"> · {r.actor_role}</span>}</TableCell>
                <TableCell className="font-mono text-[11px]">{r.action}</TableCell>
                <TableCell className="text-xs">{r.entity}{r.entity_id && <span className="font-mono text-muted-foreground"> {r.entity_id.slice(0, 8)}</span>}</TableCell>
                <TableCell className="text-[11px] text-muted-foreground max-w-[28rem] truncate" title={describe(r)}>{describe(r)}</TableCell>
              </TableRow>
            ))}
            {!q.isLoading && (q.data ?? []).length === 0 && <EmptyRow cols={5}>Nothing recorded yet.</EmptyRow>}
          </TableBody>
        </Table>
      </ScrollTable>
      <Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="actions" />
    </Panel>
  );
}
