import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Currency for print. Grouped like the screen, and negatives in brackets as
// the accounts are read.
function fmt(v: string | number | undefined | null) {
  const n = Number(v ?? 0);
  const grouped = Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(GHS ${grouped})` : `GHS ${grouped}`;
}

// Helper to format date
function fmtDate(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s.split("T")[0] + "T00:00:00").toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function getLogoImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.src = "/company-logo-v3.png";
    if (img.complete && img.naturalWidth !== 0) {
      resolve(img);
    } else {
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.error("Failed to load logo image");
        resolve(null);
      };
    }
  });
}

// Draw the header brand logo, company letterhead, and title
function drawBrandHeader(
  doc: jsPDF,
  title: string,
  metaDetails: { label: string; value: string }[],
  clientLabel: string,
  clientDetails: string[],
  logoImg: HTMLImageElement | null
) {
  // Page Width
  const pageWidth = doc.internal.pageSize.width;

  // Center logo
  if (logoImg) {
    try {
      doc.addImage(logoImg, "PNG", (pageWidth - 24) / 2, 8, 24, 24);
    } catch (err) {
      console.error("Error drawing logo in PDF", err);
    }
  }

  // Company Name
  doc.setTextColor(0, 78, 152);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("VISION 2000 LOTTO.COM LTD", pageWidth / 2, 38, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("HQ Location: Afienya Mataheko  |  Postal: PO Box SQ 168", pageWidth / 2, 43, { align: "center" });
  doc.text("Email: info@vs2000smartportal.com  |  Contact: 0302 021 000 / 0244614981", pageWidth / 2, 47, { align: "center" });

  // Draw divider line
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(15, 51, pageWidth - 15, 51);

  // Title Box
  doc.setTextColor(0, 78, 152);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title.toUpperCase(), 15, 60);

  // Left Column - Bill To / Client Info
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(clientLabel.toUpperCase() + ":", 15, 69);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  let currentY = 74;
  clientDetails.forEach((line) => {
    doc.text(line, 15, currentY);
    currentY += 4.5;
  });

  // Right Column - Statement Info Grid (Top aligned)
  let rightY = 60;
  metaDetails.forEach((item) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(`${item.label.toUpperCase()}:`, pageWidth - 85, rightY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(40, 40, 40);
    doc.text(item.value, pageWidth - 45, rightY);
    rightY += 4.5;
  });

  // Draw another subtle divider before details table
  doc.setDrawColor(230, 230, 230);
  doc.line(15, currentY + 3, pageWidth - 15, currentY + 3);

  return Math.max(currentY + 8, rightY + 8);
}

// Draw physical signature blocks at the bottom of the last page
function drawSignatureBlock(doc: jsPDF, labelLeft: string, labelRight: string) {
  const pageHeight = doc.internal.pageSize.height;
  const pageWidth = doc.internal.pageSize.width;
  const sigY = pageHeight - 35;

  // Left line
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.5);
  doc.line(15, sigY, 75, sigY);
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(labelLeft, 15, sigY + 4);
  doc.setFont("helvetica", "normal");
  doc.text("Signed with Pen / Hand", 15, sigY + 8);

  // Right line
  doc.line(pageWidth - 75, sigY, pageWidth - 15, sigY);
  doc.setFont("helvetica", "bold");
  doc.text(labelRight, pageWidth - 75, sigY + 4);
  doc.setFont("helvetica", "normal");
  doc.text("Signed with Pen / Hand", pageWidth - 75, sigY + 8);

  // Thank you note
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text("Thank you for your business!  |  VISION 2000 LOTTO.COM LTD", pageWidth / 2, pageHeight - 12, {
    align: "center",
  });
}

// Helper to autoTable stylings
const tableTheme: any = {
  headStyles: {
    fillColor: [0, 78, 152],
    textColor: [255, 255, 255],
    fontSize: 8,
    fontStyle: "bold",
    halign: "right",
  },
  bodyStyles: {
    fontSize: 8,
    textColor: [60, 60, 60],
  },
  alternateRowStyles: {
    fillColor: [248, 250, 252],
  },
  margin: { left: 15, right: 15 },
};

// ─── 1. WRITER REPORT PDF ───
export async function generateWriterReportPDF(
  writerName: string,
  writerCode: string,
  dateFrom: string,
  dateTo: string,
  totals: any,
  rows: any[]
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const startY = drawBrandHeader(
    doc,
    "Writer Performance Statement",
    [
      { label: "Statement ID", value: `WRT-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Writer Details",
    [`Name: ${writerName}`, `Code: ${writerCode}`, "Role: Writer Account"],
    logoImg
  );

  const columns = [
    { header: "Date", dataKey: "calcDate" },
    { header: "Gross Sales", dataKey: "grossSales" },
    { header: "Commission", dataKey: "commissionAmount" },
    { header: "Net Gross", dataKey: "netGross" },
    { header: "Wins Paid", dataKey: "winsAmount" },
    { header: "Reserve", dataKey: "reserveAmount" },
    { header: "Writer Balance", dataKey: "writerBalance" },
  ];

  const tableData = rows.map((r) => ({
    calcDate: fmtDate(r.calcDate),
    grossSales: fmt(r.grossSales),
    commissionAmount: fmt(r.commissionAmount),
    netGross: fmt(r.netGross),
    winsAmount: fmt(r.winsAmount),
    reserveAmount: fmt(r.reserveAmount),
    writerBalance: fmt(r.writerBalance),
  }));

  autoTable(doc, {
    columns,
    body: tableData,
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: {
      calcDate: { halign: "left" },
    },
    didParseCell: (data: any) => {
      // Bold the last column
      if (data.column.key === "writerBalance" && data.section === "body") {
        data.cell.styles.fontStyle = "bold";
      }
    },
    margin: tableTheme.margin,
  });

  const finalY = doc.lastAutoTable.finalY + 8;
  const pageWidth = doc.internal.pageSize.width;

  // Add Totals Panel block
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, finalY, 80, 32, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Gross Sales:", pageWidth - 90, finalY + 7);
  doc.text("Total Wins Deduct:", pageWidth - 90, finalY + 14);
  doc.text("Total Net Balance:", pageWidth - 90, finalY + 24);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(totals.grossSales), pageWidth - 20, finalY + 7, { align: "right" });
  doc.text(fmt(totals.winsAmount), pageWidth - 20, finalY + 14, { align: "right" });

  const bal = Number(totals.writerBalance);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(bal < 0 ? 220 : 16, bal < 0 ? 38 : 124, bal < 0 ? 38 : 65); // Red or green
  doc.text(fmt(totals.writerBalance), pageWidth - 20, finalY + 25, { align: "right" });

  drawSignatureBlock(doc, "Cashier/Auditor", "Writer Signature");
  doc.save(`statement_writer_${writerCode}.pdf`);
}

// ─── 2. AGENT REPORT PDF ───
export async function generateAgentReportPDF(
  agentName: string,
  agentCode: string,
  dateFrom: string,
  dateTo: string,
  totals: any,
  writersBreakdown: any[],
  payments: any[],
  totalPaid: string
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const startY = drawBrandHeader(
    doc,
    "Agent Performance Statement",
    [
      { label: "Invoice / Ref", value: `INV-AGT-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Agent Billing Details",
    [`Name: ${agentName}`, `Code: ${agentCode}`, "Role: Registered Agency Partner"],
    logoImg
  );

  // Render Writer Breakdown Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 78, 152);
  doc.text("WRITER PERFORMANCE BREAKDOWN", 15, startY);

  const columns = [
    { header: "Writer Code & Name", dataKey: "writer" },
    { header: "Gross Sales", dataKey: "grossSales" },
    { header: "Commission", dataKey: "commissionAmount" },
    { header: "Net Gross", dataKey: "netGross" },
    { header: "Wins Deduct", dataKey: "winsAmount" },
    { header: "Reserve", dataKey: "reserveAmount" },
    { header: "Net Balance", dataKey: "writerBalance" },
  ];

  const tableData = writersBreakdown.filter(w => w.writer).map((w) => ({
    writer: `${w.writer.fullCode} (${w.writer.fullName})`,
    grossSales: fmt(w.totals.grossSales),
    commissionAmount: fmt(w.totals.commissionAmount),
    netGross: fmt(w.totals.netGross),
    winsAmount: fmt(w.totals.winsAmount),
    reserveAmount: fmt(w.totals.reserveAmount),
    writerBalance: fmt(w.totals.writerBalance),
  }));

  autoTable(doc, {
    columns,
    body: tableData,
    startY: startY + 4,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: {
      writer: { halign: "left" },
    },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;

  // Payments summary if present
  if (payments && payments.length > 0) {
    // Add page break if running out of space
    if (nextY > 210) {
      doc.addPage();
      nextY = 20;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0, 78, 152);
    doc.text("PAYMENTS COLLECTED RECORD", 15, nextY);

    const payCols = [
      { header: "Receipt No", dataKey: "receiptNumber" },
      { header: "Payment Date", dataKey: "paymentDate" },
      { header: "Transaction Type", dataKey: "transactionType" },
      { header: "Amount Received", dataKey: "amount" },
      { header: "Notes", dataKey: "notes" },
    ];

    const payData = payments.map((p) => ({
      receiptNumber: p.receiptNumber || "—",
      paymentDate: fmtDate(p.paymentDate),
      transactionType: p.transactionType.replace("_", " ").toUpperCase(),
      amount: fmt(p.amount),
      notes: p.notes || "—",
    }));

    autoTable(doc, {
      columns: payCols,
      body: payData,
      startY: nextY + 4,
      theme: "grid",
      headStyles: { ...tableTheme.headStyles, halign: "left" },
      bodyStyles: { ...tableTheme.bodyStyles, halign: "left" },
      columnStyles: {
        amount: { halign: "right" },
      },
      margin: tableTheme.margin,
    });
    nextY = doc.lastAutoTable.finalY + 10;
  }

  // Final totals panel
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 36, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Gross Sales:", pageWidth - 90, nextY + 7);
  doc.text("Total Wins Paid:", pageWidth - 90, nextY + 14);
  doc.text("Total Payments Paid:", pageWidth - 90, nextY + 21);
  doc.text("Net Balance Due:", pageWidth - 90, nextY + 30);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(totals.grossSales), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(totals.winsAmount), pageWidth - 20, nextY + 14, { align: "right" });
  doc.text(fmt(totalPaid), pageWidth - 20, nextY + 21, { align: "right" });

  const finalBal = Number(totals.writerBalance);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(finalBal < 0 ? 220 : 16, finalBal < 0 ? 38 : 124, finalBal < 0 ? 38 : 65); // Red/green
  doc.text(fmt(totals.writerBalance), pageWidth - 20, nextY + 31, { align: "right" });

  drawSignatureBlock(doc, "Billed By (Administrator)", "Acknowledged By (Agent)");
  doc.save(`invoice_agent_${agentCode}.pdf`);
}

// ─── 3. ORGANISATION REPORT (P&L Summary) PDF ───
export async function generateOrgReportPDF(
  dateFrom: string,
  dateTo: string,
  totals: any,
  agentsBreakdown: any[]
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const startY = drawBrandHeader(
    doc,
    "Executive Performance Statement (Org P&L)",
    [
      { label: "Report ID", value: `ORG-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Audited Entity",
    ["VISION 2000 LOTTO.COM LTD", "Operational HQ", "Consolidated Agencies Summary"],
    logoImg
  );

  const columns = [
    { header: "Agent Code & Owner", dataKey: "agent" },
    { header: "Gross Sales", dataKey: "grossSales" },
    { header: "Commission Paid", dataKey: "commissionAmount" },
    { header: "Net Gross", dataKey: "netGross" },
    { header: "Wins Paid", dataKey: "winsAmount" },
    { header: "Reserve Fund", dataKey: "reserveAmount" },
    { header: "Consolidated Bal", dataKey: "writerBalance" },
  ];

  const tableData = agentsBreakdown.map((a) => ({
    agent: `${a.agent.fullCode} — ${a.agent.user?.fullName ?? "—"}`,
    grossSales: fmt(a.totals.grossSales),
    commissionAmount: fmt(a.totals.commissionAmount),
    netGross: fmt(a.totals.netGross),
    winsAmount: fmt(a.totals.winsAmount),
    reserveAmount: fmt(a.totals.reserveAmount),
    writerBalance: fmt(a.totals.writerBalance),
  }));

  autoTable(doc, {
    columns,
    body: tableData,
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: {
      agent: { halign: "left" },
    },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  // Totals box
  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 36, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Gross Sales:", pageWidth - 90, nextY + 7);
  doc.text("Total Commissions:", pageWidth - 90, nextY + 14);
  doc.text("Total Wins Paid:", pageWidth - 90, nextY + 21);
  doc.text("Net Profit / Bal:", pageWidth - 90, nextY + 30);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(totals.grossSales), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(totals.commissionAmount), pageWidth - 20, nextY + 14, { align: "right" });
  doc.text(fmt(totals.winsAmount), pageWidth - 20, nextY + 21, { align: "right" });

  const profit = Number(totals.writerBalance);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(profit < 0 ? 220 : 16, profit < 0 ? 38 : 124, profit < 0 ? 38 : 65);
  doc.text(fmt(totals.writerBalance), pageWidth - 20, nextY + 31, { align: "right" });

  drawSignatureBlock(doc, "Director Signatory", "External Auditor Signatory");
  doc.save(`org_performance_statement.pdf`);
}

// ─── 3a. E-TOKEN REPORT PDF ───
/**
 * The e-token report, which was the one report with no PDF.
 *
 * It had CSV, which is for a spreadsheet, not for a file somebody signs or
 * files. The variance line leads, because it is the number the report exists
 * to prove: minted units should equal pool plus floats plus what writers
 * hold, and anything else is a discrepancy to chase.
 */
export async function generateTokenReportPDF(
  dateFrom: string,
  dateTo: string,
  summary: {
    totalMinted: string; poolBalance: string; heldByCashiers: string;
    disbursedToWriters: string; variance: string;
  },
  writerHoldings: { held: string; purchased: string; spent: string },
  floats: Array<{ cashierName: string; balance: string; totalReceived: string; totalDisbursed: string }>,
  poolTransactions: Array<{ transactionType: string; amount: string; balanceAfter: string; createdAt: string; byName: string; notes: string | null }>,
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const variance = Number(summary.variance);
  const startY = drawBrandHeader(
    doc,
    "E-Token Supply Report",
    [
      { label: "Report ID", value: `TOK-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Reconciliation",
    [
      "VISION 2000 LOTTO.COM LTD",
      `Units generated: ${fmt(summary.totalMinted)}`,
      variance === 0 ? "Balanced - no variance" : `VARIANCE: ${fmt(summary.variance)}`,
    ],
    logoImg,
  );

  autoTable(doc, {
    columns: [
      { header: "Position", dataKey: "position" },
      { header: "Units", dataKey: "units" },
    ],
    body: [
      { position: "Generated (ever minted)", units: fmt(summary.totalMinted) },
      { position: "In pool (unissued)", units: fmt(summary.poolBalance) },
      { position: "Held by cashiers (floats)", units: fmt(summary.heldByCashiers) },
      { position: "Sold to writers", units: fmt(summary.disbursedToWriters) },
      { position: "Held by writers", units: fmt(writerHoldings.held) },
      { position: "Staked by writers", units: fmt(writerHoldings.spent) },
      { position: "Variance", units: fmt(summary.variance) },
    ],
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: { position: { halign: "left" } },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;

  if (floats.length > 0) {
    if (nextY > 215) { doc.addPage(); nextY = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    doc.text("Cashier Floats", 14, nextY);
    autoTable(doc, {
      columns: [
        { header: "Cashier", dataKey: "cashier" },
        { header: "Received", dataKey: "received" },
        { header: "Disbursed", dataKey: "disbursed" },
        { header: "Balance", dataKey: "balance" },
      ],
      body: floats.map((f) => ({
        cashier: f.cashierName,
        received: fmt(f.totalReceived),
        disbursed: fmt(f.totalDisbursed),
        balance: fmt(f.balance),
      })),
      startY: nextY + 4,
      theme: "striped",
      headStyles: { ...tableTheme.headStyles, halign: "right" },
      bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
      columnStyles: { cashier: { halign: "left" } },
      margin: tableTheme.margin,
    });
    nextY = doc.lastAutoTable.finalY + 10;
  }

  if (poolTransactions.length > 0) {
    if (nextY > 200) { doc.addPage(); nextY = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    doc.text("Pool Movements", 14, nextY);
    autoTable(doc, {
      columns: [
        { header: "Date", dataKey: "date" },
        { header: "Type", dataKey: "type" },
        { header: "By", dataKey: "by" },
        { header: "Amount", dataKey: "amount" },
        { header: "Balance After", dataKey: "after" },
      ],
      // Capped: a year of movements is not a document anybody reads, and the
      // CSV export is still there for the full history.
      body: poolTransactions.slice(0, 60).map((t) => ({
        date: new Date(t.createdAt).toLocaleDateString("en-GB"),
        type: t.transactionType,
        by: t.byName,
        amount: fmt(t.amount),
        after: fmt(t.balanceAfter),
      })),
      startY: nextY + 4,
      theme: "striped",
      headStyles: { ...tableTheme.headStyles, halign: "right" },
      bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
      columnStyles: { date: { halign: "left" }, type: { halign: "left" }, by: { halign: "left" } },
      margin: tableTheme.margin,
    });
    nextY = doc.lastAutoTable.finalY + 8;
    if (poolTransactions.length > 60) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(120, 120, 120);
      doc.text(`Showing the 60 most recent of ${poolTransactions.length} movements. Export CSV for the full list.`, 14, nextY);
    }
  }

  drawSignatureBlock(doc, "Prepared By", "Director Signatory");
  doc.save("etoken_supply_report.pdf");
}

// ─── 3b. POS WINS REPORT PDF ───
/**
 * POS wins paid over a period: the disbursements, then who they went through.
 * Portal tickets only - wins an agent entered by hand never reach this report.
 */
export async function generatePosWinsReportPDF(
  dateFrom: string,
  dateTo: string,
  paid: { count: number; total: string },
  byAgency: Array<{ agentCode: string; agencyName: string | null; count: number; total: string }>,
  byCashier: Array<{ cashierName: string; count: number; total: string }>,
  disbursements: Array<{
    paidAt: string | null; amount: string; ticketNumber: string; writerCode: string;
    agentCode: string; gameName: string; eventNumber: string; cashierName: string | null;
    payeeMomoNumber: string | null; transferReference: string | null;
  }>,
  wallet: { available: string; held: string },
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF({ orientation: "landscape" }) as any;

  const startY = drawBrandHeader(
    doc,
    "POS Wins Payment Report",
    [
      { label: "Report ID", value: `PWP-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Disbursed via Paystack",
    [
      `${paid.count} payout${paid.count === 1 ? "" : "s"} - ${fmt(paid.total)}`,
      `Master Wallet available: ${fmt(wallet.available)}`,
      `Held for claims in progress: ${fmt(wallet.held)}`,
    ],
    logoImg,
  );

  autoTable(doc, {
    columns: [
      { header: "Paid", dataKey: "paidAt" },
      { header: "Ticket", dataKey: "ticket" },
      { header: "Draw", dataKey: "draw" },
      { header: "Writer", dataKey: "writer" },
      { header: "Agency", dataKey: "agency" },
      { header: "MoMo wallet", dataKey: "momo" },
      { header: "Approved by", dataKey: "cashier" },
      { header: "Reference", dataKey: "ref" },
      { header: "Amount", dataKey: "amount" },
    ],
    body: disbursements.map((d) => ({
      paidAt: d.paidAt ? new Date(d.paidAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "-",
      ticket: d.ticketNumber,
      draw: `${d.gameName} #${d.eventNumber}`,
      writer: d.writerCode,
      agency: d.agentCode,
      momo: d.payeeMomoNumber ?? "-",
      cashier: d.cashierName ?? "-",
      ref: d.transferReference ?? "-",
      amount: fmt(d.amount),
    })),
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles },
    bodyStyles: { ...tableTheme.bodyStyles, fontSize: 7 },
    columnStyles: { amount: { halign: "right" }, ref: { fontSize: 6 } },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;
  if (nextY > 150) { doc.addPage(); nextY = 20; }

  autoTable(doc, {
    columns: [
      { header: "By agency", dataKey: "name" },
      { header: "Payouts", dataKey: "count" },
      { header: "Total", dataKey: "total" },
    ],
    body: byAgency.map((a) => ({ name: `${a.agentCode} - ${a.agencyName ?? ""}`, count: a.count, total: fmt(a.total) })),
    startY: nextY,
    theme: "striped",
    headStyles: tableTheme.headStyles,
    bodyStyles: tableTheme.bodyStyles,
    columnStyles: { count: { halign: "right" }, total: { halign: "right" } },
    margin: { left: 14, right: 160 },
  });
  autoTable(doc, {
    columns: [
      { header: "By cashier", dataKey: "name" },
      { header: "Payouts", dataKey: "count" },
      { header: "Total", dataKey: "total" },
    ],
    body: byCashier.map((c) => ({ name: c.cashierName, count: c.count, total: fmt(c.total) })),
    startY: nextY,
    theme: "striped",
    headStyles: tableTheme.headStyles,
    bodyStyles: tableTheme.bodyStyles,
    columnStyles: { count: { halign: "right" }, total: { halign: "right" } },
    margin: { left: 150, right: 14 },
  });

  drawSignatureBlock(doc, "Cashier Signatory", "Director Signatory");
  doc.save("pos_wins_payment_report.pdf");
}

// ─── 3d. SALES BY CHANNEL PDF ───
/** One row of the Sales by Channel breakdown, already grouped as on screen. */
export type SalesChannelGroupRow = {
  key: string; name: string; sub: string;
  prepaid: string; prepaidTickets: number;
  postpaid: string; postpaidTickets: number;
  manual: string; manualEntries: number;
  total: string;
  payable: string; collected: string; outstanding: string; notYetDue: string;
};

export async function generateSalesChannelsReportPDF(opts: {
  dateFrom: string;
  dateTo: string;
  agencyLabel: string;
  groupLabel: string;
  summary: {
    prepaid: { amount: string; tickets: number };
    postpaid: { amount: string; tickets: number };
    manual: { amount: string; entries: number };
    total: string;
    unconfirmedLate: { amount: string; entries: number };
    postpaidCollection: { commission: string; payable: string; collected: string; outstanding: string; notYetDue: string };
    writerCount: number;
    agencyCount: number;
  };
  rows: SalesChannelGroupRow[];
}) {
  const { dateFrom, dateTo, agencyLabel, groupLabel, summary: s, rows } = opts;
  const logoImg = await getLogoImage();
  const doc = new jsPDF({ orientation: "landscape" }) as any;
  const total = Number(s.total);
  const share = (v: string) => (total > 0 ? `${((Number(v) / total) * 100).toFixed(1)}%` : "-");

  const startY = drawBrandHeader(
    doc,
    "Sales by Channel",
    [
      { label: "Report ID", value: `SBC-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
      { label: "Grouped By", value: groupLabel },
    ],
    "Scope",
    [
      agencyLabel || "All agencies",
      `${s.writerCount} writer${s.writerCount === 1 ? "" : "s"} across ${s.agencyCount} agenc${s.agencyCount === 1 ? "y" : "ies"}`,
      `Total sales: ${fmt(s.total)}`,
    ],
    logoImg,
  );

  const pageWidth = doc.internal.pageSize.width;
  const half = (pageWidth - 30 - 8) / 2;

  autoTable(doc, {
    columns: [
      { header: "Channel", dataKey: "channel" },
      { header: "Sales", dataKey: "amount" },
      { header: "Share", dataKey: "share" },
      { header: "Count", dataKey: "count" },
    ],
    body: [
      { channel: "POS prepaid (e-tokens)", amount: fmt(s.prepaid.amount), share: share(s.prepaid.amount), count: `${s.prepaid.tickets} tickets` },
      { channel: "POS postpaid (credit)", amount: fmt(s.postpaid.amount), share: share(s.postpaid.amount), count: `${s.postpaid.tickets} tickets` },
      { channel: "Manual (agent entry)", amount: fmt(s.manual.amount), share: share(s.manual.amount), count: `${s.manual.entries} entries` },
      { channel: "Total", amount: fmt(s.total), share: total > 0 ? "100%" : "-", count: "" },
    ],
    startY,
    theme: "striped",
    headStyles: tableTheme.headStyles,
    bodyStyles: tableTheme.bodyStyles,
    columnStyles: { channel: { halign: "left" }, amount: { halign: "right" }, share: { halign: "right" }, count: { halign: "right" } },
    didParseCell: (data: any) => {
      if (data.section === "head" && data.column.dataKey === "channel") data.cell.styles.halign = "left";
      if (data.section === "body" && data.row.index === 3) data.cell.styles.fontStyle = "bold";
    },
    margin: { left: 15, right: 15 + half + 8 },
  });
  const leftEnd = doc.lastAutoTable.finalY;

  autoTable(doc, {
    columns: [
      { header: "Postpaid collection", dataKey: "label" },
      { header: "Amount", dataKey: "amount" },
    ],
    body: [
      { label: "Writers' commission", amount: fmt(s.postpaidCollection.commission) },
      { label: "Payable to company", amount: fmt(s.postpaidCollection.payable) },
      { label: "Collected", amount: fmt(s.postpaidCollection.collected) },
      { label: "Outstanding", amount: fmt(s.postpaidCollection.outstanding) },
      { label: "Not yet due (betting still open)", amount: fmt(s.postpaidCollection.notYetDue) },
    ],
    startY,
    theme: "striped",
    headStyles: tableTheme.headStyles,
    bodyStyles: tableTheme.bodyStyles,
    columnStyles: { label: { halign: "left" }, amount: { halign: "right" } },
    didParseCell: (data: any) => {
      if (data.section === "head" && data.column.dataKey === "label") data.cell.styles.halign = "left";
    },
    margin: { left: 15 + half + 8, right: 15 },
  });

  let nextY = Math.max(leftEnd, doc.lastAutoTable.finalY) + 6;
  if (s.unconfirmedLate.entries > 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(150, 90, 0);
    doc.text(
      `Not counted: ${s.unconfirmedLate.entries} late manual entr${s.unconfirmedLate.entries === 1 ? "y" : "ies"} (${fmt(s.unconfirmedLate.amount)}) awaiting administrator confirmation.`,
      15, nextY,
    );
    nextY += 6;
  }

  autoTable(doc, {
    columns: [
      { header: groupLabel, dataKey: "name" },
      { header: "Prepaid", dataKey: "prepaid" },
      { header: "Tkts", dataKey: "prepaidTickets" },
      { header: "Postpaid", dataKey: "postpaid" },
      { header: "Tkts", dataKey: "postpaidTickets" },
      { header: "Manual", dataKey: "manual" },
      { header: "Entries", dataKey: "manualEntries" },
      { header: "Total", dataKey: "total" },
      { header: "PP payable", dataKey: "payable" },
      { header: "Collected", dataKey: "collected" },
      { header: "Outstanding", dataKey: "outstanding" },
    ],
    body: [
      ...rows.map((r) => ({
        name: r.sub ? `${r.name}\n${r.sub}` : r.name,
        prepaid: fmt(r.prepaid), prepaidTickets: r.prepaidTickets,
        postpaid: fmt(r.postpaid), postpaidTickets: r.postpaidTickets,
        manual: fmt(r.manual), manualEntries: r.manualEntries,
        total: fmt(r.total),
        payable: fmt(r.payable), collected: fmt(r.collected), outstanding: fmt(r.outstanding),
      })),
      {
        name: "TOTAL",
        prepaid: fmt(s.prepaid.amount), prepaidTickets: s.prepaid.tickets,
        postpaid: fmt(s.postpaid.amount), postpaidTickets: s.postpaid.tickets,
        manual: fmt(s.manual.amount), manualEntries: s.manual.entries,
        total: fmt(s.total),
        payable: fmt(s.postpaidCollection.payable), collected: fmt(s.postpaidCollection.collected),
        outstanding: fmt(s.postpaidCollection.outstanding),
      },
    ],
    startY: nextY,
    theme: "striped",
    headStyles: tableTheme.headStyles,
    bodyStyles: { ...tableTheme.bodyStyles, fontSize: 7.5, halign: "right" },
    columnStyles: { name: { halign: "left", cellWidth: 52 } },
    didParseCell: (data: any) => {
      if (data.section === "head" && data.column.dataKey === "name") data.cell.styles.halign = "left";
      if (data.section === "body" && data.row.index === rows.length) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [235, 241, 250];
      }
    },
    margin: { left: 15, right: 15 },
  });

  // The signatures sit at the foot of the last page; give them a page of
  // their own rather than printing them over the end of the table.
  if (doc.lastAutoTable.finalY > doc.internal.pageSize.height - 45) doc.addPage();
  drawSignatureBlock(doc, "Prepared By (Accounts)", "Director Signatory");
  const stamp = dateFrom || dateTo ? `${dateFrom || "start"}_to_${dateTo || "today"}` : "all_time";
  doc.save(`sales_by_channel_${stamp}.pdf`);
}

// ─── 3c. MASTER WALLET LEDGER PDF ───
/** The Master Wallet's movements, as filed. Each row carries the balances it left. */
export async function generateMasterWalletLedgerPDF(
  dateFrom: string,
  dateTo: string,
  balances: { available: string; held: string; totalFunded: string; totalDisbursed: string },
  entries: Array<{
    createdAt: string; entryType: string; amount: string; availableAfter: string; heldAfter: string;
    actorName: string | null; actorRole: string | null; reference: string | null; note: string | null;
    ticketNumber: string | null;
  }>,
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF({ orientation: "landscape" }) as any;
  const label: Record<string, string> = { fund: "Funded", withdraw: "Withdrawn", hold: "Held", release: "Released", disburse: "Disbursed" };

  const startY = drawBrandHeader(
    doc,
    "Master Wallet Ledger",
    [
      { label: "Report ID", value: `MWL-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Position",
    [
      `Available: ${fmt(balances.available)}   Held: ${fmt(balances.held)}`,
      `Funded to date: ${fmt(balances.totalFunded)}`,
      `Disbursed to date: ${fmt(balances.totalDisbursed)}`,
    ],
    logoImg,
  );

  autoTable(doc, {
    columns: [
      { header: "When", dataKey: "when" },
      { header: "Movement", dataKey: "type" },
      { header: "Amount", dataKey: "amount" },
      { header: "Available after", dataKey: "available" },
      { header: "Held after", dataKey: "held" },
      { header: "By", dataKey: "by" },
      { header: "Ticket / reference", dataKey: "ref" },
      { header: "Note", dataKey: "note" },
    ],
    body: entries.map((e) => ({
      when: new Date(e.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }),
      type: label[e.entryType] ?? e.entryType,
      amount: fmt(e.amount),
      available: fmt(e.availableAfter),
      held: fmt(e.heldAfter),
      by: e.actorName ?? (e.actorRole === "writer" ? "Writer claim" : "System"),
      ref: e.ticketNumber ?? e.reference ?? "-",
      note: e.note ?? "",
    })),
    startY,
    theme: "striped",
    headStyles: tableTheme.headStyles,
    bodyStyles: { ...tableTheme.bodyStyles, fontSize: 7 },
    columnStyles: { amount: { halign: "right" }, available: { halign: "right" }, held: { halign: "right" } },
    margin: tableTheme.margin,
  });

  drawSignatureBlock(doc, "Prepared By", "Director Signatory");
  doc.save("master_wallet_ledger.pdf");
}

// ─── 4a. GAME SALES BY AGENCY PDF ───
/**
 * One game's sales over a period, by agency.
 *
 * Mirrors what the screen shows, in the order it shows it: the game and the
 * draws counted, the period totals, then the agency league table. Writers go
 * in as a second table only when the report was narrowed to one agency -
 * every writer of every agency would be pages of detail nobody asked for.
 */
export async function generateGameSalesByAgencyPDF(
  gameName: string,
  eventCount: number,
  dateFrom: string,
  dateTo: string,
  summary: {
    gross: string; commission: string; netGross: string;
    wins: string; reserve: string; balance: string;
    agencyCount: number; writerCount: number;
  },
  byAgent: Array<{
    agent: { fullCode: string; agencyName?: string | null; agentName?: string };
    gross: string; commission: string; netGross: string;
    wins: string; reserve: string; balance: string;
    pct: number; writerCount: number; eventCount: number;
    writers?: Array<{
      writer: { fullCode: string; fullName: string };
      gross: string; commission: string; netGross: string;
      wins: string; reserve: string; balance: string;
    }>;
  }>,
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const startY = drawBrandHeader(
    doc,
    "Game Sales Report — by Agency",
    [
      { label: "Report ID", value: `GSA-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Game",
    [
      gameName,
      `${eventCount} event${eventCount === 1 ? "" : "s"} in period`,
      `${summary.agencyCount} agenc${summary.agencyCount === 1 ? "y" : "ies"} · ${summary.writerCount} writer${summary.writerCount === 1 ? "" : "s"}`,
    ],
    logoImg,
  );

  autoTable(doc, {
    columns: [
      { header: "Agency", dataKey: "agency" },
      { header: "Share", dataKey: "pct" },
      { header: "Gross Sales", dataKey: "gross" },
      { header: "Commission", dataKey: "commission" },
      { header: "Net Gross", dataKey: "netGross" },
      { header: "Wins", dataKey: "wins" },
      { header: "Reserve", dataKey: "reserve" },
      { header: "Balance", dataKey: "balance" },
    ],
    body: byAgent.map((a) => ({
      agency: `${a.agent.fullCode} — ${a.agent.agencyName ?? a.agent.agentName ?? "—"}`,
      pct: `${a.pct.toFixed(1)}%`,
      gross: fmt(a.gross),
      commission: fmt(a.commission),
      netGross: fmt(a.netGross),
      wins: fmt(a.wins),
      reserve: fmt(a.reserve),
      balance: fmt(a.balance),
    })),
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: { agency: { halign: "left" } },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;

  // Writers, only when the report is already narrowed to one agency.
  if (byAgent.length === 1 && byAgent[0].writers?.length) {
    if (nextY > 215) { doc.addPage(); nextY = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    doc.text(`Writers — ${byAgent[0].agent.fullCode}`, 14, nextY);
    autoTable(doc, {
      columns: [
        { header: "Writer", dataKey: "writer" },
        { header: "Gross Sales", dataKey: "gross" },
        { header: "Commission", dataKey: "commission" },
        { header: "Net Gross", dataKey: "netGross" },
        { header: "Wins", dataKey: "wins" },
        { header: "Reserve", dataKey: "reserve" },
        { header: "Balance", dataKey: "balance" },
      ],
      body: byAgent[0].writers.map((w) => ({
        writer: `${w.writer.fullCode} — ${w.writer.fullName}`,
        gross: fmt(w.gross),
        commission: fmt(w.commission),
        netGross: fmt(w.netGross),
        wins: fmt(w.wins),
        reserve: fmt(w.reserve),
        balance: fmt(w.balance),
      })),
      startY: nextY + 4,
      theme: "striped",
      headStyles: { ...tableTheme.headStyles, halign: "right" },
      bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
      columnStyles: { writer: { halign: "left" } },
      margin: tableTheme.margin,
    });
    nextY = doc.lastAutoTable.finalY + 10;
  }

  if (nextY > 230) { doc.addPage(); nextY = 20; }

  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 44, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Gross Sales:", pageWidth - 90, nextY + 7);
  doc.text("Total Commission:", pageWidth - 90, nextY + 14);
  doc.text("Total Wins Paid:", pageWidth - 90, nextY + 21);
  doc.text("Total Reserve:", pageWidth - 90, nextY + 28);
  doc.text("Net Balance:", pageWidth - 90, nextY + 38);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(summary.gross), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(summary.commission), pageWidth - 20, nextY + 14, { align: "right" });
  doc.text(fmt(summary.wins), pageWidth - 20, nextY + 21, { align: "right" });
  doc.text(fmt(summary.reserve), pageWidth - 20, nextY + 28, { align: "right" });

  const bal = Number(summary.balance);
  doc.setFontSize(10);
  doc.setTextColor(bal < 0 ? 220 : 16, bal < 0 ? 38 : 124, bal < 0 ? 38 : 65);
  doc.text(fmt(summary.balance), pageWidth - 20, nextY + 39, { align: "right" });

  drawSignatureBlock(doc, "Prepared By", "Director Signatory");
  doc.save(`game_sales_${gameName.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.pdf`);
}

// ─── 4. GAME SALES REPORT PDF ───
export async function generateGameSalesReportPDF(
  agentName: string,
  agentCode: string,
  dateFrom: string,
  dateTo: string,
  summary: any,
  byGameType: any[],
  byWriter: any[],
  gameFinancials: any[]
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const startY = drawBrandHeader(
    doc,
    "Game Sales Performance Audit",
    [
      { label: "Report Ref", value: `GAME-SLS-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Audited Agency",
    [`Name: ${agentName}`, `Code: ${agentCode}`, "Entity: Game Tickets Distribution Summary"],
    logoImg
  );

  // Sales by game type table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 78, 152);
  doc.text("SALES SHARE BY GAME TYPE", 15, startY);

  const gameCols = [
    { header: "Game Type Name", dataKey: "gameType" },
    { header: "Total Tickets", dataKey: "ticketCount" },
    { header: "Consolidated Revenue", dataKey: "totalAmount" },
    { header: "Share %", dataKey: "pct" },
  ];

  const gameData = byGameType.map((gt) => ({
    gameType: gt.gameType,
    ticketCount: gt.ticketCount,
    totalAmount: fmt(gt.totalAmount),
    pct: `${gt.pct.toFixed(1)}%`,
  }));

  autoTable(doc, {
    columns: gameCols,
    body: gameData,
    startY: startY + 4,
    theme: "grid",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: {
      gameType: { halign: "left" },
    },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;

  // Sales by writer breakdown
  if (byWriter && byWriter.length > 0) {
    if (nextY > 210) {
      doc.addPage();
      nextY = 20;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0, 78, 152);
    doc.text("WRITER CONTRIBUTION ANALYSIS", 15, nextY);

    const writerCols = [
      { header: "Writer Name", dataKey: "name" },
      { header: "Code", dataKey: "code" },
      { header: "Tickets Logged", dataKey: "ticketCount" },
      { header: "Total Value Logged", dataKey: "totalAmount" },
      { header: "Share %", dataKey: "pct" },
    ];

    const writerData = byWriter.map((w) => ({
      name: w.writer.fullName,
      code: w.writer.fullCode,
      ticketCount: w.ticketCount,
      totalAmount: fmt(w.totalAmount),
      pct: `${w.pct.toFixed(1)}%`,
    }));

    autoTable(doc, {
      columns: writerCols,
      body: writerData,
      startY: nextY + 4,
      theme: "striped",
      headStyles: { ...tableTheme.headStyles, halign: "right" },
      bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
      columnStyles: {
        name: { halign: "left" },
        code: { halign: "left" },
      },
      margin: tableTheme.margin,
    });
    nextY = doc.lastAutoTable.finalY + 10;
  }

  // Game Financial Summaries (categorized by game type)
  if (gameFinancials && gameFinancials.length > 0) {
    const financialsByGroup = new Map<string, typeof gameFinancials>();
    for (const fin of gameFinancials) {
      let list = financialsByGroup.get(fin.gameName);
      if (!list) {
        list = [];
        financialsByGroup.set(fin.gameName, list);
      }
      list.push(fin);
    }

    for (const [gameType, items] of financialsByGroup.entries()) {
      if (nextY > 210) {
        doc.addPage();
        nextY = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(0, 78, 152);
      doc.text(`${gameType.toUpperCase()} FINANCIAL SUMMARY`, 15, nextY);

      const finCols = [
        { header: "Name of Game", dataKey: "gameNameAndEvent" },
        { header: "Gross Sales", dataKey: "grossSales" },
        { header: "Commission", dataKey: "commission" },
        { header: "Net Gross", dataKey: "netGross" },
        { header: "Wins", dataKey: "wins" },
        { header: "Reserve", dataKey: "reserve" },
        { header: "Balance", dataKey: "balance" }
      ];

      const finData = items.map((item) => ({
        gameNameAndEvent: `${item.eventNumber} (${fmtDate(item.goLiveAt)})`,
        grossSales: fmt(item.grossSales),
        commission: fmt(item.commission),
        netGross: fmt(item.netGross),
        wins: fmt(item.wins),
        reserve: fmt(item.reserve),
        balance: fmt(item.balance),
      }));

      autoTable(doc, {
        columns: finCols,
        body: finData,
        startY: nextY + 4,
        theme: "grid",
        headStyles: { ...tableTheme.headStyles, halign: "right" },
        bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
        columnStyles: {
          gameNameAndEvent: { halign: "left" },
        },
        margin: tableTheme.margin,
      });
      nextY = doc.lastAutoTable.finalY + 10;
    }
  }

  // Calculate grand aggregates from gameFinancials
  let totalGrossSales = 0;
  let grandNetBalance = 0;
  if (gameFinancials && gameFinancials.length > 0) {
    for (const item of gameFinancials) {
      totalGrossSales += parseFloat(item.grossSales ?? "0");
      grandNetBalance += parseFloat(item.balance ?? "0");
    }
  }

  // Summary footer panel
  if (nextY > 210) {
    doc.addPage();
    nextY = 20;
  }

  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 32, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Ticket Entries:", pageWidth - 90, nextY + 7);
  doc.text("Total Revenue (Sales):", pageWidth - 90, nextY + 14);
  doc.text("Grand Net Balance:", pageWidth - 90, nextY + 24);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(String(summary.totalEntries), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(totalGrossSales), pageWidth - 20, nextY + 14, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(grandNetBalance < 0 ? 220 : 16, grandNetBalance < 0 ? 38 : 124, grandNetBalance < 0 ? 38 : 65);
  doc.text(fmt(grandNetBalance), pageWidth - 20, nextY + 25, { align: "right" });

  drawSignatureBlock(doc, "Audited By (Administrator)", "Billed Authorized Sign");
  doc.save(`game_sales_report_${agentCode}.pdf`);
}

// ─── 5. DAILY CASH RECONCILIATION SETTLEMENT PDF ───
export async function generateDailySettlementPDF(
  date: string,
  totalPayIn: number,
  totalPayOut: number,
  netPosition: number,
  transactions: any[],
  agentNameMap: Record<string, string>
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const startY = drawBrandHeader(
    doc,
    "Daily Cashier Settlement Sheet",
    [
      { label: "Ledger Date", value: fmtDate(date) },
      { label: "Session Code", value: `CSH-${Date.now().toString().slice(-6)}` },
      { label: "Generated At", value: new Date().toLocaleTimeString("en-GB") },
    ],
    "Settlement Entity",
    ["VISION 2000 LOTTO.COM LTD", "Cashier Desk Ledger", "Afienya Mataheko Branch"],
    logoImg
  );

  const columns = [
    { header: "Receipt No", dataKey: "receiptNumber" },
    { header: "Time", dataKey: "time" },
    { header: "Agent Account Owner", dataKey: "agent" },
    { header: "Type", dataKey: "type" },
    { header: "Amount", dataKey: "amount" },
    { header: "Notes", dataKey: "notes" },
  ];

  const tableData = transactions.map((t) => {
    let tTime = "";
    if (t.createdAt) {
      try {
        tTime = new Date(t.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      } catch {
        tTime = "—";
      }
    }
    return {
      receiptNumber: t.receiptNumber || "—",
      time: tTime,
      agent: agentNameMap[t.agentId] ?? "Unknown Agent",
      type: t.transactionType === "pay_in" ? "PAY-IN (RECEIPT)" : "PAY-OUT (DISBURSE)",
      amount: fmt(t.amount),
      notes: t.notes || "—",
    };
  });

  autoTable(doc, {
    columns,
    body: tableData,
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "left" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "left" },
    columnStyles: {
      amount: { halign: "right" },
    },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  // Summary box
  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 28, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Drawer Pay-In:", pageWidth - 90, nextY + 7);
  doc.text("Total Drawer Pay-Out:", pageWidth - 90, nextY + 14);
  doc.text("Net Cash Position:", pageWidth - 90, nextY + 22);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(totalPayIn), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(totalPayOut), pageWidth - 20, nextY + 14, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(netPosition < 0 ? 220 : 16, netPosition < 0 ? 38 : 124, netPosition < 0 ? 38 : 65);
  doc.text(fmt(netPosition), pageWidth - 20, nextY + 23, { align: "right" });

  drawSignatureBlock(doc, "Prepared By (Cashier)", "Verified By (Admin / Manager)");
  doc.save(`cashier_settlement_${date}.pdf`);
}

// ─── 6. PAYROLL DISBURSEMENT PDF ───
export async function generatePayrollPDF(
  periodLabel: string,
  salaryPayments: any[]
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const startY = drawBrandHeader(
    doc,
    "Payroll Disbursement Voucher",
    [
      { label: "Payroll Month", value: periodLabel },
      { label: "Voucher Code", value: `PAY-${Date.now().toString().slice(-6)}` },
      { label: "Date Disbursed", value: new Date().toLocaleDateString("en-GB") },
    ],
    "Disbursing Agent Details",
    ["VISION 2000 LOTTO.COM LTD", "Internal HR & Payroll Ledger", "Status: Consolidated Payouts"],
    logoImg
  );

  const columns = [
    { header: "Staff Member / Position", dataKey: "staff" },
    { header: "Type", dataKey: "type" },
    { header: "Base Salary", dataKey: "base" },
    { header: "Allowances", dataKey: "allowance" },
    { header: "Bonuses", dataKey: "bonus" },
    { header: "Net Amount Paid", dataKey: "net" },
    { header: "Status", dataKey: "status" },
  ];

  const tableData = salaryPayments.map((p) => ({
    staff: `${p.staffName}\n(${p.staffPosition})`,
    type: p.staffType === "company" ? "INTERNAL" : `AGENCY: ${p.agencyName || "—"}`,
    base: fmt(p.baseSalary),
    allowance: fmt(p.allowances),
    bonus: fmt(p.bonuses),
    net: fmt(p.netAmount),
    status: p.status.toUpperCase(),
  }));

  autoTable(doc, {
    columns,
    body: tableData,
    startY,
    theme: "grid",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: {
      staff: { halign: "left" },
      type: { halign: "left" },
      status: { halign: "center" },
    },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  // Calculate sum of disbursements
  const totalBase = salaryPayments.reduce((s, p) => s + parseFloat(p.baseSalary || "0"), 0);
  const totalAllow = salaryPayments.reduce((s, p) => s + parseFloat(p.allowances || "0"), 0);
  const totalBonus = salaryPayments.reduce((s, p) => s + parseFloat(p.bonuses || "0"), 0);
  const grandTotal = salaryPayments.reduce((s, p) => s + parseFloat(p.netAmount || "0"), 0);

  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 28, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Base Salaries:", pageWidth - 90, nextY + 7);
  doc.text("Total Allowances/Bonus:", pageWidth - 90, nextY + 14);
  doc.text("Net Payroll Total:", pageWidth - 90, nextY + 22);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(totalBase), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(totalAllow + totalBonus), pageWidth - 20, nextY + 14, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 78, 152);
  doc.text(fmt(grandTotal), pageWidth - 20, nextY + 23, { align: "right" });

  drawSignatureBlock(doc, "Approved By (HR/Cashier)", "Authorized By (Director)");
  doc.save(`payroll_summary_${periodLabel.replace(/\s+/g, "_")}.pdf`);
}

// ─── 7. GAME EVENT AUDIT REPORT PDF ───
export async function generateGameEventReportPDF(
  gameName: string,
  eventNumber: string,
  closeDateStr: string,
  totals: any,
  agents: any[],
  writers: any[]
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const startY = drawBrandHeader(
    doc,
    "Game Event Audit Report",
    [
      { label: "Event Code", value: eventNumber },
      { label: "Close Date", value: fmtDate(closeDateStr) },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
    ],
    "Audited Game Details",
    [`Name: ${gameName}`, `Event: ${eventNumber}`, "Status: Completed Draw Event"],
    logoImg
  );

  // Consolidated Agent Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 78, 152);
  doc.text("AGENT CONTRIBUTION BREAKDOWN", 15, startY);

  const agentCols = [
    { header: "Agent (Owner)", dataKey: "agent" },
    { header: "Gross Sales", dataKey: "grossSales" },
    { header: "Commission", dataKey: "commissionAmount" },
    { header: "Net Gross", dataKey: "netGross" },
    { header: "Wins Paid", dataKey: "winsAmount" },
    { header: "Reserve Fund", dataKey: "reserveAmount" },
    { header: "Net Balance", dataKey: "writerBalance" },
  ];

  const agentData = agents.map((a) => ({
    agent: `${a.agent.fullCode} (${a.agent.ownerName})`,
    grossSales: fmt(a.totals.grossSales),
    commissionAmount: fmt(a.totals.commissionAmount),
    netGross: fmt(a.totals.netGross),
    winsAmount: fmt(a.totals.winsAmount),
    reserveAmount: fmt(a.totals.reserveAmount),
    writerBalance: fmt(a.totals.writerBalance),
  }));

  autoTable(doc, {
    columns: agentCols,
    body: agentData,
    startY: startY + 4,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: {
      agent: { halign: "left" },
    },
    margin: tableTheme.margin,
  } as any);

  let nextY = doc.lastAutoTable.finalY + 10;

  // Writer Table
  if (writers && writers.length > 0) {
    if (nextY > 210) {
      doc.addPage();
      nextY = 20;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0, 78, 152);
    doc.text("WRITER CONTRIBUTION BREAKDOWN", 15, nextY);

    const writerCols = [
      { header: "Writer Code & Name", dataKey: "writer" },
      { header: "Gross Sales", dataKey: "grossSales" },
      { header: "Commission", dataKey: "commissionAmount" },
      { header: "Net Gross", dataKey: "netGross" },
      { header: "Wins Paid", dataKey: "winsAmount" },
      { header: "Net Balance", dataKey: "writerBalance" },
    ];

    const writerData = writers.map((w) => ({
      writer: `${w.writer.fullCode} — ${w.writer.fullName}`,
      grossSales: fmt(w.totals.grossSales),
      commissionAmount: fmt(w.totals.commissionAmount),
      netGross: fmt(w.totals.netGross),
      winsAmount: fmt(w.totals.winsAmount),
      writerBalance: fmt(w.totals.writerBalance),
    }));

    autoTable(doc, {
      columns: writerCols,
      body: writerData,
      startY: nextY + 4,
      theme: "grid",
      headStyles: { ...tableTheme.headStyles, halign: "right" },
      bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
      columnStyles: {
        writer: { halign: "left" },
      },
      margin: tableTheme.margin,
    } as any);

    nextY = doc.lastAutoTable.finalY + 10;
  }

  // Summary box
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 36, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Gross Sales:", pageWidth - 90, nextY + 7);
  doc.text("Total Commissions:", pageWidth - 90, nextY + 14);
  doc.text("Total Wins Paid:", pageWidth - 90, nextY + 21);
  doc.text("Net Profit / Bal:", pageWidth - 90, nextY + 30);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(totals.grossSales), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(totals.commissionAmount), pageWidth - 20, nextY + 14, { align: "right" });
  doc.text(fmt(totals.winsAmount), pageWidth - 20, nextY + 21, { align: "right" });

  const profit = Number(totals.writerBalance);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(profit < 0 ? 220 : 16, profit < 0 ? 38 : 124, profit < 0 ? 38 : 65);
  doc.text(fmt(totals.writerBalance), pageWidth - 20, nextY + 31, { align: "right" });

  drawSignatureBlock(doc, "Audited By (Cashier)", "Authorized Signatory (Director)");
  doc.save(`event_audit_report_${eventNumber}.pdf`);
}

// ─── 8. DIGITAL PADLOCK ASSIGNMENTS HISTORY REPORT PDF ───
export async function generatePadlockAssignmentsPDF(
  assignments: any[],
  dateFrom?: string,
  dateTo?: string
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const startY = drawBrandHeader(
    doc,
    "Digital Padlocks Assignment History",
    [
      { label: "Report ID", value: `PDL-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Inventory & Security Details",
    ["VISION 2000 LOTTO.COM LTD", "Digital Padlocks Tracking System", "Status: Audited Logs"],
    logoImg
  );

  const columns = [
    { header: "Serial Number", dataKey: "serialNumber" },
    { header: "Agent (Code)", dataKey: "agent" },
    { header: "Destination", dataKey: "destination" },
    { header: "Cond. Before", dataKey: "condBefore" },
    { header: "Cond. After", dataKey: "condAfter" },
    { header: "Assigned At", dataKey: "assignedAt" },
    { header: "Locked At", dataKey: "lockedAt" },
    { header: "Opened At", dataKey: "openedAt" },
    { header: "Returned At", dataKey: "returnedAt" },
  ];

  const formatDateTime = (s?: string | null) => {
    if (!s) return "—";
    try {
      const d = new Date(s);
      return d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return s;
    }
  };

  const tableData = assignments.map((a) => ({
    serialNumber: a.padlockSerialNumber || "—",
    agent: `${a.agentCode}${a.agencyName ? ` (${a.agencyName})` : ""}`,
    destination: a.destination || "—",
    condBefore: a.conditionBefore || "—",
    condAfter: a.conditionAfter || "—",
    assignedAt: formatDateTime(a.assignedAt),
    lockedAt: formatDateTime(a.lockedAt),
    openedAt: formatDateTime(a.openedAt),
    returnedAt: formatDateTime(a.returnedAt),
  }));

  autoTable(doc, {
    columns,
    body: tableData,
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "left" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "left", fontSize: 7 },
    columnStyles: {
      serialNumber: { fontStyle: "bold" },
    },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  // Summary box
  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 20, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Assignments Logged:", pageWidth - 90, nextY + 8);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(10);
  doc.text(String(assignments.length), pageWidth - 20, nextY + 8, { align: "right" });

  drawSignatureBlock(doc, "Prepared By (Inventory Manager)", "Verified By (Operations Director)");
  doc.save(`padlock_assignments_history.pdf`);
}

// ─── 9. AGENT LEDGER REPORT PDF ───
export async function generateAgentLedgerPDF(
  receipts: any[],
  dateFrom: string,
  dateTo: string
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  // Calculate totals
  const totalDue = receipts.reduce((sum, r) => sum + parseFloat(r.amountDue || "0"), 0);
  const totalPaid = receipts.reduce((sum, r) => sum + parseFloat(r.amountPaid || "0"), 0);
  const totalShortfall = Math.max(0, totalDue - totalPaid);

  const startY = drawBrandHeader(
    doc,
    "Agent Ledger Statement",
    [
      { label: "Report Ref", value: `LDG-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Period Covered", value: dateFrom || dateTo ? `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}` : "All periods" },
    ],
    "Report Summary",
    [
      `Total Receipts: ${receipts.length}`,
      `Total Amount Due: ${fmt(totalDue)}`,
      `Total Amount Paid: ${fmt(totalPaid)}`,
      `Total Shortfall: ${fmt(totalShortfall)}`
    ],
    logoImg
  );

  const columns = [
    { header: "Agent Code", dataKey: "agentCode" },
    { header: "Agent Name", dataKey: "agentName" },
    { header: "Calc Date", dataKey: "calcDate" },
    { header: "Amount Due", dataKey: "amountDue" },
    { header: "Amount Paid", dataKey: "amountPaid" },
    { header: "Shortfall", dataKey: "shortfall" },
    { header: "Cashier", dataKey: "cashier" },
    { header: "Notes", dataKey: "notes" },
  ];

  const tableData = receipts.map((r) => {
    const due = parseFloat(r.amountDue || "0");
    const paid = parseFloat(r.amountPaid || "0");
    const shortfall = Math.max(0, due - paid);
    return {
      agentCode: r.agentFullCode || "—",
      agentName: r.agentName || "—",
      calcDate: fmtDate(r.calcDate),
      amountDue: fmt(due),
      amountPaid: fmt(paid),
      shortfall: fmt(shortfall),
      cashier: r.markedByName || "—",
      notes: r.notes || "—",
    };
  });

  autoTable(doc, {
    columns,
    body: tableData,
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: {
      agentCode: { halign: "left" },
      agentName: { halign: "left" },
      calcDate: { halign: "center" },
      cashier: { halign: "left" },
      notes: { halign: "left" },
    },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  // Summary box
  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 28, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Amount Due:", pageWidth - 90, nextY + 7);
  doc.text("Total Amount Paid:", pageWidth - 90, nextY + 14);
  doc.text("Total Shortfall:", pageWidth - 90, nextY + 22);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(totalDue), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(totalPaid), pageWidth - 20, nextY + 14, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(totalShortfall > 0 ? 220 : 16, totalShortfall > 0 ? 38 : 124, totalShortfall > 0 ? 38 : 65);
  doc.text(fmt(totalShortfall), pageWidth - 20, nextY + 23, { align: "right" });

  drawSignatureBlock(doc, "Prepared By (Finance Officer)", "Approved By (Finance Director)");
  doc.save(`agent_ledger_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── 10. SMART DEBT SIMULATION REPORT PDF ───
export async function generateSmartDebtSimulationPDF(
  simulation: any[],
  strategy: string,
  cap: string | number,
  reserveBalance: number,
  totalOutstanding: number,
  totalApplied: number,
  newBalance: number
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  const strategyLabel = strategy === "fifo" ? "FIFO (First In, First Out)" : strategy === "lifo" ? "LIFO (Last In, First Out)" : "Performance-Weighted (Best Performer)";

  const startY = drawBrandHeader(
    doc,
    "Smart Debt Allocation Statement",
    [
      { label: "Report Ref", value: `SDA-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Repayment Strategy", value: strategyLabel },
    ],
    "Pool & Allocation Cap Summary",
    [
      `Available Reserve Balance: ${fmt(reserveBalance)}`,
      `Allocation Cap Applied: ${cap && Number(cap) > 0 ? fmt(cap) : "No Cap (Full Pool)"}`,
      `Total Debt Outstanding: ${fmt(totalOutstanding)}`,
      `Projected Allocation: ${fmt(totalApplied)}`,
      `Projected Reserve After: ${fmt(newBalance)}`
    ],
    logoImg
  );

  const columns = [
    { header: "Writer Code & Name", dataKey: "writer" },
    { header: "Agent Code", dataKey: "agent" },
    { header: "Calc Date", dataKey: "calcDate" },
    { header: "Outstanding Debt", dataKey: "outstanding" },
    { header: "Allocated Amount", dataKey: "allocated" },
    { header: "Projected Remaining", dataKey: "remaining" },
    { header: "Allocation Status", dataKey: "status" },
  ];

  const tableData = simulation.map((d) => {
    const outstanding = parseFloat(d.outstandingAmount || "0");
    const allocated = d.toApply || 0;
    const remaining = d.remaining || 0;
    
    let status = "Deferred";
    if (allocated > 0) {
      status = remaining === 0 ? "Settled" : "Partial";
    }

    return {
      writer: `${d.writerFullCode || "—"}\n(${d.writerFullName || "—"})`,
      agent: d.agentFullCode || "—",
      calcDate: fmtDate(d.calcDate),
      outstanding: fmt(outstanding),
      allocated: fmt(allocated),
      remaining: fmt(remaining),
      status: status.toUpperCase(),
    };
  });

  autoTable(doc, {
    columns,
    body: tableData,
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "right" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "right" },
    columnStyles: {
      writer: { halign: "left" },
      agent: { halign: "left" },
      calcDate: { halign: "center" },
      status: { halign: "center" },
    },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  // Summary box
  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 28, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Debt Outstanding:", pageWidth - 90, nextY + 7);
  doc.text("Projected Allocation:", pageWidth - 90, nextY + 14);
  doc.text("Projected Reserve After:", pageWidth - 90, nextY + 22);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(totalOutstanding), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(totalApplied), pageWidth - 20, nextY + 14, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(newBalance < 0 ? 220 : 16, newBalance < 0 ? 38 : 124, newBalance < 0 ? 38 : 65);
  doc.text(fmt(newBalance), pageWidth - 20, nextY + 23, { align: "right" });

  drawSignatureBlock(doc, "Prepared By (Treasury Manager)", "Approved By (Finance Director)");
  doc.save(`smart_debt_allocation_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── 11. COMPANY EXPENSES STATEMENT REPORT PDF ───
export async function generateCompanyExpensesPDF(
  expenses: any[],
  dateFrom: string,
  dateTo: string
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  // Compute metrics
  let total = 0;
  let recurringTotal = 0;
  let nonRecurringTotal = 0;
  expenses.forEach((item) => {
    const val = parseFloat(item.amount);
    total += val;
    if (item.type === "recurring") {
      recurringTotal += val;
    } else {
      nonRecurringTotal += val;
    }
  });

  const startY = drawBrandHeader(
    doc,
    "Company Expenses Statement",
    [
      { label: "Report Ref", value: `EXP-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Filter Range", value: `${dateFrom} to ${dateTo}` },
    ],
    "Financial Summary",
    [
      `Total Combined Expenditures: ${fmt(total)}`,
      `Recurring Expenses: ${fmt(recurringTotal)}`,
      `Non-Recurring Expenses: ${fmt(nonRecurringTotal)}`,
    ],
    logoImg
  );

  const columns = [
    { header: "Date & Time", dataKey: "dateTime" },
    { header: "Expense Type", dataKey: "type" },
    { header: "Description", dataKey: "description" },
    { header: "Amount", dataKey: "amount" },
    { header: "Payee", dataKey: "payee" },
    { header: "Authorizing Officer", dataKey: "authorizer" },
    { header: "Issued Cashier", dataKey: "cashier" },
  ];

  const tableData = expenses.map((d) => {
    const amountVal = parseFloat(d.amount || "0");
    const formattedDate = d.createdAt ? new Date(d.createdAt).toLocaleString("en-GB") : "—";
    
    return {
      dateTime: formattedDate,
      type: (d.type || "").toUpperCase(),
      description: d.description || "—",
      amount: fmt(amountVal),
      payee: d.payeeName || "—",
      authorizer: d.authorizingOfficer || "—",
      cashier: d.cashierName || "System",
    };
  });

  autoTable(doc, {
    columns,
    body: tableData,
    startY,
    theme: "striped",
    headStyles: { ...tableTheme.headStyles, halign: "left" },
    bodyStyles: { ...tableTheme.bodyStyles, halign: "left" },
    columnStyles: {
      amount: { halign: "right" },
      type: { halign: "center" },
      dateTime: { halign: "center" },
    },
    margin: tableTheme.margin,
  });

  let nextY = doc.lastAutoTable.finalY + 10;
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  // Summary box
  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 20, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Expenditures:", pageWidth - 90, nextY + 7);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(fmt(total), pageWidth - 20, nextY + 7, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(total > 0 ? 220 : 16, total > 0 ? 38 : 124, total > 0 ? 38 : 65);
  doc.text(fmt(total), pageWidth - 20, nextY + 14, { align: "right" });

  drawSignatureBlock(doc, "Prepared By (Finance Officer)", "Approved By (Managing Director)");
  doc.save(`company_expenses_${new Date().toISOString().slice(0, 10)}.pdf`);
}


/**
 * Transaction History, as the cashier's desk copy.
 *
 * Voided rows are kept rather than dropped - a statement that quietly omits a
 * cancelled receipt is worse than useless when someone is reconciling against
 * a receipt book - but they are marked and excluded from the totals, so the
 * figures still add up to what actually moved.
 */
export async function generatePaymentsHistoryPDF(
  payments: any[],
  agentMap: Record<string, { name?: string; code?: string } | undefined>,
  filters: { agentName?: string; from?: string; to?: string },
) {
  const logoImg = await getLogoImage();
  const doc = new jsPDF() as any;

  let paidIn = 0;
  let paidOut = 0;
  let voided = 0;
  for (const p of payments) {
    if (p.isVoided) {
      voided += 1;
      continue;
    }
    const amount = parseFloat(p.amount ?? "0") || 0;
    if (p.transactionType === "pay_out") paidOut += amount;
    else paidIn += amount;
  }

  const range =
    filters.from || filters.to
      ? `${filters.from || "the beginning"} to ${filters.to || "today"}`
      : "All dates";

  const startY = drawBrandHeader(
    doc,
    "Transaction History",
    [
      { label: "Report Ref", value: `TXN-${Date.now().toString().slice(-6)}` },
      { label: "Date Generated", value: new Date().toLocaleDateString("en-GB") },
      { label: "Filter Range", value: range },
      { label: "Agent", value: filters.agentName || "All agents" },
    ],
    "Financial Summary",
    [
      `Total Paid In: ${fmt(paidIn)}`,
      `Total Paid Out: ${fmt(paidOut)}`,
      `Net Position: ${fmt(paidIn - paidOut)}`,
      `Transactions Listed: ${payments.length}${voided > 0 ? ` (${voided} voided, excluded from totals)` : ""}`,
    ],
    logoImg,
  );

  const columns = [
    { header: "Receipt", dataKey: "receipt" },
    { header: "Date", dataKey: "date" },
    { header: "Agent", dataKey: "agent" },
    { header: "Type", dataKey: "type" },
    { header: "Method", dataKey: "method" },
    { header: "Amount", dataKey: "amount" },
  ];

  const body = payments.map((p) => ({
    receipt: `${p.receiptNumber ?? "—"}${p.isVoided ? " (VOID)" : ""}`,
    date: fmtDate(p.paymentDate),
    agent: `${agentMap[p.agentId]?.name ?? "—"}${
      agentMap[p.agentId]?.code ? ` (${agentMap[p.agentId]?.code})` : ""
    }`,
    type: p.transactionType === "pay_out" ? "Pay Out" : "Pay In",
    method: p.paymentMethod ?? "—",
    amount: fmt(p.amount),
  }));

  autoTable(doc, {
    startY,
    columns,
    body,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 250] },
    columnStyles: { amount: { halign: "right" } },
    // Greyed and struck through, so a void never reads as money that moved.
    didParseCell: (data: any) => {
      if (data.section !== "body") return;
      if (payments[data.row.index]?.isVoided) {
        data.cell.styles.textColor = [150, 150, 150];
        data.cell.styles.fontStyle = "italic";
      }
    },
  });

  doc.save(`transaction-history-${new Date().toISOString().slice(0, 10)}.pdf`);
}
