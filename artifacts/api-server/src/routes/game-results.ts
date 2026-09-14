import { Router } from "express";
import { db, gameResultsTable, ticketsTable, payoutRequestsTable, writersTable, writerTokenWalletsTable, writerTokenTransactionsTable, postpaidDailyLedgerTable, betTypesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { SmsAdapter } from "../lib/sms-gateway";
import { recordTicketEvent } from "../lib/ticket-audit";
import { payoutFor } from "../lib/settle-tickets";

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

  // Ensure game is closed
  // Process winners, update tickets, create payout requests
  const result = await db.transaction(async (tx) => {
    // Create game result
    const [gameResult] = await tx.insert(gameResultsTable).values({
      gameId,
      winningNumbers,
      machineNumbers,
      processedBy: req.user!.userId,
    }).returning();

    // Fetch tickets and bet types
    const tickets = await tx.select().from(ticketsTable).where(eq(ticketsTable.gameId, gameId));
    const betTypes = await tx.select().from(betTypesTable);
    const betTypeMap = new Map(betTypes.map(b => [b.id, b]));

    let totalWinners = 0;
    let totalPayouts = 0;
    let totalStakes = 0;

    for (const ticket of tickets) {
      if (ticket.status !== "active") continue;
      totalStakes += parseFloat(ticket.stakeAmount);

      const betType = betTypeMap.get(ticket.betTypeId);
      if (!betType) continue;

      // Same engine as the calculation run. These two paths must never
      // disagree about what a ticket is owed.
      const payout = payoutFor(ticket, winningNumbers, betType);
      const winAmount = payout.toFixed(2);

      if (payout > 0) {
        totalWinners++;
        totalPayouts += payout;

        await tx.update(ticketsTable)
          .set({ status: "won", isWinner: true, winAmount })
          .where(eq(ticketsTable.id, ticket.id));
          
        const [ticketWriter] = await tx
          .select({ agentId: writersTable.agentId })
          .from(writersTable)
          .where(eq(writersTable.id, ticket.writerId))
          .limit(1);
        if (!ticketWriter) {
          throw new Error(`Writer ${ticket.writerId} not found for ticket ${ticket.id}`);
        }

        await tx.insert(payoutRequestsTable).values({
          ticketId: ticket.id,
          gameResultId: gameResult.id,
          writerId: ticket.writerId,
          agentId: ticketWriter.agentId,
          payoutAmount: winAmount,
        });
      } else {
        await tx.update(ticketsTable)
          .set({ status: "lost" })
          .where(eq(ticketsTable.id, ticket.id));
      }
    }

    await tx.update(gameResultsTable).set({
      totalTickets: tickets.length,
      totalStakes: totalStakes.toString(),
      totalWinners,
      totalPayouts: totalPayouts.toString()
    }).where(eq(gameResultsTable.id, gameResult.id));

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

  for (const payout of payouts) {
    const [writer] = await db.select().from(writersTable).where(eq(writersTable.id, payout.writerId)).limit(1);
    if (!writer) {
      skipped.push({ payoutId: payout.id, reason: "writer not found" });
      continue;
    }

    if (writer.operationModel === "prepaid") {
      // Credit wallet
      const [wallet] = await db.select().from(writerTokenWalletsTable).where(eq(writerTokenWalletsTable.writerId, writer.id)).limit(1);
      if (!wallet) {
        skipped.push({ payoutId: payout.id, reason: "token wallet not found" });
        continue;
      }
      const newBalance = parseFloat(wallet.balance) + parseFloat(payout.payoutAmount);
      await db.update(writerTokenWalletsTable).set({ balance: newBalance.toString() }).where(eq(writerTokenWalletsTable.writerId, writer.id));
      
      await db.insert(writerTokenTransactionsTable).values({
        writerId: writer.id,
        transactionType: "win_credit",
        amount: payout.payoutAmount,
        balanceAfter: newBalance.toString(),
        description: `Win payout for ticket on game`,
      });
    } else {
      // Postpaid credit
      const today = new Date().toISOString().slice(0, 10);
      let [ledger] = await db.select().from(postpaidDailyLedgerTable)
        .where(and(eq(postpaidDailyLedgerTable.writerId, writer.id), eq(postpaidDailyLedgerTable.ledgerDate, today), eq(postpaidDailyLedgerTable.gameId, gameId))).limit(1);
      
      if (ledger) {
        await db.update(postpaidDailyLedgerTable)
          .set({ 
            totalWinnings: (parseFloat(ledger.totalWinnings) + parseFloat(payout.payoutAmount)).toString(),
            netBalance: (parseFloat(ledger.netBalance) - parseFloat(payout.payoutAmount)).toString()
          })
          .where(eq(postpaidDailyLedgerTable.id, ledger.id));
      }
    }

    await db.update(payoutRequestsTable).set({ status: "paid", paidAt: new Date() }).where(eq(payoutRequestsTable.id, payout.id));

    await recordTicketEvent(db, {
      ticketId: payout.ticketId,
      eventType: "paid",
      actorUserId: req.user!.userId,
      actorRole: req.user!.role,
      source: "admin",
      note: `Paid ${payout.payoutAmount}`,
    });

    // Send SMS
    if (writer.phone) {
      await smsAdapter.send(writer.phone, `Congratulations! You won GHS ${payout.payoutAmount} on VS2000 Lottery. Reference: ${payout.ticketId}`);
    }
  }

  await db.update(gameResultsTable).set({ smsNotificationsSent: true }).where(eq(gameResultsTable.id, gameResult.id));

  res.json({
    success: true,
    processedCount: payouts.length - skipped.length,
    skippedCount: skipped.length,
    skipped,
  });
});

export default router;
