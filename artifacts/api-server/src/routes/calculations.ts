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
import { eq, and, gte, lte, desc, inArray, sql } from "drizzle-orm";
import { reserveLedgerTotals, recomputeReserveFund } from "../lib/finance/reserve";
import { drawCompleted, approvedCorrection, normaliseNumbers } from "./draws";
import { audit } from "../lib/finance/books";
import { drawCorrectionsTable } from "@workspace/db";

class DrawAlreadyRun extends Error {}
import { RunCalculationsBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { calculateWriter } from "../lib/calculator";
import { verifyLedgerAndEscalate } from "../lib/accountant";
import { dispatchSystemNotification } from "../lib/notify";
import { settleGameTickets } from "../lib/settle-tickets";
import { getUnifiedWriterTotals } from "../lib/unified-sales";
import { quoteDueLedgers, stampUnsettledAtCalculation, type UnsettledWriter } from "../lib/postpaid";
import { logger } from "../lib/logger";

const router = Router();

router.post(
  "/calculations/run",
  requireAuth,
  // The administrator runs draws. The director funds the Master Wallet that
  // pays what a draw produces, and so does not also decide what it produces.
  requireRole("administrator"),
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
    let settlement: Awaited<ReturnType<typeof settleGameTickets>> | null = null;
    let correction: Awaited<ReturnType<typeof approvedCorrection>> | null = null;
    // Writers who had not handed in their postpaid money when this ran. Their
    // wins are still calculated, but stamped for a reviewer to decide.
    let unsettledWriters: UnsettledWriter[] = [];

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

      // A draw runs once. Running it again is allowed only to apply a
      // correction the director approved, and only with the numbers approved.
      const done = await drawCompleted(db, gameId);
      correction = await approvedCorrection(db, gameId);
      if (done.completed && !correction) {
        res.status(409).json({
          error: "Draw already run. To change its numbers, propose a correction in Draw Histories; the director approves it and the draw is unlocked for one re-run.",
          code: "draw_already_run",
        });
        return;
      }
      if (correction && (normaliseNumbers(winningNumbers) !== correction.newWinning || normaliseNumbers(machineNumbers) !== correction.newMachine)) {
        res.status(409).json({
          error: `This re-run is approved for winning ${correction.newWinning} and machine ${correction.newMachine} only.`,
          code: "correction_numbers_mismatch",
        });
        return;
      }

      // Closing the game and settling its tickets are one act. Done
      // separately, a settlement failure leaves the game marked closed with
      // its numbers posted and no wins behind it - which reads as a finished
      // draw and is the hardest state to notice or unpick.
      try {
        settlement = await db.transaction(async (tx) => {
          // Two runs of the same draw at once: the second waits here, then
          // finds the first one's result and stops.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`draw:${gameId}`}))`);
          const again = await drawCompleted(tx, gameId);
          if (again.settled) throw new DrawAlreadyRun();

          await tx
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

          // Quote anything not yet quoted before we judge who is unsettled, so
          // a writer is never marked delinquent on a figure nobody ever showed
          // them.
          await quoteDueLedgers(tx, { gameId });

          // Posting the declared numbers also settles the writer tickets for
          // this draw, creating the payout requests the payout review screen
          // works from. Idempotent - a game already settled is left alone.
          const result = await settleGameTickets(tx, gameId, winningNumbers, machineNumbers, req.user!.userId);

          // This run is the settlement deadline. Stamp it after settlement, so
          // the payout requests it marks already exist.
          unsettledWriters = await stampUnsettledAtCalculation(tx, gameId);

          return result;
        });
      } catch (err) {
        if (err instanceof DrawAlreadyRun) {
          res.status(409).json({ error: "Draw already run - another run of this draw finished first.", code: "draw_already_run" });
          return;
        }
        // Say what actually broke. A bare 500 here cost an evening once.
        logger.error({ err, gameId, calcDate }, "Settlement failed");
        res.status(500).json({
          error: `Could not settle this draw: ${err instanceof Error ? err.message : String(err)}`,
          stage: "settlement",
        });
        return;
      }
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

    // Gross and wins now come from one place, covering both agent-entered
    // figures and writer-portal tickets. Settlement above has already set
    // ticket win amounts, so portal wins are included in the same pass.
    const unified = await getUnifiedWriterTotals(db, { calcDate, gameId });
    const grossMap = new Map<string, number>();
    const winsMap = new Map<string, number>();
    for (const [writerId, t] of unified) {
      grossMap.set(writerId, t.gross);
      winsMap.set(writerId, t.wins);
    }

    const allWriterIds = [...unified.keys()];

    if (allWriterIds.length === 0) {
      res.json({ calculated: 0, calcDate, results: [], reserveAllocations: 0, settlement, unsettledWriters });
      return;
    }

    const runGameId = gameId && gameId !== "undefined" && gameId !== "null" ? gameId : null;
    const runWriterIds = allWriterIds;

    /*
     * Everything that changes money for this draw happens in one transaction:
     * either the whole draw is booked, or none of it is.
     *
     * A draw can be run again (a corrected entry, a late wins figure). Before
     * this change a second run added its reserve contributions, its reserve
     * draws and its agency debt changes on top of the first run's - the
     * reserve and the agency balances drifted by exactly the amounts of every
     * re-run. Now a re-run first undoes its own previous run: its automatic
     * reserve draws are superseded (kept, no longer counted) and its agency
     * debt changes are reversed, and only then is the draw booked afresh.
     */
    const booked = await db.transaction(async (tx) => {
      // One run of a given draw at a time.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`calc:${calcDate}:${runGameId ?? "day"}`}))`);

      // ── Undo this draw's previous run ──
      const thisDraw = runGameId
        ? sql`(a.game_id = ${runGameId} OR (a.game_id IS NULL AND a.writer_id IN (
              SELECT c.writer_id FROM daily_calculations c WHERE c.calc_date = ${calcDate} AND c.game_id = ${runGameId})))`
        : sql`(a.game_id IS NULL AND a.writer_id IN (${sql.join(runWriterIds.map((w) => sql`${w}::uuid`), sql`, `)}))`;
      await tx.execute(sql`
        UPDATE reserve_allocations a
           SET superseded_at = now(),
               superseded_reason = 'Superseded: this draw was calculated again on ' || to_char(now() AT TIME ZONE 'Africa/Accra', 'DD Mon YYYY HH24:MI')
         WHERE a.source = 'auto' AND a.superseded_at IS NULL AND a.allocation_date = ${calcDate} AND ${thisDraw}`);

      const previous = await tx.execute(sql`
        SELECT id, agent_id, reduction_amount FROM agent_debt_reductions
         WHERE calc_date = ${calcDate} AND superseded_at IS NULL
           AND ${runGameId ? sql`game_id = ${runGameId}` : sql`game_id IS NULL AND false`}
         FOR UPDATE`);
      for (const p of previous.rows as Array<{ id: string; agent_id: string; reduction_amount: string }>) {
        await tx.execute(sql`UPDATE agents SET outstanding_debt = outstanding_debt + ${p.reduction_amount}::numeric WHERE id = ${p.agent_id}`);
        await tx.execute(sql`UPDATE agent_debt_reductions SET superseded_at = now(), superseded_reason = 'Reversed: this draw was calculated again' WHERE id = ${p.id}`);
      }

      if (runGameId) {
        await tx.delete(dailyCalculationsTable).where(eq(dailyCalculationsTable.gameId, runGameId));
      } else {
        await tx.delete(dailyCalculationsTable).where(
          and(eq(dailyCalculationsTable.calcDate, calcDate), inArray(dailyCalculationsTable.writerId, runWriterIds)),
        );
      }

      // The reserve available to cover deficits, from the ledger itself:
      // everything ever set aside by calculations, less the draws still
      // standing. Worked in pesewas so no float residue reaches the books.
      const reserveNow = await reserveLedgerTotals(tx);
      let reserveCents = Math.max(0, Math.round(reserveNow.balance * 100));

      const results: (typeof dailyCalculationsTable.$inferSelect)[] = [];
      const allocations: Array<{ writerId: string; amountDrawn: string; reserveBalanceAfter: string }> = [];

      for (const writerId of runWriterIds) {
        const gross = grossMap.get(writerId) ?? 0;
        const wins = winsMap.get(writerId) ?? 0;
        const calc = calculateWriter(gross, wins, commissionPct, reservePct);

        let balanceCents = Math.round(calc.writerBalance * 100);
        if (balanceCents < 0 && reserveCents > 0) {
          const drawCents = Math.min(-balanceCents, reserveCents);
          reserveCents -= drawCents;
          balanceCents += drawCents;
          allocations.push({
            writerId,
            amountDrawn: (drawCents / 100).toFixed(2),
            reserveBalanceAfter: (reserveCents / 100).toFixed(2),
          });
        }

        const [saved] = await tx
          .insert(dailyCalculationsTable)
          .values({
            writerId,
            calcDate,
            gameId: runGameId,
            grossSales: calc.grossSales.toFixed(2),
            commissionPct: String(calc.commissionPct),
            commissionAmount: calc.commissionAmount.toFixed(2),
            netGross: calc.netGross.toFixed(2),
            winsAmount: calc.winsAmount.toFixed(2),
            reservePct: String(calc.reservePct),
            reserveAmount: calc.reserveAmount.toFixed(2),
            writerBalance: (balanceCents / 100).toFixed(2),
          })
          .returning();
        results.push(saved!);

        await tx
          .update(grossEntriesTable)
          .set({ locked: true })
          .where(and(
            eq(grossEntriesTable.writerId, writerId),
            eq(grossEntriesTable.entryDate, calcDate),
            runGameId ? eq(grossEntriesTable.gameId, runGameId) : undefined,
          ));
        await tx
          .update(winsEntriesTable)
          .set({ locked: true })
          .where(and(
            eq(winsEntriesTable.writerId, writerId),
            eq(winsEntriesTable.entryDate, calcDate),
            runGameId ? eq(winsEntriesTable.gameId, runGameId) : undefined,
          ));
      }

      for (const alloc of allocations) {
        await tx.insert(reserveAllocationsTable).values({
          writerId: alloc.writerId,
          allocationDate: calcDate,
          amountDrawn: alloc.amountDrawn,
          reason: "Auto-draw: negative writer balance",
          reserveBalanceAfter: alloc.reserveBalanceAfter,
          gameId: runGameId,
          source: "auto",
          createdBy: req.user!.userId,
        });
      }

      // The month-by-month summary the Reserve page shows is rebuilt from the
      // ledger, never added to.
      await recomputeReserveFund(tx);

      // ── Agency balances ──
      const writerAgentRows = await tx
        .select({ writerId: writersTable.id, agentId: writersTable.agentId })
        .from(writersTable)
        .where(inArray(writersTable.id, runWriterIds));
      const writerToAgent = new Map(writerAgentRows.map((r) => [r.writerId, r.agentId]));
      const agentDailyNetCents = new Map<string, number>();
      for (const r of results) {
        const agentId = writerToAgent.get(r.writerId);
        if (!agentId) continue;
        agentDailyNetCents.set(agentId, (agentDailyNetCents.get(agentId) ?? 0) + Math.round(parseFloat(r.writerBalance) * 100));
      }

      const debtReductionSummary: Array<{ agentId: string; netGross: string; reduction: string; debtBefore: string; debtAfter: string; surplus: string | null }> = [];
      for (const [agentId, netCents] of agentDailyNetCents) {
        if (netCents === 0) continue;
        const [agentRow] = await tx
          .select({ id: agentsTable.id, outstandingDebt: agentsTable.outstandingDebt })
          .from(agentsTable)
          .where(eq(agentsTable.id, agentId))
          .for("update")
          .limit(1);
        if (!agentRow) continue;
        const currentCents = Math.round(parseFloat(agentRow.outstandingDebt || "0") * 100);
        const newCents = currentCents - netCents;
        const debtSinceVal = newCents < 0 ? (currentCents >= 0 ? new Date() : undefined) : null;
        await tx
          .update(agentsTable)
          .set({ outstandingDebt: (newCents / 100).toFixed(2), debtSince: debtSinceVal })
          .where(eq(agentsTable.id, agentId));
        const row = {
          agentId,
          netGross: (netCents / 100).toFixed(2),
          reduction: (netCents / 100).toFixed(2),
          debtBefore: (currentCents / 100).toFixed(2),
          debtAfter: (newCents / 100).toFixed(2),
          surplus: null,
        };
        await tx.insert(agentDebtReductionsTable).values({
          agentId,
          calcDate,
          gameId: runGameId,
          netGrossAmount: row.netGross,
          reductionAmount: row.reduction,
          debtBefore: row.debtBefore,
          debtAfter: row.debtAfter,
          surplus: null,
        });
        debtReductionSummary.push(row);
      }

      return { results, allocations, debtReductionSummary, agentIds: [...agentDailyNetCents.keys()] };
    });

    const { results, allocations, debtReductionSummary } = booked;

    // The approved correction has now been carried out.
    if (correction) {
      await db.update(drawCorrectionsTable)
        .set({ status: "applied", appliedBy: req.user!.userId, appliedAt: new Date() })
        .where(eq(drawCorrectionsTable.id, correction.id));
      await audit(db, { actorUserId: req.user!.userId, actorRole: req.user!.role, action: "draw.correction_applied", entity: "draw_correction", entityId: correction.id,
        detail: { winning: correction.newWinning, machine: correction.newMachine, writers: results.length } });
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
    for (const agentId of booked.agentIds) {
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
      settlement,
      results,
      reserveAllocations: allocations.length,
      debtReductions: debtReductionSummary,
      // Named so the run reports who closed the day owing money.
      unsettledWriters,
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
