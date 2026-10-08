import { Router } from "express";
import { db, gameResultsTable, ticketsTable, payoutRequestsTable, writersTable, writerTokenWalletsTable, writerTokenTransactionsTable, postpaidDailyLedgerTable, betTypesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { SmsAdapter } from "../lib/sms-gateway";
import { recordTicketEvent } from "../lib/ticket-audit";
import { payoutFor, settleGameTickets } from "../lib/settle-tickets";
import { creditWallet } from "../lib/wallet";
import { logger } from "../lib/logger";

const router = Router();
const smsAdapter = new SmsAdapter();

const gameResultSchema = z.object({
  gameId: z.string().uuid(),
  winningNumbers: z.string(), // "23,45,67,89,12"
  machineNumbers: z.string(), // "11,22,33,44,55"
});

router.post("/game-results", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const parse = gameResultSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid data" });
    return;
  }
  const { gameId, winningNumbers, machineNumbers } = parse.data;

  /**
   * One settlement path, not two.
   *
   * This route used to carry its own copy of the loop: it looked the
   * writer's agent up per winning ticket rather than once, wrote no ticket
   * events at all - so a draw settled here left no audit trail while the
   * same draw settled through /calculations left a full one - and had no
   * guard against settling a game twice beyond the unique constraint on
   * game_results.game_id, which fails with a database error rather than an
   * answer.
   *
   * settleGameTickets is the same engine the calculation run uses, is
   * idempotent, and now writes in batches.
   */
  const result = await db.transaction(async (tx) => {
    const summary = await settleGameTickets(
      tx,
      gameId,
      winningNumbers,
      machineNumbers,
      req.user!.userId,
    );
    const [gameResult] = await tx
      .select()
      .from(gameResultsTable)
      .where(eq(gameResultsTable.id, summary.gameResultId))
      .limit(1);
    return gameResult;
  });

  res.json(result);
});

router.post("/game-results/:gameId/process-payouts", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const gameId = req.params["gameId"] as string;
  
  const [gameResult] = await db.select().from(gameResultsTable).where(eq(gameResultsTable.gameId, gameId)).limit(1);
  if (!gameResult) {
    res.status(404).json({ error: "Game result not found" });
    return;
  }

  // Pay only what a reviewer has approved. Before approval existed this read
  // "pending"; leaving it that way would have paid unreviewed requests and
  // skipped approved ones exactly backwards.
  const payouts = await db.select().from(payoutRequestsTable).where(and(eq(payoutRequestsTable.gameResultId, gameResult.id), eq(payoutRequestsTable.status, "approved")));
  const skipped: Array<{ payoutId: string; reason: string }> = [];

  /**
   * One transaction per payout, and the claim inside it.
   *
   * This loop used to run straight against db, so each payout was a sequence
   * of independent writes: credit the wallet, write the token transaction,
   * mark the request paid. A function that died between the first and the
   * last left a writer credited against a request still marked approved -
   * and the next run credited them again. Re-running a failed payout run is
   * exactly what an administrator would do.
   *
   * Claiming the request inside the same transaction as the credit makes the
   * pair all-or-nothing, and the WHERE on status means a second run - or a
   * second administrator pressing the button - finds nothing to claim rather
   * than paying twice.
   *
   * The whole run is deliberately NOT one transaction. At a large draw that
   * would be back to a single statement stream that cannot finish inside the
   * time limit, and a timeout would roll back every payout including the ones
   * that worked. Per-payout is the unit that can be safely retried.
   */
  const texts: Array<{ phone: string; message: string }> = [];

  for (const payout of payouts) {
    const [writer] = await db.select().from(writersTable).where(eq(writersTable.id, payout.writerId)).limit(1);
    if (!writer) {
      skipped.push({ payoutId: payout.id, reason: "writer not found" });
      continue;
    }

    try {
      const claimed = await db.transaction(async (tx) => {
        // Claim first, inside the transaction. Zero rows means someone else
        // already paid this one.
        const [got] = await tx
          .update(payoutRequestsTable)
          .set({ status: "paid", paidAt: new Date() })
          .where(
            and(
              eq(payoutRequestsTable.id, payout.id),
              eq(payoutRequestsTable.status, "approved"),
            ),
          )
          .returning({ id: payoutRequestsTable.id });
        if (!got) return false;

        if (writer.operationModel === "prepaid") {
          const newBalance = await creditWallet(
            tx,
            writer.id,
            parseFloat(payout.payoutAmount),
            false,
          );
          await tx.insert(writerTokenTransactionsTable).values({
            writerId: writer.id,
            transactionType: "win_credit",
            amount: payout.payoutAmount,
            balanceAfter: newBalance,
            description: `Win payout for ticket on game`,
          });
        } else {
          const today = new Date().toISOString().slice(0, 10);
          // Recorded against the writer's sales, and recorded ONLY. The company
          // pays this winner through the agent, so it must not come off what the
          // writer hands in - netting it off would let a writer who recorded a
          // win keep the day's takings, which is the risk-free position the
          // ledger exists to close.
          //
          // Added in SQL rather than read-then-written, so a win landing while
          // the writer is still selling cannot be lost.
          await tx.execute(sql`
            UPDATE postpaid_daily_ledger
               SET total_winnings = total_winnings + ${Number(payout.payoutAmount).toFixed(2)}::numeric
             WHERE writer_id = ${writer.id}
               AND ledger_date = ${today}
               AND game_id = ${gameId}
          `);
        }

        await recordTicketEvent(tx, {
          ticketId: payout.ticketId,
          eventType: "paid",
          actorUserId: req.user!.userId,
          actorRole: req.user!.role,
          source: "admin",
          note: `Paid ${payout.payoutAmount}`,
        });

        return true;
      });

      if (!claimed) {
        skipped.push({ payoutId: payout.id, reason: "already paid" });
        continue;
      }
    } catch (err) {
      // One payout failing must not stop the rest. It stays approved, so the
      // run can simply be repeated.
      logger.error(
        { payoutId: payout.id, err: err instanceof Error ? err.message : String(err) },
        "[PAYOUTS] payout failed and was left unpaid",
      );
      skipped.push({ payoutId: payout.id, reason: "failed, still approved" });
      continue;
    }

    // Texts go out after the money is committed, never inside the
    // transaction: a gateway timeout must not roll back a payment, and
    // waiting on an SMS per writer is most of what made this loop slow.
    if (writer.phone) {
      texts.push({
        phone: writer.phone,
        message: `Congratulations! You won GHS ${payout.payoutAmount} on VS2000 Lottery. Reference: ${payout.ticketId}`,
      });
    }
  }

  // Sent together, and never fatal - the money has already moved.
  const smsResults = await Promise.allSettled(
    texts.map((t) => smsAdapter.send(t.phone, t.message)),
  );
  const smsFailed = smsResults.filter((r) => r.status === "rejected").length;
  if (smsFailed > 0) {
    logger.error({ smsFailed, of: texts.length }, "[PAYOUTS] some win texts did not send");
  }

  await db.update(gameResultsTable).set({ smsNotificationsSent: true }).where(eq(gameResultsTable.id, gameResult.id));

  res.json({
    success: true,
    processedCount: payouts.length - skipped.length,
    smsSent: texts.length - smsFailed,
    skippedCount: skipped.length,
    skipped,
  });
});

export default router;
