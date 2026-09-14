import { Router } from "express";
import {
  db,
  ticketsTable,
  writersTable,
  agentsTable,
  gamesTable,
  betTypesTable,
  gameResultsTable,
} from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { recordTicketEventSafe } from "../lib/ticket-audit";
import {
  buildReceiptText,
  buildSmsText,
  buildQrPayload,
  buildNumbersBlock,
  expiryDate,
  TICKET_VALIDITY_DAYS,
  type ReceiptData,
} from "../lib/receipt";
import { winningPicks, parseNumberList, type Mechanic } from "../lib/bet-engine";

const router = Router();

// Overridable per-deployment, but these are the registered trading name and
// slogan that must appear on every printed ticket.
const COMPANY_NAME = process.env["COMPANY_NAME"] ?? "VISION 2000 LOTTO COM.LTD";
const COMPANY_TAGLINE =
  process.env["COMPANY_TAGLINE"] ?? "Gaming in aid of Street Children";

/**
 * One ticket with everything a receipt needs. `q` accepts either the ticket's
 * UUID or its printed ticket number, so a scanned QR and a typed reference
 * both resolve here.
 */
async function loadTicket(q: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);

  const [row] = await db
    .select({
      ticket: ticketsTable,
      writer: writersTable,
      agent: agentsTable,
      game: gamesTable,
      betType: betTypesTable,
      // The declared draw. Left-joined because an open game has none yet.
      result: gameResultsTable,
    })
    .from(ticketsTable)
    .innerJoin(writersTable, eq(ticketsTable.writerId, writersTable.id))
    .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
    .innerJoin(gamesTable, eq(ticketsTable.gameId, gamesTable.id))
    .innerJoin(betTypesTable, eq(ticketsTable.betTypeId, betTypesTable.id))
    .leftJoin(gameResultsTable, eq(gameResultsTable.gameId, ticketsTable.gameId))
    .where(
      isUuid
        ? or(eq(ticketsTable.id, q), eq(ticketsTable.ticketNumber, q))
        : eq(ticketsTable.ticketNumber, q),
    )
    .limit(1);

  return row;
}

function toReceiptData(row: NonNullable<Awaited<ReturnType<typeof loadTicket>>>): ReceiptData {
  const { ticket, writer, agent, game, betType } = row;
  // One bet per ticket today; unit price therefore equals the stake. Kept as
  // separate fields so multi-line tickets need no receipt change.
  const lines = 1;
  return {
    companyName: COMPANY_NAME,
    tagline: COMPANY_TAGLINE || undefined,
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    // The writer's full code identifies the selling terminal.
    terminalId: writer.fullCode,
    agentCode: agent.fullCode,
    writerCode: writer.fullCode,
    writerName: writer.fullName,
    drawNumber: game.eventNumber,
    drawName: game.name,
    drawDate: game.closeAt,
    saleDate: ticket.createdAt,
    betTypeName: betType.name,
    numbers: ticket.numbers,
    bankerNumber: ticket.bankerNumber,
    lines,
    unitPrice: (Number(ticket.stakeAmount) / lines).toFixed(2),
    totalStake: ticket.stakeAmount,
    potentialPayout: ticket.potentialPayout,
    status: ticket.status,
    validityDays: TICKET_VALIDITY_DAYS,
  };
}

/** True when this viewer is allowed to see this ticket. */
async function mayView(
  role: string,
  userId: string,
  row: NonNullable<Awaited<ReturnType<typeof loadTicket>>>,
): Promise<boolean> {
  if (role === "director" || role === "administrator" || role === "cashier") return true;
  if (role === "writer") return row.ticket.writerId === userId;
  if (role === "agent") {
    const [myAgent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.userId, userId))
      .limit(1);
    return !!myAgent && myAgent.id === row.writer.agentId;
  }
  return false;
}

/**
 * The numbers this ticket was settled against.
 *
 * The result row is preferred over the game row because it is what settlement
 * actually read - the two posting routes do not both write the game row, and
 * a slip must never ring numbers the payout was not calculated from.
 */
function drawnFor(row: NonNullable<Awaited<ReturnType<typeof loadTicket>>>): string | null {
  return row.result?.winningNumbers ?? row.game.winningNumbers ?? null;
}

/**
 * Which of this ticket's own numbers earned the win, so the screen can ring
 * them in green.
 *
 * Settled here rather than on the client for one reason: the rules that decide
 * a winner live in the bet engine, and a cashier paying out must be looking at
 * the same verdict the money was calculated from. A ticket that did not win
 * comes back empty and is left unmarked.
 */
function winnersOn(row: NonNullable<Awaited<ReturnType<typeof loadTicket>>>) {
  const { ticket, betType } = row;
  const draw = drawnFor(row);
  if (!ticket.isWinner || !draw) return { numbers: [], banker: null };

  return winningPicks(
    {
      mechanic: (betType.mechanic as Mechanic) ?? "direct_two",
      numbers: parseNumberList(ticket.numbers),
      bankerNumber: ticket.bankerNumber ?? null,
      // Neither figure changes which picks won - only how much they pay - but
      // the engine wants a whole selection, so give it the ticket's own.
      stakePerLine: parseFloat(ticket.stakePerLine ?? "") || parseFloat(ticket.stakeAmount) || 0,
      multiplier: parseFloat(betType.payoutMultiplier) || 0,
    },
    parseNumberList(draw),
  );
}

function receiptResponse(row: NonNullable<Awaited<ReturnType<typeof loadTicket>>>) {
  const data = toReceiptData(row);
  const won = winnersOn(row);
  return {
    ticket: {
      id: data.ticketId,
      ticketNumber: data.ticketNumber,
      status: data.status,
      isWinner: row.ticket.isWinner,
      winAmount: row.ticket.winAmount,
      numbers: data.numbers,
      bankerNumber: row.ticket.bankerNumber,
      /** Picks to ring on the slip. Empty on anything that did not win. */
      winningNumbers: won.numbers,
      winningBanker: won.banker,
      stakeAmount: data.totalStake,
      potentialPayout: data.potentialPayout,
      saleDate: data.saleDate,
      validUntil: expiryDate(data.drawDate, data.validityDays),
    },
    game: {
      name: data.drawName,
      eventNumber: data.drawNumber,
      drawDate: data.drawDate,
      /** The declared draw, or null while the game is still open. */
      winningNumbers: drawnFor(row),
    },
    betType: { name: data.betTypeName },
    writer: { code: data.writerCode, name: data.writerName },
    agent: { code: data.agentCode, name: row.agent.agencyName },
    receipt: data,
    qrPayload: buildQrPayload(data),
    receiptText: buildReceiptText(data),
    // The exact slice of receiptText holding the played numbers, so the screen
    // can find it without parsing the slip.
    numbersBlock: buildNumbersBlock(data),
    smsText: buildSmsText(data),
  };
}

/**
 * Lookup for review. Admins and cashiers may check any ticket; agents only
 * their own writers'. Writers use the receipt route for their own tickets.
 */
router.get(
  "/tickets/lookup",
  requireAuth,
  requireRole("director", "administrator", "cashier", "agent"),
  async (req, res) => {
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    if (!q) {
      res.status(400).json({ error: "Enter a ticket ID or ticket number" });
      return;
    }

    const row = await loadTicket(q);
    if (!row) {
      res.status(404).json({ error: "No ticket found for that reference" });
      return;
    }
    if (!(await mayView(req.user!.role, req.user!.userId, row))) {
      // Don't distinguish "not yours" from "doesn't exist" - that would let an
      // agent probe for other agencies' ticket numbers.
      res.status(404).json({ error: "No ticket found for that reference" });
      return;
    }

    // A lookup IS the validation: it is what a cashier does before paying.
    // Logged best-effort - a ticket check must not fail because its audit row
    // did, and the order of the two is what the anomaly rules read.
    await recordTicketEventSafe(db, {
      ticketId: row.ticket.id,
      eventType: "validated",
      toStatus: row.ticket.status,
      actorUserId: req.user!.userId,
      actorRole: req.user!.role,
      source: "admin",
    });

    res.json(receiptResponse(row));
  },
);

/** Receipt for one ticket, used by the writer portal after a bet is placed. */
router.get("/tickets/:ticketId/receipt", requireAuth, async (req, res) => {
  const row = await loadTicket(req.params["ticketId"] as string);
  if (!row) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (!(await mayView(req.user!.role, req.user!.userId, row))) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  res.json(receiptResponse(row));
});

export default router;
