import { Router } from "express";
import { db, dailyCalculationsTable, writersTable, agentsTable, usersTable, winsEntriesTable, reserveAllocationsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { GetWriterReportParams, GetAgentReportParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function sumCalcs(calcs: Array<Record<string, string>>) {
  return calcs.reduce(
    (acc, c) => ({
      totalGross: acc.totalGross + parseFloat(c.grossSales ?? "0"),
      totalCommission: acc.totalCommission + parseFloat(c.commissionAmount ?? "0"),
      totalNetGross: acc.totalNetGross + parseFloat(c.netGross ?? "0"),
      totalWins: acc.totalWins + parseFloat(c.winsAmount ?? "0"),
      totalReserve: acc.totalReserve + parseFloat(c.reserveAmount ?? "0"),
      totalBalance: acc.totalBalance + parseFloat(c.writerBalance ?? "0"),
    }),
    {
      totalGross: 0,
      totalCommission: 0,
      totalNetGross: 0,
      totalWins: 0,
      totalReserve: 0,
      totalBalance: 0,
    },
  );
}

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

    const conditions = [eq(dailyCalculationsTable.writerId, writerId)];
    if (dateFrom) conditions.push(gte(dailyCalculationsTable.calcDate, dateFrom));
    if (dateTo) conditions.push(lte(dailyCalculationsTable.calcDate, dateTo));

    const [writer] = await db
      .select({ fullName: writersTable.fullName, fullCode: writersTable.fullCode })
      .from(writersTable)
      .where(eq(writersTable.id, writerId))
      .limit(1);

    const calculations = await db
      .select()
      .from(dailyCalculationsTable)
      .where(and(...conditions))
      .orderBy(desc(dailyCalculationsTable.calcDate));

    res.json({
      writer: writer ?? null,
      totals: sumCalcs(calculations as unknown as Array<Record<string, string>>),
      calculations,
    });
  },
);

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

    const [agent] = await db
      .select({ fullCode: agentsTable.fullCode, fullName: usersTable.fullName })
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(agentsTable.id, agentId))
      .limit(1);

    const writers = await db
      .select({ id: writersTable.id, fullCode: writersTable.fullCode, fullName: writersTable.fullName })
      .from(writersTable)
      .where(eq(writersTable.agentId, agentId));

    const allCalcs = [];
    for (const w of writers) {
      const conditions = [eq(dailyCalculationsTable.writerId, w.id)];
      if (dateFrom) conditions.push(gte(dailyCalculationsTable.calcDate, dateFrom));
      if (dateTo) conditions.push(lte(dailyCalculationsTable.calcDate, dateTo));
      const calcs = await db
        .select()
        .from(dailyCalculationsTable)
        .where(and(...conditions));
      allCalcs.push(...calcs);
    }

    res.json({
      agent: agent ?? null,
      writers,
      totals: sumCalcs(allCalcs as unknown as Array<Record<string, string>>),
    });
  },
);

router.get(
  "/reports/org",
  requireAuth,
  requireRole("director"),
  async (req, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const conditions = [];
    if (dateFrom) conditions.push(gte(dailyCalculationsTable.calcDate, dateFrom));
    if (dateTo) conditions.push(lte(dailyCalculationsTable.calcDate, dateTo));

    const calculations = await db
      .select()
      .from(dailyCalculationsTable)
      .where(conditions.length ? and(...conditions) : undefined);

    const writerCount = new Set(calculations.map((c) => c.writerId)).size;

    res.json({
      totals: sumCalcs(calculations as unknown as Array<Record<string, string>>),
      writerCount,
      recordCount: calculations.length,
    });
  },
);

router.get(
  "/reports/wins-debt",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. All wins entries with writer info
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

    // 2. Agent names
    const agentIds = [...new Set(allWinsEntries.map((e) => e.agentId))];
    const agents =
      agentIds.length > 0
        ? await db
            .select({
              id: agentsTable.id,
              fullCode: agentsTable.fullCode,
              fullName: usersTable.fullName,
            })
            .from(agentsTable)
            .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
            .where(inArray(agentsTable.id, agentIds))
        : [];
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    // 3. All daily calculations
    const allCalcs = await db
      .select()
      .from(dailyCalculationsTable)
      .orderBy(desc(dailyCalculationsTable.calcDate));

    const calcMap = new Map<string, (typeof allCalcs)[0]>();
    for (const c of allCalcs) {
      calcMap.set(`${c.writerId}__${c.calcDate}`, c);
    }

    // 4. All reserve allocations
    const allAllocs = await db.select().from(reserveAllocationsTable);
    const allocMap = new Map<string, number>();
    for (const a of allAllocs) {
      const key = `${a.writerId}__${a.allocationDate}`;
      allocMap.set(key, (allocMap.get(key) ?? 0) + parseFloat(a.amountDrawn));
    }

    // ── Summary ──────────────────────────────────────────────────────────
    const pending = allWinsEntries.filter((e) => !e.locked);
    const calculated = allWinsEntries.filter((e) => e.locked);

    const totalWinsRecorded = allWinsEntries.reduce((s, e) => s + parseFloat(e.winsAmount), 0);
    const totalPending = pending.reduce((s, e) => s + parseFloat(e.winsAmount), 0);
    const totalCalculated = calculated.reduce((s, e) => s + parseFloat(e.winsAmount), 0);
    const totalReserveDrawn = allAllocs.reduce((s, a) => s + parseFloat(a.amountDrawn), 0);

    let clearedByAgentNet = 0;
    let remainingDeficit = 0;
    for (const calc of allCalcs) {
      const balance = parseFloat(calc.writerBalance);
      const draws = allocMap.get(`${calc.writerId}__${calc.calcDate}`) ?? 0;
      const wins = parseFloat(calc.winsAmount);
      if (balance >= 0) {
        clearedByAgentNet += wins - draws;
      } else {
        remainingDeficit += Math.abs(balance);
        const agentPortion = wins - draws - Math.abs(balance);
        if (agentPortion > 0) clearedByAgentNet += agentPortion;
      }
    }

    // ── Aging (pending only) ─────────────────────────────────────────────
    const buckets = {
      under7: { count: 0, amount: 0 },
      d7to14: { count: 0, amount: 0 },
      d14to30: { count: 0, amount: 0 },
      over30: { count: 0, amount: 0 },
    };
    for (const e of pending) {
      const days = Math.floor(
        (today.getTime() - new Date(e.entryDate).getTime()) / 86400000
      );
      const amt = parseFloat(e.winsAmount);
      if (days < 7) { buckets.under7.count++; buckets.under7.amount += amt; }
      else if (days < 14) { buckets.d7to14.count++; buckets.d7to14.amount += amt; }
      else if (days < 30) { buckets.d14to30.count++; buckets.d14to30.amount += amt; }
      else { buckets.over30.count++; buckets.over30.amount += amt; }
    }

    // ── Payment speed (locked entries) ───────────────────────────────────
    const speeds: number[] = [];
    for (const e of calculated) {
      const calc = calcMap.get(`${e.writerId}__${e.entryDate}`);
      if (calc) {
        const days = Math.max(
          0,
          Math.round(
            (new Date(calc.calcDate).getTime() - new Date(e.entryDate).getTime()) /
              86400000
          )
        );
        speeds.push(days);
      }
    }
    const paymentSpeed =
      speeds.length > 0
        ? {
            avgDaysToCalculate:
              Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10,
            fastestDays: Math.min(...speeds),
            slowestDays: Math.max(...speeds),
          }
        : { avgDaysToCalculate: null, fastestDays: null, slowestDays: null };

    // ── Queue (FIFO — oldest first) ───────────────────────────────────────
    const queue = pending
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      .map((e) => {
        const days = Math.floor(
          (today.getTime() - new Date(e.entryDate).getTime()) / 86400000
        );
        const agent = agentMap.get(e.agentId);
        return {
          id: e.id,
          writerId: e.writerId,
          writerName: e.writerName,
          writerCode: e.writerCode,
          agentId: e.agentId,
          agentName: agent?.fullName ?? "—",
          agentCode: agent?.fullCode ?? "—",
          entryDate: e.entryDate,
          winsAmount: e.winsAmount,
          daysInQueue: days,
          urgency: days < 7 ? "ok" : days < 14 ? "warning" : ("critical" as const),
        };
      });

    // ── History (calculated, most recent first, up to 100) ────────────────
    const history = calculated
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
      .slice(0, 100)
      .map((e) => {
        const calc = calcMap.get(`${e.writerId}__${e.entryDate}`);
        const agent = agentMap.get(e.agentId);
        const draws = calc
          ? (allocMap.get(`${calc.writerId}__${calc.calcDate}`) ?? 0)
          : 0;
        const balance = calc ? parseFloat(calc.writerBalance) : 0;
        const daysToCalc = calc
          ? Math.max(
              0,
              Math.round(
                (new Date(calc.calcDate).getTime() -
                  new Date(e.entryDate).getTime()) /
                  86400000
              )
            )
          : 0;
        const clearedBy =
          balance < 0 ? "deficit" : draws > 0 ? "reserve" : "agent_net";
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
          writerBalance: calc?.writerBalance ?? "0.00",
        };
      });

    res.json({
      summary: {
        totalWinsRecorded: totalWinsRecorded.toFixed(2),
        totalCalculated: totalCalculated.toFixed(2),
        totalPending: totalPending.toFixed(2),
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
      paymentSpeed,
      queue,
      history,
    });
  }
);

export default router;
