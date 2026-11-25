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
import { eq, and, gte, lte, desc, asc, inArray, sql, isNull } from "drizzle-orm";
import { GetWriterReportParams, GetAgentReportParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { calculateWriter, currentRates, toPesewas, waterfallFromStored } from "../lib/calculator";
import { quoteDueLedgers } from "../lib/postpaid";
import { TICKET_VALIDITY_DAYS } from "../lib/receipt";

const router = Router();

/**
 * One statement row, in the platform waterfall order. Net After Reserve and
 * Profit/(Deficit) are derived from the stored components (see
 * waterfallFromStored), so a statement is right by construction; netGross and
 * writerBalance keep their old names for screens that still read them and
 * carry the same values (Net After Commission, Profit/(Deficit)).
 */
type ReportRow = {
  calcDate?: string;
  grossSales: string;
  commissionAmount: string;
  netGross: string;
  reserveAmount: string;
  netAfterReserve: string;
  winsAmount: string;
  profitOrDeficit: string;
  writerBalance: string;
};

const pes = (p: number) => (p / 100).toFixed(2);

function calcToRow(c: typeof dailyCalculationsTable.$inferSelect): ReportRow {
  const w = waterfallFromStored(c);
  return {
    calcDate: c.calcDate,
    grossSales: pes(w.gross),
    commissionAmount: pes(w.commission),
    netGross: pes(w.net),
    reserveAmount: pes(w.reserve),
    netAfterReserve: pes(w.netAfterReserve),
    winsAmount: pes(w.wins),
    profitOrDeficit: pes(w.profitOrDeficit),
    writerBalance: pes(w.profitOrDeficit),
  };
}

/** Column sums in whole pesewas, so totals equal the sum of the rows shown. */
function sumRows(rows: ReportRow[]): ReportRow {
  const acc = { gross: 0, commission: 0, net: 0, reserve: 0, nar: 0, wins: 0, pd: 0 };
  for (const r of rows) {
    acc.gross += toPesewas(r.grossSales);
    acc.commission += toPesewas(r.commissionAmount);
    acc.net += toPesewas(r.netGross);
    acc.reserve += toPesewas(r.reserveAmount);
    acc.nar += toPesewas(r.netAfterReserve);
    acc.wins += toPesewas(r.winsAmount);
    acc.pd += toPesewas(r.profitOrDeficit);
  }
  return {
    grossSales: pes(acc.gross),
    commissionAmount: pes(acc.commission),
    netGross: pes(acc.net),
    reserveAmount: pes(acc.reserve),
    netAfterReserve: pes(acc.nar),
    winsAmount: pes(acc.wins),
    profitOrDeficit: pes(acc.pd),
    writerBalance: pes(acc.pd),
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

    // Only money that actually moved: completed, not voided. A pending or
    // rejected cash request (which has no receipt) is not a payment.
    const paymentConds = [eq(paymentsTable.agentId, agentId), eq(paymentsTable.isVoided, false), eq(paymentsTable.status, "completed")];
    if (dateFrom) paymentConds.push(gte(paymentsTable.paymentDate, dateFrom));
    if (dateTo) paymentConds.push(lte(paymentsTable.paymentDate, dateTo));
    const payments = await db
      .select({ id: paymentsTable.id, paymentDate: paymentsTable.paymentDate, amount: paymentsTable.amount, grossAmount: paymentsTable.grossAmount, transactionType: paymentsTable.transactionType, receiptNumber: paymentsTable.receiptNumber, notes: paymentsTable.notes })
      .from(paymentsTable)
      .where(and(...paymentConds))
      .orderBy(desc(paymentsTable.paymentDate));

    // Pay-ins and pay-outs are opposite directions: a pay-in is the agency
    // handing the company cash, a pay-out the company handing the agency
    // cash. They are totalled apart and netted, never added together.
    const payInP = payments.filter((p) => p.transactionType === "pay_in").reduce((s, p) => s + toPesewas(p.amount), 0);
    const payOutP = payments.filter((p) => p.transactionType === "pay_out").reduce((s, p) => s + toPesewas(p.amount), 0);
    const totals = sumRows(allCalcRows);
    const netPaymentsP = payInP - payOutP;
    // Profit/(Deficit) is what the draws left the agency owing (+) or owed
    // (-); net cash it has already handed over settles that much of it.
    const netBalanceDueP = toPesewas(totals.profitOrDeficit) - netPaymentsP;

    res.json({
      agent: agentRow,
      totals,
      writers: writerSummaries,
      payments,
      totalPayIn: pes(payInP),
      totalPayOut: pes(payOutP),
      netPayments: pes(netPaymentsP),
      netBalanceDue: pes(netBalanceDueP),
      /** @deprecated the net of pay-ins and pay-outs; read netPayments. */
      totalPaid: pes(netPaymentsP),
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

// ── GET /reports/game-names ───────────────────────────────────────────────────
/**
 * The games a report can be run for, by name rather than by draw.
 *
 * A game runs many times - "Monday Special" has an event a week - and the
 * question the report answers is how a game performs over a period, not how
 * one draw did. So the selector offers names, and the period decides which of
 * that name's events are counted.
 */
router.get(
  "/reports/game-names",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (_req, res) => {
    const rows = await db
      .select({
        name: gamesTable.name,
        eventCount: sql<number>`count(*)::int`,
        firstEventAt: sql<Date>`min(${gamesTable.goLiveAt})`,
        lastEventAt: sql<Date>`max(${gamesTable.goLiveAt})`,
      })
      .from(gamesTable)
      .groupBy(gamesTable.name)
      .orderBy(asc(gamesTable.name));
    res.json(rows);
  },
);

// ── GET /reports/game-sales ───────────────────────────────────────────────────
/**
 * One game's sales over a period, broken down by agency.
 *
 * The tab was called Game Sales and had no way to select a game: it asked for
 * an agent and answered "how did this agent do", which is the Agent report.
 * This answers the question the name promises - for this game, over these
 * dates, which agencies sold it and what did each of them return.
 *
 * Figures come from daily_calculations, which is the locked per-writer,
 * per-game result the calculation run produces. Reading sales_logs instead
 * would have given a different gross from the one the agency is actually
 * settled on, and two screens in the same product disagreeing about money is
 * worse than one screen missing.
 */
router.get(
  "/reports/game-sales",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const gameName = typeof req.query["gameName"] === "string" ? req.query["gameName"].trim() : "";
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const agentFilter = typeof req.query["agentId"] === "string" ? req.query["agentId"] : "";

    if (!gameName) {
      res.status(400).json({ error: "A game must be selected" });
      return;
    }

    // Which draws of this game fall in the period. goLiveAt is when the game
    // opened, which is the date an operator means by "that week's draw".
    const gameConditions = [eq(gamesTable.name, gameName)];
    if (dateFrom) gameConditions.push(gte(gamesTable.goLiveAt, new Date(dateFrom)));
    if (dateTo) {
      // The To date is inclusive of its whole day, not midnight at its start.
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      gameConditions.push(lte(gamesTable.goLiveAt, end));
    }

    const events = await db
      .select({
        id: gamesTable.id,
        eventNumber: gamesTable.eventNumber,
        name: gamesTable.name,
        goLiveAt: gamesTable.goLiveAt,
        closeAt: gamesTable.closeAt,
        status: gamesTable.status,
      })
      .from(gamesTable)
      .where(and(...gameConditions))
      .orderBy(desc(gamesTable.goLiveAt));

    const empty = {
      game: { name: gameName, eventCount: 0, events: [] as typeof events },
      summary: {
        gross: "0.00", commission: "0.00", netGross: "0.00",
        wins: "0.00", reserve: "0.00", balance: "0.00",
        agencyCount: 0, writerCount: 0,
      },
      byAgent: [] as unknown[],
    };

    if (events.length === 0) {
      res.json(empty);
      return;
    }

    const eventIds = events.map((e) => e.id);

    const calcConditions = [inArray(dailyCalculationsTable.gameId, eventIds)];
    if (agentFilter) calcConditions.push(eq(agentsTable.id, agentFilter));

    const rows = await db
      .select({
        agentId: agentsTable.id,
        agentFullCode: agentsTable.fullCode,
        agencyName: agentsTable.agencyName,
        agentName: usersTable.fullName,
        writerId: writersTable.id,
        writerFullCode: writersTable.fullCode,
        writerName: writersTable.fullName,
        gameId: dailyCalculationsTable.gameId,
        grossSales: dailyCalculationsTable.grossSales,
        commissionAmount: dailyCalculationsTable.commissionAmount,
        netGross: dailyCalculationsTable.netGross,
        winsAmount: dailyCalculationsTable.winsAmount,
        reserveAmount: dailyCalculationsTable.reserveAmount,
        writerBalance: dailyCalculationsTable.writerBalance,
      })
      .from(dailyCalculationsTable)
      .innerJoin(writersTable, eq(writersTable.id, dailyCalculationsTable.writerId))
      .innerJoin(agentsTable, eq(agentsTable.id, writersTable.agentId))
      .innerJoin(usersTable, eq(usersTable.id, agentsTable.userId))
      .where(and(...calcConditions));

    type Money = {
      gross: number; commission: number; netGross: number;
      wins: number; reserve: number; balance: number;
    };
    const zero = (): Money => ({ gross: 0, commission: 0, netGross: 0, wins: 0, reserve: 0, balance: 0 });
    const add = (m: Money, r: typeof rows[number]) => {
      m.gross += parseFloat(r.grossSales ?? "0");
      m.commission += parseFloat(r.commissionAmount ?? "0");
      m.netGross += parseFloat(r.netGross ?? "0");
      m.wins += parseFloat(r.winsAmount ?? "0");
      m.reserve += parseFloat(r.reserveAmount ?? "0");
      m.balance += parseFloat(r.writerBalance ?? "0");
    };

    const agencies = new Map<string, {
      agentId: string; fullCode: string; agencyName: string | null; agentName: string;
      totals: Money;
      writers: Map<string, { writerId: string; fullCode: string; fullName: string; totals: Money; events: Set<string> }>;
      events: Set<string>;
    }>();
    const totals = zero();
    const allWriters = new Set<string>();

    for (const r of rows) {
      add(totals, r);
      allWriters.add(r.writerId);

      let a = agencies.get(r.agentId);
      if (!a) {
        a = {
          agentId: r.agentId, fullCode: r.agentFullCode, agencyName: r.agencyName,
          agentName: r.agentName, totals: zero(), writers: new Map(), events: new Set(),
        };
        agencies.set(r.agentId, a);
      }
      add(a.totals, r);
      if (r.gameId) a.events.add(r.gameId);

      let w = a.writers.get(r.writerId);
      if (!w) {
        w = { writerId: r.writerId, fullCode: r.writerFullCode, fullName: r.writerName, totals: zero(), events: new Set() };
        a.writers.set(r.writerId, w);
      }
      add(w.totals, r);
      if (r.gameId) w.events.add(r.gameId);
    }

    const money = (m: Money) => ({
      gross: m.gross.toFixed(2),
      commission: m.commission.toFixed(2),
      netGross: m.netGross.toFixed(2),
      wins: m.wins.toFixed(2),
      reserve: m.reserve.toFixed(2),
      balance: m.balance.toFixed(2),
    });

    const byAgent = [...agencies.values()]
      .sort((a, b) => b.totals.gross - a.totals.gross)
      .map((a) => ({
        agent: {
          id: a.agentId,
          fullCode: a.fullCode,
          agencyName: a.agencyName,
          agentName: a.agentName,
        },
        ...money(a.totals),
        // Share of the game's gross, so a reader can see concentration
        // without doing the division themselves.
        pct: totals.gross > 0 ? Math.round((a.totals.gross / totals.gross) * 1000) / 10 : 0,
        writerCount: a.writers.size,
        eventCount: a.events.size,
        writers: [...a.writers.values()]
          .sort((x, y) => y.totals.gross - x.totals.gross)
          .map((w) => ({
            writer: { id: w.writerId, fullCode: w.fullCode, fullName: w.fullName },
            ...money(w.totals),
            eventCount: w.events.size,
          })),
      }));

    res.json({
      game: { name: gameName, eventCount: events.length, events },
      summary: {
        ...money(totals),
        agencyCount: agencies.size,
        writerCount: allWriters.size,
      },
      byAgent,
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
    const { commissionPct, reservePct } = settings
      ? { commissionPct: parseFloat(settings.commissionPct), reservePct: parseFloat(settings.reservePct) }
      : await currentRates();

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

    // Draws still standing; a draw superseded by a re-run no longer counts.
    const allAllocs = await db.select().from(reserveAllocationsTable).where(isNull(reserveAllocationsTable.supersededAt));
    const autoCovered = new Map<string, number>();
    const manualCovered = new Map<string, number>();
    const allocMap = new Map<string, number>();

    for (const a of allAllocs) {
      const key = `${a.writerId}__${a.allocationDate}`;
      const amount = parseFloat(a.amountDrawn);
      allocMap.set(key, (allocMap.get(key) ?? 0) + amount);
      if (a.reason?.includes("Auto-draw")) {
        autoCovered.set(key, (autoCovered.get(key) ?? 0) + amount);
      } else {
        manualCovered.set(key, (manualCovered.get(key) ?? 0) + amount);
      }
    }

    const pending = allWinsEntries.filter((e) => !e.locked);
    const calculated = allWinsEntries.filter((e) => e.locked);
    const totalReserveDrawn = allAllocs.reduce((s, a) => s + parseFloat(a.amountDrawn), 0);

    let clearedByAgentNet = 0;
    let remainingDeficit = 0;
    for (const calc of allCalcs) {
      const balance = parseFloat(calc.writerBalance);
      const key = `${calc.writerId}__${calc.calcDate}`;
      const autoDraw = autoCovered.get(key) ?? 0;
      const manual = manualCovered.get(key) ?? 0;
      const draws = autoDraw + manual;
      const wins = parseFloat(calc.winsAmount);

      if (balance >= 0) {
        clearedByAgentNet += wins - draws;
      } else {
        // Full formula deficit, less everything the Reserve has put to it.
        const outstanding = Math.max(0, Math.abs(balance) - draws);
        remainingDeficit += outstanding;
        const ap = wins - draws - outstanding;
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
        const currentBalance = calc ? Math.abs(balance) : 0;
        const outstanding = calc ? Math.max(0, currentBalance - draws) : 0;
        const daysToCalc = calc ? Math.max(0, Math.round((new Date(calc.calcDate).getTime() - new Date(e.entryDate).getTime()) / 86400000)) : 0;

        let clearedBy: "deficit" | "reserve" | "agent_net" = "agent_net";
        if (balance < 0) {
          clearedBy = outstanding > 0.005 ? "deficit" : "reserve";
        } else if (draws > 0) {
          clearedBy = "reserve";
        }

        return {
          calcDate: e.entryDate,
          writerId: e.writerId,
          writerName: e.writerName,
          writerCode: e.writerCode,
          agentName: agent?.fullName ?? "—",
          winsAmount: e.winsAmount,
          clearedBy,
          reserveDrawn: draws.toFixed(2),
          daysToCalculate: daysToCalc,
          writerBalance: calc?.writerBalance ?? "0.00"
        };
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
      const { commissionPct, reservePct } = settings
        ? { commissionPct: parseFloat(settings.commissionPct), reservePct: parseFloat(settings.reservePct) }
        : await currentRates();

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

// ── GET /reports/sales-channels ───────────────────────────────────────────────
/**
 * Every sale in a period, by the way it was made.
 *
 *   prepaid   a POS ticket paid for from the writer's e-token float. Marked by
 *             the token transaction the sale debited - the only thing that
 *             says, per ticket, how it was paid. The writer's current
 *             operation model is not used: a writer moved from prepaid to
 *             postpaid last week still sold prepaid before that.
 *   postpaid  a POS ticket sold on credit, owed back through the postpaid
 *             ledger.
 *   manual    a gross figure an agent keyed in for a writer. Late entries an
 *             administrator has not confirmed are left out, as the daily
 *             calculation leaves them out, and reported on their own.
 *
 * Cancelled and void tickets are not sales and are not counted.
 *
 * The answer comes back at writer x game-name grain, so the page can regroup
 * by agency, writer or game without asking again. That grain is bounded by
 * the roster times the game names, not by the number of tickets.
 *
 * Postpaid collection comes from the postpaid ledger, which is what the
 * cashier settles against: commission and payable are the figures frozen when
 * betting closed, collected is what has been recorded as paid in, and
 * anything whose betting has not closed yet is "not yet due" rather than
 * outstanding.
 */
router.get(
  "/reports/sales-channels",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const isDate = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
    const rawFrom = req.query["dateFrom"];
    const rawTo = req.query["dateTo"];
    if ((rawFrom && !isDate(rawFrom)) || (rawTo && !isDate(rawTo))) {
      res.status(400).json({ error: "Dates must be YYYY-MM-DD" });
      return;
    }
    const from = isDate(rawFrom) ? rawFrom : null;
    const to = isDate(rawTo) ? rawTo : null;
    if (from && to && from > to) {
      res.status(400).json({ error: "The From date is after the To date" });
      return;
    }
    const agentId = typeof req.query["agentId"] === "string" && /^[0-9a-f-]{36}$/i.test(req.query["agentId"])
      ? req.query["agentId"]
      : null;

    // Ledgers whose betting has shut get their figures frozen now, so the
    // report does not call money "not yet due" that the writer already owes.
    await quoteDueLedgers(db);

    const agencyFilter = agentId ? sql`and w.agent_id = ${agentId}` : sql``;
    const ticketFrom = from ? sql`and t.created_at >= ${from}::date` : sql``;
    const ticketTo = to ? sql`and t.created_at < (${to}::date + 1)` : sql``;
    const entryFrom = from ? sql`and e.entry_date >= ${from}::date` : sql``;
    const entryTo = to ? sql`and e.entry_date <= ${to}::date` : sql``;
    const ledgerFrom = from ? sql`and l.ledger_date >= ${from}::date` : sql``;
    const ledgerTo = to ? sql`and l.ledger_date <= ${to}::date` : sql``;

    const [sold, keyed, ledger] = await Promise.all([
      db.execute(sql`
        select t.writer_id, g.name as game_name,
               coalesce(sum(t.stake_amount) filter (where t.token_transaction_id is not null), 0)::text as prepaid,
               count(*) filter (where t.token_transaction_id is not null)::int                          as prepaid_tickets,
               coalesce(sum(t.stake_amount) filter (where t.token_transaction_id is null), 0)::text     as postpaid,
               count(*) filter (where t.token_transaction_id is null)::int                              as postpaid_tickets
          from tickets t
          join writers w on w.id = t.writer_id
          join games g on g.id = t.game_id
         where t.status not in ('cancelled', 'void')
           ${ticketFrom} ${ticketTo} ${agencyFilter}
         group by t.writer_id, g.name`),
      db.execute(sql`
        select e.writer_id, coalesce(g.name, 'No game recorded') as game_name,
               coalesce(sum(e.gross_amount) filter (where not (e.is_late and not e.admin_confirmed)), 0)::text as manual,
               count(*) filter (where not (e.is_late and not e.admin_confirmed))::int                        as manual_entries,
               coalesce(sum(e.gross_amount) filter (where e.is_late and not e.admin_confirmed), 0)::text       as unconfirmed,
               count(*) filter (where e.is_late and not e.admin_confirmed)::int                                as unconfirmed_entries
          from gross_entries e
          join writers w on w.id = e.writer_id
          left join games g on g.id = e.game_id
         where true ${entryFrom} ${entryTo} ${agencyFilter}
         group by e.writer_id, coalesce(g.name, 'No game recorded')`),
      db.execute(sql`
        select l.writer_id, g.name as game_name,
               coalesce(sum(l.commission_amount) filter (where l.commission_pct is not null), 0)::text as commission,
               -- Settled before rates were frozen per draw: the old figure was net_balance.
               coalesce(sum(case
                 when l.commission_pct is not null then l.amount_payable
                 when l.settlement_status = 'settled' then l.net_balance
                 else 0 end), 0)::text as payable,
               coalesce(sum(case
                 when l.settlement_status = 'settled' and l.commission_pct is null then l.net_balance
                 when l.settlement_status = 'settled' then greatest(l.amount_payable, l.amount_paid)
                 else l.amount_paid end), 0)::text as collected,
               coalesce(sum(case
                 when l.settlement_status = 'settled' then 0
                 when l.commission_pct is null then 0
                 else greatest(l.amount_payable - l.amount_paid, 0) end), 0)::text as outstanding,
               coalesce(sum(l.total_stakes) filter (where l.commission_pct is null and l.settlement_status <> 'settled'), 0)::text as not_yet_due
          from postpaid_daily_ledger l
          join writers w on w.id = l.writer_id
          join games g on g.id = l.game_id
         where true ${ledgerFrom} ${ledgerTo} ${agencyFilter}
         group by l.writer_id, g.name`),
    ]);

    type Cell = {
      writerId: string; gameName: string;
      prepaid: number; prepaidTickets: number; postpaid: number; postpaidTickets: number;
      manual: number; manualEntries: number; unconfirmed: number; unconfirmedEntries: number;
      commission: number; payable: number; collected: number; outstanding: number; notYetDue: number;
    };
    const cells = new Map<string, Cell>();
    const cell = (writerId: string, gameName: string): Cell => {
      const key = `${writerId}\u0000${gameName}`;
      let c = cells.get(key);
      if (!c) {
        c = {
          writerId, gameName,
          prepaid: 0, prepaidTickets: 0, postpaid: 0, postpaidTickets: 0,
          manual: 0, manualEntries: 0, unconfirmed: 0, unconfirmedEntries: 0,
          commission: 0, payable: 0, collected: 0, outstanding: 0, notYetDue: 0,
        };
        cells.set(key, c);
      }
      return c;
    };
    // Money is summed in pesewas, so a long period does not drift by a cedi.
    const pes = (v: unknown) => Math.round(Number(v ?? 0) * 100);
    type Raw = Record<string, unknown>;
    for (const r of sold.rows as Raw[]) {
      const c = cell(String(r["writer_id"]), String(r["game_name"]));
      c.prepaid += pes(r["prepaid"]); c.prepaidTickets += Number(r["prepaid_tickets"]);
      c.postpaid += pes(r["postpaid"]); c.postpaidTickets += Number(r["postpaid_tickets"]);
    }
    for (const r of keyed.rows as Raw[]) {
      const c = cell(String(r["writer_id"]), String(r["game_name"]));
      c.manual += pes(r["manual"]); c.manualEntries += Number(r["manual_entries"]);
      c.unconfirmed += pes(r["unconfirmed"]); c.unconfirmedEntries += Number(r["unconfirmed_entries"]);
    }
    for (const r of ledger.rows as Raw[]) {
      const c = cell(String(r["writer_id"]), String(r["game_name"]));
      c.commission += pes(r["commission"]); c.payable += pes(r["payable"]);
      c.collected += pes(r["collected"]); c.outstanding += pes(r["outstanding"]);
      c.notYetDue += pes(r["not_yet_due"]);
    }

    const writerIds = [...new Set([...cells.values()].map((c) => c.writerId))];
    const writers = writerIds.length
      ? await db
          .select({
            id: writersTable.id,
            fullCode: writersTable.fullCode,
            fullName: writersTable.fullName,
            agentId: writersTable.agentId,
            agentCode: agentsTable.fullCode,
            agencyName: agentsTable.agencyName,
            agentName: usersTable.fullName,
          })
          .from(writersTable)
          .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
          .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
          .where(inArray(writersTable.id, writerIds))
      : [];
    const writerById = new Map(writers.map((w) => [w.id, w]));

    const cedis = (p: number) => (p / 100).toFixed(2);
    const rows = [...cells.values()]
      .map((c) => {
        const w = writerById.get(c.writerId);
        return {
          writerId: c.writerId,
          writerCode: w?.fullCode ?? "-",
          writerName: w?.fullName ?? "Unknown writer",
          agentId: w?.agentId ?? null,
          agentCode: w?.agentCode ?? "-",
          agencyName: w?.agencyName || w?.agentName || null,
          gameName: c.gameName,
          prepaid: cedis(c.prepaid),
          prepaidTickets: c.prepaidTickets,
          postpaid: cedis(c.postpaid),
          postpaidTickets: c.postpaidTickets,
          manual: cedis(c.manual),
          manualEntries: c.manualEntries,
          total: cedis(c.prepaid + c.postpaid + c.manual),
          unconfirmed: cedis(c.unconfirmed),
          unconfirmedEntries: c.unconfirmedEntries,
          postpaidCommission: cedis(c.commission),
          postpaidPayable: cedis(c.payable),
          postpaidCollected: cedis(c.collected),
          postpaidOutstanding: cedis(c.outstanding),
          postpaidNotYetDue: cedis(c.notYetDue),
        };
      })
      .sort((a, b) => a.agentCode.localeCompare(b.agentCode) || a.writerCode.localeCompare(b.writerCode) || a.gameName.localeCompare(b.gameName));

    const sum = (k: keyof Cell) => [...cells.values()].reduce((s, c) => s + (c[k] as number), 0);
    const prepaid = sum("prepaid");
    const postpaid = sum("postpaid");
    const manual = sum("manual");
    const selling = [...cells.values()].filter((c) => c.prepaid + c.postpaid + c.manual > 0);

    res.json({
      period: { dateFrom: from, dateTo: to },
      summary: {
        prepaid: { amount: cedis(prepaid), tickets: sum("prepaidTickets") },
        postpaid: { amount: cedis(postpaid), tickets: sum("postpaidTickets") },
        manual: { amount: cedis(manual), entries: sum("manualEntries") },
        total: cedis(prepaid + postpaid + manual),
        unconfirmedLate: { amount: cedis(sum("unconfirmed")), entries: sum("unconfirmedEntries") },
        postpaidCollection: {
          commission: cedis(sum("commission")),
          payable: cedis(sum("payable")),
          collected: cedis(sum("collected")),
          outstanding: cedis(sum("outstanding")),
          notYetDue: cedis(sum("notYetDue")),
        },
        writerCount: new Set(selling.map((c) => c.writerId)).size,
        agencyCount: new Set(selling.map((c) => writerById.get(c.writerId)?.agentId).filter(Boolean)).size,
      },
      rows,
    });
  },
);

// ── GET /reports/wins-debt-overview ───────────────────────────────────────────
/**
 * Wins & Debt Overview: what the company owes on wins, and what is owed to it,
 * across every way a sale can be made.
 *
 * Wins, by channel:
 *   POS prepaid / POS postpaid  winning portal tickets and where each stands
 *                               in the payout pipeline (unclaimed, with the
 *                               cashier, awaiting funds, transfer sent, paid,
 *                               flagged, withheld, or expired unclaimed)
 *   Manual                      wins agents keyed in, pending or calculated.
 *                               The deeper manual analysis (reserve cover,
 *                               aging queue) stays on /reports/wins-debt.
 *
 * Debts, as of now:
 *   postpaid writers   quoted and unpaid on the postpaid ledger; "overdue"
 *                      once Run Draws has passed the draw with it unpaid
 *   agencies           the running agency balance: negative is the agency
 *                      owing the company, positive the company owing it -
 *                      the convention the agent and payment screens use
 *
 * The period filters what was won (by draw date for tickets, entry date for
 * manual wins). Positions - the pipeline, the debts, the wallet - are now.
 */
router.get(
  "/reports/wins-debt-overview",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const isDate = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
    const rawFrom = req.query["dateFrom"];
    const rawTo = req.query["dateTo"];
    if ((rawFrom && !isDate(rawFrom)) || (rawTo && !isDate(rawTo))) {
      res.status(400).json({ error: "Dates must be YYYY-MM-DD" });
      return;
    }
    const from = isDate(rawFrom) ? rawFrom : null;
    const to = isDate(rawTo) ? rawTo : null;
    if (from && to && from > to) {
      res.status(400).json({ error: "The From date is after the To date" });
      return;
    }

    await quoteDueLedgers(db);

    const days = TICKET_VALIDITY_DAYS;
    // A ticket can be claimed until the end of the day it expires (Accra is
    // GMT all year), the same rule the claim screen enforces.
    const validUntil = sql`(date_trunc('day', (g.close_at at time zone 'UTC') + make_interval(days => ${days})) + interval '1 day')`;
    const nowUtc = sql`(now() at time zone 'UTC')`;
    const state = sql`case
        when p.id is null then 'missing'
        when p.status in ('pending', 'approved') and ${nowUtc} >= ${validUntil} then 'expired'
        when p.status in ('pending', 'approved') then 'unclaimed'
        else p.status::text end`;
    const channel = sql`case when t.token_transaction_id is null then 'postpaid' else 'prepaid' end`;

    const posQuery = (periodFilter: ReturnType<typeof sql>) => db.execute(sql`
      select ${channel} as channel, ${state} as state,
             count(*)::int as n,
             coalesce(sum(coalesce(p.payout_amount, t.win_amount)), 0)::text as amount,
             count(*) filter (where p.status in ('pending', 'approved')
                               and ${nowUtc} < ${validUntil}
                               and ${nowUtc} >= ${validUntil} - interval '3 days')::int as expiring_n,
             coalesce(sum(p.payout_amount) filter (where p.status in ('pending', 'approved')
                               and ${nowUtc} < ${validUntil}
                               and ${nowUtc} >= ${validUntil} - interval '3 days'), 0)::text as expiring_amount
        from tickets t
        join games g on g.id = t.game_id
        left join payout_requests p on p.ticket_id = t.id
       where t.is_winner and t.win_amount > 0 and t.status not in ('cancelled', 'void')
         ${periodFilter}
       group by 1, 2`);

    const drawFrom = from ? sql`and (g.close_at at time zone 'UTC')::date >= ${from}::date` : sql``;
    const drawTo = to ? sql`and (g.close_at at time zone 'UTC')::date <= ${to}::date` : sql``;
    const entryFrom = from ? sql`and e.entry_date >= ${from}::date` : sql``;
    const entryTo = to ? sql`and e.entry_date <= ${to}::date` : sql``;

    const [posPeriod, posNow, manualPeriod, ledgerAging, debtors, agencies, wallet] = await Promise.all([
      posQuery(sql`${drawFrom} ${drawTo}`),
      posQuery(sql``),
      db.execute(sql`
        select count(*)::int as n,
               coalesce(sum(e.wins_amount), 0)::text as amount,
               count(*) filter (where e.locked)::int as settled_n,
               coalesce(sum(e.wins_amount) filter (where e.locked), 0)::text as settled_amount,
               count(*) filter (where not e.locked)::int as pending_n,
               coalesce(sum(e.wins_amount) filter (where not e.locked), 0)::text as pending_amount
          from wins_entries e
         where true ${entryFrom} ${entryTo}`),
      db.execute(sql`
        with open_ledgers as (
          select l.*,
                 greatest(l.amount_payable - l.amount_paid, 0) as owed,
                 (l.unsettled_at_calculation is not null or l.settlement_status = 'overdue') as overdue,
                 (current_date - l.ledger_date) as age
            from postpaid_daily_ledger l
           where l.settlement_status <> 'settled'
        )
        select
          coalesce(sum(owed) filter (where commission_pct is not null), 0)::text as outstanding,
          count(*) filter (where commission_pct is not null and owed > 0)::int as outstanding_n,
          coalesce(sum(owed) filter (where commission_pct is not null and overdue), 0)::text as overdue,
          count(*) filter (where commission_pct is not null and overdue and owed > 0)::int as overdue_n,
          coalesce(sum(total_stakes) filter (where commission_pct is null), 0)::text as not_yet_due,
          count(distinct writer_id) filter (where commission_pct is not null and owed > 0)::int as writers_owing,
          coalesce(sum(owed) filter (where commission_pct is not null and age <= 1), 0)::text as age_0_1,
          coalesce(sum(owed) filter (where commission_pct is not null and age between 2 and 7), 0)::text as age_2_7,
          coalesce(sum(owed) filter (where commission_pct is not null and age between 8 and 30), 0)::text as age_8_30,
          coalesce(sum(owed) filter (where commission_pct is not null and age > 30), 0)::text as age_30_plus
          from open_ledgers`),
      db.execute(sql`
        select w.id as writer_id, w.full_code as writer_code, w.full_name as writer_name,
               a.full_code as agent_code, coalesce(a.agency_name, u.full_name) as agency_name,
               sum(greatest(l.amount_payable - l.amount_paid, 0))::text as owed,
               bool_or(l.unsettled_at_calculation is not null or l.settlement_status = 'overdue') as overdue,
               min(l.ledger_date)::text as oldest,
               count(*)::int as draws
          from postpaid_daily_ledger l
          join writers w on w.id = l.writer_id
          join agents a on a.id = w.agent_id
          join users u on u.id = a.user_id
         where l.settlement_status <> 'settled' and l.commission_pct is not null
           and l.amount_payable > l.amount_paid
         group by w.id, w.full_code, w.full_name, a.full_code, a.agency_name, u.full_name
         order by sum(greatest(l.amount_payable - l.amount_paid, 0)) desc
         limit 15`),
      db.execute(sql`
        select a.id as agent_id, a.full_code as agent_code, coalesce(a.agency_name, u.full_name) as agency_name,
               a.outstanding_debt::text as balance, a.debt_since, a.status
          from agents a
          join users u on u.id = a.user_id
         where a.outstanding_debt <> 0
         order by a.outstanding_debt asc`),
      db.execute(sql`select available::text, held::text from master_wallet where id = 1`).catch(() => ({ rows: [] })),
    ]);

    type Raw = Record<string, unknown>;
    const pes = (v: unknown) => Math.round(Number(v ?? 0) * 100);
    const cedis = (p: number) => (p / 100).toFixed(2);
    type Bucket = { count: number; amount: number };
    const zero = (): Bucket => ({ count: 0, amount: 0 });
    const out = (b: Bucket) => ({ count: b.count, amount: cedis(b.amount) });

    const STATES = ["missing", "unclaimed", "expired", "verified", "awaiting_funds", "processing", "paid", "rejected", "withheld"] as const;
    type State = (typeof STATES)[number];
    const tally = (rows: Raw[]) => {
      const by: Record<"prepaid" | "postpaid", Record<State, Bucket>> = {
        prepaid: Object.fromEntries(STATES.map((s) => [s, zero()])) as Record<State, Bucket>,
        postpaid: Object.fromEntries(STATES.map((s) => [s, zero()])) as Record<State, Bucket>,
      };
      const expiring = zero();
      for (const r of rows) {
        const ch = r["channel"] === "prepaid" ? "prepaid" : "postpaid";
        const st = (STATES as readonly string[]).includes(String(r["state"])) ? (r["state"] as State) : "unclaimed";
        by[ch][st].count += Number(r["n"]);
        by[ch][st].amount += pes(r["amount"]);
        expiring.count += Number(r["expiring_n"]);
        expiring.amount += pes(r["expiring_amount"]);
      }
      return { by, expiring };
    };
    const period = tally(posPeriod.rows as Raw[]);
    const now = tally(posNow.rows as Raw[]);

    const sumStates = (b: Record<State, Bucket>, states: State[]): Bucket =>
      states.reduce((acc, s) => ({ count: acc.count + b[s].count, amount: acc.amount + b[s].amount }), zero());

    const posChannel = (ch: "prepaid" | "postpaid", label: string) => {
      const b = period.by[ch];
      return {
        channel: ch,
        label,
        recorded: out(sumStates(b, [...STATES])),
        settled: out(b.paid),
        inProgress: out(sumStates(b, ["verified", "awaiting_funds", "processing"])),
        unclaimed: out(sumStates(b, ["unclaimed", "missing"])),
        flagged: out(b.rejected),
        lost: out(sumStates(b, ["expired", "withheld"])),
      };
    };
    const m = (manualPeriod.rows as Raw[])[0] ?? {};
    const channels = [
      posChannel("prepaid", "POS prepaid"),
      posChannel("postpaid", "POS postpaid"),
      {
        channel: "manual",
        label: "Manual (agent entry)",
        recorded: { count: Number(m["n"] ?? 0), amount: cedis(pes(m["amount"])) },
        settled: { count: Number(m["settled_n"] ?? 0), amount: cedis(pes(m["settled_amount"])) },
        inProgress: { count: Number(m["pending_n"] ?? 0), amount: cedis(pes(m["pending_amount"])) },
        unclaimed: null,
        flagged: null,
        lost: null,
      },
    ];

    const both = (s: State): Bucket => ({
      count: now.by.prepaid[s].count + now.by.postpaid[s].count,
      amount: now.by.prepaid[s].amount + now.by.postpaid[s].amount,
    });
    const pipeline = Object.fromEntries(STATES.map((s) => [s, out(both(s))])) as Record<State, { count: number; amount: string }>;
    const posOwed = sumStates(
      Object.fromEntries(STATES.map((s) => [s, both(s)])) as Record<State, Bucket>,
      ["missing", "unclaimed", "verified", "awaiting_funds", "processing", "rejected"],
    );

    const L = (ledgerAging.rows as Raw[])[0] ?? {};
    const agencyRows = (agencies.rows as Raw[]).map((r) => ({
      agentId: String(r["agent_id"]),
      agentCode: String(r["agent_code"]),
      agencyName: r["agency_name"] ? String(r["agency_name"]) : null,
      balance: cedis(pes(r["balance"])),
      debtSince: r["debt_since"] ? new Date(r["debt_since"] as string).toISOString() : null,
      status: String(r["status"] ?? "active"),
    }));
    const owedByAgencies = agencyRows.filter((a) => Number(a.balance) < 0).reduce((s, a) => s - pes(a.balance), 0);
    const owedToAgencies = agencyRows.filter((a) => Number(a.balance) > 0).reduce((s, a) => s + pes(a.balance), 0);

    const W = (wallet.rows as Raw[])[0];
    const available = W ? pes(W["available"]) : 0;
    const held = W ? pes(W["held"]) : 0;
    const awaiting = both("awaiting_funds").amount;

    res.json({
      period: { dateFrom: from, dateTo: to },
      validityDays: days,
      channels,
      pipeline: { ...pipeline, expiringSoon: out(now.expiring) },
      posOwed: out(posOwed),
      postpaid: {
        outstanding: cedis(pes(L["outstanding"])),
        outstandingDraws: Number(L["outstanding_n"] ?? 0),
        overdue: cedis(pes(L["overdue"])),
        overdueDraws: Number(L["overdue_n"] ?? 0),
        notYetDue: cedis(pes(L["not_yet_due"])),
        writersOwing: Number(L["writers_owing"] ?? 0),
        aging: {
          days0to1: cedis(pes(L["age_0_1"])),
          days2to7: cedis(pes(L["age_2_7"])),
          days8to30: cedis(pes(L["age_8_30"])),
          over30: cedis(pes(L["age_30_plus"])),
        },
        topDebtors: (debtors.rows as Raw[]).map((r) => ({
          writerId: String(r["writer_id"]),
          writerCode: String(r["writer_code"]),
          writerName: String(r["writer_name"]),
          agentCode: String(r["agent_code"]),
          agencyName: r["agency_name"] ? String(r["agency_name"]) : null,
          owed: cedis(pes(r["owed"])),
          overdue: Boolean(r["overdue"]),
          oldest: String(r["oldest"]),
          draws: Number(r["draws"]),
        })),
      },
      agencies: {
        owedByAgencies: cedis(owedByAgencies),
        owedToAgencies: cedis(owedToAgencies),
        list: agencyRows,
      },
      wallet: {
        available: cedis(available),
        held: cedis(held),
        awaitingFunds: cedis(awaiting),
        shortfall: cedis(Math.max(awaiting - available, 0)),
        present: Boolean(W),
      },
    });
  },
);

export default router;
