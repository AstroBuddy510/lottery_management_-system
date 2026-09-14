import { Router } from "express";
import {
  db,
  riskFlagsTable,
  writersTable,
  agentsTable,
  ticketsTable,
  betTypesTable,
  gamesTable,
} from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  buildExposureReport,
  combinationKey,
  parseNumbers,
  type ExposureTicket,
} from "../lib/exposure";
import { loadHedgePolicy } from "../lib/hedge-policy";

const router = Router();

const adminOnly = [requireAuth, requireRole("director", "administrator")] as const;

/**
 * Live exposure for one game.
 *
 * Answers the question the risk desk actually has: if the NLA draws a given
 * combination tonight, what do we owe, and what would it cost to lay that off
 * by staking the same numbers with them. Everything is computed from active
 * tickets at request time - nothing is cached, because the book moves until
 * the game closes.
 */
router.get("/risk/exposure", ...adminOnly, async (req, res) => {
  const gameIdParam = req.query["gameId"];
  const gameId = typeof gameIdParam === "string" && gameIdParam ? gameIdParam : null;

  // Default to the game currently taking bets, else the most recent one.
  let game;
  if (gameId) {
    [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId)).limit(1);
  } else {
    [game] = await db
      .select()
      .from(gamesTable)
      .where(eq(gamesTable.status, "live"))
      .orderBy(desc(gamesTable.goLiveAt))
      .limit(1);
    if (!game) {
      [game] = await db.select().from(gamesTable).orderBy(desc(gamesTable.goLiveAt)).limit(1);
    }
  }

  if (!game) {
    res.status(404).json({ error: "No game to analyse" });
    return;
  }

  const tickets = await db
    .select({
      writerId: ticketsTable.writerId,
      betTypeId: ticketsTable.betTypeId,
      numbers: ticketsTable.numbers,
      stakeAmount: ticketsTable.stakeAmount,
      potentialPayout: ticketsTable.potentialPayout,
    })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.gameId, game.id), eq(ticketsTable.status, "active")));

  const betTypes = await db
    .select({
      id: betTypesTable.id,
      name: betTypesTable.name,
      code: betTypesTable.code,
      payoutMultiplier: betTypesTable.payoutMultiplier,
    })
    .from(betTypesTable);

  const flaggedWriters = await db
    .select({
      id: writersTable.id,
      fullName: writersTable.fullName,
      fullCode: writersTable.fullCode,
      reason: writersTable.redFlagReason,
      flaggedAt: writersTable.redFlaggedAt,
      agencyName: agentsTable.agencyName,
      agentCode: agentsTable.fullCode,
    })
    .from(writersTable)
    .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
    .where(eq(writersTable.isRedFlagged, true));

  const flaggedIds = new Set(flaggedWriters.map((w) => w.id));
  const policy = await loadHedgePolicy();
  const report = buildExposureReport(tickets as ExposureTicket[], betTypes, flaggedIds, policy);

  // Per-writer book for the watch list, from the same tickets - a flagged
  // writer's own biggest combination is what the desk wants to see first.
  const perWriter = new Map<
    string,
    { ticketCount: number; totalStake: number; liability: number; byCombo: Map<string, number> }
  >();
  for (const t of tickets) {
    if (!flaggedIds.has(t.writerId)) continue;
    let row = perWriter.get(t.writerId);
    if (!row) {
      row = { ticketCount: 0, totalStake: 0, liability: 0, byCombo: new Map() };
      perWriter.set(t.writerId, row);
    }
    const payout = parseFloat(t.potentialPayout) || 0;
    row.ticketCount += 1;
    row.totalStake += parseFloat(t.stakeAmount) || 0;
    row.liability += payout;
    const numbers = parseNumbers(t.numbers);
    const key = combinationKey(t.betTypeId, numbers);
    row.byCombo.set(key, (row.byCombo.get(key) ?? 0) + payout);
  }

  const comboByKey = new Map(report.combinations.map((c) => [c.key, c]));

  const watchList = flaggedWriters
    .map((w) => {
      const row = perWriter.get(w.id);
      let topCombination: { numbers: number[]; betTypeCode: string; liability: number } | null = null;
      if (row) {
        let bestKey: string | null = null;
        let bestLiability = -1;
        for (const [key, liability] of row.byCombo) {
          if (liability > bestLiability) {
            bestLiability = liability;
            bestKey = key;
          }
        }
        const combo = bestKey ? comboByKey.get(bestKey) : undefined;
        if (combo) {
          topCombination = {
            numbers: combo.numbers,
            betTypeCode: combo.betTypeCode,
            liability: bestLiability,
          };
        }
      }
      return {
        writerId: w.id,
        fullName: w.fullName,
        fullCode: w.fullCode,
        agencyName: w.agencyName,
        agentCode: w.agentCode,
        reason: w.reason,
        flaggedAt: w.flaggedAt,
        ticketCount: row?.ticketCount ?? 0,
        totalStake: row?.totalStake ?? 0,
        liability: row?.liability ?? 0,
        shareOfLiability: report.totalLiability > 0 ? (row?.liability ?? 0) / report.totalLiability : 0,
        topCombination,
      };
    })
    .sort((a, b) => b.liability - a.liability);

  res.json({
    game: {
      id: game.id,
      name: game.name,
      eventNumber: game.eventNumber,
      status: game.status,
      closeAt: game.closeAt,
    },
    generatedAt: new Date().toISOString(),
    ...report,
    watchList,
    watchListLiability: watchList.reduce((sum, w) => sum + w.liability, 0),
  });
});

/**
 * Mark a writer as one to watch, or clear the mark. Kept on the writer rather
 * than in risk_flags because it is a standing property of the writer, not an
 * incident to be reviewed and closed.
 */
router.patch("/writers/:id/red-flag", ...adminOnly, async (req, res) => {
  const id = req.params["id"] as string;
  const parse = z
    .object({
      isRedFlagged: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    })
    .safeParse(req.body);

  if (!parse.success) {
    res.status(400).json({ error: "Invalid data", issues: parse.error.issues });
    return;
  }

  const [updated] = await db
    .update(writersTable)
    .set(
      parse.data.isRedFlagged
        ? {
            isRedFlagged: true,
            redFlagReason: parse.data.reason ?? null,
            redFlaggedBy: req.user!.userId,
            redFlaggedAt: new Date(),
          }
        : {
            isRedFlagged: false,
            redFlagReason: null,
            redFlaggedBy: null,
            redFlaggedAt: null,
          },
    )
    .where(eq(writersTable.id, id))
    .returning({
      id: writersTable.id,
      fullName: writersTable.fullName,
      fullCode: writersTable.fullCode,
      isRedFlagged: writersTable.isRedFlagged,
      redFlagReason: writersTable.redFlagReason,
      redFlaggedAt: writersTable.redFlaggedAt,
    });

  if (!updated) {
    res.status(404).json({ error: "Writer not found" });
    return;
  }

  res.json(updated);
});

/** Which of a set of writers carry the watch mark - for the writers list. */
router.get("/writers/red-flags", ...adminOnly, async (req, res) => {
  const agentId = req.query["agentId"];
  const rows = await db
    .select({
      id: writersTable.id,
      isRedFlagged: writersTable.isRedFlagged,
      redFlagReason: writersTable.redFlagReason,
    })
    .from(writersTable)
    .where(
      typeof agentId === "string" && agentId
        ? and(eq(writersTable.agentId, agentId), eq(writersTable.isRedFlagged, true))
        : eq(writersTable.isRedFlagged, true),
    );
  res.json(rows);
});

router.get("/risk/flags", ...adminOnly, async (_req, res) => {
  const flags = await db
    .select({
      flag: riskFlagsTable,
      writer: {
        fullName: writersTable.fullName,
        fullCode: writersTable.fullCode,
      },
    })
    .from(riskFlagsTable)
    .leftJoin(writersTable, eq(riskFlagsTable.writerId, writersTable.id))
    .orderBy(desc(riskFlagsTable.createdAt))
    .limit(100);

  res.json(flags);
});

router.patch("/risk/flags/:id", ...adminOnly, async (req, res) => {
  const id = req.params["id"] as string;
  const parse = z
    .object({
      status: z.enum(["open", "reviewed", "dismissed", "escalated"]),
      reviewNotes: z.string().optional(),
    })
    .safeParse(req.body);

  if (!parse.success) {
    res.status(400).json({ error: "Invalid data" });
    return;
  }

  const [updated] = await db
    .update(riskFlagsTable)
    .set({
      status: parse.data.status,
      reviewNotes: parse.data.reviewNotes,
      reviewedBy: req.user!.userId,
      updatedAt: new Date(),
    })
    .where(eq(riskFlagsTable.id, id))
    .returning();

  res.json(updated);
});

router.get("/risk/dashboard", ...adminOnly, async (_req, res) => {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(riskFlagsTable)
    .where(eq(riskFlagsTable.status, "open"));
  const [{ flagged }] = await db
    .select({ flagged: sql<number>`count(*)::int` })
    .from(writersTable)
    .where(eq(writersTable.isRedFlagged, true));
  res.json({ openFlags: count, redFlaggedWriters: flagged });
});

export default router;
