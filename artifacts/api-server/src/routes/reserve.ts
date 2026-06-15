import { Router } from "express";
import { z } from "zod/v4";
import {
  db,
  reserveFundTable,
  reserveAllocationsTable,
  agentReserveReceiptsTable,
  writersTable,
  agentsTable,
  usersTable,
  dailyCalculationsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, lt, sql, inArray } from "drizzle-orm";
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

    const autoCovered = new Map<string, number>();
    const manualCovered = new Map<string, number>();
    for (const a of allAllocations) {
      const key = `${a.writerId}:${a.allocationDate}`;
      const amount = parseFloat(a.amountDrawn);
      if (a.reason?.includes("Auto-draw")) {
        autoCovered.set(key, (autoCovered.get(key) ?? 0) + amount);
      } else {
        manualCovered.set(key, (manualCovered.get(key) ?? 0) + amount);
      }
    }

    const agentTotalGross = new Map<string, number>();
    for (const c of calcs) {
      agentTotalGross.set(c.agentId, (agentTotalGross.get(c.agentId) ?? 0) + parseFloat(c.grossSales));
    }

    const result = calcs
      .map((c) => {
        const currentBalance = Math.abs(parseFloat(c.writerBalance));
        const key = `${c.writerId}:${c.calcDate}`;
        const autoDraw = autoCovered.get(key) ?? 0;
        const manual = manualCovered.get(key) ?? 0;

        const originalDeficit = currentBalance + autoDraw;
        const amountCovered = autoDraw + manual;
        const outstanding = Math.max(0, currentBalance - manual);

        return {
          ...c,
          deficitAmount: originalDeficit.toFixed(2),
          amountCovered: amountCovered.toFixed(2),
          outstandingAmount: outstanding.toFixed(2),
          agentTotalGross: (agentTotalGross.get(c.agentId) ?? 0).toFixed(2),
        };
      })
      .filter((d) => parseFloat(d.outstandingAmount) > 0.005);

    res.json(result);
  },
);

// ── Agent Daily Reserve Totals ────────────────────────────────────────────────

router.get(
  "/reserve/agent-daily-totals",
  requireAuth,
  requireRole("cashier", "administrator", "director"),
  async (req, res) => {
    const { calcDate } = req.query as Record<string, string>;
    if (!calcDate) {
      res.status(400).json({ error: "calcDate is required" });
      return;
    }

    const rows = await db
      .select({
        agentId: agentsTable.id,
        agentFullCode: agentsTable.fullCode,
        agentName: usersTable.fullName,
        totalReserve: sql<string>`SUM(${dailyCalculationsTable.reserveAmount})::text`,
      })
      .from(dailyCalculationsTable)
      .innerJoin(writersTable, eq(dailyCalculationsTable.writerId, writersTable.id))
      .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(dailyCalculationsTable.calcDate, calcDate))
      .groupBy(agentsTable.id, agentsTable.fullCode, usersTable.fullName)
      .orderBy(agentsTable.fullCode);

    res.json(rows);
  },
);

// ── Reserve Receipts ─────────────────────────────────────────────────────────

router.get(
  "/reserve/receipts",
  requireAuth,
  requireRole("cashier", "administrator", "director"),
  async (req, res) => {
    const { agentId, calcDate, dateFrom, dateTo } = req.query as Record<string, string>;
    const conditions = [];
    if (agentId) conditions.push(eq(agentReserveReceiptsTable.agentId, agentId));
    if (calcDate) conditions.push(eq(agentReserveReceiptsTable.calcDate, calcDate));
    if (dateFrom) conditions.push(gte(agentReserveReceiptsTable.calcDate, dateFrom));
    if (dateTo) conditions.push(lte(agentReserveReceiptsTable.calcDate, dateTo));

    const rows = await db
      .select({
        id: agentReserveReceiptsTable.id,
        agentId: agentReserveReceiptsTable.agentId,
        calcDate: agentReserveReceiptsTable.calcDate,
        amountDue: agentReserveReceiptsTable.amountDue,
        amountPaid: agentReserveReceiptsTable.amountPaid,
        markedBy: agentReserveReceiptsTable.markedBy,
        markedAt: agentReserveReceiptsTable.markedAt,
        notes: agentReserveReceiptsTable.notes,
        agentFullCode: agentsTable.fullCode,
        agentName: usersTable.fullName,
        markedByUserId: agentReserveReceiptsTable.markedBy,
      })
      .from(agentReserveReceiptsTable)
      .innerJoin(agentsTable, eq(agentReserveReceiptsTable.agentId, agentsTable.id))
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(agentReserveReceiptsTable.calcDate), agentsTable.fullCode);

    // resolve markedBy names
    const markedByIds = [...new Set(rows.map((r) => r.markedBy))];
    const markerRows = markedByIds.length
      ? await db.select({ id: usersTable.id, fullName: usersTable.fullName }).from(usersTable).where(
          inArray(usersTable.id, markedByIds)
        )
      : [];
    const markerMap = new Map(markerRows.map((u) => [u.id, u.fullName]));

    res.json(
      rows.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        agentFullCode: r.agentFullCode,
        agentName: r.agentName,
        calcDate: r.calcDate,
        amountDue: r.amountDue,
        amountPaid: r.amountPaid,
        markedBy: r.markedBy,
        markedByName: markerMap.get(r.markedBy) ?? null,
        markedAt: r.markedAt,
        notes: r.notes,
      })),
    );
  },
);

const CreateReceiptSchema = z.object({
  agentId: z.string().uuid(),
  calcDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountDue: z.string(),
  amountPaid: z.string(),
  notes: z.string().optional(),
});

router.post(
  "/reserve/receipts",
  requireAuth,
  requireRole("cashier", "administrator"),
  async (req, res) => {
    const body = CreateReceiptSchema.parse(req.body);
    const [row] = await db
      .insert(agentReserveReceiptsTable)
      .values({
        agentId: body.agentId,
        calcDate: body.calcDate,
        amountDue: body.amountDue,
        amountPaid: body.amountPaid,
        markedBy: req.user!.userId,
        notes: body.notes ?? null,
      })
      .returning();

    const agentRow = await db
      .select({ fullCode: agentsTable.fullCode, agentName: usersTable.fullName })
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(agentsTable.id, row.agentId))
      .limit(1);

    const markerRow = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, row.markedBy))
      .limit(1);

    res.status(201).json({
      ...row,
      agentFullCode: agentRow[0]?.fullCode ?? null,
      agentName: agentRow[0]?.agentName ?? null,
      markedByName: markerRow[0]?.fullName ?? null,
    });
  },
);

router.delete(
  "/reserve/receipts/:id",
  requireAuth,
  requireRole("cashier", "administrator"),
  async (req, res) => {
    await db
      .delete(agentReserveReceiptsTable)
      .where(eq(agentReserveReceiptsTable.id, String(req.params.id)));
    res.status(204).send();
  },
);

// ─────────────────────────────────────────────────────────────────────────────

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
    const autoCovered = new Map<string, number>();
    const manualCovered = new Map<string, number>();
    for (const a of allAllocations) {
      const key = `${a.writerId}:${a.allocationDate}`;
      const amount = parseFloat(a.amountDrawn);
      if (a.reason?.includes("Auto-draw")) {
        autoCovered.set(key, (autoCovered.get(key) ?? 0) + amount);
      } else {
        manualCovered.set(key, (manualCovered.get(key) ?? 0) + amount);
      }
    }

    const agentTotalGross = new Map<string, number>();
    for (const c of calcs) {
      agentTotalGross.set(c.agentId, (agentTotalGross.get(c.agentId) ?? 0) + parseFloat(c.grossSales));
    }

    const debts = calcs
      .map((c) => {
        const deficit = Math.abs(parseFloat(c.writerBalance));
        const key = `${c.writerId}:${c.calcDate}`;
        const manual = manualCovered.get(key) ?? 0;
        const outstanding = Math.max(0, deficit - manual);
        return { ...c, outstanding, agentTotalGrossVal: agentTotalGross.get(c.agentId) ?? 0 };
      })
      .filter((d) => d.outstanding > 0.005);

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
