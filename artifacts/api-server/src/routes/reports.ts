import { Router } from "express";
import { db, dailyCalculationsTable, writersTable, agentsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
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

export default router;
