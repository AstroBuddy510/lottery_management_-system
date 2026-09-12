import { Router } from "express";
import { db, gameResultsTable, ticketsTable, payoutRequestsTable, writersTable, writerTokenWalletsTable, writerTokenTransactionsTable, postpaidDailyLedgerTable, betTypesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { SmsAdapter } from "../lib/sms-gateway";

const router = Router();
const smsAdapter = new SmsAdapter();

const gameResultSchema = z.object({
  gameId: z.string().uuid(),
  winningNumbers: z.string(), // "23,45,67,89,12"
  machineNumbers: z.string(), // "11,22,33,44,55"
});

function checkWin(ticketNumbersStr: string, winningNumbersStr: string, betType: any): boolean {
  const ticketNums = ticketNumbersStr.split(",").map(n => parseInt(n, 10));
  const winNums = winningNumbersStr.split(",").map(n => parseInt(n, 10));
  
  if (betType.isPermutation) {
    // All numbers in ticket must exist in winning numbers (any order)
    return ticketNums.every(num => winNums.includes(num));
  } else {
    // Must match exactly for Direct (we assume position doesn't strictly matter for Direct 1/2/3 
    // unless 'exact order' is a rule. For standard NLA, Direct means the numbers must appear in the winning set.
    // If strict order is required, you'd match the array slices. Let's assume standard set inclusion here.)
    return ticketNums.every(num => winNums.includes(num));
  }
}

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

      const isWinner = checkWin(ticket.numbers, winningNumbers, betType);
      
      if (isWinner) {
        totalWinners++;
        totalPayouts += parseFloat(ticket.potentialPayout);
        
        await tx.update(ticketsTable)
          .set({ status: "won", isWinner: true, winAmount: ticket.potentialPayout })
          .where(eq(ticketsTable.id, ticket.id));
          
        await tx.insert(payoutRequestsTable).values({
          ticketId: ticket.id,
          gameResultId: gameResult.id,
          writerId: ticket.writerId,
          agentId: (await tx.select({ agentId: writersTable.agentId }).from(writersTable).where(eq(writersTable.id, ticket.writerId)).limit(1))[0].agentId,
          payoutAmount: ticket.potentialPayout,
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

  const payouts = await db.select().from(payoutRequestsTable).where(and(eq(payoutRequestsTable.gameResultId, gameResult.id), eq(payoutRequestsTable.status, "pending")));

  for (const payout of payouts) {
    const [writer] = await db.select().from(writersTable).where(eq(writersTable.id, payout.writerId)).limit(1);
    
    if (writer.operationModel === "prepaid") {
      // Credit wallet
      let [wallet] = await db.select().from(writerTokenWalletsTable).where(eq(writerTokenWalletsTable.writerId, writer.id)).limit(1);
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

    // Send SMS
    if (writer.phone) {
      await smsAdapter.send(writer.phone, `Congratulations! You won GHS ${payout.payoutAmount} on VS2000 Lottery. Reference: ${payout.ticketId}`);
    }
  }

  await db.update(gameResultsTable).set({ smsNotificationsSent: true }).where(eq(gameResultsTable.id, gameResult.id));

  res.json({ success: true, processedCount: payouts.length });
});

export default router;
