import { Router } from "express";
import { db } from "@workspace/db";
import {
  grossEntriesTable,
  winsEntriesTable,
  dailyCalculationsTable,
  systemSettingsTable,
  reserveFundTable,
  reserveAllocationsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { RunCalculationsBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { calculateWriter } from "../lib/calculator";

const router = Router();

router.post(
  "/calculations/run",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = RunCalculationsBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const calcDate = parse.data.date;

    const [settings] = await db
      .select()
      .from(systemSettingsTable)
      .orderBy(desc(systemSettingsTable.updatedAt))
      .limit(1);
    if (!settings) {
      res.status(400).json({ error: "System settings not configured" });
      return;
    }

    const commissionPct = parseFloat(settings.commissionPct);
    const reservePct = parseFloat(settings.reservePct);

    const grossEntries = await db
      .select()
      .from(grossEntriesTable)
      .where(eq(grossEntriesTable.entryDate, calcDate));

    const winsEntries = await db
      .select()
      .from(winsEntriesTable)
      .where(eq(winsEntriesTable.entryDate, calcDate));

    const grossMap = new Map(
      grossEntries.map((e) => [e.writerId, parseFloat(e.grossAmount)]),
    );
    const winsMap = new Map(
      winsEntries.map((e) => [e.writerId, parseFloat(e.winsAmount)]),
    );

    const allWriterIds = [...new Set([...grossMap.keys(), ...winsMap.keys()])];

    if (allWriterIds.length === 0) {
      res.json({ calculated: 0, calcDate, results: [], reserveAllocations: 0 });
      return;
    }

    const periodMonth = calcDate.slice(0, 7);
    const periodDate = `${periodMonth}-01`;
    const [reserveFund] = await db
      .select()
      .from(reserveFundTable)
      .where(eq(reserveFundTable.periodDate, periodDate))
      .limit(1);
    let reserveBalance = reserveFund ? parseFloat(reserveFund.balance) : 0;

    const results = [];
    const allocations: Array<{
      writerId: string;
      amountDrawn: number;
      allocationDate: string;
      reserveBalanceAfter: number;
    }> = [];

    for (const writerId of allWriterIds) {
      const gross = grossMap.get(writerId) ?? 0;
      const wins = winsMap.get(writerId) ?? 0;
      const calc = calculateWriter(gross, wins, commissionPct, reservePct);

      let finalWriterBalance = calc.writerBalance;

      if (finalWriterBalance < 0 && reserveBalance > 0) {
        const drawAmount = Math.min(Math.abs(finalWriterBalance), reserveBalance);
        reserveBalance -= drawAmount;
        finalWriterBalance += drawAmount;
        allocations.push({
          writerId,
          amountDrawn: drawAmount,
          allocationDate: calcDate,
          reserveBalanceAfter: reserveBalance,
        });
      }

      await db
        .delete(dailyCalculationsTable)
        .where(
          and(
            eq(dailyCalculationsTable.writerId, writerId),
            eq(dailyCalculationsTable.calcDate, calcDate),
          ),
        );

      const [saved] = await db
        .insert(dailyCalculationsTable)
        .values({
          writerId,
          calcDate,
          grossSales: String(calc.grossSales),
          commissionPct: String(calc.commissionPct),
          commissionAmount: String(calc.commissionAmount),
          netGross: String(calc.netGross),
          winsAmount: String(calc.winsAmount),
          reservePct: String(calc.reservePct),
          reserveAmount: String(calc.reserveAmount),
          writerBalance: String(finalWriterBalance),
        })
        .returning();

      results.push(saved);

      await db
        .update(grossEntriesTable)
        .set({ locked: true })
        .where(
          and(
            eq(grossEntriesTable.writerId, writerId),
            eq(grossEntriesTable.entryDate, calcDate),
          ),
        );
      await db
        .update(winsEntriesTable)
        .set({ locked: true })
        .where(
          and(
            eq(winsEntriesTable.writerId, writerId),
            eq(winsEntriesTable.entryDate, calcDate),
          ),
        );
    }

    for (const alloc of allocations) {
      await db.insert(reserveAllocationsTable).values({
        writerId: alloc.writerId,
        allocationDate: alloc.allocationDate,
        amountDrawn: String(alloc.amountDrawn),
        reason: "Auto-draw: negative writer balance",
        reserveBalanceAfter: String(alloc.reserveBalanceAfter),
      });
    }

    const totalContributedNew = results.reduce(
      (sum, r) => sum + parseFloat(r!.reserveAmount),
      0,
    );
    const totalAllocatedNew = allocations.reduce(
      (sum, a) => sum + a.amountDrawn,
      0,
    );

    if (reserveFund) {
      await db
        .update(reserveFundTable)
        .set({
          totalContributed: String(
            parseFloat(reserveFund.totalContributed) + totalContributedNew,
          ),
          totalAllocated: String(
            parseFloat(reserveFund.totalAllocated) + totalAllocatedNew,
          ),
          balance: String(reserveBalance + totalContributedNew),
        })
        .where(eq(reserveFundTable.id, reserveFund.id));
    } else {
      await db.insert(reserveFundTable).values({
        periodDate,
        totalContributed: String(totalContributedNew),
        totalAllocated: String(totalAllocatedNew),
        balance: String(totalContributedNew - totalAllocatedNew),
      });
    }

    res.json({
      calculated: results.length,
      calcDate,
      results,
      reserveAllocations: allocations.length,
    });
  },
);

router.get(
  "/calculations",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { writerId, dateFrom, dateTo } = req.query as Record<string, string>;
    const conditions = [];
    if (writerId)
      conditions.push(eq(dailyCalculationsTable.writerId, writerId));
    if (dateFrom)
      conditions.push(gte(dailyCalculationsTable.calcDate, dateFrom));
    if (dateTo) conditions.push(lte(dailyCalculationsTable.calcDate, dateTo));

    const calculations = await db
      .select()
      .from(dailyCalculationsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(dailyCalculationsTable.calcDate));
    res.json(calculations);
  },
);

export default router;
