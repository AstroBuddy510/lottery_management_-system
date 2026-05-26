import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Helper function to format currency as GHS
function fmt(v: string | number | undefined | null) {
  const n = Number(v ?? 0);
  return n < 0 ? `(GHS ${Math.abs(n).toFixed(2)})` : `GHS ${n.toFixed(2)}`;
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

// Draw the header brand logo, company letterhead, and title
function drawBrandHeader(
  doc: jsPDF,
  title: string,
  metaDetails: { label: string; value: string }[],
  clientLabel: string,
  clientDetails: string[]
) {
  // Page Width
  const pageWidth = doc.internal.pageSize.width;

  // Draw orange accent circle (inspired by invoice sample)
  doc.setFillColor(255, 103, 0); // brand orange #ff6700
  doc.circle(20, 20, 12, "F");

  // Draw overlapping dark circle for logo style
  doc.setFillColor(0, 78, 152); // brand dark blue #004e98
  doc.circle(26, 26, 7, "F");

  // Company Name
  doc.setTextColor(0, 78, 152);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("VISION 2000 LOTTO.COM LTD", 40, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("HQ Location: Afienya Mataheko  |  Postal: PO Box SQ 168", 40, 27);
  doc.text("Email: info@vs2000smartportal.com  |  Contact: 0302 021 000 / 0244614981", 40, 31);

  // Draw divider line
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(15, 36, pageWidth - 15, 36);

  // Title Box
  doc.setTextColor(0, 78, 152);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title.toUpperCase(), 15, 47);

  // Left Column - Bill To / Client Info
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(clientLabel.toUpperCase() + ":", 15, 56);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  let currentY = 61;
  clientDetails.forEach((line) => {
    doc.text(line, 15, currentY);
    currentY += 4.5;
  });

  // Right Column - Statement Info Grid (Top aligned)
  let rightY = 47;
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
export function generateWriterReportPDF(
  writerName: string,
  writerCode: string,
  dateFrom: string,
  dateTo: string,
  totals: any,
  rows: any[]
) {
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
    [`Name: ${writerName}`, `Code: ${writerCode}`, "Role: Writer Account"]
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
export function generateAgentReportPDF(
  agentName: string,
  agentCode: string,
  dateFrom: string,
  dateTo: string,
  totals: any,
  writersBreakdown: any[],
  payments: any[],
  totalPaid: string
) {
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
    [`Name: ${agentName}`, `Code: ${agentCode}`, "Role: Registered Agency Partner"]
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
export function generateOrgReportPDF(
  dateFrom: string,
  dateTo: string,
  totals: any,
  agentsBreakdown: any[]
) {
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
    ["VISION 2000 LOTTO.COM LTD", "Operational HQ", "Consolidated Agencies Summary"]
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

// ─── 4. GAME SALES REPORT PDF ───
export function generateGameSalesReportPDF(
  agentName: string,
  agentCode: string,
  dateFrom: string,
  dateTo: string,
  summary: any,
  byGameType: any[],
  byWriter: any[]
) {
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
    [`Name: ${agentName}`, `Code: ${agentCode}`, "Entity: Game Tickets Distribution Summary"]
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

  // Summary footer panel
  if (nextY > 230) {
    doc.addPage();
    nextY = 20;
  }

  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(241, 245, 249);
  doc.rect(pageWidth - 95, nextY, 80, 24, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Total Ticket Entries:", pageWidth - 90, nextY + 7);
  doc.text("Total Sales Revenue:", pageWidth - 90, nextY + 14);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(String(summary.totalEntries), pageWidth - 20, nextY + 7, { align: "right" });
  doc.text(fmt(summary.totalAmount), pageWidth - 20, nextY + 14, { align: "right" });

  drawSignatureBlock(doc, "Audited By (Administrator)", "Billed Authorized Sign");
  doc.save(`game_sales_report_${agentCode}.pdf`);
}

// ─── 5. DAILY CASH RECONCILIATION SETTLEMENT PDF ───
export function generateDailySettlementPDF(
  date: string,
  totalPayIn: number,
  totalPayOut: number,
  netPosition: number,
  transactions: any[],
  agentNameMap: Record<string, string>
) {
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
    ["VISION 2000 LOTTO.COM LTD", "Cashier Desk Ledger", "Afienya Mataheko Branch"]
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
export function generatePayrollPDF(
  periodLabel: string,
  salaryPayments: any[]
) {
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
    ["VISION 2000 LOTTO.COM LTD", "Internal HR & Payroll Ledger", "Status: Consolidated Payouts"]
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
export function generateGameEventReportPDF(
  gameName: string,
  eventNumber: string,
  closeDateStr: string,
  totals: any,
  agents: any[],
  writers: any[]
) {
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
    [`Name: ${gameName}`, `Event: ${eventNumber}`, "Status: Completed Draw Event"]
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
