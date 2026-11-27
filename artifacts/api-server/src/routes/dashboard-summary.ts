import { Router } from "express";
import {
  db,
  agentsTable,
  writersTable,
  usersTable,
  systemSettingsTable,
  dailyCalculationsTable,
  gamesTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { calculateWriter } from "../lib/calculator";
import { getUnifiedWriterTotals } from "../lib/unified-sales";

const router = Router();

/**
 * Collective platform performance for one draw, unified across every way a
 * sale can reach the system: agent-entered gross, and prepaid or postpaid
 * sales made in the writers' portal.
 *
 * The figures are produced by calculateWriter - the same function the daily
 * calculation run uses - so the live view and the committed calculation
 * cannot drift apart. Computing this server-side also removes the duplicate
 * copy of the formula that the dashboard was carrying.
 */

interface Totals {
  gross: number;
  commission: number;
  netBeforeDeduction: number;
  reserve: number;
  netAfterReserve: number;
  wins: number;
  profitOrDeficit: number;
}

function emptySplit() {
  return { entryGross: 0, ticketGross: 0, entryWins: 0, ticketWins: 0, ticketCount: 0 };
}

function emptyTotals(): Totals {
  return {
    gross: 0,
    commission: 0,
    netBeforeDeduction: 0,
    reserve: 0,
    netAfterReserve: 0,
    wins: 0,
    profitOrDeficit: 0,
  };
}

function addWriter(into: Totals, gross: number, wins: number, commissionPct: number, reservePct: number) {
  const c = calculateWriter(gross, wins, commissionPct, reservePct);
  into.gross += c.grossSales;
  into.commission += c.commissionAmount;
  into.netBeforeDeduction += c.netGross;
  into.reserve += c.reserveAmount;
  into.netAfterReserve += c.netGross - c.reserveAmount;
  into.wins += c.winsAmount;
  into.profitOrDeficit += c.writerBalance;
}

router.get(
  "/dashboard/unified-summary",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : undefined;
    let calcDate = typeof req.query["date"] === "string" ? req.query["date"] : undefined;

    // Default the date from the draw itself, so a game that closed just
    // before midnight still reports against its own day.
    let game: { id: string; name: string; eventNumber: string; status: string; closeAt: Date } | undefined;
    if (gameId) {
      const [g] = await db
        .select({
          id: gamesTable.id,
          name: gamesTable.name,
          eventNumber: gamesTable.eventNumber,
          status: gamesTable.status,
          closeAt: gamesTable.closeAt,
        })
        .from(gamesTable)
        .where(eq(gamesTable.id, gameId))
        .limit(1);
      if (!g) {
        res.status(404).json({ error: "Game not found" });
        return;
      }
      game = g;
      calcDate ??= new Date(g.closeAt).toISOString().slice(0, 10);
    }
    calcDate ??= new Date().toISOString().slice(0, 10);

    const [settings] = await db
      .select()
      .from(systemSettingsTable)
      .orderBy(desc(systemSettingsTable.updatedAt))
      .limit(1);
    if (!settings) {
      res.status(400).json({ error: "System settings not configured" });
      return;
    }
    const commissionPct = parseFloat(settings.commissionPct);
    const reservePct = parseFloat(settings.reservePct);

    // Committed figures win where they exist: once a draw is calculated, the
    // stored row is the record of account and the live view must match it.
    const committed = await db
      .select()
      .from(dailyCalculationsTable)
      .where(
        gameId
          ? and(eq(dailyCalculationsTable.calcDate, calcDate), eq(dailyCalculationsTable.gameId, gameId))
          : eq(dailyCalculationsTable.calcDate, calcDate),
      );
    const committedByWriter = new Map(committed.map((c) => [c.writerId, c]));

    const unified = await getUnifiedWriterTotals(db, { calcDate, gameId });

    // Writer -> agent, so the per-agent breakdown can be built.
    const writers = await db
      .select({
        id: writersTable.id,
        fullName: writersTable.fullName,
        fullCode: writersTable.fullCode,
        agentId: writersTable.agentId,
      })
      .from(writersTable);
    const writerMeta = new Map(writers.map((w) => [w.id, w]));

    const agents = await db
      .select({
        id: agentsTable.id,
        fullCode: agentsTable.fullCode,
        agencyName: agentsTable.agencyName,
        agentName: usersTable.fullName,
      })
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id));
    const agentMeta = new Map(agents.map((a) => [a.id, a]));

    const totals = emptyTotals();
    const perAgent = new Map<
      string,
      Totals & {
        writerCount: number;
        ticketCount: number;
        isPending: boolean;
        // Where this agent's gross came from, so a card can show the split.
        entryGross: number;
        ticketGross: number;
        entryWins: number;
        ticketWins: number;
      }
    >();
    const sourceSplit = emptySplit();

    // Every writer with either committed figures or live activity.
    const writerIds = new Set<string>([...unified.keys(), ...committedByWriter.keys()]);

    for (const writerId of writerIds) {
      const live = unified.get(writerId);
      const stored = committedByWriter.get(writerId);
      const meta = writerMeta.get(writerId);
      const agentId = meta?.agentId ?? "unassigned";

      let bucket = perAgent.get(agentId);
      if (!bucket) {
        bucket = {
          ...emptyTotals(),
          writerCount: 0,
          ticketCount: 0,
          isPending: false,
          entryGross: 0,
          ticketGross: 0,
          entryWins: 0,
          ticketWins: 0,
        };
        perAgent.set(agentId, bucket);
      }
      bucket.writerCount += 1;

      if (live) {
        sourceSplit.entryGross += live.entryGross;
        sourceSplit.ticketGross += live.ticketGross;
        sourceSplit.entryWins += live.entryWins;
        sourceSplit.ticketWins += live.ticketWins;
        sourceSplit.ticketCount += live.ticketCount;
        bucket.ticketCount += live.ticketCount;
        bucket.entryGross += live.entryGross;
        bucket.ticketGross += live.ticketGross;
        bucket.entryWins += live.entryWins;
        bucket.ticketWins += live.ticketWins;
      }

      if (stored) {
        const gross = parseFloat(stored.grossSales);
        const wins = parseFloat(stored.winsAmount);
        addWriter(totals, gross, wins, commissionPct, reservePct);
        addWriter(bucket, gross, wins, commissionPct, reservePct);
      } else if (live) {
        bucket.isPending = true;
        addWriter(totals, live.gross, live.wins, commissionPct, reservePct);
        addWriter(bucket, live.gross, live.wins, commissionPct, reservePct);
      }
    }

    const breakdown = [...perAgent.entries()]
      .map(([agentId, t]) => {
        const meta = agentMeta.get(agentId);
        return {
          agentId,
          agentCode: meta?.fullCode ?? "—",
          agentName: meta?.agentName ?? "Unassigned",
          agencyName: meta?.agencyName ?? null,
          ...t,
        };
      })
      .sort((a, b) => b.gross - a.gross);

    res.json({
      calcDate,
      game: game ? { id: game.id, name: game.name, eventNumber: game.eventNumber, status: game.status } : null,
      commissionPct,
      reservePct,
      // True while any writer's figures are live rather than committed.
      isPending: breakdown.some((b) => b.isPending),
      totals,
      sourceSplit,
      breakdown,
    });
  },
);

/**
 * The same figures, scoped to whoever is asking:
 *   agent  - their own entries for their writers, plus those writers' portal
 *            sales: one consolidated view of their whole agency
 *   writer - only sales they made in their own portal
 *
 * Uses the same unified aggregation and calculateWriter as the platform
 * summary, so an agent's figures always reconcile with the slice of the
 * director's dashboard that covers them.
 */
router.get("/dashboard/my-summary", requireAuth, async (req, res) => {
  const role = req.user!.role;
  const gameId = typeof req.query["gameId"] === "string" && req.query["gameId"] ? req.query["gameId"] : undefined;
  let calcDate = typeof req.query["date"] === "string" ? req.query["date"] : undefined;

  /*
   * One draw at a time. Several games can run on the same date, and adding
   * them together would hide which event made or lost money - so this
   * summary is only ever given for a single event, never a day's bundle.
   */
  if (!gameId) {
    res.status(400).json({ error: "Choose a draw: sales are reported per event" });
    return;
  }

  if (gameId) {
    const [g] = await db
      .select({ closeAt: gamesTable.closeAt })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1);
    if (g) calcDate ??= new Date(g.closeAt).toISOString().slice(0, 10);
  }
  calcDate ??= new Date().toISOString().slice(0, 10);

  const [settings] = await db
    .select()
    .from(systemSettingsTable)
    .orderBy(desc(systemSettingsTable.updatedAt))
    .limit(1);
  if (!settings) {
    res.status(400).json({ error: "System settings not configured" });
    return;
  }
  const commissionPct = parseFloat(settings.commissionPct);
  /*
   * A writer's own figures carry no reserve: Gross - Commission = Net, and
   * Net - Wins = Profit / (Deficit). The reserve is an agency-level deduction
   * and stays in the agent's view.
   */
  const reservePct = role === "writer" ? 0 : parseFloat(settings.reservePct);

  // Which writers this viewer's figures cover.
  let writerIds: Set<string>;
  if (role === "writer") {
    writerIds = new Set([req.user!.userId]);
  } else if (role === "agent") {
    const [myAgent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.userId))
      .limit(1);
    if (!myAgent) {
      res.json({ calcDate, scope: role, totals: emptyTotals(), sourceSplit: emptySplit(), writers: [] });
      return;
    }
    const mine = await db
      .select({ id: writersTable.id })
      .from(writersTable)
      .where(eq(writersTable.agentId, myAgent.id));
    writerIds = new Set(mine.map((w) => w.id));
  } else {
    res.status(403).json({ error: "Not applicable for this role" });
    return;
  }

  // Scoped in SQL. The viewer's own writers were already worked out above;
  // handing that list to the aggregation is the difference between reading
  // one writer's rows and reading the company's.
  const scopeIds = [...writerIds];
  const unified = await getUnifiedWriterTotals(db, { calcDate, gameId, writerIds: scopeIds });
  const meta = new Map(
    (
      scopeIds.length === 0
        ? []
        : await db
            .select({ id: writersTable.id, fullName: writersTable.fullName, fullCode: writersTable.fullCode })
            .from(writersTable)
            // Names for the writers in view, not for all 74 of them on every poll.
            .where(inArray(writersTable.id, scopeIds))
    ).map((w: { id: string; fullName: string; fullCode: string }) => [w.id, w]),
  );

  const totals = emptyTotals();
  const sourceSplit = emptySplit();
  const writers: Array<Record<string, unknown>> = [];

  for (const [writerId, t] of unified) {
    if (!writerIds.has(writerId)) continue;

    /*
     * Everything sold under this writer's code for the draw: their portal
     * tickets and any gross or wins their agent entered for them. Counting
     * only the tickets left a writer whose agent records their booklet sales
     * looking at "no sales" for a draw they had sold and settled - and it
     * was not what their settlement is worked out on. The split below still
     * says which part came from where.
     */
    const gross = t.gross;
    const wins = t.wins;
    if (gross === 0 && wins === 0) continue;

    addWriter(totals, gross, wins, commissionPct, reservePct);
    sourceSplit.entryGross += t.entryGross;
    sourceSplit.ticketGross += t.ticketGross;
    sourceSplit.entryWins += t.entryWins;
    sourceSplit.ticketWins += t.ticketWins;
    sourceSplit.ticketCount += t.ticketCount;

    const m = meta.get(writerId);
    writers.push({
      writerId,
      writerName: m?.fullName ?? "—",
      writerCode: m?.fullCode ?? "—",
      gross,
      wins,
      entryGross: t.entryGross,
      ticketGross: t.ticketGross,
      ticketCount: t.ticketCount,
    });
  }

  writers.sort((a, b) => Number(b["gross"]) - Number(a["gross"]));

  res.json({ calcDate, scope: role, commissionPct, reservePct, totals, sourceSplit, writers });
});

export default router;
