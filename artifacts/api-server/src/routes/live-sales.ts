import { Router } from "express";
import {
  db,
  ticketsTable,
  writersTable,
  agentsTable,
  gamesTable,
} from "@workspace/db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * Live sales are scoped to a single game. On days when two games run at once
 * the caller picks which one; when only one is live the client selects it
 * automatically. Figures come from the tickets writers actually place, so
 * they move the moment a bet is taken.
 */

type Totals = {
  ticketCount: number;
  totalStakes: string;
  winningTickets: number;
  totalWins: string;
};

const ZERO: Totals = {
  ticketCount: 0,
  totalStakes: "0",
  winningTickets: 0,
  totalWins: "0",
};

/** Aggregate expressions shared by every scope below. */
const totalsSelection = {
  ticketCount: sql<number>`count(*)::int`,
  totalStakes: sql<string>`coalesce(sum(${ticketsTable.stakeAmount}), 0)::text`,
  winningTickets: sql<number>`count(*) filter (where ${ticketsTable.isWinner})::int`,
  totalWins: sql<string>`coalesce(sum(${ticketsTable.winAmount}), 0)::text`,
};

/**
 * Games worth showing live figures for: anything live now, plus games closed
 * today whose results are still being settled.
 */
router.get("/live-sales/games", requireAuth, async (_req, res) => {
  const games = await db
    .select({
      id: gamesTable.id,
      name: gamesTable.name,
      eventNumber: gamesTable.eventNumber,
      status: gamesTable.status,
      goLiveAt: gamesTable.goLiveAt,
      closeAt: gamesTable.closeAt,
    })
    .from(gamesTable)
    .where(
      sql`${gamesTable.status} = 'live' or (${gamesTable.status} = 'closed' and ${gamesTable.closeAt} >= now() - interval '1 day')`,
    )
    .orderBy(desc(gamesTable.goLiveAt));

  res.json(games);
});

router.get("/live-sales", requireAuth, async (req, res) => {
  const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : undefined;
  if (!gameId) {
    res.status(400).json({ error: "gameId is required" });
    return;
  }

  const [game] = await db
    .select({ id: gamesTable.id, name: gamesTable.name, status: gamesTable.status })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId))
    .limit(1);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const role = req.user!.role;

  // Which writers this viewer is allowed to see.
  let writerIds: string[] | null = null; // null = every writer (director/admin)

  if (role === "writer") {
    writerIds = [req.user!.userId];
  } else if (role === "agent") {
    const [myAgent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.userId))
      .limit(1);
    if (!myAgent) {
      res.json({ game, scope: "agent", totals: ZERO, breakdown: [] });
      return;
    }
    const mine = await db
      .select({ id: writersTable.id })
      .from(writersTable)
      .where(eq(writersTable.agentId, myAgent.id));
    writerIds = mine.map((w) => w.id);
  }

  // An agent with no writers, or a scope that resolves to nobody, has no sales.
  if (writerIds !== null && writerIds.length === 0) {
    res.json({ game, scope: role, totals: ZERO, breakdown: [] });
    return;
  }

  const scopeFilter =
    writerIds === null
      ? eq(ticketsTable.gameId, gameId)
      : and(eq(ticketsTable.gameId, gameId), inArray(ticketsTable.writerId, writerIds));

  const [totals] = await db.select(totalsSelection).from(ticketsTable).where(scopeFilter);

  // Directors and administrators get a per-agent split; agents get a
  // per-writer split; writers just get their own totals.
  let breakdown: unknown[] = [];

  if (role === "director" || role === "administrator") {
    breakdown = await db
      .select({
        agentId: agentsTable.id,
        agentName: agentsTable.agencyName,
        agentCode: agentsTable.fullCode,
        ...totalsSelection,
      })
      .from(ticketsTable)
      .innerJoin(writersTable, eq(ticketsTable.writerId, writersTable.id))
      .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
      .where(eq(ticketsTable.gameId, gameId))
      .groupBy(agentsTable.id, agentsTable.agencyName, agentsTable.fullCode)
      .orderBy(sql`sum(${ticketsTable.stakeAmount}) desc`);
  } else if (role === "agent") {
    breakdown = await db
      .select({
        writerId: writersTable.id,
        writerName: writersTable.fullName,
        writerCode: writersTable.fullCode,
        ...totalsSelection,
      })
      .from(ticketsTable)
      .innerJoin(writersTable, eq(ticketsTable.writerId, writersTable.id))
      .where(scopeFilter)
      .groupBy(writersTable.id, writersTable.fullName, writersTable.fullCode)
      .orderBy(sql`sum(${ticketsTable.stakeAmount}) desc`);
  }

  res.json({ game, scope: role, totals: totals ?? ZERO, breakdown });
});

/**
 * Per-writer live figures for one agent, used by the Users & Agents
 * drill-down. Agents may only read their own.
 */
router.get("/live-sales/agents/:agentId/writers", requireAuth, async (req, res) => {
  const agentId = req.params["agentId"] as string;
  const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : undefined;

  if (req.user!.role === "agent") {
    const [myAgent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.userId))
      .limit(1);
    if (!myAgent || myAgent.id !== agentId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  } else if (req.user!.role === "writer") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Left join so writers with no tickets still appear, with zeroes.
  const rows = await db
    .select({
      writerId: writersTable.id,
      writerName: writersTable.fullName,
      writerCode: writersTable.fullCode,
      isActive: writersTable.isActive,
      operationModel: writersTable.operationModel,
      approvalStatus: writersTable.approvalStatus,
      phone: writersTable.phone,
      // Whether this writer can sign in at all; the hash itself never leaves.
      hasPin: sql<boolean>`${writersTable.pinHash} is not null`,
      ticketCount: sql<number>`count(${ticketsTable.id})::int`,
      totalStakes: sql<string>`coalesce(sum(${ticketsTable.stakeAmount}), 0)::text`,
      winningTickets: sql<number>`count(${ticketsTable.id}) filter (where ${ticketsTable.isWinner})::int`,
      totalWins: sql<string>`coalesce(sum(${ticketsTable.winAmount}), 0)::text`,
    })
    .from(writersTable)
    .leftJoin(
      ticketsTable,
      gameId
        ? and(eq(ticketsTable.writerId, writersTable.id), eq(ticketsTable.gameId, gameId))
        : eq(ticketsTable.writerId, writersTable.id),
    )
    .where(eq(writersTable.agentId, agentId))
    .groupBy(
      writersTable.id,
      writersTable.fullName,
      writersTable.fullCode,
      writersTable.isActive,
      writersTable.operationModel,
      writersTable.approvalStatus,
      writersTable.phone,
    )
    .orderBy(writersTable.fullCode);

  res.json(rows);
});

export default router;
