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
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { recordTicketEvent } from "../lib/ticket-audit";

const router = Router();

/**
 * Payout review, drilled down agent -> writer -> ticket.
 *
 * Every level reads payout_requests, which ticket settlement creates when a
 * draw's declared numbers are posted. Approving marks a request authorised;
 * it does not move money - crediting stays the separate paying step.
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
        approvedCount: sql<number>`count(*) filter (where ${payoutRequestsTable.status} = 'approved')::int`,
        paidCount: sql<number>`count(*) filter (where ${payoutRequestsTable.status} = 'paid')::int`,
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
        approvedBy: payoutRequestsTable.approvedBy,
        paidAt: payoutRequestsTable.paidAt,
        createdAt: payoutRequestsTable.createdAt,
        ticketId: ticketsTable.id,
        ticketNumber: ticketsTable.ticketNumber,
        numbers: ticketsTable.numbers,
        stakeAmount: ticketsTable.stakeAmount,
        winAmount: ticketsTable.winAmount,
        soldAt: ticketsTable.createdAt,
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

    res.json(rows);
  },
);

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

/**
 * Approve one payout request. Authorisation only - no money moves here, so
 * the person who approves and the person who pays stay distinguishable.
 */
router.patch(
  "/payouts/:payoutId/approve",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const payoutId = req.params["payoutId"] as string;

    const [existing] = await db
      .select()
      .from(payoutRequestsTable)
      .where(eq(payoutRequestsTable.id, payoutId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Payout request not found" });
      return;
    }
    if (existing.status !== "pending") {
      res.status(409).json({ error: `Payout is already ${existing.status}` });
      return;
    }

    // Re-check status in the WHERE so two reviewers cannot both approve.
    const [updated] = await db
      .update(payoutRequestsTable)
      .set({ status: "approved", approvedBy: req.user!.userId })
      .where(and(eq(payoutRequestsTable.id, payoutId), eq(payoutRequestsTable.status, "pending")))
      .returning();

    if (!updated) {
      res.status(409).json({ error: "Payout was reviewed by someone else" });
      return;
    }

    await recordTicketEvent(db, {
      ticketId: updated.ticketId,
      eventType: "claim_approved",
      actorUserId: req.user!.userId,
      actorRole: req.user!.role,
      source: "admin",
      note: `Payout ${updated.payoutAmount} approved`,
    });

    res.json(updated);
  },
);

/** Approve every pending request for one writer in one step. */
router.patch(
  "/payouts/writers/:writerId/approve-all",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const writerId = req.params["writerId"] as string;
    const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : undefined;

    let ids: string[] | undefined;
    if (gameId) {
      const scoped = await db
        .select({ id: payoutRequestsTable.id })
        .from(payoutRequestsTable)
        .innerJoin(gameResultsTable, eq(payoutRequestsTable.gameResultId, gameResultsTable.id))
        .where(
          and(
            eq(payoutRequestsTable.writerId, writerId),
            eq(payoutRequestsTable.status, "pending"),
            eq(gameResultsTable.gameId, gameId),
          ),
        );
      ids = scoped.map((r) => r.id);
      if (ids.length === 0) {
        res.json({ approved: 0 });
        return;
      }
    }

    const updated = await db
      .update(payoutRequestsTable)
      .set({ status: "approved", approvedBy: req.user!.userId })
      .where(
        ids
          ? and(inArray(payoutRequestsTable.id, ids), eq(payoutRequestsTable.status, "pending"))
          : and(eq(payoutRequestsTable.writerId, writerId), eq(payoutRequestsTable.status, "pending")),
      )
      .returning();

    for (const row of updated) {
      await recordTicketEvent(db, {
        ticketId: row.ticketId,
        eventType: "claim_approved",
        actorUserId: req.user!.userId,
        actorRole: req.user!.role,
        source: "admin",
        note: `Approved in bulk for writer`,
      });
    }

    res.json({ approved: updated.length });
  },
);

export default router;
