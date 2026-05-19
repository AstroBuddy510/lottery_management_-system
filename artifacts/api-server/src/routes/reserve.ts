import { Router } from "express";
import { z } from "zod/v4";
import {
  db,
  reserveFundTable,
  reserveAllocationsTable,
  writersTable,
  agentsTable,
  usersTable,
  dailyCalculationsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, lt, sql } from "drizzle-orm";
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

router.get(
  "/reserve/debts",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const calcs = await db
      .select({
        id: dailyCalculationsTable.id,
        calcDate: dailyCalculationsTable.calcDate,
        writerId: dailyCalculationsTable.writerId,
        writerFullCode: writersTable.fullCode,
        writerFullName: writersTable.fullName,
        agentId: agentsTable.id,
        agentFullCode: agentsTable.fullCode,
        agentName: usersTable.fullName,
        grossSales: dailyCalculationsTable.grossSales,
        netGross: dailyCalculationsTable.netGross,
        winsAmount: dailyCalculationsTable.winsAmount,
        reserveAmount: dailyCalculationsTable.reserveAmount,
        writerBalance: dailyCalculationsTable.writerBalance,
      })
      .from(dailyCalculationsTable)
      .innerJoin(writersTable, eq(dailyCalculationsTable.writerId, writersTable.id))
      .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(lt(dailyCalculationsTable.writerBalance, "0"))
      .orderBy(dailyCalculationsTable.calcDate);

    const allAllocations = await db.select().from(reserveAllocationsTable);

    const covered = new Map<string, number>();
    for (const a of allAllocations) {
      const key = `${a.writerId}:${a.allocationDate}`;
      covered.set(key, (covered.get(key) ?? 0) + parseFloat(a.amountDrawn));
    }

    const agentTotalGross = new Map<string, number>();
    for (const c of calcs) {
      agentTotalGross.set(c.agentId, (agentTotalGross.get(c.agentId) ?? 0) + parseFloat(c.grossSales));
    }

    const result = calcs.map((c) => {
      const deficit = Math.abs(parseFloat(c.writerBalance));
      const key = `${c.writerId}:${c.calcDate}`;
      const amountCovered = covered.get(key) ?? 0;
      const outstanding = Math.max(0, deficit - amountCovered);
      return {
        ...c,
        deficitAmount: deficit.toFixed(2),
        amountCovered: amountCovered.toFixed(2),
        outstandingAmount: outstanding.toFixed(2),
        agentTotalGross: (agentTotalGross.get(c.agentId) ?? 0).toFixed(2),
      };
    });

    res.json(result);
  },
);

const AllocateReserveBodySchema = z.object({
  strategy: z.enum(["fifo", "lifo", "best_performer"]),
  maxAmount: z.number().positive().optional(),
});

router.post(
  "/reserve/allocate",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { strategy, maxAmount } = AllocateReserveBodySchema.parse(req.body);

    const reserveRecords = await db
      .select()
      .from(reserveFundTable)
      .orderBy(desc(reserveFundTable.periodDate));
    const currentBalance = reserveRecords.reduce(
      (s, r) => s + parseFloat(r.balance),
      0,
    );

    const calcs = await db
      .select({
        id: dailyCalculationsTable.id,
        calcDate: dailyCalculationsTable.calcDate,
        writerId: dailyCalculationsTable.writerId,
        agentId: agentsTable.id,
        grossSales: dailyCalculationsTable.grossSales,
        writerBalance: dailyCalculationsTable.writerBalance,
      })
      .from(dailyCalculationsTable)
      .innerJoin(writersTable, eq(dailyCalculationsTable.writerId, writersTable.id))
      .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
      .where(lt(dailyCalculationsTable.writerBalance, "0"));

    const allAllocations = await db.select().from(reserveAllocationsTable);
    const covered = new Map<string, number>();
    for (const a of allAllocations) {
      const key = `${a.writerId}:${a.allocationDate}`;
      covered.set(key, (covered.get(key) ?? 0) + parseFloat(a.amountDrawn));
    }

    const agentTotalGross = new Map<string, number>();
    for (const c of calcs) {
      agentTotalGross.set(c.agentId, (agentTotalGross.get(c.agentId) ?? 0) + parseFloat(c.grossSales));
    }

    const debts = calcs
      .map((c) => {
        const deficit = Math.abs(parseFloat(c.writerBalance));
        const key = `${c.writerId}:${c.calcDate}`;
        const amountCoveredVal = covered.get(key) ?? 0;
        const outstanding = Math.max(0, deficit - amountCoveredVal);
        return { ...c, outstanding, agentTotalGrossVal: agentTotalGross.get(c.agentId) ?? 0 };
      })
      .filter((d) => d.outstanding > 0);

    if (strategy === "fifo") {
      debts.sort((a, b) => a.calcDate.localeCompare(b.calcDate));
    } else if (strategy === "lifo") {
      debts.sort((a, b) => b.calcDate.localeCompare(a.calcDate));
    } else {
      debts.sort((a, b) => b.agentTotalGrossVal - a.agentTotalGrossVal);
    }

    let remaining = Math.min(currentBalance, maxAmount ?? currentBalance);
    let runningBalance = currentBalance;
    const applied: { calcId: string; writerId: string; agentId: string; amountApplied: string; outstanding: string }[] = [];

    for (const debt of debts) {
      if (remaining <= 0.005) break;
      const toApply = Math.min(debt.outstanding, remaining);
      if (toApply < 0.01) continue;

      runningBalance -= toApply;

      await db.insert(reserveAllocationsTable).values({
        writerId: debt.writerId,
        allocationDate: debt.calcDate,
        amountDrawn: toApply.toFixed(2),
        reason: `Smart Debt Management — ${strategy === "fifo" ? "FIFO" : strategy === "lifo" ? "LIFO" : "Best Performer"} strategy · calc date ${debt.calcDate}`,
        reserveBalanceAfter: runningBalance.toFixed(2),
      });

      remaining -= toApply;
      applied.push({
        calcId: debt.id,
        writerId: debt.writerId,
        agentId: debt.agentId,
        amountApplied: toApply.toFixed(2),
        outstanding: Math.max(0, debt.outstanding - toApply).toFixed(2),
      });
    }

    const totalApplied = applied.reduce((s, a) => s + parseFloat(a.amountApplied), 0);

    if (totalApplied > 0.005 && reserveRecords.length > 0) {
      const latest = reserveRecords[0];
      await db
        .update(reserveFundTable)
        .set({
          totalAllocated: (parseFloat(latest.totalAllocated) + totalApplied).toFixed(2),
          balance: (parseFloat(latest.balance) - totalApplied).toFixed(2),
        })
        .where(eq(reserveFundTable.id, latest.id));
    }

    res.json({
      allocatedCount: applied.length,
      totalAllocated: totalApplied.toFixed(2),
      newBalance: (currentBalance - totalApplied).toFixed(2),
      items: applied,
    });
  },
);

export default router;
