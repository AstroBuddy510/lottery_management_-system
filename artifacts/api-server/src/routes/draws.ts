import { Router } from "express";
import { db, drawCorrectionsTable, gamesTable, usersTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { recordTicketEvents } from "../lib/ticket-audit";
import { dispatchSystemNotification } from "../lib/notify";
import { audit } from "../lib/finance/books";
import { logger } from "../lib/logger";

/**
 * Draw histories and corrections.
 *
 * A draw, once run, is final: the Run Draws page and the calculation route
 * both refuse to run it again. The one way to change its numbers is a
 * correction - an administrator proposes it, the director approves it, and
 * approval unlocks exactly one re-run with exactly the approved numbers.
 */

const router = Router();
const OFFICE = ["director", "administrator", "cashier"] as const;

/** "7, 12,45 ,3,90" -> "7,12,45,3,90"; null unless five numbers from 1 to 90. */
export function normaliseNumbers(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const parts = input.split(/[^0-9]+/).filter(Boolean).map((p) => Number(p));
  if (parts.length !== 5 || parts.some((n) => !Number.isInteger(n) || n < 1 || n > 90)) return null;
  return parts.join(",");
}

/** Is this draw already run? It is once it has been settled or calculated. */
export async function drawCompleted(exec: { execute: typeof db.execute }, gameId: string) {
  const r = await exec.execute(sql`
    SELECT EXISTS (SELECT 1 FROM game_results WHERE game_id = ${gameId}) AS settled,
           EXISTS (SELECT 1 FROM daily_calculations WHERE game_id = ${gameId}) AS calculated`);
  const row = r.rows[0] as { settled: boolean; calculated: boolean };
  return { settled: row.settled, calculated: row.calculated, completed: row.settled || row.calculated };
}

/**
 * What stands in the way of re-settling a draw: wins someone has already
 * claimed, been paid, been refused, or that have money or records hanging
 * off them. Unclaimed wins can be re-decided; these cannot.
 */
async function correctionBlockers(exec: { execute: typeof db.execute }, gameId: string) {
  const r = await exec.execute(sql`
    SELECT count(*) FILTER (WHERE p.status NOT IN ('pending', 'approved'))::int AS claimed,
           coalesce(sum(p.payout_amount) FILTER (WHERE p.status NOT IN ('pending', 'approved')), 0) AS claimed_amount,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM master_wallet_ledger l WHERE l.payout_request_id = p.id)
                              OR EXISTS (SELECT 1 FROM winnings_expiries x WHERE x.payout_request_id = p.id)
                              OR EXISTS (SELECT 1 FROM winnings_contributions c WHERE c.payout_request_id = p.id))::int AS linked
      FROM payout_requests p JOIN game_results gr ON gr.id = p.game_result_id
     WHERE gr.game_id = ${gameId}`);
  const row = r.rows[0] as { claimed: number; claimed_amount: string; linked: number };
  const reasons: string[] = [];
  if (row.claimed) reasons.push(`${row.claimed} winning ticket(s) worth GH₵${Number(row.claimed_amount).toFixed(2)} have already been claimed, paid or refused`);
  if (row.linked) reasons.push(`${row.linked} win(s) already carry wallet, expiry or contribution records`);
  return reasons;
}

async function notifyRole(roles: string[], sentBy: string, title: string, body: string, except?: string) {
  try {
    const ids = (await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.role, roles as never[])))
      .map((u) => u.id).filter((id) => id !== except);
    if (ids.length) await dispatchSystemNotification({ sentBy, messageType: "alert", title, body, targetType: "system", recipientUserIds: ids });
  } catch (err) {
    logger.warn({ err, title }, "[DRAWS] notification failed");
  }
}

/** Every draw that has been run, its numbers, what it produced, and its corrections. */
router.get("/draws/history", requireAuth, requireRole(...OFFICE), async (_req, res) => {
  const draws = await db.execute(sql`
    SELECT g.id, g.name, g.event_number, g.status, g.close_at,
           coalesce(gr.winning_numbers, g.winning_numbers) AS winning_numbers,
           coalesce(gr.machine_numbers, g.machine_numbers) AS machine_numbers,
           gr.id AS result_id, gr.processed_at, pu.full_name AS processed_by_name,
           gr.total_tickets, gr.total_winners, gr.total_payouts, gr.sms_notifications_sent,
           (SELECT count(*)::int FROM daily_calculations c WHERE c.game_id = g.id) AS calc_rows,
           (SELECT coalesce(sum(gross_sales), 0) FROM daily_calculations c WHERE c.game_id = g.id) AS gross,
           (SELECT coalesce(sum(wins_amount), 0) FROM daily_calculations c WHERE c.game_id = g.id) AS wins,
           (SELECT max(calculated_at) FROM daily_calculations c WHERE c.game_id = g.id) AS calculated_at
      FROM games g
      LEFT JOIN game_results gr ON gr.game_id = g.id
      LEFT JOIN users pu ON pu.id = gr.processed_by
     WHERE gr.id IS NOT NULL
        OR EXISTS (SELECT 1 FROM daily_calculations c WHERE c.game_id = g.id)
        OR EXISTS (SELECT 1 FROM draw_corrections d WHERE d.game_id = g.id)
     ORDER BY g.close_at DESC
     LIMIT 1000`);
  const corrections = await db.execute(sql`
    SELECT d.*, ru.full_name AS requested_by_name, du.full_name AS decided_by_name, au.full_name AS applied_by_name
      FROM draw_corrections d
      JOIN users ru ON ru.id = d.requested_by
      LEFT JOIN users du ON du.id = d.decided_by
      LEFT JOIN users au ON au.id = d.applied_by
     ORDER BY d.requested_at DESC LIMIT 1000`);
  res.json({ draws: draws.rows, corrections: corrections.rows });
});

const correctionSchema = z.object({
  winningNumbers: z.string(),
  machineNumbers: z.string(),
  reason: z.string().trim().min(10, "Say why the numbers are being corrected, and on what authority").max(1000),
});

/** An administrator proposes corrected numbers for a draw already run. Nothing changes until the director approves. */
router.post("/draws/:gameId/corrections", requireAuth, requireRole("administrator"), async (req, res) => {
  const gameId = String(req.params["gameId"]);
  const p = correctionSchema.safeParse(req.body);
  const win = p.success ? normaliseNumbers(p.data.winningNumbers) : null;
  const mach = p.success ? normaliseNumbers(p.data.machineNumbers) : null;
  if (!p.success || !win || !mach) {
    res.status(400).json({ error: p.success ? "Enter five winning and five machine numbers, each from 1 to 90" : (p.error.issues[0]?.message ?? "Check the correction") });
    return;
  }
  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId)).limit(1);
  if (!game) {
    res.status(404).json({ error: "No such game" });
    return;
  }
  const done = await drawCompleted(db, gameId);
  if (!done.settled) {
    res.status(409).json({ error: done.calculated ? "This draw is waiting for its approved re-run" : "This draw has not been run yet - enter its numbers on Run Draws" });
    return;
  }
  const oldWin = normaliseNumbers(game.winningNumbers ?? "") ?? (game.winningNumbers ?? "");
  const oldMach = normaliseNumbers(game.machineNumbers ?? "") ?? (game.machineNumbers ?? "");
  if (win === oldWin && mach === oldMach) {
    res.status(400).json({ error: "These are the numbers the draw already has" });
    return;
  }
  const blockers = await correctionBlockers(db, gameId);
  if (blockers.length) {
    res.status(409).json({ error: `This draw cannot be corrected here: ${blockers.join("; ")}. Correcting it would re-decide wins people already acted on.` });
    return;
  }
  try {
    const [row] = await db.transaction(async (tx) => {
      const rows = await tx.insert(drawCorrectionsTable).values({
        gameId, oldWinning: oldWin, oldMachine: oldMach, newWinning: win, newMachine: mach, reason: p.data.reason, requestedBy: req.user!.userId,
      }).returning();
      await audit(tx, { actorUserId: req.user!.userId, actorRole: req.user!.role, action: "draw.correction_requested", entity: "draw_correction", entityId: rows[0]!.id,
        detail: { game: game.eventNumber, from: { winning: oldWin, machine: oldMach }, to: { winning: win, machine: mach } }, note: p.data.reason });
      return rows;
    });
    await notifyRole(["director"], req.user!.userId, `Draw correction to approve — ${game.name} #${game.eventNumber}`,
      `Winning ${oldWin} → ${win}; machine ${oldMach} → ${mach}. Reason: ${p.data.reason}. Approve or reject it in Run Draws › Draw Histories.`);
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "This draw already has a correction waiting for approval or for its re-run" });
  }
});

const decideSchema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional().nullable() });

/**
 * The director decides. Approval, in one transaction: the draw's unclaimed
 * payouts are removed and its tickets returned to active (both written into
 * the correction, and each ticket's trail), its result row is cleared, and
 * its numbers become the corrected ones. The next run of the draw - which
 * must use these numbers - settles it again.
 */
router.post("/draw-corrections/:id/decide", requireAuth, requireRole("director"), async (req, res) => {
  const p = decideSchema.safeParse(req.body);
  if (!p.success || (p.data.decision === "reject" && !p.data.note)) {
    res.status(400).json({ error: "Approve, or reject with a reason" });
    return;
  }
  const id = String(req.params["id"]);
  const outcome = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(drawCorrectionsTable).where(eq(drawCorrectionsTable.id, id)).for("update").limit(1);
    if (!c || c.status !== "pending") return { error: "This correction is not waiting for a decision", status: 409 };
    if (c.requestedBy === req.user!.userId) return { error: "The person who proposed a correction cannot approve it", status: 403 };
    if (p.data.decision === "reject") {
      await tx.update(drawCorrectionsTable).set({ status: "rejected", decidedBy: req.user!.userId, decidedAt: new Date(), decisionNote: p.data.note! })
        .where(eq(drawCorrectionsTable.id, id));
      await audit(tx, { actorUserId: req.user!.userId, actorRole: req.user!.role, action: "draw.correction_rejected", entity: "draw_correction", entityId: id, note: p.data.note ?? null });
      return { correction: c, decision: "reject" as const };
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`draw:${c.gameId}`}))`);
    const blockers = await correctionBlockers(tx, c.gameId);
    if (blockers.length) return { error: `It can no longer be applied: ${blockers.join("; ")}.`, status: 409 };

    const payouts = (await tx.execute(sql`
      SELECT p.id, p.ticket_id, p.payout_amount, p.status FROM payout_requests p
        JOIN game_results gr ON gr.id = p.game_result_id WHERE gr.game_id = ${c.gameId}`)).rows as Array<{ id: string; ticket_id: string; payout_amount: string; status: string }>;
    const settled = (await tx.execute(sql`
      SELECT id, status FROM tickets WHERE game_id = ${c.gameId} AND status IN ('won', 'lost')`)).rows as Array<{ id: string; status: string }>;
    const reversed = {
      payoutsRemoved: payouts.length,
      payoutTotal: payouts.reduce((s, x) => s + Number(x.payout_amount), 0).toFixed(2),
      payouts: payouts.map((x) => ({ ticketId: x.ticket_id, amount: x.payout_amount, status: x.status })),
      ticketsReturned: settled.length,
      winnersReturned: settled.filter((t) => t.status === "won").length,
    };

    if (payouts.length) await tx.execute(sql`DELETE FROM payout_requests WHERE id IN (${sql.join(payouts.map((x) => sql`${x.id}::uuid`), sql`, `)})`);
    if (settled.length) {
      await tx.execute(sql`UPDATE tickets SET status = 'active', is_winner = false, win_amount = 0 WHERE game_id = ${c.gameId} AND status IN ('won', 'lost')`);
      for (let i = 0; i < settled.length; i += 2000) {
        await recordTicketEvents(tx, settled.slice(i, i + 2000).map((t) => ({
          ticketId: t.id, eventType: "settlement_reversed" as const, fromStatus: t.status, toStatus: "active",
          actorUserId: req.user!.userId, actorRole: req.user!.role, source: "admin" as const,
          note: `Draw corrected: winning ${c.oldWinning} → ${c.newWinning}, machine ${c.oldMachine} → ${c.newMachine}. Re-settled on the re-run.`,
        })));
      }
    }
    await tx.execute(sql`DELETE FROM game_results WHERE game_id = ${c.gameId}`);
    await tx.update(gamesTable).set({ winningNumbers: c.newWinning, machineNumbers: c.newMachine, updatedAt: new Date() }).where(eq(gamesTable.id, c.gameId));
    await tx.update(drawCorrectionsTable).set({
      status: "approved", decidedBy: req.user!.userId, decidedAt: new Date(), decisionNote: p.data.note || null, reversed,
    }).where(eq(drawCorrectionsTable.id, id));
    await audit(tx, { actorUserId: req.user!.userId, actorRole: req.user!.role, action: "draw.correction_approved", entity: "draw_correction", entityId: id, detail: reversed, note: p.data.note ?? null });
    return { correction: c, decision: "approve" as const, reversed };
  });
  if ("error" in outcome) {
    res.status(outcome.status ?? 409).json({ error: outcome.error });
    return;
  }
  const [game] = await db.select({ name: gamesTable.name, eventNumber: gamesTable.eventNumber }).from(gamesTable).where(eq(gamesTable.id, outcome.correction.gameId)).limit(1);
  await notifyRole(["administrator"], req.user!.userId,
    `Draw correction ${outcome.decision === "approve" ? "approved" : "rejected"} — ${game?.name ?? ""} #${game?.eventNumber ?? ""}`,
    outcome.decision === "approve"
      ? `The draw is unlocked for one re-run with winning ${outcome.correction.newWinning} and machine ${outcome.correction.newMachine}. Run it from Run Draws, then process payouts and SMS.`
      : `Not approved: ${p.data.note}`);
  res.json({ ok: true, ...(outcome.decision === "approve" ? { reversed: outcome.reversed } : {}) });
});

/** The approved correction waiting for its re-run, if this draw has one. */
export async function approvedCorrection(exec: { select: typeof db.select }, gameId: string) {
  const [c] = await exec.select().from(drawCorrectionsTable)
    .where(and(eq(drawCorrectionsTable.gameId, gameId), eq(drawCorrectionsTable.status, "approved"))).limit(1);
  return c ?? null;
}

export default router;
