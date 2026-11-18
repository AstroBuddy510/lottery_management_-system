import type { TableReport } from "@/lib/pdf-generator";

export type { TableReport, TableReportSection, TableReportColumn, TableReportRowKind } from "@/lib/pdf-generator";
import { reportText } from "@/lib/report-text";

/** Export a report spec to PDF. jsPDF is loaded only when someone asks for one. */
export async function exportReportPdf(report: TableReport) {
  const { generateTableReportPDF } = await import("@/lib/pdf-generator");
  await generateTableReportPDF(report);
}

const esc = (s: string) =>
  reportText(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Print a report spec: the same letterhead, sections and rows as its PDF,
 * laid out for paper in a window of its own so the portal's menus and
 * buttons never reach the printer. Text goes through the same normaliser as
 * the PDF (lib/report-text.ts), so the two read alike.
 */
export function printReport(report: TableReport) {
  const w = window.open("", "_blank", "width=1000,height=760");
  if (!w) {
    alert("Your browser blocked the print window. Allow pop-ups for this site and try again.");
    return;
  }
  const now = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });
  const meta = [{ label: "Printed", value: now }, ...(report.meta ?? [])];
  const sections = report.sections.map((s) => {
    const al = (i: number) => s.columns[i]?.align ?? "left";
    const cls = (i: number) => `a-${al(i)}`;
    const kinds = s.rowKinds ?? [];
    const head = s.columns.map((c, i) => `<th class="${cls(i)}">${esc(c.header)}</th>`).join("");
    const body = s.rows.length
      ? s.rows.map((r, ri) => {
          const kind = kinds[ri];
          if (kind === "heading") return `<tr class="k-heading"><td colspan="${s.columns.length}">${esc(r.filter(Boolean).join("  "))}</td></tr>`;
          return `<tr class="${kind ? `k-${kind}` : ""}">${r.map((c, i) => `<td class="${cls(i)}">${esc(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`;
        }).join("")
      : `<tr><td colspan="${s.columns.length}" class="empty">${esc(s.empty ?? "Nothing to show.")}</td></tr>`;
    const totals = s.totals && s.rows.length
      ? `<tr class="k-total">${s.totals.map((c, i) => `<td class="${cls(i)}">${esc(c)}</td>`).join("")}</tr>`
      : "";
    return `<section>${s.heading ? `<h3>${esc(s.heading)}</h3>` : ""}<table><thead><tr>${head}</tr></thead><tbody>${body}${totals}</tbody></table></section>`;
  }).join("");

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>
  @page { size: ${report.orientation === "landscape" ? "A4 landscape" : "A4"}; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1f2937; font-size: 10.5px; margin: 0; }
  .brand { text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 12px; }
  .brand img { width: 48px; height: 48px; }
  .brand .name { color: #004e98; font-weight: 800; font-size: 16px; letter-spacing: .02em; }
  .brand .addr { color: #666; font-size: 9px; }
  .top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: start; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; }
  h1 { color: #004e98; font-size: 15px; text-transform: uppercase; margin: 0 0 6px; }
  .summary div { color: #444; line-height: 1.5; overflow-wrap: anywhere; }
  .meta { font-size: 9.5px; color: #555; display: grid; grid-template-columns: auto auto; gap: 2px 10px; max-width: 300px; }
  .meta span { text-transform: uppercase; font-weight: 700; color: #888; font-size: 8.5px; }
  .meta b { color: #222; overflow-wrap: anywhere; }
  section { margin-bottom: 12px; }
  h3 { color: #004e98; font-size: 12px; margin: 14px 0 6px; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #004e98; color: #fff; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; padding: 6px 7px; vertical-align: bottom; }
  td { padding: 4.5px 7px; border-bottom: 1px solid #e5e7eb; vertical-align: top; overflow-wrap: anywhere; }
  .a-left { text-align: left; } .a-center { text-align: center; }
  .a-right { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  .k-heading td { background: #f1f5fb !important; color: #004e98; font-weight: 800; padding-top: 7px; }
  .k-indent td:first-child { padding-left: 22px; }
  .k-subtotal td { font-weight: 800; border-top: 1px solid #999; }
  .k-total td { font-weight: 800; background: #e2ebf7 !important; border-top: 2px solid #004e98; }
  .empty { text-align: center; color: #888; padding: 14px; }
  .foot { margin-top: 26px; display: flex; justify-content: space-between; font-size: 9.5px; color: #555; page-break-inside: avoid; }
  .foot div { border-top: 1px solid #999; padding-top: 4px; width: 200px; }
</style></head><body>
<div class="brand">
  <img src="${window.location.origin}/company-logo-v3.png" alt="" onerror="this.style.display='none'">
  <div class="name">VISION 2000 LOTTO.COM LTD</div>
  <div class="addr">HQ Location: Afienya Mataheko | Postal: PO Box SQ 168 | info@vs2000smartportal.com | 0302 021 000 / 0244614981</div>
</div>
<div class="top">
  <div class="summary"><h1>${esc(report.title)}</h1>${report.summary.map((l) => `<div>${esc(l)}</div>`).join("")}</div>
  <div class="meta">${meta.map((m) => `<span>${esc(m.label)}</span><b>${esc(m.value)}</b>`).join("")}</div>
</div>
${sections}
<div class="foot"><div>Prepared By</div><div>Approved By</div></div>
<script>window.onload = function () { setTimeout(function () { window.focus(); window.print(); }, 250); };</script>
</body></html>`);
  w.document.close();
}

/** Money for paper: grouped, two places, negatives in brackets. */
export function money(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  const s = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(GHS ${s})` : `GHS ${s}`;
}
