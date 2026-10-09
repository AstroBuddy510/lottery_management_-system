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
import { getUnifiedWriterTotals, getUnifiedWriterActivity } from "../lib/unified-sales";

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

/**
 * A calendar date from the query string, or null.
 *
 * Date.parse is not enough on its own: it accepts 2026-02-30 and silently
 * rolls it to March 2nd, so the string reached Postgres as a date literal and
 * came back as a failed query - a 500 with the SQL in the response body, for
 * what is only a typo. Round-tripping the parsed date back to a string is
 * what rejects a day that does not exist.
 *
 * Defaults to today in Accra, which is the day every live view means.
 */
function accraDate(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Accra",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // February 30th parses, then becomes March 2nd. Only a real day survives this.
  return parsed.toISOString().slice(0, 10) === text ? text : null;
}

const BLANK_ENTRY_TOTALS = {
  gross: "0.00",
  wins: "0.00",
  entryGross: "0.00",
  entryWins: "0.00",
  ticketGross: "0.00",
  ticketWins: "0.00",
  ticketCount: 0,
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

/**
 * One day's live per-writer figures for one agent, from BOTH sources.
 *
 * The admin portal's Live Entries table was built on the gross_entries and
 * wins_entries tables alone - the figures an agent types in. A writer selling
 * on a POS terminal writes tickets and no entry row, so every portal sale was
 * invisible here: the table showed a dash against a writer who had taken money
 * all morning, and the estimated commission, net, reserve and balance beneath
 * it were all computed from a gross that was too low.
 *
 * This reads the same unified figures the daily calculation run reads, so the
 * live estimate and the locked figure describe the same sales. They are
 * estimates only because the draw has not settled and nothing is confirmed,
 * not because they come from a different place.
 *
 * Scoped by day, not by game: a supervisor asking what an agency has taken
 * today means across every draw.
 */
router.get("/live-sales/agents/:agentId/entries", requireAuth, async (req, res) => {
  const agentId = req.params["agentId"] as string;
  const date = accraDate(req.query["date"]);
  if (!date) {
    res.status(400).json({ error: "date must be a calendar date, as YYYY-MM-DD" });
    return;
  }

  // Same ownership rule as the per-writer ticket view above: an agent reads
  // their own agency and nobody else's, and a writer has no business here.
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

  const roster = await db
    .select({
      id: writersTable.id,
      fullName: writersTable.fullName,
      fullCode: writersTable.fullCode,
      isActive: writersTable.isActive,
    })
    .from(writersTable)
    .where(eq(writersTable.agentId, agentId))
    .orderBy(writersTable.fullCode);

  if (roster.length === 0) {
    res.json({ date, agentId, rows: [], totals: BLANK_ENTRY_TOTALS });
    return;
  }

  const writerIds = roster.map((w) => w.id);
  const [totalsByWriter, activityByWriter] = await Promise.all([
    getUnifiedWriterTotals(db, { calcDate: date, writerIds }),
    getUnifiedWriterActivity(db, { calcDate: date, writerIds }),
  ]);

  const money = (n: number) => n.toFixed(2);

  const rows = roster
    .map((w) => {
      const t = totalsByWriter.get(w.id);
      const a = activityByWriter.get(w.id);
      return {
        writerId: w.id,
        writerName: w.fullName,
        writerCode: w.fullCode,
        isActive: w.isActive,
        gross: money(t?.gross ?? 0),
        wins: money(t?.wins ?? 0),
        // Split by origin so a figure that looks wrong can be traced to the
        // agent's keyboard or to a terminal without opening the database.
        entryGross: money(t?.entryGross ?? 0),
        entryWins: money(t?.entryWins ?? 0),
        ticketGross: money(t?.ticketGross ?? 0),
        ticketWins: money(t?.ticketWins ?? 0),
        ticketCount: t?.ticketCount ?? 0,
        grossAt: a?.grossAt ?? null,
        winsAt: a?.winsAt ?? null,
      };
    })
    // A writer who has neither sold nor won today is listed separately in the
    // UI as "no entries yet", not as a row of zeroes.
    .filter((r) => parseFloat(r.gross) !== 0 || parseFloat(r.wins) !== 0 || r.ticketCount > 0);

  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + parseFloat(r.gross),
      wins: acc.wins + parseFloat(r.wins),
      entryGross: acc.entryGross + parseFloat(r.entryGross),
      entryWins: acc.entryWins + parseFloat(r.entryWins),
      ticketGross: acc.ticketGross + parseFloat(r.ticketGross),
      ticketWins: acc.ticketWins + parseFloat(r.ticketWins),
      ticketCount: acc.ticketCount + r.ticketCount,
    }),
    { gross: 0, wins: 0, entryGross: 0, entryWins: 0, ticketGross: 0, ticketWins: 0, ticketCount: 0 },
  );

  res.json({
    date,
    agentId,
    rows,
    totals: {
      gross: money(totals.gross),
      wins: money(totals.wins),
      entryGross: money(totals.entryGross),
      entryWins: money(totals.entryWins),
      ticketGross: money(totals.ticketGross),
      ticketWins: money(totals.ticketWins),
      ticketCount: totals.ticketCount,
    },
  });
});

/**
 * One day's real sales, for whoever is asking.
 *
 * The agent dashboard used to read its "Gross Sales" from the gross_entries
 * table, which is a figure somebody types in after the fact - so it showed
 * nothing until it was declared, and then showed whatever was declared rather
 * than what was sold. This counts tickets.
 *
 * Scoped by day rather than by game, because an agent asking "what have we
 * sold today" means across every draw, and a ticket belongs to the day it was
 * sold on. The day is an Accra day, half-open, matching the rest of the system.
 *
 * One query rather than one per game: the dashboard polls this, and the audit
 * of this codebase already found polling to be its heaviest load.
 */
router.get("/live-sales/day", requireAuth, async (req, res) => {
  const date = accraDate(req.query["date"]);
  if (!date) {
    res.status(400).json({ error: "date must be a calendar date, as YYYY-MM-DD" });
    return;
  }

  const role = req.user!.role;
  let writerIds: string[] | null = null; // null = everybody (director/admin)

  if (role === "writer") {
    writerIds = [req.user!.userId];
  } else if (role === "agent") {
    const [myAgent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.userId))
      .limit(1);
    if (!myAgent) {
      res.json({ date, scope: "agent", totals: ZERO, byGame: [] });
      return;
    }
    const mine = await db
      .select({ id: writersTable.id })
      .from(writersTable)
      .where(eq(writersTable.agentId, myAgent.id));
    writerIds = mine.map((w) => w.id);
  }

  if (writerIds !== null && writerIds.length === 0) {
    res.json({ date, scope: role, totals: ZERO, byGame: [] });
    return;
  }

  const dayWindow = and(
    sql`${ticketsTable.createdAt} >= ((${date})::date)::timestamp AT TIME ZONE 'Africa/Accra'`,
    sql`${ticketsTable.createdAt} < (((${date})::date + 1)::timestamp AT TIME ZONE 'Africa/Accra')`,
  );
  // Voided and cancelled tickets took no money, so they are not sales.
  const sellable = sql`${ticketsTable.status} not in ('void', 'cancelled')`;

  const scopeFilter =
    writerIds === null
      ? and(dayWindow, sellable)
      : and(dayWindow, sellable, inArray(ticketsTable.writerId, writerIds));

  const [totals] = await db.select(totalsSelection).from(ticketsTable).where(scopeFilter);

  const byGame = await db
    .select({
      gameId: gamesTable.id,
      gameName: gamesTable.name,
      eventNumber: gamesTable.eventNumber,
      status: gamesTable.status,
      ...totalsSelection,
    })
    .from(ticketsTable)
    .innerJoin(gamesTable, eq(ticketsTable.gameId, gamesTable.id))
    .where(scopeFilter)
    .groupBy(gamesTable.id, gamesTable.name, gamesTable.eventNumber, gamesTable.status)
    .orderBy(sql`sum(${ticketsTable.stakeAmount}) desc`);

  res.json({ date, scope: role, totals: totals ?? ZERO, byGame });
});

export default router;
