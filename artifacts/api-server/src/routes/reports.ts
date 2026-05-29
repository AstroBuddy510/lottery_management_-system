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
  salesLogsTable,
  gamesTable,
  systemSettingsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { GetWriterReportParams, GetAgentReportParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { calculateWriter } from "../lib/calculator";

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

// ── GET /reports/agent/:agentId/game-sales ────────────────────────────────────
router.get(
  "/reports/agent/:agentId/game-sales",
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
      .select({ id: writersTable.id, fullCode: writersTable.fullCode, fullName: writersTable.fullName })
      .from(writersTable)
      .where(eq(writersTable.agentId, agentId));

    if (writers.length === 0) {
      res.json({
        agent: agentRow,
        summary: { totalEntries: 0, totalAmount: "0.00", gameTypeCount: 0, writerCount: 0 },
        byGameType: [],
        byWriter: [],
        entries: [],
      });
      return;
    }

    const writerIds = writers.map(w => w.id);
    const writerMap = new Map(writers.map(w => [w.id, w]));

    const conditions = [inArray(salesLogsTable.writerId, writerIds)];
    if (dateFrom) conditions.push(gte(salesLogsTable.saleDate, dateFrom));
    if (dateTo) conditions.push(lte(salesLogsTable.saleDate, dateTo));

    const sales = await db
      .select()
      .from(salesLogsTable)
      .where(and(...conditions))
      .orderBy(desc(salesLogsTable.saleDate));

    const totalAmount = sales.reduce((s, e) => s + parseFloat(e.ticketAmount), 0);

    // Group by game type
    const gameTypeMap = new Map<string, { ticketCount: number; totalAmount: number; writerAmounts: Map<string, number> }>();
    for (const s of sales) {
      let entry = gameTypeMap.get(s.gameType);
      if (!entry) { entry = { ticketCount: 0, totalAmount: 0, writerAmounts: new Map() }; gameTypeMap.set(s.gameType, entry); }
      entry.ticketCount++;
      entry.totalAmount += parseFloat(s.ticketAmount);
      entry.writerAmounts.set(s.writerId, (entry.writerAmounts.get(s.writerId) ?? 0) + parseFloat(s.ticketAmount));
    }

    const byGameType = [...gameTypeMap.entries()]
      .sort((a, b) => b[1].totalAmount - a[1].totalAmount)
      .map(([gameType, data]) => ({
        gameType,
        ticketCount: data.ticketCount,
        totalAmount: data.totalAmount.toFixed(2),
        pct: totalAmount > 0 ? Math.round((data.totalAmount / totalAmount) * 1000) / 10 : 0,
        writers: [...data.writerAmounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([writerId, amount]) => ({
            writer: writerMap.get(writerId) ?? { id: writerId, fullCode: "—", fullName: "—" },
            ticketCount: sales.filter(s => s.writerId === writerId && s.gameType === gameType).length,
            totalAmount: amount.toFixed(2),
          })),
      }));

    // Group by writer
    const writerAmountMap = new Map<string, { ticketCount: number; totalAmount: number; byGameType: Map<string, { ticketCount: number; totalAmount: number }> }>();
    for (const s of sales) {
      let entry = writerAmountMap.get(s.writerId);
      if (!entry) { entry = { ticketCount: 0, totalAmount: 0, byGameType: new Map() }; writerAmountMap.set(s.writerId, entry); }
      entry.ticketCount++;
      entry.totalAmount += parseFloat(s.ticketAmount);
      let gt = entry.byGameType.get(s.gameType);
      if (!gt) { gt = { ticketCount: 0, totalAmount: 0 }; entry.byGameType.set(s.gameType, gt); }
      gt.ticketCount++;
      gt.totalAmount += parseFloat(s.ticketAmount);
    }

    const byWriter = [...writerAmountMap.entries()]
      .sort((a, b) => b[1].totalAmount - a[1].totalAmount)
      .map(([writerId, data]) => ({
        writer: writerMap.get(writerId) ?? { id: writerId, fullCode: "—", fullName: "—" },
        ticketCount: data.ticketCount,
        totalAmount: data.totalAmount.toFixed(2),
        pct: totalAmount > 0 ? Math.round((data.totalAmount / totalAmount) * 1000) / 10 : 0,
        byGameType: [...data.byGameType.entries()]
          .sort((a, b) => b[1].totalAmount - a[1].totalAmount)
          .map(([gameType, gt]) => ({ gameType, ticketCount: gt.ticketCount, totalAmount: gt.totalAmount.toFixed(2) })),
      }));

    // Fetch all games in the date range
    const gameConditions = [];
    if (dateFrom) gameConditions.push(gte(gamesTable.goLiveAt, new Date(dateFrom)));
    if (dateTo) gameConditions.push(lte(gamesTable.goLiveAt, new Date(dateTo)));

    const allGamesInPeriod = await db
      .select()
      .from(gamesTable)
      .where(gameConditions.length > 0 ? and(...gameConditions) : undefined)
      .orderBy(desc(gamesTable.goLiveAt));

    // Fetch system settings
    const [settings] = await db
      .select()
      .from(systemSettingsTable)
      .orderBy(desc(systemSettingsTable.updatedAt))
      .limit(1);
    const commissionPct = settings ? parseFloat(settings.commissionPct) : 0.20;
    const reservePct = settings ? parseFloat(settings.reservePct) : 0.05;

    const gameFinancials = [];

    for (const g of allGamesInPeriod) {
      // Fetch daily calculations for this game and this agent's writers
      const gameCalcs = await db
        .select()
        .from(dailyCalculationsTable)
        .where(
          and(
            eq(dailyCalculationsTable.gameId, g.id),
            inArray(dailyCalculationsTable.writerId, writerIds)
          )
        );

      let grossSales = 0;
      let commission = 0;
      let netGross = 0;
      let wins = 0;
      let reserve = 0;
      let balance = 0;
      let hasActivity = false;

      if (gameCalcs.length > 0) {
        hasActivity = true;
        for (const c of gameCalcs) {
          grossSales += parseFloat(c.grossSales ?? "0");
          commission += parseFloat(c.commissionAmount ?? "0");
          netGross += parseFloat(c.netGross ?? "0");
          wins += parseFloat(c.winsAmount ?? "0");
          reserve += parseFloat(c.reserveAmount ?? "0");
          balance += parseFloat(c.writerBalance ?? "0");
        }
      } else {
        // Fetch entries to calculate on the fly
        const grossEntries = await db
          .select()
          .from(grossEntriesTable)
          .where(
            and(
              eq(grossEntriesTable.gameId, g.id),
              inArray(grossEntriesTable.writerId, writerIds)
            )
          );
        const winsEntries = await db
          .select()
          .from(winsEntriesTable)
          .where(
            and(
              eq(winsEntriesTable.gameId, g.id),
              inArray(winsEntriesTable.writerId, writerIds)
            )
          );

        if (grossEntries.length > 0 || winsEntries.length > 0) {
          hasActivity = true;
          const wGrossMap = new Map<string, number>();
          for (const e of grossEntries) {
            wGrossMap.set(e.writerId, (wGrossMap.get(e.writerId) ?? 0) + parseFloat(e.grossAmount));
          }
          const wWinsMap = new Map<string, number>();
          for (const e of winsEntries) {
            wWinsMap.set(e.writerId, (wWinsMap.get(e.writerId) ?? 0) + parseFloat(e.winsAmount));
          }
          const activeWIds = [...new Set([...wGrossMap.keys(), ...wWinsMap.keys()])];
          for (const wId of activeWIds) {
            const gr = wGrossMap.get(wId) ?? 0;
            const wn = wWinsMap.get(wId) ?? 0;
            const res = calculateWriter(gr, wn, commissionPct, reservePct);
            grossSales += res.grossSales;
            commission += res.commissionAmount;
            netGross += res.netGross;
            wins += res.winsAmount;
            reserve += res.reserveAmount;
            balance += res.writerBalance;
          }
        }
      }

      if (hasActivity) {
        gameFinancials.push({
          gameId: g.id,
          gameName: g.name,
          eventNumber: g.eventNumber ?? "—",
          goLiveAt: g.goLiveAt,
          closeAt: g.closeAt,
          grossSales: grossSales.toFixed(2),
          commission: commission.toFixed(2),
          netGross: netGross.toFixed(2),
          wins: wins.toFixed(2),
          reserve: reserve.toFixed(2),
          balance: balance.toFixed(2),
        });
      }
    }

    res.json({
      agent: agentRow,
      summary: {
        totalEntries: sales.length,
        totalAmount: totalAmount.toFixed(2),
        gameTypeCount: gameTypeMap.size,
        writerCount: writerAmountMap.size,
      },
      byGameType,
      byWriter,
      entries: sales.map(s => ({
        id: s.id,
        saleDate: s.saleDate,
        gameType: s.gameType,
        ticketAmount: s.ticketAmount,
        writerId: s.writerId,
        writerCode: writerMap.get(s.writerId)?.fullCode ?? "—",
        writerFullName: writerMap.get(s.writerId)?.fullName ?? "—",
        imageUrl: s.imageUrl,
      })),
      gameFinancials,
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
  }
);

// ── GET /reports/game/:gameId ──────────────────────────────────────────────────
router.get(
  "/reports/game/:gameId",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const gameId = req.params.gameId as string;

    const [game] = await db
      .select()
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1);

    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }

    let calcs = await db
      .select({
        calc: dailyCalculationsTable,
        writer: {
          id: writersTable.id,
          fullName: writersTable.fullName,
          fullCode: writersTable.fullCode,
          agentId: writersTable.agentId,
        },
        agent: {
          id: agentsTable.id,
          fullCode: agentsTable.fullCode,
          agencyName: agentsTable.agencyName,
        },
        agentUser: {
          fullName: usersTable.fullName,
        }
      })
      .from(dailyCalculationsTable)
      .innerJoin(writersTable, eq(dailyCalculationsTable.writerId, writersTable.id))
      .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(dailyCalculationsTable.gameId, gameId));

    if (calcs.length === 0) {
      // Fetch system settings
      const [settings] = await db
        .select()
        .from(systemSettingsTable)
        .orderBy(desc(systemSettingsTable.updatedAt))
        .limit(1);
      const commissionPct = settings ? parseFloat(settings.commissionPct) : 0.20;
      const reservePct = settings ? parseFloat(settings.reservePct) : 0.05;

      // Fetch entries
      const grossEntries = await db
        .select()
        .from(grossEntriesTable)
        .where(eq(grossEntriesTable.gameId, gameId));

      const winsEntries = await db
        .select()
        .from(winsEntriesTable)
        .where(eq(winsEntriesTable.gameId, gameId));

      // Get all writer IDs who have activity
      const grossMap = new Map<string, number>();
      for (const e of grossEntries) {
        grossMap.set(e.writerId, (grossMap.get(e.writerId) ?? 0) + parseFloat(e.grossAmount));
      }
      const winsMap = new Map<string, number>();
      for (const e of winsEntries) {
        winsMap.set(e.writerId, (winsMap.get(e.writerId) ?? 0) + parseFloat(e.winsAmount));
      }
      const activeWriterIds = [...new Set([...grossMap.keys(), ...winsMap.keys()])];

      if (activeWriterIds.length > 0) {
        // Fetch writer/agent details for active writers
        const writersInfo = await db
          .select({
            writer: {
              id: writersTable.id,
              fullName: writersTable.fullName,
              fullCode: writersTable.fullCode,
              agentId: writersTable.agentId,
            },
            agent: {
              id: agentsTable.id,
              fullCode: agentsTable.fullCode,
              agencyName: agentsTable.agencyName,
            },
            agentUser: {
              fullName: usersTable.fullName,
            }
          })
          .from(writersTable)
          .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
          .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
          .where(inArray(writersTable.id, activeWriterIds));

        // Construct mock calcs array
        const mockCalcs = [];
        for (const wInfo of writersInfo) {
          const gross = grossMap.get(wInfo.writer.id) ?? 0;
          const wins = winsMap.get(wInfo.writer.id) ?? 0;
          const calcResult = calculateWriter(gross, wins, commissionPct, reservePct);
          
          mockCalcs.push({
            calc: {
              id: `mock-${wInfo.writer.id}`,
              writerId: wInfo.writer.id,
              gameId: gameId,
              calcDate: game.goLiveAt,
              grossSales: calcResult.grossSales.toFixed(2),
              commissionPct: calcResult.commissionPct.toFixed(4),
              commissionAmount: calcResult.commissionAmount.toFixed(2),
              netGross: calcResult.netGross.toFixed(2),
              winsAmount: calcResult.winsAmount.toFixed(2),
              reservePct: calcResult.reservePct.toFixed(4),
              reserveAmount: calcResult.reserveAmount.toFixed(2),
              writerBalance: calcResult.writerBalance.toFixed(2),
              reserveBalanceAfter: "0.00",
              reserveDrawAmount: "0.00",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            writer: wInfo.writer,
            agent: wInfo.agent,
            agentUser: wInfo.agentUser,
          });
        }
        calcs = mockCalcs as any;
      }
    }

    const totals = {
      grossSales: 0,
      commissionAmount: 0,
      netGross: 0,
      winsAmount: 0,
      reserveAmount: 0,
      writerBalance: 0,
    };

    const agentMap = new Map<string, {
      agent: { id: string; fullCode: string; agencyName: string | null; ownerName: string };
      totals: typeof totals;
    }>();

    const writerMap = new Map<string, {
      writer: { id: string; fullCode: string; fullName: string; agentId: string };
      totals: typeof totals;
    }>();

    for (const row of calcs) {
      const gs = parseFloat(row.calc.grossSales ?? "0");
      const comm = parseFloat(row.calc.commissionAmount ?? "0");
      const ng = parseFloat(row.calc.netGross ?? "0");
      const wins = parseFloat(row.calc.winsAmount ?? "0");
      const resAmt = parseFloat(row.calc.reserveAmount ?? "0");
      const bal = parseFloat(row.calc.writerBalance ?? "0");

      totals.grossSales += gs;
      totals.commissionAmount += comm;
      totals.netGross += ng;
      totals.winsAmount += wins;
      totals.reserveAmount += resAmt;
      totals.writerBalance += bal;

      let agentEntry = agentMap.get(row.agent.id);
      if (!agentEntry) {
        agentEntry = {
          agent: {
            id: row.agent.id,
            fullCode: row.agent.fullCode,
            agencyName: row.agent.agencyName,
            ownerName: row.agentUser.fullName ?? "—",
          },
          totals: { grossSales: 0, commissionAmount: 0, netGross: 0, winsAmount: 0, reserveAmount: 0, writerBalance: 0 },
        };
        agentMap.set(row.agent.id, agentEntry);
      }
      agentEntry.totals.grossSales += gs;
      agentEntry.totals.commissionAmount += comm;
      agentEntry.totals.netGross += ng;
      agentEntry.totals.winsAmount += wins;
      agentEntry.totals.reserveAmount += resAmt;
      agentEntry.totals.writerBalance += bal;

      let writerEntry = writerMap.get(row.writer.id);
      if (!writerEntry) {
        writerEntry = {
          writer: {
            id: row.writer.id,
            fullCode: row.writer.fullCode,
            fullName: row.writer.fullName,
            agentId: row.writer.agentId,
          },
          totals: { grossSales: 0, commissionAmount: 0, netGross: 0, winsAmount: 0, reserveAmount: 0, writerBalance: 0 },
        };
        writerMap.set(row.writer.id, writerEntry);
      }
      writerEntry.totals.grossSales += gs;
      writerEntry.totals.commissionAmount += comm;
      writerEntry.totals.netGross += ng;
      writerEntry.totals.winsAmount += wins;
      writerEntry.totals.reserveAmount += resAmt;
      writerEntry.totals.writerBalance += bal;
    }

    const formatTotals = (t: typeof totals) => ({
      grossSales: t.grossSales.toFixed(2),
      commissionAmount: t.commissionAmount.toFixed(2),
      netGross: t.netGross.toFixed(2),
      winsAmount: t.winsAmount.toFixed(2),
      reserveAmount: t.reserveAmount.toFixed(2),
      writerBalance: t.writerBalance.toFixed(2),
    });

    res.json({
      game,
      calculationsCount: calcs.length,
      totals: formatTotals(totals),
      agents: [...agentMap.values()].map(a => ({
        agent: a.agent,
        totals: formatTotals(a.totals),
      })),
      writers: [...writerMap.values()].map(w => ({
        writer: w.writer,
        totals: formatTotals(w.totals),
      })),
    });
  }
);

export default router;
