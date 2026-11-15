import { Router } from "express";
import {
  db,
  payoutRequestsTable,
  ticketsTable,
  writersTable,
  agentsTable,
  usersTable,
  gamesTable,
  betTypesTable,
  gameResultsTable,
  ticketEventsTable,
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  recordTicketEvent,
  detectTicketAnomalies,
  type AuditTicket,
  type AuditEvent,
} from "../lib/ticket-audit";

const router = Router();

/**
 * Payout review, drilled down agent -> writer -> ticket.
 *
 * Every level reads payout_requests - the Winning Tickets registry - which
 * ticket settlement creates when a draw's declared numbers are posted. This is
 * a view of the registry and nothing more; claiming, approving and paying all
 * happen elsewhere.
 */

const REVIEW_ROLES = ["director", "administrator", "cashier"] as const;

/** Restrict to one game when given, otherwise every unsettled draw. */
function gameFilter(gameId?: string) {
  return gameId ? eq(gameResultsTable.gameId, gameId) : undefined;
}

/** Level 1: agents with their win totals. */
router.get(
  "/payouts/agents",
  requireAuth,
  requireRole(...REVIEW_ROLES),
  async (req, res) => {
    const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : undefined;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;

    const conditions = [gameFilter(gameId), status ? eq(payoutRequestsTable.status, status as "pending") : undefined].filter(Boolean);

    const rows = await db
      .select({
        agentId: agentsTable.id,
        agentCode: agentsTable.fullCode,
        agencyName: agentsTable.agencyName,
        agentName: usersTable.fullName,
        ticketCount: sql<number>`count(*)::int`,
        totalWins: sql<string>`coalesce(sum(${payoutRequestsTable.payoutAmount}), 0)::text`,
        pendingCount: sql<number>`count(*) filter (where ${payoutRequestsTable.status} = 'pending')::int`,
        // Claimed and somewhere between the POS and the writer's wallet.
        approvedCount: sql<number>`count(*) filter (where ${payoutRequestsTable.status} in ('verified', 'awaiting_funds', 'processing'))::int`,
        paidCount: sql<number>`count(*) filter (where ${payoutRequestsTable.status} = 'paid')::int`,
        flaggedCount: sql<number>`count(*) filter (where ${payoutRequestsTable.status} in ('rejected', 'withheld'))::int`,
      })
      .from(payoutRequestsTable)
      .innerJoin(agentsTable, eq(payoutRequestsTable.agentId, agentsTable.id))
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .innerJoin(gameResultsTable, eq(payoutRequestsTable.gameResultId, gameResultsTable.id))
      .where(conditions.length ? and(...(conditions as never[])) : undefined)
      .groupBy(agentsTable.id, agentsTable.fullCode, agentsTable.agencyName, usersTable.fullName)
      .orderBy(sql`sum(${payoutRequestsTable.payoutAmount}) desc`);

    res.json(rows);
  },
);

/** Level 2: writers under one agent. */
router.get(
  "/payouts/agents/:agentId/writers",
  requireAuth,
  requireRole(...REVIEW_ROLES),
  async (req, res) => {
    const agentId = req.params["agentId"] as string;
    const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : undefined;

    const conditions = [eq(payoutRequestsTable.agentId, agentId), gameFilter(gameId)].filter(Boolean);

    const rows = await db
      .select({
        writerId: writersTable.id,
        writerName: writersTable.fullName,
        writerCode: writersTable.fullCode,
        phone: writersTable.phone,
        operationModel: writersTable.operationModel,
        ticketCount: sql<number>`count(*)::int`,
        totalWins: sql<string>`coalesce(sum(${payoutRequestsTable.payoutAmount}), 0)::text`,
        pendingCount: sql<number>`count(*) filter (where ${payoutRequestsTable.status} = 'pending')::int`,
      })
      .from(payoutRequestsTable)
      .innerJoin(writersTable, eq(payoutRequestsTable.writerId, writersTable.id))
      .innerJoin(gameResultsTable, eq(payoutRequestsTable.gameResultId, gameResultsTable.id))
      .where(and(...(conditions as never[])))
      .groupBy(
        writersTable.id,
        writersTable.fullName,
        writersTable.fullCode,
        writersTable.phone,
        writersTable.operationModel,
      )
      .orderBy(sql`sum(${payoutRequestsTable.payoutAmount}) desc`);

    res.json(rows);
  },
);

/** Level 3: the winning tickets behind one writer's total. */
router.get(
  "/payouts/writers/:writerId/tickets",
  requireAuth,
  requireRole(...REVIEW_ROLES),
  async (req, res) => {
    const writerId = req.params["writerId"] as string;
    const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : undefined;

    const conditions = [eq(payoutRequestsTable.writerId, writerId), gameFilter(gameId)].filter(Boolean);

    const rows = await db
      .select({
        payoutId: payoutRequestsTable.id,
        status: payoutRequestsTable.status,
        payoutAmount: payoutRequestsTable.payoutAmount,
        claimedAt: payoutRequestsTable.claimedAt,
        paidAt: payoutRequestsTable.paidAt,
        /**
         * What this writer still owed on their postpaid account when the draw
         * was calculated. Set means they had not settled - policy is that the
         * company does not carry wins on unsettled sales, so this sits next to
         * the amount the reviewer is about to authorise.
         */
        writerUnsettledAmount: payoutRequestsTable.writerUnsettledAmount,
        createdAt: payoutRequestsTable.createdAt,
        ticketId: ticketsTable.id,
        ticketNumber: ticketsTable.ticketNumber,
        numbers: ticketsTable.numbers,
        stakeAmount: ticketsTable.stakeAmount,
        winAmount: ticketsTable.winAmount,
        soldAt: ticketsTable.createdAt,
        writerId: ticketsTable.writerId,
        gameId: ticketsTable.gameId,
        betTypeId: ticketsTable.betTypeId,
        gameCloseAt: gamesTable.closeAt,
        drawProcessedAt: gameResultsTable.processedAt,
        ticketStatus: ticketsTable.status,
        betTypeName: betTypesTable.name,
        gameName: gamesTable.name,
        eventNumber: gamesTable.eventNumber,
        winningNumbers: gameResultsTable.winningNumbers,
      })
      .from(payoutRequestsTable)
      .innerJoin(ticketsTable, eq(payoutRequestsTable.ticketId, ticketsTable.id))
      .innerJoin(betTypesTable, eq(ticketsTable.betTypeId, betTypesTable.id))
      .innerJoin(gamesTable, eq(ticketsTable.gameId, gamesTable.id))
      .innerJoin(gameResultsTable, eq(payoutRequestsTable.gameResultId, gameResultsTable.id))
      .where(and(...(conditions as never[])))
      .orderBy(desc(payoutRequestsTable.createdAt));

    // The approver is about to authorise money against these exact tickets,
    // so anything the fraud rules object to belongs HERE, not only on a
    // screen they might never open. A ticket sold after betting closed is
    // the case this was built for.
    const anomalies = await anomaliesForTickets(rows);
    const byTicket = new Map<string, typeof anomalies>();
    for (const a of anomalies) {
      const list = byTicket.get(a.ticketId);
      if (list) list.push(a);
      else byTicket.set(a.ticketId, [a]);
    }

    res.json(rows.map((r) => ({ ...r, anomalies: byTicket.get(r.ticketId) ?? [] })));
  },
);

interface TicketLike {
  ticketId: string;
  ticketNumber: string;
  writerId: string;
  gameId: string;
  betTypeId: string;
  numbers: string;
  stakeAmount: string;
  ticketStatus: string;
  soldAt: Date | string;
  gameCloseAt: Date | string | null;
  drawProcessedAt: Date | string | null;
}

/** Run the same rules the fraud screen runs, over just these tickets. */
async function anomaliesForTickets(rows: TicketLike[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.ticketId);

  const events = await db
    .select({
      ticketId: ticketEventsTable.ticketId,
      eventType: ticketEventsTable.eventType,
      occurredAt: ticketEventsTable.occurredAt,
      actorRole: ticketEventsTable.actorRole,
      source: ticketEventsTable.source,
    })
    .from(ticketEventsTable)
    .where(inArray(ticketEventsTable.ticketId, ids));

  const tickets: AuditTicket[] = rows.map((r) => ({
    id: r.ticketId,
    ticketNumber: r.ticketNumber,
    writerId: r.writerId,
    gameId: r.gameId,
    betTypeId: r.betTypeId,
    numbers: r.numbers,
    stakeAmount: r.stakeAmount,
    status: r.ticketStatus,
    createdAt: r.soldAt,
    gameCloseAt: r.gameCloseAt,
    drawProcessedAt: r.drawProcessedAt,
  }));

  return detectTicketAnomalies(tickets, events as AuditEvent[]);
}

/** Draws that have settled tickets, for the game selector. */
router.get("/payouts/games", requireAuth, requireRole(...REVIEW_ROLES), async (_req, res) => {
  const rows = await db
    .select({
      gameId: gamesTable.id,
      name: gamesTable.name,
      eventNumber: gamesTable.eventNumber,
      drawDate: gamesTable.closeAt,
      winningNumbers: gameResultsTable.winningNumbers,
      totalWinners: gameResultsTable.totalWinners,
      totalPayouts: gameResultsTable.totalPayouts,
    })
    .from(gameResultsTable)
    .innerJoin(gamesTable, eq(gameResultsTable.gameId, gamesTable.id))
    .orderBy(desc(gamesTable.closeAt));

  res.json(rows);
});

/*
 * There is no approve endpoint here any more, and that is the change.
 *
 * This file used to let a director or administrator mark a request approved,
 * one at a time or a whole writer at once. Under the POS wins flow the people
 * who run the draw do not release its payouts: a request is approved by a
 * cashier, after the writer has claimed it, in routes/pos-wins.ts. What stays
 * here is the read-only drill-down of the Winning Tickets registry.
 */

export default router;
