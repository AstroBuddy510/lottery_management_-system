import type { TableReport } from "@/lib/pdf-generator";

export type { TableReport, TableReportSection, TableReportColumn } from "@/lib/pdf-generator";

/** Export a report spec to PDF. jsPDF is loaded only when someone asks for one. */
export async function exportReportPdf(report: TableReport) {
  const { generateTableReportPDF } = await import("@/lib/pdf-generator");
  await generateTableReportPDF(report);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Print a report spec: the same letterhead, sections and rows as its PDF,
 * laid out for paper in a window of its own so the portal's menus and
 * buttons never reach the printer.
 */
export function printReport(report: TableReport) {
  const w = window.open("", "_blank", "width=1000,height=760");
  if (!w) {
    alert("Your browser blocked the print window. Allow pop-ups for this site and try again.");
    return;
  }
  const now = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const meta = [{ label: "Printed", value: now }, ...(report.meta ?? [])];
  const sections = report.sections.map((s) => {
    const al = (i: number) => s.columns[i]?.align ?? "left";
    const head = s.columns.map((c, i) => `<th style="text-align:${al(i)}">${esc(c.header)}</th>`).join("");
    const body = s.rows.length
      ? s.rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${al(i)}">${esc(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${s.columns.length}" class="empty">${esc(s.empty ?? "Nothing to show.")}</td></tr>`;
    const totals = s.totals && s.rows.length
      ? `<tr class="totals">${s.totals.map((c, i) => `<td style="text-align:${al(i)}">${esc(c)}</td>`).join("")}</tr>`
      : "";
    return `${s.heading ? `<h3>${esc(s.heading)}</h3>` : ""}<table><thead><tr>${head}</tr></thead><tbody>${body}${totals}</tbody></table>`;
  }).join("");

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>
  @page { size: ${report.orientation === "landscape" ? "A4 landscape" : "A4"}; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1f2937; font-size: 11px; margin: 0; }
  .brand { text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 12px; }
  .brand img { width: 52px; height: 52px; }
  .brand .name { color: #004e98; font-weight: 800; font-size: 16px; letter-spacing: .02em; }
  .brand .addr { color: #666; font-size: 9px; }
  .top { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 12px; }
  h1 { color: #004e98; font-size: 15px; text-transform: uppercase; margin: 0 0 6px; }
  .summary div { color: #444; line-height: 1.5; }
  .meta { font-size: 9.5px; color: #555; text-align: right; white-space: nowrap; }
  .meta b { color: #222; }
  h3 { color: #004e98; font-size: 12px; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #004e98; color: #fff; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; padding: 6px 7px; }
  td { padding: 5px 7px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  .totals td { font-weight: 800; background: #ecf2fa !important; border-top: 2px solid #004e98; }
  .empty { text-align: center; color: #888; padding: 14px; }
  .foot { margin-top: 26px; display: flex; justify-content: space-between; font-size: 9.5px; color: #555; }
  .foot div { border-top: 1px solid #999; padding-top: 4px; width: 200px; }
</style></head><body>
<div class="brand">
  <img src="${window.location.origin}/company-logo-v3.png" alt="" onerror="this.style.display='none'">
  <div class="name">VISION 2000 LOTTO.COM LTD</div>
  <div class="addr">HQ Location: Afienya Mataheko | Postal: PO Box SQ 168 | info@vs2000smartportal.com | 0302 021 000 / 0244614981</div>
</div>
<div class="top">
  <div class="summary"><h1>${esc(report.title)}</h1>${report.summary.map((l) => `<div>${esc(l)}</div>`).join("")}</div>
  <div class="meta">${meta.map((m) => `<div>${esc(m.label)}: <b>${esc(m.value)}</b></div>`).join("")}</div>
</div>
${sections}
<div class="foot"><div>Prepared By (Cashier)</div><div>Approved By</div></div>
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
