import { Router } from "express";
import { db, gameResultsTable, payoutRequestsTable, writersTable, gamesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { SmsAdapter } from "../lib/sms-gateway";
import { settleGameTickets } from "../lib/settle-tickets";
import { expiryDate, TICKET_VALIDITY_DAYS } from "../lib/receipt";
import { logger } from "../lib/logger";

const router = Router();
const smsAdapter = new SmsAdapter();

const gameResultSchema = z.object({
  gameId: z.string().uuid(),
  winningNumbers: z.string(), // "23,45,67,89,12"
  machineNumbers: z.string(), // "11,22,33,44,55"
});

router.post("/game-results", requireAuth, requireRole("administrator"), async (req, res) => {
  const parse = gameResultSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid data" });
    return;
  }
  const { gameId, winningNumbers, machineNumbers } = parse.data;

  /**
   * One settlement path, not two.
   *
   * This route used to carry its own copy of the loop: it looked the
   * writer's agent up per winning ticket rather than once, wrote no ticket
   * events at all - so a draw settled here left no audit trail while the
   * same draw settled through /calculations left a full one - and had no
   * guard against settling a game twice beyond the unique constraint on
   * game_results.game_id, which fails with a database error rather than an
   * answer.
   *
   * settleGameTickets is the same engine the calculation run uses, is
   * idempotent, and now writes in batches.
   */
  const result = await db.transaction(async (tx) => {
    const summary = await settleGameTickets(
      tx,
      gameId,
      winningNumbers,
      machineNumbers,
      req.user!.userId,
    );
    const [gameResult] = await tx
      .select()
      .from(gameResultsTable)
      .where(eq(gameResultsTable.id, summary.gameResultId))
      .limit(1);
    return gameResult;
  });

  res.json(result);
});

/**
 * Stage 01 into Stage 02: publish a draw's winning tickets and tell the
 * writers who sold them.
 *
 * This endpoint used to be where money moved - it credited e-token wallets
 * for every request an administrator had approved. It moves nothing now. A win
 * is paid when its writer claims it on their POS and a cashier approves it,
 * and not before; what this does is start that off, by texting each writer
 * what they have to claim.
 *
 * One text per writer, not per ticket: a writer with eleven winners needs to
 * know there are eleven, not to receive eleven messages.
 *
 * Safe to press again. It only ever counts tickets still waiting to be
 * claimed, so a second run reminds the writers who have not yet scanned and
 * says nothing to those who have.
 */
router.post("/game-results/:gameId/process-payouts", requireAuth, requireRole("administrator"), async (req, res) => {
  const gameId = req.params["gameId"] as string;

  const [gameResult] = await db.select().from(gameResultsTable).where(eq(gameResultsTable.gameId, gameId)).limit(1);
  if (!gameResult) {
    res.status(404).json({ error: "Run the draw for this game first" });
    return;
  }
  const [game] = await db
    .select({ name: gamesTable.name, eventNumber: gamesTable.eventNumber, closeAt: gamesTable.closeAt })
    .from(gamesTable)
    .where(eq(gamesTable.id, gameId))
    .limit(1);

  const perWriter = await db
    .select({
      writerId: writersTable.id,
      phone: writersTable.phone,
      hasWallet: sql<boolean>`${writersTable.momoNumber} is not null`,
      tickets: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${payoutRequestsTable.payoutAmount}), 0)::text`,
    })
    .from(payoutRequestsTable)
    .innerJoin(writersTable, eq(writersTable.id, payoutRequestsTable.writerId))
    .where(and(eq(payoutRequestsTable.gameResultId, gameResult.id), eq(payoutRequestsTable.status, "pending")))
    .groupBy(writersTable.id, writersTable.phone, writersTable.momoNumber);

  const validUntil = game ? expiryDate(game.closeAt, TICKET_VALIDITY_DAYS) : null;
  if (validUntil) validUntil.setUTCHours(23, 59, 59, 999);
  if (validUntil && Date.now() > validUntil.getTime()) {
    // Texting writers to scan tickets that will be refused as expired would
    // send them to their customers with a promise the system will not keep.
    res.status(409).json({ error: `Tickets for this draw expired ${TICKET_VALIDITY_DAYS} days after it; there is nothing left to claim.` });
    return;
  }
  const until = validUntil
    ? validUntil.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Accra" })
    : null;

  const texts = perWriter
    .filter((w) => !!w.phone)
    .map((w) => ({
      phone: w.phone!,
      message:
        `VS2000: You have ${w.tickets} winning ticket${w.tickets === 1 ? "" : "s"} worth GHS ${Number(w.total).toFixed(2)} ` +
        `in ${game?.name ?? "the draw"} #${game?.eventNumber ?? ""}. Open Claim Wins on your POS and scan each ticket's QR code ` +
        `to be paid to your MoMo wallet${until ? `. Valid until ${until}` : ""}.` +
        (w.hasWallet ? "" : " You have no MoMo wallet registered - ask your agent to add one first."),
    }));

  const results = await Promise.allSettled(texts.map((t) => smsAdapter.send(t.phone, t.message)));
  const sent = results.filter((r) => r.status === "fulfilled" && r.value.success).length;
  const stubbed = results.some((r) => r.status === "fulfilled" && r.value.stubbed);
  if (sent < texts.length) {
    logger.error({ failed: texts.length - sent, of: texts.length }, "[DRAW] some winning-ticket texts did not send");
  }

  await db.update(gameResultsTable).set({ smsNotificationsSent: true }).where(eq(gameResultsTable.id, gameResult.id));

  res.json({
    success: true,
    writersWithWinners: perWriter.length,
    ticketsAwaitingClaim: perWriter.reduce((n, w) => n + w.tickets, 0),
    totalAwaitingClaim: perWriter.reduce((n, w) => n + Number(w.total), 0).toFixed(2),
    smsSent: sent,
    smsFailed: texts.length - sent,
    // Said plainly, so "12 sent" is never read as delivered when no gateway is set up.
    smsStubbed: stubbed,
    writersWithoutPhone: perWriter.filter((w) => !w.phone).length,
    writersWithoutWallet: perWriter.filter((w) => !w.hasWallet).length,
  });
});

export default router;
