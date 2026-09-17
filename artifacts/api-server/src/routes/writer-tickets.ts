import { Router } from "express";
import { db, ticketsTable, gamesTable, betTypesTable, writersTable, writerTokenWalletsTable, writerTokenTransactionsTable, postpaidDailyLedgerTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { recordTicketEvent } from "../lib/ticket-audit";
import {
  quote,
  validateSelection,
  parseNumberList,
  type Mechanic,
} from "../lib/bet-engine";

const router = Router();

const placeBetSchema = z.object({
  gameId: z.string().uuid(),
  betTypeCode: z.string(),
  numbers: z.string(), // e.g. "23,45"
  /**
   * The stake PER LINE. A perm buys many lines from one selection, so the
   * money taken is this times the line count - computed server-side, never
   * accepted from the client.
   */
  stakeAmount: z.number().min(0.01),
  bankerNumber: z.number().int().min(1).max(90).optional(),
});


/** Bets a customer bought together and paid for once. */
const slipSchema = z.object({
  gameId: z.string().uuid(),
  bets: z
    .array(
      z.object({
        betTypeCode: z.string(),
        numbers: z.string().default(""),
        stakeAmount: z.number().min(0.01),
        bankerNumber: z.number().int().min(1).max(90).optional(),
      }),
    )
    .min(1)
    .max(20),
});

// Format: SLIP-YYYYMMDD-XXXX
async function generateSlipNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `SLIP-${dateStr}-${rand}`;
}

interface PricedBet {
  betType: typeof betTypesTable.$inferSelect;
  numbers: number[];
  bankerNumber: number | null;
  stakePerLine: number;
  lines: number;
  stakeAmount: number;
  potentialPayout: number;
}

/**
 * Price one bet, or say why it cannot be placed.
 *
 * The engine owns what a selection costs and what it can pay. The client
 * sends numbers and a per-line stake; everything else is derived here, so a
 * single bet and a bet inside a slip are priced by exactly the same code.
 */
function priceBet(
  betType: typeof betTypesTable.$inferSelect,
  raw: { numbers: string; stakeAmount: number; bankerNumber?: number | undefined },
): { ok: true; bet: PricedBet } | { ok: false; error: string } {
  const numArr = parseNumberList(raw.numbers);
  const selection = {
    mechanic: betType.mechanic as Mechanic,
    numbers: numArr,
    bankerNumber: raw.bankerNumber ?? null,
    stakePerLine: raw.stakeAmount,
    multiplier: parseFloat(betType.payoutMultiplier),
    minStake: parseFloat(betType.minStake) || 0,
    maxStake: parseFloat(betType.maxStake) || 0,
  };

  const invalid = validateSelection(selection);
  if (invalid) return { ok: false, error: invalid };

  const priced = quote(selection);
  return {
    ok: true,
    bet: {
      betType,
      numbers: numArr,
      bankerNumber: raw.bankerNumber ?? null,
      stakePerLine: raw.stakeAmount,
      lines: priced.lines,
      stakeAmount: priced.totalStake,
      potentialPayout: priced.maxPayout,
    },
  };
}

/**
 * Take the money for a basket of bets and write the tickets.
 *
 * Runs inside one transaction, so a basket either sells whole or not at all -
 * a customer must never end up paying for three bets and holding two. The
 * balance is checked against the WHOLE basket before anything is written,
 * which is the part a per-bet loop would get wrong: three GHS 40 bets against
 * a GHS 100 float would pass twice and fail on the third.
 */
async function sellBets(
  tx: any,
  opts: {
    writer: typeof writersTable.$inferSelect;
    game: typeof gamesTable.$inferSelect;
    bets: PricedBet[];
    slipNumber: string | null;
  },
) {
  const { writer, game, bets, slipNumber } = opts;
  const writerId = writer.id;
  const total = bets.reduce((sum, b) => sum + b.stakeAmount, 0);

  let transactionId: string | null = null;

  if (writer.operationModel === "prepaid") {
    const [wallet] = await tx
      .select()
      .from(writerTokenWalletsTable)
      .where(eq(writerTokenWalletsTable.writerId, writerId))
      .limit(1);
    if (!wallet || parseFloat(wallet.balance) < total) {
      throw new Error("INSUFFICIENT_FUNDS");
    }

    const newBalance = parseFloat(wallet.balance) - total;
    await tx
      .update(writerTokenWalletsTable)
      .set({
        balance: newBalance.toString(),
        totalSpent: (parseFloat(wallet.totalSpent) + total).toString(),
      })
      .where(eq(writerTokenWalletsTable.writerId, writerId));

    // One debit for one payment, whether that is one bet or ten.
    const [tokenTx] = await tx
      .insert(writerTokenTransactionsTable)
      .values({
        writerId,
        transactionType: "bet_deduction",
        amount: (-total).toString(),
        balanceAfter: newBalance.toString(),
        description: slipNumber
          ? `${bets.length} bets on ${game.name} - ${slipNumber}`
          : `Bet placed on ${game.name}`,
      })
      .returning();
    transactionId = tokenTx.id;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const [ledger] = await tx
      .select()
      .from(postpaidDailyLedgerTable)
      .where(
        and(
          eq(postpaidDailyLedgerTable.writerId, writerId),
          eq(postpaidDailyLedgerTable.ledgerDate, today),
          eq(postpaidDailyLedgerTable.gameId, game.id),
        ),
      )
      .limit(1);

    if (!ledger) {
      await tx.insert(postpaidDailyLedgerTable).values({
        writerId,
        gameId: game.id,
        ledgerDate: today,
        totalStakes: total.toString(),
        netBalance: total.toString(),
      });
    } else {
      await tx
        .update(postpaidDailyLedgerTable)
        .set({
          totalStakes: (parseFloat(ledger.totalStakes) + total).toString(),
          netBalance: (parseFloat(ledger.netBalance) + total).toString(),
        })
        .where(eq(postpaidDailyLedgerTable.id, ledger.id));
    }
  }

  const created = [];
  for (const b of bets) {
    const ticketNumber = await generateTicketNumber();
    const [ticket] = await tx
      .insert(ticketsTable)
      .values({
        ticketNumber,
        slipNumber,
        writerId,
        gameId: game.id,
        betTypeId: b.betType.id,
        numbers: b.numbers.join(","),
        bankerNumber: b.bankerNumber,
        stakePerLine: b.stakePerLine.toString(),
        lineCount: b.lines,
        stakeAmount: b.stakeAmount.toString(),
        potentialPayout: b.potentialPayout.toString(),
        status: "active",
        tokenTransactionId: transactionId,
      })
      .returning();

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

    created.push(ticket);
  }

  return { tickets: created, total };
}

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
  const { gameId, betTypeCode, numbers, bankerNumber } = parse.data;
  const stakePerLine = parse.data.stakeAmount;
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

  const pricedBet = priceBet(betType, {
    numbers,
    stakeAmount: stakePerLine,
    bankerNumber,
  });
  if (!pricedBet.ok) {
    res.status(400).json({ error: pricedBet.error });
    return;
  }

  try {
    const result = await db.transaction(async (tx) =>
      sellBets(tx, { writer, game, bets: [pricedBet.bet], slipNumber: null }),
    );
    // One bet in, one ticket out - the shape the portal already expects.
    res.status(201).json(result.tickets[0]);
  } catch (err: any) {
    if (err.message === "INSUFFICIENT_FUNDS") {
      res.status(402).json({ error: "Insufficient token balance" });
    } else {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * Sell a basket of bets as one slip.
 *
 * Every bet is validated and priced BEFORE any money moves, so a basket with
 * one bad bet in it is refused whole rather than half-sold. The response names
 * the offending bet by its position, which is what lets the portal point at
 * the right row in the cart.
 */
router.post("/tickets/slip", requireAuth, requireRole("writer"), async (req, res) => {
  const parse = slipSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid slip", details: parse.error.issues });
    return;
  }
  const { gameId, bets } = parse.data;
  const writerId = req.user!.userId;

  const [writer] = await db.select().from(writersTable).where(eq(writersTable.id, writerId)).limit(1);
  if (!writer || !writer.isActive) {
    res.status(403).json({ error: "Account inactive" });
    return;
  }

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId)).limit(1);
  if (!game || game.status !== "live") {
    res.status(400).json({ error: "Game is not live" });
    return;
  }
  // Same rule as a single bet: a game stays 'live' past its close time, so
  // server time is what decides whether this basket can still be sold.
  if (new Date() >= new Date(game.closeAt)) {
    res.status(400).json({ error: "Betting has closed for this game", closedAt: game.closeAt });
    return;
  }

  const priced: PricedBet[] = [];
  for (let i = 0; i < bets.length; i++) {
    const raw = bets[i]!;
    const [betType] = await db
      .select()
      .from(betTypesTable)
      .where(eq(betTypesTable.code, raw.betTypeCode))
      .limit(1);
    if (!betType || !betType.isActive) {
      res.status(400).json({ error: `Bet ${i + 1}: unknown bet type`, index: i });
      return;
    }
    const result = priceBet(betType, {
      numbers: raw.numbers,
      stakeAmount: raw.stakeAmount,
      bankerNumber: raw.bankerNumber,
    });
    if (!result.ok) {
      res.status(400).json({ error: `Bet ${i + 1}: ${result.error}`, index: i });
      return;
    }
    priced.push(result.bet);
  }

  const slipNumber = await generateSlipNumber();

  try {
    const result = await db.transaction(async (tx) =>
      sellBets(tx, { writer, game, bets: priced, slipNumber }),
    );
    res.status(201).json({
      slipNumber,
      ticketCount: result.tickets.length,
      totalStake: result.total.toFixed(2),
      tickets: result.tickets,
    });
  } catch (err: any) {
    if (err.message === "INSUFFICIENT_FUNDS") {
      res.status(402).json({ error: "Insufficient token balance for the whole slip" });
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

/**
 * Price a selection without placing it.
 *
 * The writer portal shows lines, cost and best case as the numbers go in. It
 * asks here rather than working it out in the browser, so the figure a writer
 * quotes a customer is the same arithmetic that will take their money.
 */
router.post("/tickets/quote", requireAuth, requireRole("writer"), async (req, res) => {
  const parse = z
    .object({
      betTypeCode: z.string(),
      numbers: z.string().default(""),
      stakeAmount: z.number().min(0),
      bankerNumber: z.number().int().min(1).max(90).optional(),
    })
    .safeParse(req.body);

  if (!parse.success) {
    res.status(400).json({ error: "Invalid quote request" });
    return;
  }

  const [betType] = await db
    .select()
    .from(betTypesTable)
    .where(eq(betTypesTable.code, parse.data.betTypeCode))
    .limit(1);

  if (!betType || !betType.isActive) {
    res.status(400).json({ error: "Invalid bet type" });
    return;
  }

  const selection = {
    mechanic: betType.mechanic as Mechanic,
    numbers: parseNumberList(parse.data.numbers),
    bankerNumber: parse.data.bankerNumber ?? null,
    stakePerLine: parse.data.stakeAmount,
    multiplier: parseFloat(betType.payoutMultiplier),
    minStake: parseFloat(betType.minStake) || 0,
    maxStake: parseFloat(betType.maxStake) || 0,
  };

  const invalid = validateSelection(selection);
  if (invalid) {
    // Not an error: the writer is mid-selection. Say what is missing and
    // price what can be priced.
    res.json({ valid: false, reason: invalid, ...quote(selection) });
    return;
  }

  res.json({ valid: true, reason: null, ...quote(selection) });
});

export default router;
