import { Router } from "express";
import {
  db,
  dailyCalculationsTable,
  writersTable,
  agentsTable,
  usersTable,
  grossEntriesTable,
  winsEntriesTable,
  paymentsTable,
  reserveAllocationsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { GetWriterReportParams, GetAgentReportParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

type ReportRow = {
  calcDate?: string;
  grossSales: string;
  commissionAmount: string;
  netGross: string;
  winsAmount: string;
  reserveAmount: string;
  writerBalance: string;
};

function calcToRow(c: typeof dailyCalculationsTable.$inferSelect): ReportRow {
  return {
    calcDate: c.calcDate,
    grossSales: c.grossSales,
    commissionAmount: c.commissionAmount,
    netGross: c.netGross,
    winsAmount: c.winsAmount,
    reserveAmount: c.reserveAmount,
    writerBalance: c.writerBalance,
  };
}

function sumRows(rows: ReportRow[]): ReportRow {
  const acc = { grossSales: 0, commissionAmount: 0, netGross: 0, winsAmount: 0, reserveAmount: 0, writerBalance: 0 };
  for (const r of rows) {
    acc.grossSales += parseFloat(r.grossSales ?? "0");
    acc.commissionAmount += parseFloat(r.commissionAmount ?? "0");
    acc.netGross += parseFloat(r.netGross ?? "0");
    acc.winsAmount += parseFloat(r.winsAmount ?? "0");
    acc.reserveAmount += parseFloat(r.reserveAmount ?? "0");
    acc.writerBalance += parseFloat(r.writerBalance ?? "0");
  }
  return {
    grossSales: acc.grossSales.toFixed(2),
    commissionAmount: acc.commissionAmount.toFixed(2),
    netGross: acc.netGross.toFixed(2),
    winsAmount: acc.winsAmount.toFixed(2),
    reserveAmount: acc.reserveAmount.toFixed(2),
    writerBalance: acc.writerBalance.toFixed(2),
  };
}

// ── GET /reports/writer/:writerId ─────────────────────────────────────────────
router.get(
  "/reports/writer/:writerId",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const paramsResult = GetWriterReportParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const writerId = paramsResult.data.writerId;

    const [writer] = await db
      .select({
        id: writersTable.id,
        fullName: writersTable.fullName,
        fullCode: writersTable.fullCode,
        writerCode: writersTable.writerCode,
        agentId: writersTable.agentId,
        isActive: writersTable.isActive,
        createdAt: writersTable.createdAt,
      })
      .from(writersTable)
      .where(eq(writersTable.id, writerId))
      .limit(1);

    if (!writer) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }

    const calcConds = [eq(dailyCalculationsTable.writerId, writerId)];
    if (dateFrom) calcConds.push(gte(dailyCalculationsTable.calcDate, dateFrom));
    if (dateTo) calcConds.push(lte(dailyCalculationsTable.calcDate, dateTo));

    const grossConds = [eq(grossEntriesTable.writerId, writerId), eq(grossEntriesTable.locked, false)];
    const winsConds = [eq(winsEntriesTable.writerId, writerId), eq(winsEntriesTable.locked, false)];
    if (dateFrom) { grossConds.push(gte(grossEntriesTable.entryDate, dateFrom)); winsConds.push(gte(winsEntriesTable.entryDate, dateFrom)); }
    if (dateTo) { grossConds.push(lte(grossEntriesTable.entryDate, dateTo)); winsConds.push(lte(winsEntriesTable.entryDate, dateTo)); }

    const [calculations, pendingGross, pendingWins] = await Promise.all([
      db.select().from(dailyCalculationsTable).where(and(...calcConds)).orderBy(desc(dailyCalculationsTable.calcDate)),
      db.select({ id: grossEntriesTable.id, entryDate: grossEntriesTable.entryDate, grossAmount: grossEntriesTable.grossAmount }).from(grossEntriesTable).where(and(...grossConds)).orderBy(desc(grossEntriesTable.entryDate)),
      db.select({ id: winsEntriesTable.id, entryDate: winsEntriesTable.entryDate, winsAmount: winsEntriesTable.winsAmount }).from(winsEntriesTable).where(and(...winsConds)).orderBy(desc(winsEntriesTable.entryDate)),
    ]);

    const rows = calculations.map(calcToRow);

    res.json({
      writer,
      totals: sumRows(rows),
      rows,
      pending: {
        grossEntries: pendingGross,
        winsEntries: pendingWins,
        totalGross: pendingGross.reduce((s, e) => s + parseFloat(e.grossAmount), 0).toFixed(2),
        totalWins: pendingWins.reduce((s, e) => s + parseFloat(e.winsAmount), 0).toFixed(2),
      },
    });
  },
);

// ── GET /reports/agent/:agentId ───────────────────────────────────────────────
router.get(
  "/reports/agent/:agentId",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const paramsResult = GetAgentReportParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const agentId = paramsResult.data.agentId;

    const [agentRow] = await db
      .select({
        id: agentsTable.id,
        fullCode: agentsTable.fullCode,
        agentCode: agentsTable.agentCode,
        userId: agentsTable.userId,
        isActive: agentsTable.isActive,
        status: agentsTable.status,
        agencyName: agentsTable.agencyName,
        outstandingDebt: agentsTable.outstandingDebt,
        createdAt: agentsTable.createdAt,
        user: { id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone, role: usersTable.role },
      })
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(agentsTable.id, agentId))
      .limit(1);

    if (!agentRow) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const writers = await db
      .select({ id: writersTable.id, fullCode: writersTable.fullCode, fullName: writersTable.fullName, writerCode: writersTable.writerCode, agentId: writersTable.agentId, isActive: writersTable.isActive, createdAt: writersTable.createdAt })
      .from(writersTable)
      .where(eq(writersTable.agentId, agentId));

    const allCalcRows: ReportRow[] = [];
    const writerSummaries = [];

    for (const w of writers) {
      const conds = [eq(dailyCalculationsTable.writerId, w.id)];
      if (dateFrom) conds.push(gte(dailyCalculationsTable.calcDate, dateFrom));
      if (dateTo) conds.push(lte(dailyCalculationsTable.calcDate, dateTo));
      const calcs = await db.select().from(dailyCalculationsTable).where(and(...conds)).orderBy(desc(dailyCalculationsTable.calcDate));
      const writerRows = calcs.map(calcToRow);
      allCalcRows.push(...writerRows);
      writerSummaries.push({ writer: w, totals: sumRows(writerRows), rows: writerRows });
    }

    const paymentConds = [eq(paymentsTable.agentId, agentId), eq(paymentsTable.isVoided, false)];
    if (dateFrom) paymentConds.push(gte(paymentsTable.paymentDate, dateFrom));
    if (dateTo) paymentConds.push(lte(paymentsTable.paymentDate, dateTo));
    const payments = await db
      .select({ id: paymentsTable.id, paymentDate: paymentsTable.paymentDate, amount: paymentsTable.amount, grossAmount: paymentsTable.grossAmount, transactionType: paymentsTable.transactionType, receiptNumber: paymentsTable.receiptNumber, notes: paymentsTable.notes })
      .from(paymentsTable)
      .where(and(...paymentConds))
      .orderBy(desc(paymentsTable.paymentDate));

    res.json({
      agent: agentRow,
      totals: sumRows(allCalcRows),
      writers: writerSummaries,
      payments,
      totalPaid: payments.reduce((s, p) => s + parseFloat(p.amount), 0).toFixed(2),
    });
  },
);

// ── GET /reports/organization ─────────────────────────────────────────────────
router.get(
  "/reports/organization",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string>;

    const agents = await db
      .select({
        id: agentsTable.id,
        fullCode: agentsTable.fullCode,
        agentCode: agentsTable.agentCode,
        userId: agentsTable.userId,
        isActive: agentsTable.isActive,
        status: agentsTable.status,
        agencyName: agentsTable.agencyName,
        outstandingDebt: agentsTable.outstandingDebt,
        createdAt: agentsTable.createdAt,
        user: { id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone, role: usersTable.role },
      })
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id));

    const allCalcRows: ReportRow[] = [];
    const agentSummaries = [];

    for (const agent of agents) {
      const agentWriters = await db.select({ id: writersTable.id }).from(writersTable).where(eq(writersTable.agentId, agent.id));
      const agentCalcRows: ReportRow[] = [];
      for (const w of agentWriters) {
        const conds = [eq(dailyCalculationsTable.writerId, w.id)];
        if (dateFrom) conds.push(gte(dailyCalculationsTable.calcDate, dateFrom));
        if (dateTo) conds.push(lte(dailyCalculationsTable.calcDate, dateTo));
        const calcs = await db.select().from(dailyCalculationsTable).where(and(...conds));
        agentCalcRows.push(...calcs.map(calcToRow));
      }
      allCalcRows.push(...agentCalcRows);
      agentSummaries.push({ agent, totals: sumRows(agentCalcRows) });
    }

    res.json({
      totals: sumRows(allCalcRows),
      agents: agentSummaries,
    });
  },
);

// ── GET /reports/wins-debt ────────────────────────────────────────────────────
router.get(
  "/reports/wins-debt",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const allWinsEntries = await db
      .select({
        id: winsEntriesTable.id,
        writerId: winsEntriesTable.writerId,
        entryDate: winsEntriesTable.entryDate,
        winsAmount: winsEntriesTable.winsAmount,
        locked: winsEntriesTable.locked,
        writerName: writersTable.fullName,
        writerCode: writersTable.fullCode,
        agentId: writersTable.agentId,
      })
      .from(winsEntriesTable)
      .innerJoin(writersTable, eq(winsEntriesTable.writerId, writersTable.id));

    const agentIds = [...new Set(allWinsEntries.map((e) => e.agentId))];
    const agents =
      agentIds.length > 0
        ? await db
            .select({ id: agentsTable.id, fullCode: agentsTable.fullCode, fullName: usersTable.fullName })
            .from(agentsTable)
            .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
            .where(inArray(agentsTable.id, agentIds))
        : [];
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    const allCalcs = await db.select().from(dailyCalculationsTable).orderBy(desc(dailyCalculationsTable.calcDate));
    const calcMap = new Map<string, (typeof allCalcs)[0]>();
    for (const c of allCalcs) calcMap.set(`${c.writerId}__${c.calcDate}`, c);

    const allAllocs = await db.select().from(reserveAllocationsTable);
    const allocMap = new Map<string, number>();
    for (const a of allAllocs) {
      const key = `${a.writerId}__${a.allocationDate}`;
      allocMap.set(key, (allocMap.get(key) ?? 0) + parseFloat(a.amountDrawn));
    }

    const pending = allWinsEntries.filter((e) => !e.locked);
    const calculated = allWinsEntries.filter((e) => e.locked);
    const totalReserveDrawn = allAllocs.reduce((s, a) => s + parseFloat(a.amountDrawn), 0);

    let clearedByAgentNet = 0;
    let remainingDeficit = 0;
    for (const calc of allCalcs) {
      const balance = parseFloat(calc.writerBalance);
      const draws = allocMap.get(`${calc.writerId}__${calc.calcDate}`) ?? 0;
      const wins = parseFloat(calc.winsAmount);
      if (balance >= 0) { clearedByAgentNet += wins - draws; }
      else {
        remainingDeficit += Math.abs(balance);
        const ap = wins - draws - Math.abs(balance);
        if (ap > 0) clearedByAgentNet += ap;
      }
    }

    const buckets = { under7: { count: 0, amount: 0 }, d7to14: { count: 0, amount: 0 }, d14to30: { count: 0, amount: 0 }, over30: { count: 0, amount: 0 } };
    for (const e of pending) {
      const days = Math.floor((today.getTime() - new Date(e.entryDate).getTime()) / 86400000);
      const amt = parseFloat(e.winsAmount);
      if (days < 7) { buckets.under7.count++; buckets.under7.amount += amt; }
      else if (days < 14) { buckets.d7to14.count++; buckets.d7to14.amount += amt; }
      else if (days < 30) { buckets.d14to30.count++; buckets.d14to30.amount += amt; }
      else { buckets.over30.count++; buckets.over30.amount += amt; }
    }

    const speeds: number[] = [];
    for (const e of calculated) {
      const calc = calcMap.get(`${e.writerId}__${e.entryDate}`);
      if (calc) speeds.push(Math.max(0, Math.round((new Date(calc.calcDate).getTime() - new Date(e.entryDate).getTime()) / 86400000)));
    }

    const queue = pending
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      .map((e) => {
        const days = Math.floor((today.getTime() - new Date(e.entryDate).getTime()) / 86400000);
        const agent = agentMap.get(e.agentId);
        return { id: e.id, writerId: e.writerId, writerName: e.writerName, writerCode: e.writerCode, agentId: e.agentId, agentName: agent?.fullName ?? "—", agentCode: agent?.fullCode ?? "—", entryDate: e.entryDate, winsAmount: e.winsAmount, daysInQueue: days, urgency: days < 7 ? "ok" : days < 14 ? "warning" : ("critical" as const) };
      });

    const history = calculated
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
      .slice(0, 100)
      .map((e) => {
        const calc = calcMap.get(`${e.writerId}__${e.entryDate}`);
        const agent = agentMap.get(e.agentId);
        const draws = calc ? (allocMap.get(`${calc.writerId}__${calc.calcDate}`) ?? 0) : 0;
        const balance = calc ? parseFloat(calc.writerBalance) : 0;
        const daysToCalc = calc ? Math.max(0, Math.round((new Date(calc.calcDate).getTime() - new Date(e.entryDate).getTime()) / 86400000)) : 0;
        return { calcDate: e.entryDate, writerId: e.writerId, writerName: e.writerName, writerCode: e.writerCode, agentName: agent?.fullName ?? "—", winsAmount: e.winsAmount, clearedBy: balance < 0 ? "deficit" : draws > 0 ? "reserve" : "agent_net", reserveDrawn: draws.toFixed(2), daysToCalculate: daysToCalc, writerBalance: calc?.writerBalance ?? "0.00" };
      });

    res.json({
      summary: {
        totalWinsRecorded: allWinsEntries.reduce((s, e) => s + parseFloat(e.winsAmount), 0).toFixed(2),
        totalCalculated: calculated.reduce((s, e) => s + parseFloat(e.winsAmount), 0).toFixed(2),
        totalPending: pending.reduce((s, e) => s + parseFloat(e.winsAmount), 0).toFixed(2),
        clearedByAgentNet: Math.max(0, clearedByAgentNet).toFixed(2),
        clearedByReserve: totalReserveDrawn.toFixed(2),
        remainingDeficit: remainingDeficit.toFixed(2),
        pendingCount: pending.length,
        calculatedCount: calculated.length,
      },
      aging: {
        under7Days: { count: buckets.under7.count, amount: buckets.under7.amount.toFixed(2) },
        days7to14: { count: buckets.d7to14.count, amount: buckets.d7to14.amount.toFixed(2) },
        days14to30: { count: buckets.d14to30.count, amount: buckets.d14to30.amount.toFixed(2) },
        over30Days: { count: buckets.over30.count, amount: buckets.over30.amount.toFixed(2) },
      },
      paymentSpeed: speeds.length > 0
        ? { avgDaysToCalculate: Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10, fastestDays: Math.min(...speeds), slowestDays: Math.max(...speeds) }
        : { avgDaysToCalculate: null, fastestDays: null, slowestDays: null },
      queue,
      history,
    });
  },
);

export default router;
