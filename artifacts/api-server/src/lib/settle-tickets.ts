import {
  gameResultsTable,
  ticketsTable,
  payoutRequestsTable,
  writersTable,
  betTypesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordTicketEvent } from "./ticket-audit";
import { settleSelection, parseNumberList, type Mechanic } from "./bet-engine";

/**
 * Ticket settlement for a drawn game.
 *
 * This is what turns placed tickets into won/lost and creates the
 * payout_requests rows the payout review screen works from. It runs from the
 * Calculations page (NLA Declared Draw Entry) so posting the declared numbers
 * settles tickets in the same step as the daily run.
 */

/**
 * What this ticket is owed on this draw.
 *
 * A win is no longer yes-or-no: a perm with three of its numbers drawn has
 * three winning pairs and is paid three times over, so settlement asks the
 * bet engine for an amount rather than a verdict.
 */
export function payoutFor(
  ticket: {
    numbers: string;
    bankerNumber?: number | null;
    stakePerLine?: string | null;
    stakeAmount: string;
    lineCount?: number | null;
  },
  winningNumbersStr: string,
  betType: { mechanic?: string | null; payoutMultiplier: string },
): number {
  // Tickets sold before line pricing existed carry only a total stake, and
  // were all single-line bets - so the total IS the per-line stake.
  const stakePerLine = parseFloat(ticket.stakePerLine ?? "") || parseFloat(ticket.stakeAmount) || 0;

  const outcome = settleSelection(
    {
      mechanic: (betType.mechanic as Mechanic) ?? "direct_two",
      numbers: parseNumberList(ticket.numbers),
      bankerNumber: ticket.bankerNumber ?? null,
      stakePerLine,
      multiplier: parseFloat(betType.payoutMultiplier) || 0,
    },
    parseNumberList(winningNumbersStr),
  );

  return outcome.payout;
}

export interface SettlementSummary {
  alreadySettled: boolean;
  gameResultId: string;
  totalTickets: number;
  totalStakes: string;
  totalWinners: number;
  totalPayouts: string;
}

/**
 * Settle every active ticket on a game. Idempotent: if a result already
 * exists for the game it returns that summary untouched rather than paying
 * a draw twice - the calculation run and a direct post must not both settle.
 *
 * `tx` is the surrounding transaction, so settlement commits or rolls back
 * with whatever else that run is doing.
 */
export async function settleGameTickets(
  tx: any,
  gameId: string,
  winningNumbers: string,
  machineNumbers: string,
  processedBy: string,
): Promise<SettlementSummary> {
  const [existing] = await tx
    .select()
    .from(gameResultsTable)
    .where(eq(gameResultsTable.gameId, gameId))
    .limit(1);

  if (existing) {
    return {
      alreadySettled: true,
      gameResultId: existing.id,
      totalTickets: existing.totalTickets ?? 0,
      totalStakes: existing.totalStakes ?? "0",
      totalWinners: existing.totalWinners ?? 0,
      totalPayouts: existing.totalPayouts ?? "0",
    };
  }

  const [gameResult] = await tx
    .insert(gameResultsTable)
    .values({ gameId, winningNumbers, machineNumbers, processedBy })
    .returning();

  const tickets = await tx.select().from(ticketsTable).where(eq(ticketsTable.gameId, gameId));
  const betTypes = await tx.select().from(betTypesTable);
  const betTypeMap = new Map(betTypes.map((b: { id: string }) => [b.id, b]));

  // Resolve every writer's agent once rather than per winning ticket.
  const writers = await tx
    .select({ id: writersTable.id, agentId: writersTable.agentId })
    .from(writersTable);
  const agentByWriter = new Map(
    writers.map((w: { id: string; agentId: string }) => [w.id, w.agentId]),
  );

  let totalWinners = 0;
  let totalPayouts = 0;
  let totalStakes = 0;

  for (const ticket of tickets) {
    if (ticket.status !== "active") continue;
    totalStakes += parseFloat(ticket.stakeAmount);

    const betType = betTypeMap.get(ticket.betTypeId);
    if (!betType) continue;

    const payout = payoutFor(ticket, winningNumbers, betType as { mechanic?: string; payoutMultiplier: string });

    if (payout > 0) {
      totalWinners++;
      totalPayouts += payout;
      const winAmount = payout.toFixed(2);

      await tx
        .update(ticketsTable)
        .set({ status: "won", isWinner: true, winAmount })
        .where(eq(ticketsTable.id, ticket.id));

      await recordTicketEvent(tx, {
        ticketId: ticket.id,
        eventType: "settled_won",
        fromStatus: "active",
        toStatus: "won",
        actorUserId: processedBy,
        source: "settlement",
        note: `Draw ${winningNumbers}`,
      });

      const agentId = agentByWriter.get(ticket.writerId);
      if (!agentId) {
        throw new Error(`Writer ${ticket.writerId} not found for ticket ${ticket.id}`);
      }

      await tx.insert(payoutRequestsTable).values({
        ticketId: ticket.id,
        gameResultId: gameResult.id,
        writerId: ticket.writerId,
        agentId,
        // What the draw actually owes, which for a perm is rarely the ceiling.
        payoutAmount: winAmount,
      });
    } else {
      await tx.update(ticketsTable).set({ status: "lost" }).where(eq(ticketsTable.id, ticket.id));
      await recordTicketEvent(tx, {
        ticketId: ticket.id,
        eventType: "settled_lost",
        fromStatus: "active",
        toStatus: "lost",
        actorUserId: processedBy,
        source: "settlement",
        note: `Draw ${winningNumbers}`,
      });
    }
  }

  await tx
    .update(gameResultsTable)
    .set({
      totalTickets: tickets.length,
      totalStakes: totalStakes.toString(),
      totalWinners,
      totalPayouts: totalPayouts.toString(),
    })
    .where(eq(gameResultsTable.id, gameResult.id));

  return {
    alreadySettled: false,
    gameResultId: gameResult.id,
    totalTickets: tickets.length,
    totalStakes: totalStakes.toString(),
    totalWinners,
    totalPayouts: totalPayouts.toString(),
  };
}
