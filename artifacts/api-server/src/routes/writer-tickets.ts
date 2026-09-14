import { Router } from "express";
import { db, ticketsTable, gamesTable, betTypesTable, writersTable, writerTokenWalletsTable, writerTokenTransactionsTable, postpaidDailyLedgerTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { recordTicketEvent } from "../lib/ticket-audit";

const router = Router();

const placeBetSchema = z.object({
  gameId: z.string().uuid(),
  betTypeCode: z.string(),
  numbers: z.string(), // e.g. "23,45"
  stakeAmount: z.number().min(1),
});

// Format: TKT-YYYYMMDD-XXXX
async function generateTicketNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TKT-${dateStr}-${rand}`;
}

router.post("/tickets", requireAuth, requireRole("writer"), async (req, res) => {
  const parse = placeBetSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid data", details: parse.error.issues });
    return;
  }
  const { gameId, betTypeCode, numbers, stakeAmount } = parse.data;
  const writerId = req.user!.userId;

  // 1. Validate writer and model
  const [writer] = await db.select().from(writersTable).where(eq(writersTable.id, writerId)).limit(1);
  if (!writer || !writer.isActive) {
    res.status(403).json({ error: "Account inactive" });
    return;
  }

  // 2. Validate game
  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId)).limit(1);
  if (!game || game.status !== "live") {
    res.status(400).json({ error: "Game is not live" });
    return;
  }

  // Games deliberately stay 'live' past their close time - they are only
  // closed when calculations run. So status alone does not prove a draw is
  // still open, and without this check a ticket could be sold after the
  // numbers are drawn. Server time decides; a device clock cannot be trusted.
  if (new Date() >= new Date(game.closeAt)) {
    res.status(400).json({
      error: "Betting has closed for this game",
      closedAt: game.closeAt,
    });
    return;
  }

  // 3. Validate bet type
  const [betType] = await db.select().from(betTypesTable).where(eq(betTypesTable.code, betTypeCode)).limit(1);
  if (!betType || !betType.isActive) {
    res.status(400).json({ error: "Invalid bet type" });
    return;
  }

  // Check number format
  const numArr = numbers.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= 90);
  if (numArr.length !== betType.numbersRequired) {
    res.status(400).json({ error: `Requires exactly ${betType.numbersRequired} numbers between 1-90` });
    return;
  }

  const potentialPayout = stakeAmount * parseFloat(betType.payoutMultiplier);
  const ticketNumber = await generateTicketNumber();

  try {
    const result = await db.transaction(async (tx) => {
      let transactionId = null;

      // Handle Prepaid vs Postpaid
      if (writer.operationModel === "prepaid") {
        const [wallet] = await tx.select().from(writerTokenWalletsTable).where(eq(writerTokenWalletsTable.writerId, writerId)).limit(1);
        if (!wallet || parseFloat(wallet.balance) < stakeAmount) {
          throw new Error("INSUFFICIENT_FUNDS");
        }
        
        const newBalance = parseFloat(wallet.balance) - stakeAmount;
        await tx.update(writerTokenWalletsTable)
          .set({ balance: newBalance.toString(), totalSpent: (parseFloat(wallet.totalSpent) + stakeAmount).toString() })
          .where(eq(writerTokenWalletsTable.writerId, writerId));
        
        const [tokenTx] = await tx.insert(writerTokenTransactionsTable).values({
          writerId,
          transactionType: "bet_deduction",
          amount: (-stakeAmount).toString(),
          balanceAfter: newBalance.toString(),
          description: `Bet placed on ${game.name} - ${ticketNumber}`,
        }).returning();
        transactionId = tokenTx.id;
      } else {
        // Postpaid: Update daily ledger
        const today = new Date().toISOString().slice(0, 10);
        let [ledger] = await tx.select().from(postpaidDailyLedgerTable)
          .where(and(eq(postpaidDailyLedgerTable.writerId, writerId), eq(postpaidDailyLedgerTable.ledgerDate, today), eq(postpaidDailyLedgerTable.gameId, gameId))).limit(1);
        
        if (!ledger) {
          [ledger] = await tx.insert(postpaidDailyLedgerTable).values({
            writerId,
            gameId,
            ledgerDate: today,
            totalStakes: stakeAmount.toString(),
            netBalance: stakeAmount.toString()
          }).returning();
        } else {
          await tx.update(postpaidDailyLedgerTable)
            .set({ 
              totalStakes: (parseFloat(ledger.totalStakes) + stakeAmount).toString(),
              netBalance: (parseFloat(ledger.netBalance) + stakeAmount).toString()
            })
            .where(eq(postpaidDailyLedgerTable.id, ledger.id));
        }
      }

      // Record Ticket
      const [ticket] = await tx.insert(ticketsTable).values({
        ticketNumber,
        writerId,
        gameId,
        betTypeId: betType.id,
        numbers: numArr.join(","),
        stakeAmount: stakeAmount.toString(),
        potentialPayout: potentialPayout.toString(),
        status: "active",
        tokenTransactionId: transactionId,
      }).returning();

      // The audit row carries the ticket's own creation time, so the two can
      // never drift and make a false "before sale" anomaly.
      await recordTicketEvent(tx, {
        ticketId: ticket.id,
        eventType: "sold",
        toStatus: "active",
        actorRole: "writer",
        source: "portal",
        occurredAt: ticket.createdAt,
      });

      return ticket;
    });

    res.status(201).json(result);
  } catch (err: any) {
    if (err.message === "INSUFFICIENT_FUNDS") {
      res.status(402).json({ error: "Insufficient token balance" });
    } else {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.get("/tickets", requireAuth, async (req, res) => {
  const writerId = req.user!.role === "writer" ? req.user!.userId : (req.query.writerId as string);
  const query = db.select().from(ticketsTable);
  if (writerId) query.where(eq(ticketsTable.writerId, writerId));
  const tickets = await query.orderBy(desc(ticketsTable.createdAt)).limit(100);
  res.json(tickets);
});

export default router;
