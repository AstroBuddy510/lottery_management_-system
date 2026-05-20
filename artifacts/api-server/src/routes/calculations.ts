import { Router } from "express";
import { db } from "@workspace/db";
import {
  grossEntriesTable,
  winsEntriesTable,
  dailyCalculationsTable,
  systemSettingsTable,
  reserveFundTable,
  reserveAllocationsTable,
  writersTable,
  agentsTable,
  agentDebtReductionsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { RunCalculationsBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { calculateWriter } from "../lib/calculator";
import { dispatchSystemNotification } from "../lib/notify";

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

    const results: (typeof dailyCalculationsTable.$inferSelect)[] = [];
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

    // ── Automated debt reduction from daily net gross ─────────────────────────
    // Group results by agent, sum netGross per agent, then reduce outstandingDebt
    const writerAgentRows = await db
      .select({ writerId: writersTable.id, agentId: writersTable.agentId })
      .from(writersTable)
      .where(inArray(writersTable.id, allWriterIds));

    const writerToAgent = new Map(writerAgentRows.map((r) => [r.writerId, r.agentId]));

    // Sum netGross per agent across all their writers
    const agentNetGross = new Map<string, number>();
    for (const r of results) {
      if (!r) continue;
      const agentId = writerToAgent.get(r.writerId);
      if (!agentId) continue;
      agentNetGross.set(agentId, (agentNetGross.get(agentId) ?? 0) + parseFloat(r.netGross));
    }

    const debtReductionSummary: Array<{
      agentId: string; netGross: string; reduction: string; debtBefore: string; debtAfter: string; surplus: string | null;
    }> = [];

    for (const [agentId, netGross] of agentNetGross) {
      if (netGross <= 0) continue;

      const [agentRow] = await db
        .select({ id: agentsTable.id, outstandingDebt: agentsTable.outstandingDebt })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId))
        .limit(1);

      if (!agentRow) continue;
      const currentDebt = parseFloat(agentRow.outstandingDebt);
      if (currentDebt <= 0) continue;

      const reduction = Math.min(netGross, currentDebt);
      const newDebt = Math.max(0, currentDebt - reduction);
      const surplus = netGross > currentDebt ? netGross - currentDebt : null;

      await db
        .update(agentsTable)
        .set({
          outstandingDebt: newDebt.toFixed(2),
          debtSince: newDebt === 0 ? null : undefined,
        })
        .where(eq(agentsTable.id, agentId));

      await db.insert(agentDebtReductionsTable).values({
        agentId,
        calcDate,
        netGrossAmount: netGross.toFixed(2),
        reductionAmount: reduction.toFixed(2),
        debtBefore: currentDebt.toFixed(2),
        debtAfter: newDebt.toFixed(2),
        surplus: surplus !== null ? surplus.toFixed(2) : null,
      });

      debtReductionSummary.push({
        agentId,
        netGross: netGross.toFixed(2),
        reduction: reduction.toFixed(2),
        debtBefore: currentDebt.toFixed(2),
        debtAfter: newDebt.toFixed(2),
        surplus: surplus !== null ? surplus.toFixed(2) : null,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Dispatch deficit alerts to affected agents
    const deficitWriterIds = results
      .filter((r) => r && parseFloat(r.writerBalance) < 0)
      .map((r) => r!.writerId);

    if (deficitWriterIds.length > 0) {
      const writerRows = await db
        .select({ id: writersTable.id, agentId: writersTable.agentId, fullCode: writersTable.fullCode })
        .from(writersTable)
        .where(inArray(writersTable.id, deficitWriterIds));

      const agentIdSet = [...new Set(writerRows.map((w) => w.agentId))];
      const agentRows = await db
        .select({ id: agentsTable.id, userId: agentsTable.userId, fullCode: agentsTable.fullCode })
        .from(agentsTable)
        .where(inArray(agentsTable.id, agentIdSet));

      const agentMap = new Map(agentRows.map((a) => [a.id, a]));
      const writersByAgent = new Map<string, typeof writerRows>();
      for (const w of writerRows) {
        if (!writersByAgent.has(w.agentId)) writersByAgent.set(w.agentId, []);
        writersByAgent.get(w.agentId)!.push(w);
      }

      for (const [agentId, writers] of writersByAgent) {
        const agentRow = agentMap.get(agentId);
        if (!agentRow) continue;
        const writerList = writers.map((w) => {
          const calc = results.find((r) => r?.writerId === w.id);
          const deficit = calc ? Math.abs(parseFloat(calc.writerBalance)).toFixed(2) : "0.00";
          return `${w.fullCode}: deficit GH₵${deficit}`;
        });
        await dispatchSystemNotification({
          sentBy: req.user!.userId,
          messageType: "deficit_alert",
          title: `Deficit Alert — ${calcDate}`,
          body: `One or more of your writers ran a deficit on ${calcDate}. ${writerList.join("; ")}.`,
          targetType: "agent",
          targetId: agentId,
          recipientUserIds: [agentRow.userId],
        });
      }
    }

    res.json({
      calculated: results.length,
      calcDate,
      results,
      reserveAllocations: allocations.length,
      debtReductions: debtReductionSummary,
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
