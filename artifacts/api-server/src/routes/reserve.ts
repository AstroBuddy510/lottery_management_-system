import { Router } from "express";
import { db, reserveFundTable, reserveAllocationsTable, writersTable } from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get(
  "/reserve/balance",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const records = await db
      .select()
      .from(reserveFundTable)
      .orderBy(desc(reserveFundTable.periodDate));

    const totals = records.reduce(
      (acc, r) => ({
        totalContributed: acc.totalContributed + parseFloat(r.totalContributed),
        totalAllocated: acc.totalAllocated + parseFloat(r.totalAllocated),
        balance: acc.balance + parseFloat(r.balance),
      }),
      { totalContributed: 0, totalAllocated: 0, balance: 0 },
    );

    res.json({ ...totals, periods: records });
  },
);

router.get(
  "/reserve/allocations",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { writerId, dateFrom, dateTo } = req.query as Record<string, string>;
    const conditions = [];
    if (writerId)
      conditions.push(eq(reserveAllocationsTable.writerId, writerId));
    if (dateFrom)
      conditions.push(gte(reserveAllocationsTable.allocationDate, dateFrom));
    if (dateTo)
      conditions.push(lte(reserveAllocationsTable.allocationDate, dateTo));

    const allocations = await db
      .select({
        id: reserveAllocationsTable.id,
        writerId: reserveAllocationsTable.writerId,
        allocationDate: reserveAllocationsTable.allocationDate,
        amountDrawn: reserveAllocationsTable.amountDrawn,
        reason: reserveAllocationsTable.reason,
        reserveBalanceAfter: reserveAllocationsTable.reserveBalanceAfter,
        createdAt: reserveAllocationsTable.createdAt,
        writerFullCode: writersTable.fullCode,
        writerFullName: writersTable.fullName,
      })
      .from(reserveAllocationsTable)
      .innerJoin(writersTable, eq(reserveAllocationsTable.writerId, writersTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(reserveAllocationsTable.allocationDate));

    res.json(allocations);
  },
);

export default router;
