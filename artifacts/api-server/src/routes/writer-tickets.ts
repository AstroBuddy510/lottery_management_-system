import { Router } from "express";
import { db, ticketsTable, gamesTable, betTypesTable, writersTable, agentsTable, writerTokenWalletsTable, writerTokenTransactionsTable, postpaidDailyLedgerTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { recordTicketEvent } from "../lib/ticket-audit";
import { gateForWriter, runSweepIfDue } from "./postpaid-auto";
import {
  quote,
  validateSelection,
  parseNumberList,
  type Mechanic,
} from "../lib/bet-engine";
import { debitWallet } from "../lib/wallet";

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

/**
 * Human-facing numbers for tickets and slips.
 *
 * These used to be a random four-digit number within a day - 9,000 possible
 * values behind a UNIQUE constraint, with no retry, inside the sale
 * transaction - so a collision aborted the whole slip: the customer got
 * nothing and the writer got a 500. Measured against a real Postgres, 10,000
 * sales in one day lost 3,944 of them, and past 9,000 every sale would fail
 * permanently.
 *
 * Both numbers are now minted by the database (see
 * lib/db/drizzle/manual/0002_ticket_number_sequences.sql). Deliberately not
 * built here: generating it in SQL means there is no window between choosing a
 * number and storing it, and no second code path can invent its own format.
 * The sequence behind it takes no row lock, so a thousand writers selling at
 * once do not queue behind each other.
 */
const ticketNumberSql = sql<string>`next_ticket_number()`;

async function generateSlipNumber(): Promise<string> {
  // Drawn up front because the slip number goes in the response as well as on
  // every row of the basket.
  const result = await db.execute<{ slip_number: string }>(
    sql`select next_slip_number() as slip_number`,
  );
  const value = result.rows[0]?.slip_number;
  if (!value) throw new Error("SLIP_NUMBER_UNAVAILABLE");
  return value;
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
    // Checking the float and taking it are one statement, not two. Two
    // concurrent sales from the same writer would otherwise both read the
    // same balance and both write their own answer, letting the writer sell
    // twice against one float.
    const newBalance = await debitWallet(tx, writerId, total);
    if (newBalance === null) {
      throw new Error("INSUFFICIENT_FUNDS");
    }

    // One debit for one payment, whether that is one bet or ten.
    const [tokenTx] = await tx
      .insert(writerTokenTransactionsTable)
      .values({
        writerId,
        transactionType: "bet_deduction",
        amount: (-total).toString(),
        // The balance the database actually settled on, not one recomputed
        // here - that is the number the audit trail has to be able to stand on.
        balanceAfter: newBalance,
        description: slipNumber
          ? `${bets.length} bets on ${game.name} - ${slipNumber}`
          : `Bet placed on ${game.name}`,
      })
      .returning();
    transactionId = tokenTx.id;
  } else {
    // Ghana keeps GMT all year, so the UTC date is the Accra date.
    const today = new Date().toISOString().slice(0, 10);

    // One statement, resting on the unique index over the triple. Read-then-
    // insert let two concurrent sales each find no row and each create one,
    // splitting the writer's debt across two rows - so the bill presented at
    // settlement was only half of what they had actually sold.
    await tx.execute(sql`
      INSERT INTO postpaid_daily_ledger
        (writer_id, game_id, ledger_date, total_stakes, net_balance)
      VALUES
        (${writerId}, ${game.id}, ${today},
         ${total.toFixed(2)}::numeric, ${total.toFixed(2)}::numeric)
      ON CONFLICT (writer_id, game_id, ledger_date) DO UPDATE
         SET total_stakes = postpaid_daily_ledger.total_stakes + EXCLUDED.total_stakes,
             net_balance  = postpaid_daily_ledger.net_balance  + EXCLUDED.net_balance
    `);
  }

  const created = [];
  for (const b of bets) {
    const [ticket] = await tx
      .insert(ticketsTable)
      .values({
        // Drawn by the INSERT itself, so there is no window between choosing
        // a number and storing it in which anything could take it.
        ticketNumber: ticketNumberSql,
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

  // Automated postpaid settlement. The terminal stops selling at the halfway
  // point of a game whose takings have not been handed in, and the morning
  // after a bill that was never paid. Enforced here rather than in the portal
  // because the portal is the thing being locked out - a banner a writer can
  // reload past is not a control.
  //
  // Off by default: when the feature is disabled the gate always allows, so
  // this costs one settings read and nothing else changes.
  const gate = await gateForWriter({ writerId, game });
  if (!gate.allowed) {
    res.status(423).json({
      error:
        gate.reason === "previous-day-unpaid"
          ? "Settle yesterday's bill before selling again"
          : "Settlement is due. Selling resumes once the bill is paid",
      reason: gate.reason,
      amountDue: gate.amountDue.toFixed(2),
      owedFrom: gate.owedFrom,
      lockedAt: gate.locksAt,
    });
    return;
  }
  // Live traffic is what drives reminders here; there is no scheduler.
  runSweepIfDue();

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

  // Automated postpaid settlement. The terminal stops selling at the halfway
  // point of a game whose takings have not been handed in, and the morning
  // after a bill that was never paid. Enforced here rather than in the portal
  // because the portal is the thing being locked out - a banner a writer can
  // reload past is not a control.
  //
  // Off by default: when the feature is disabled the gate always allows, so
  // this costs one settings read and nothing else changes.
  const gate = await gateForWriter({ writerId, game });
  if (!gate.allowed) {
    res.status(423).json({
      error:
        gate.reason === "previous-day-unpaid"
          ? "Settle yesterday's bill before selling again"
          : "Settlement is due. Selling resumes once the bill is paid",
      reason: gate.reason,
      amountDue: gate.amountDue.toFixed(2),
      owedFrom: gate.owedFrom,
      lockedAt: gate.locksAt,
    });
    return;
  }
  // Live traffic is what drives reminders here; there is no scheduler.
  runSweepIfDue();

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

/**
 * Recent tickets, scoped to whoever is asking.
 *
 * This used to carry requireAuth and nothing else. A writer was pinned to
 * their own id correctly, but every other role took writerId straight from
 * the query string and nobody checked it - so any signed-in account could
 * read another agency's tickets by passing their id, or leave it off
 * entirely and take the hundred most recent tickets in the company. A
 * cashier or a wins-entry clerk had the same reach as a director.
 *
 * The scope is now decided here from the token, never from the request.
 */
router.get(
  "/tickets",
  requireAuth,
  requireRole("writer", "agent", "administrator", "director"),
  async (req, res) => {
    const role = req.user!.role;
    const asked = typeof req.query["writerId"] === "string" ? req.query["writerId"] : null;

    let writerId: string | null = null;

    if (role === "writer") {
      // Their own, whatever they ask for.
      writerId = req.user!.userId;
    } else if (role === "agent") {
      // An agent must name a writer, and it must be one of theirs.
      if (!asked) {
        res.status(400).json({ error: "writerId is required" });
        return;
      }
      const [row] = await db
        .select({ agentId: writersTable.agentId })
        .from(writersTable)
        .where(eq(writersTable.id, asked))
        .limit(1);
      const [myAgent] = await db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(eq(agentsTable.userId, req.user!.userId))
        .limit(1);
      if (!row || !myAgent || row.agentId !== myAgent.id) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      writerId = asked;
    } else {
      // Administrators and directors oversee the whole company, so an
      // unscoped read is theirs to make.
      writerId = asked;
    }

    const query = db.select().from(ticketsTable);
    if (writerId) query.where(eq(ticketsTable.writerId, writerId));
    const tickets = await query.orderBy(desc(ticketsTable.createdAt)).limit(100);
    res.json(tickets);
  },
);

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
