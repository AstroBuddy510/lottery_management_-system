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
  gamesTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { RunCalculationsBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { calculateWriter } from "../lib/calculator";
import { verifyLedgerAndEscalate } from "../lib/accountant";
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
    const gameId = parse.data.gameId;
    const winningNumbers = parse.data.winningNumbers;
    const machineNumbers = parse.data.machineNumbers;

    if (gameId && gameId !== "undefined" && gameId !== "null") {
      const [game] = await db
        .select()
        .from(gamesTable)
        .where(eq(gamesTable.id, gameId))
        .limit(1);

      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }

      if (!winningNumbers || !machineNumbers) {
        res.status(400).json({ error: "Winning numbers and machine numbers are required to run calculations for this game event." });
        return;
      }

      await db
        .update(gamesTable)
        .set({
          winningNumbers,
          machineNumbers,
          status: "closed",
          closedAt: new Date(),
          closedBy: req.user!.userId,
          closeType: "manual",
          updatedAt: new Date(),
        })
        .where(eq(gamesTable.id, gameId));
    }

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

    const grossConditions = [eq(grossEntriesTable.entryDate, calcDate)];
    const winsConditions = [eq(winsEntriesTable.entryDate, calcDate)];
    if (gameId && gameId !== "undefined" && gameId !== "null") {
      grossConditions.push(eq(grossEntriesTable.gameId, gameId));
      winsConditions.push(eq(winsEntriesTable.gameId, gameId));
    }

    const grossEntries = await db
      .select()
      .from(grossEntriesTable)
      .where(and(...grossConditions));

    const winsEntries = await db
      .select()
      .from(winsEntriesTable)
      .where(and(...winsConditions));

    const grossMap = new Map<string, number>();
    for (const e of grossEntries) {
      if (e.isLate && !e.adminConfirmed) {
        continue;
      }
      grossMap.set(e.writerId, (grossMap.get(e.writerId) ?? 0) + parseFloat(e.grossAmount));
    }

    const winsMap = new Map<string, number>();
    for (const e of winsEntries) {
      winsMap.set(e.writerId, (winsMap.get(e.writerId) ?? 0) + parseFloat(e.winsAmount));
    }

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
            gameId && gameId !== "undefined" && gameId !== "null" ? eq(dailyCalculationsTable.gameId, gameId) : undefined,
          ),
        );

      const [saved] = await db
        .insert(dailyCalculationsTable)
        .values({
          writerId,
          calcDate,
          gameId: (gameId && gameId !== "undefined" && gameId !== "null") ? gameId : null,
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
            gameId && gameId !== "undefined" && gameId !== "null" ? eq(grossEntriesTable.gameId, gameId) : undefined,
          ),
        );
      await db
        .update(winsEntriesTable)
        .set({ locked: true })
        .where(
          and(
            eq(winsEntriesTable.writerId, writerId),
            eq(winsEntriesTable.entryDate, calcDate),
            gameId && gameId !== "undefined" && gameId !== "null" ? eq(winsEntriesTable.gameId, gameId) : undefined,
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

    // ── Automated balance adjustment from daily calculations ───────────────────
    // Group results by agent, sum writerBalance per agent, then update outstandingDebt
    const writerAgentRows = await db
      .select({ writerId: writersTable.id, agentId: writersTable.agentId })
      .from(writersTable)
      .where(inArray(writersTable.id, allWriterIds));

    const writerToAgent = new Map(writerAgentRows.map((r) => [r.writerId, r.agentId]));

    // Sum writerBalance per agent across all their writers to get daily net profit/loss
    const agentDailyNet = new Map<string, number>();
    for (const r of results) {
      if (!r) continue;
      const agentId = writerToAgent.get(r.writerId);
      if (!agentId) continue;
      agentDailyNet.set(agentId, (agentDailyNet.get(agentId) ?? 0) + parseFloat(r.writerBalance));
    }

    const debtReductionSummary: Array<{
      agentId: string; netGross: string; reduction: string; debtBefore: string; debtAfter: string; surplus: string | null;
    }> = [];

    for (const [agentId, dailyNet] of agentDailyNet) {
      if (Math.abs(dailyNet) < 0.005) continue;

      const [agentRow] = await db
        .select({ id: agentsTable.id, outstandingDebt: agentsTable.outstandingDebt })
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId))
        .limit(1);

      if (!agentRow) continue;
      const currentDebt = parseFloat(agentRow.outstandingDebt || "0");
      const newDebt = currentDebt - dailyNet;

      const debtSinceVal = newDebt < 0 
        ? (currentDebt >= 0 ? new Date() : undefined) 
        : null;

      await db
        .update(agentsTable)
        .set({
          outstandingDebt: newDebt.toFixed(2),
          debtSince: debtSinceVal,
        })
        .where(eq(agentsTable.id, agentId));

      await db.insert(agentDebtReductionsTable).values({
        agentId,
        calcDate,
        netGrossAmount: dailyNet.toFixed(2),
        reductionAmount: dailyNet.toFixed(2),
        debtBefore: currentDebt.toFixed(2),
        debtAfter: newDebt.toFixed(2),
        surplus: null,
      });

      debtReductionSummary.push({
        agentId,
        netGross: dailyNet.toFixed(2),
        reduction: dailyNet.toFixed(2),
        debtBefore: currentDebt.toFixed(2),
        debtAfter: newDebt.toFixed(2),
        surplus: null,
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

    // Verify ledger and escalate conflicts for all affected agents
    for (const [agentId] of agentDailyNet) {
      verifyLedgerAndEscalate(agentId, req.user!.userId).catch(console.error);
    }

    // Dispatch balance reminders to all active agents
    try {
      const activeAgents = await db
        .select({
          id: agentsTable.id,
          userId: agentsTable.userId,
          outstandingDebt: agentsTable.outstandingDebt,
        })
        .from(agentsTable)
        .where(eq(agentsTable.status, "active"));

      for (const agentRow of activeAgents) {
        const val = parseFloat(agentRow.outstandingDebt || "0");
        let bodyText = "";
        if (val < 0) {
          bodyText = `Your outstanding balance to be paid to the company is GH₵ ${Math.abs(val).toFixed(2)}.`;
        } else if (val > 0) {
          bodyText = `Your account balance is clear. You have a surplus of GH₵ ${val.toFixed(2)}.`;
        } else {
          bodyText = `Your account balance is clear.`;
        }

        await dispatchSystemNotification({
          sentBy: req.user!.userId,
          messageType: "reminder",
          title: `Balance Reminder — ${calcDate}`,
          body: bodyText,
          targetType: "agent",
          targetId: agentRow.id,
          recipientUserIds: [agentRow.userId],
        });
      }
    } catch (e) {
      console.error("Failed to send balance reminders to agents:", e);
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
    const { writerId, dateFrom, dateTo, gameId } = req.query as Record<string, string>;
    const conditions = [];
    if (writerId)
      conditions.push(eq(dailyCalculationsTable.writerId, writerId));
    if (dateFrom)
      conditions.push(gte(dailyCalculationsTable.calcDate, dateFrom));
    if (dateTo) conditions.push(lte(dailyCalculationsTable.calcDate, dateTo));
    if (gameId && gameId !== "undefined" && gameId !== "null")
      conditions.push(eq(dailyCalculationsTable.gameId, gameId));

    const calculations = await db
      .select()
      .from(dailyCalculationsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(dailyCalculationsTable.calcDate));
    res.json(calculations);
  },
);

export default router;
