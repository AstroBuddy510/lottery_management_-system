import { Router } from "express";
import {
  db,
  ticketsTable,
  ticketEventsTable,
  writersTable,
  agentsTable,
  gamesTable,
  betTypesTable,
  payoutRequestsTable,
  gameResultsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, or, ilike, sql, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { detectTicketAnomalies, type AuditTicket, type AuditEvent } from "../lib/ticket-audit";

const router = Router();
const staffOnly = [
  requireAuth,
  requireRole("director", "administrator", "cashier", "agent"),
] as const;

export const TICKET_CATEGORIES = [
  "all",
  "active",
  "won",
  "redeemed",
  "lost",
  "voided",
  "flagged",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Agents see only their own writers' tickets; staff see everything. */
async function agentScopeId(role: string, userId: string): Promise<string | null> {
  if (role !== "agent") return null;
  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId))
    .limit(1);
  return agent?.id ?? "__none__";
}

const ticketColumns = {
  id: ticketsTable.id,
  ticketNumber: ticketsTable.ticketNumber,
  numbers: ticketsTable.numbers,
  stakeAmount: ticketsTable.stakeAmount,
  potentialPayout: ticketsTable.potentialPayout,
  winAmount: ticketsTable.winAmount,
  status: ticketsTable.status,
  isWinner: ticketsTable.isWinner,
  createdAt: ticketsTable.createdAt,
  writerId: ticketsTable.writerId,
  writerName: writersTable.fullName,
  writerCode: writersTable.fullCode,
  agentCode: agentsTable.fullCode,
  agencyName: agentsTable.agencyName,
  gameId: ticketsTable.gameId,
  gameName: gamesTable.name,
  eventNumber: gamesTable.eventNumber,
  gameCloseAt: gamesTable.closeAt,
  betTypeId: ticketsTable.betTypeId,
  betTypeName: betTypesTable.name,
  payoutStatus: payoutRequestsTable.status,
  payoutPaidAt: payoutRequestsTable.paidAt,
  drawProcessedAt: gameResultsTable.processedAt,
};

function baseQuery() {
  return db
    .select(ticketColumns)
    .from(ticketsTable)
    .innerJoin(writersTable, eq(ticketsTable.writerId, writersTable.id))
    .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
    .innerJoin(gamesTable, eq(ticketsTable.gameId, gamesTable.id))
    .innerJoin(betTypesTable, eq(ticketsTable.betTypeId, betTypesTable.id))
    .leftJoin(payoutRequestsTable, eq(payoutRequestsTable.ticketId, ticketsTable.id))
    .leftJoin(gameResultsTable, eq(gameResultsTable.gameId, ticketsTable.gameId));
}

type TicketRow = Awaited<ReturnType<ReturnType<typeof baseQuery>["execute"]>>[number];

/**
 * A ticket may match more than one payout row; keep the furthest along so a
 * ticket never shows as unpaid because an earlier rejected claim sorted first.
 */
const PAYOUT_RANK: Record<string, number> = { rejected: 0, pending: 1, approved: 2, paid: 3 };

function dedupe(rows: TicketRow[]): TicketRow[] {
  const byId = new Map<string, TicketRow>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      continue;
    }
    const a = PAYOUT_RANK[existing.payoutStatus ?? ""] ?? -1;
    const b = PAYOUT_RANK[row.payoutStatus ?? ""] ?? -1;
    if (b > a) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function categoryFilter(category: TicketCategory) {
  switch (category) {
    case "active":
      return eq(ticketsTable.status, "active");
    case "won":
      // Won but not yet money in a hand.
      return and(
        eq(ticketsTable.status, "won"),
        or(isNull(payoutRequestsTable.status), sql`${payoutRequestsTable.status} <> 'paid'`),
      );
    case "redeemed":
      return eq(payoutRequestsTable.status, "paid");
    case "lost":
      return eq(ticketsTable.status, "lost");
    case "voided":
      return inArray(ticketsTable.status, ["void", "cancelled"]);
    default:
      return undefined;
  }
}

/**
 * Tickets by category, for the lookup screen's top navigation. `flagged` is
 * not a stored status - it is whatever the anomaly rules currently object to,
 * so it is resolved after the rows are read rather than in SQL.
 */
router.get("/tickets/browse", ...staffOnly, async (req, res) => {
  const category = (req.query["category"] as TicketCategory) ?? "all";
  if (!TICKET_CATEGORIES.includes(category)) {
    res.status(400).json({ error: "Unknown category" });
    return;
  }

  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : "";
  const limit = Math.min(Number(req.query["limit"]) || 100, 300);

  const scopedAgentId = await agentScopeId(req.user!.role, req.user!.userId);

  const conditions = [
    scopedAgentId ? eq(writersTable.agentId, scopedAgentId) : undefined,
    gameId ? eq(ticketsTable.gameId, gameId) : undefined,
    q
      ? or(
          ilike(ticketsTable.ticketNumber, `%${q}%`),
          ilike(writersTable.fullName, `%${q}%`),
          ilike(writersTable.fullCode, `%${q}%`),
          ilike(ticketsTable.numbers, `%${q}%`),
        )
      : undefined,
    category === "flagged" ? undefined : categoryFilter(category),
  ].filter(Boolean);

  const rows = dedupe(
    await baseQuery()
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(ticketsTable.createdAt))
      // The flagged view filters after the fact, so it needs a wider read.
      .limit(category === "flagged" ? Math.max(limit, 300) : limit),
  );

  if (category !== "flagged") {
    const counts = await categoryCounts(scopedAgentId, gameId);
    res.json({ category, tickets: rows.slice(0, limit), counts });
    return;
  }

  const anomalies = await anomaliesFor(rows);
  const flagged = new Set(anomalies.map((a) => a.ticketId));
  const counts = await categoryCounts(scopedAgentId, gameId);
  res.json({
    category,
    tickets: rows.filter((r) => flagged.has(r.id)).slice(0, limit),
    anomalies,
    counts: { ...counts, flagged: flagged.size },
  });
});

/** Row counts per tab, so the navigation can carry them. */
async function categoryCounts(scopedAgentId: string | null, gameId: string) {
  const scope = [
    scopedAgentId ? eq(writersTable.agentId, scopedAgentId) : undefined,
    gameId ? eq(ticketsTable.gameId, gameId) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      status: ticketsTable.status,
      payoutStatus: payoutRequestsTable.status,
      ticketId: ticketsTable.id,
    })
    .from(ticketsTable)
    .innerJoin(writersTable, eq(ticketsTable.writerId, writersTable.id))
    .leftJoin(payoutRequestsTable, eq(payoutRequestsTable.ticketId, ticketsTable.id))
    .where(scope.length ? and(...scope) : undefined);

  const best = new Map<string, { status: string; payoutStatus: string | null }>();
  for (const r of rows) {
    const existing = best.get(r.ticketId);
    if (
      !existing ||
      (PAYOUT_RANK[r.payoutStatus ?? ""] ?? -1) > (PAYOUT_RANK[existing.payoutStatus ?? ""] ?? -1)
    ) {
      best.set(r.ticketId, { status: r.status, payoutStatus: r.payoutStatus });
    }
  }

  const counts = { all: 0, active: 0, won: 0, redeemed: 0, lost: 0, voided: 0, flagged: 0 };
  for (const r of best.values()) {
    counts.all += 1;
    if (r.payoutStatus === "paid") counts.redeemed += 1;
    else if (r.status === "won") counts.won += 1;
    if (r.status === "active") counts.active += 1;
    if (r.status === "lost") counts.lost += 1;
    if (r.status === "void" || r.status === "cancelled") counts.voided += 1;
  }
  return counts;
}

async function anomaliesFor(rows: TicketRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
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
    id: r.id,
    ticketNumber: r.ticketNumber,
    writerId: r.writerId,
    writerName: r.writerName,
    gameId: r.gameId,
    betTypeId: r.betTypeId,
    numbers: r.numbers,
    stakeAmount: r.stakeAmount,
    status: r.status,
    createdAt: r.createdAt,
    gameCloseAt: r.gameCloseAt,
    drawProcessedAt: r.drawProcessedAt,
  }));

  return detectTicketAnomalies(tickets, events as AuditEvent[]);
}

/** Everything that has happened to one ticket, oldest first. */
router.get("/tickets/:ticketId/events", ...staffOnly, async (req, res) => {
  const ticketId = req.params["ticketId"] as string;

  const [row] = await baseQuery().where(eq(ticketsTable.id, ticketId)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const scopedAgentId = await agentScopeId(req.user!.role, req.user!.userId);
  if (scopedAgentId) {
    const [writer] = await db
      .select({ agentId: writersTable.agentId })
      .from(writersTable)
      .where(eq(writersTable.id, row.writerId))
      .limit(1);
    if (writer?.agentId !== scopedAgentId) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
  }

  const events = await db
    .select({
      id: ticketEventsTable.id,
      ticketId: ticketEventsTable.ticketId,
      eventType: ticketEventsTable.eventType,
      fromStatus: ticketEventsTable.fromStatus,
      toStatus: ticketEventsTable.toStatus,
      actorRole: ticketEventsTable.actorRole,
      actorName: usersTable.fullName,
      source: ticketEventsTable.source,
      note: ticketEventsTable.note,
      occurredAt: ticketEventsTable.occurredAt,
    })
    .from(ticketEventsTable)
    .leftJoin(usersTable, eq(ticketEventsTable.actorUserId, usersTable.id))
    .where(eq(ticketEventsTable.ticketId, ticketId))
    .orderBy(ticketEventsTable.occurredAt);

  const anomalies = await anomaliesFor([row]);
  res.json({ events, anomalies });
});

/**
 * Everything the rules object to across recent tickets. Admins only: an
 * agent's own fraud report is not a thing worth building.
 */
router.get(
  "/tickets/fraud",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const days = Math.min(Number(req.query["days"]) || 30, 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : "";

    const rows = dedupe(
      await baseQuery()
        .where(
          gameId
            ? and(gte(ticketsTable.createdAt, since), eq(ticketsTable.gameId, gameId))
            : gte(ticketsTable.createdAt, since),
        )
        .orderBy(desc(ticketsTable.createdAt))
        .limit(5000),
    );

    const anomalies = await anomaliesFor(rows);
    const byTicket = new Map(rows.map((r) => [r.id, r]));

    const bySeverity = { critical: 0, high: 0, medium: 0 };
    const byCode: Record<string, number> = {};
    for (const a of anomalies) {
      bySeverity[a.severity] += 1;
      byCode[a.code] = (byCode[a.code] ?? 0) + 1;
    }

    res.json({
      days,
      ticketsScanned: rows.length,
      bySeverity,
      byCode,
      anomalies: anomalies.slice(0, 200).map((a) => {
        const t = byTicket.get(a.ticketId);
        return {
          ...a,
          writerName: t?.writerName ?? null,
          writerCode: t?.writerCode ?? null,
          agentCode: t?.agentCode ?? null,
          gameName: t?.gameName ?? null,
          eventNumber: t?.eventNumber ?? null,
          stakeAmount: t?.stakeAmount ?? null,
        };
      }),
    });
  },
);

export default router;
