import { Router } from "express";
import { db, winningsContributionsTable, finMoneyAccountsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { syncBooks, audit } from "../lib/finance/books";
import { winningsRegister, winningsSummary } from "../lib/finance/winnings";
import { reserveLedgerTotals, recomputeReserveFund } from "../lib/finance/reserve";

/**
 * Winnings and the reserve: what is owed to winners, what expired, what the
 * reserve holds against it, and the cash people put up to cover a shortfall.
 */

const router = Router();
const MGMT = ["director", "administrator"] as const;
const WITH_CASHIER = ["director", "administrator", "cashier"] as const;

const actorOf = (req: { user?: { userId: string; role: string } }) => ({ actorUserId: req.user?.userId ?? null, actorRole: req.user?.role ?? null });

router.get("/finance/winnings", requireAuth, requireRole(...WITH_CASHIER), async (_req, res) => {
  await syncBooks();
  const [summary, register, contributions] = await Promise.all([
    winningsSummary(),
    winningsRegister(),
    db.execute(sql`
      SELECT c.*, a.name AS account_name, u.full_name AS received_by_name,
             EXISTS (SELECT 1 FROM winnings_contributions r WHERE r.refund_of = c.id) AS refunded,
             p.status AS payout_status, t.ticket_number
        FROM winnings_contributions c
        JOIN fin_money_accounts a ON a.id = c.account_id
        JOIN users u ON u.id = c.received_by
        LEFT JOIN payout_requests p ON p.id = c.payout_request_id
        LEFT JOIN tickets t ON t.id = p.ticket_id
       ORDER BY c.received_at DESC LIMIT 2000`),
  ]);
  res.json({ summary, register, contributions: contributions.rows });
});

const contributionSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^\d{1,9}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Enter an amount above zero, to the pesewa"),
  contributorType: z.enum(["writer", "agent", "staff", "director", "other"]),
  contributorId: z.string().uuid().optional().nullable(),
  contributorName: z.string().trim().min(2).max(160),
  method: z.enum(["cash", "momo", "bank", "transfer"]),
  accountId: z.string().uuid(),
  purpose: z.string().trim().min(5, "Say what the money is for").max(500),
  payoutRequestId: z.string().uuid().optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
});

/**
 * Cash received towards wins the reserve could not cover. Recorded by whoever
 * took the money; it lands in the cash book at once, classified as a
 * contribution - not as income.
 */
router.post("/finance/winnings/contributions", requireAuth, requireRole(...WITH_CASHIER), async (req, res) => {
  const p = contributionSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the contribution" });
    return;
  }
  const [acc] = await db.select().from(finMoneyAccountsTable).where(eq(finMoneyAccountsTable.id, p.data.accountId)).limit(1);
  if (!acc || !acc.isActive) {
    res.status(404).json({ error: "Choose an open money account" });
    return;
  }
  if (req.user!.role === "cashier" && acc.code !== "CASH") {
    res.status(403).json({ error: "A cashier records contributions received in cash" });
    return;
  }
  let gameId: string | null = null;
  if (p.data.payoutRequestId) {
    const r = await db.execute(sql`
      SELECT p.status, gr.game_id FROM payout_requests p JOIN game_results gr ON gr.id = p.game_result_id WHERE p.id = ${p.data.payoutRequestId}`);
    const row = r.rows[0] as { status: string; game_id: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "No such winning ticket" });
      return;
    }
    gameId = row.game_id;
  }
  const [row] = await db.transaction(async (tx) => {
    const rows = await tx.insert(winningsContributionsTable).values({
      amount: Number(p.data.amount).toFixed(2),
      contributorType: p.data.contributorType,
      contributorId: p.data.contributorId || null,
      contributorName: p.data.contributorName,
      method: p.data.method,
      accountId: acc.id,
      purpose: p.data.purpose,
      payoutRequestId: p.data.payoutRequestId || null,
      gameId,
      reference: p.data.reference || null,
      receivedBy: req.user!.userId,
    }).returning();
    await audit(tx, { ...actorOf(req), action: "winnings.contribution_received", entity: "winnings_contribution", entityId: rows[0]!.id, detail: p.data });
    return rows;
  });
  await syncBooks(true);
  res.status(201).json(row);
});

const refundSchema = z.object({ reason: z.string().trim().min(5).max(300) });

/** Give a contribution back. A second row, never an edit. Director only. */
router.post("/finance/winnings/contributions/:id/refund", requireAuth, requireRole("director"), async (req, res) => {
  const p = refundSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Give the reason for the refund" });
    return;
  }
  const id = String(req.params["id"]);
  const [orig] = await db.select().from(winningsContributionsTable).where(eq(winningsContributionsTable.id, id)).limit(1);
  if (!orig || orig.entryType !== "contribution") {
    res.status(404).json({ error: "No such contribution" });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      const [r] = await tx.insert(winningsContributionsTable).values({
        entryType: "refund", refundOf: orig.id, amount: orig.amount, contributorType: orig.contributorType,
        contributorId: orig.contributorId, contributorName: orig.contributorName, method: orig.method,
        accountId: orig.accountId, purpose: p.data.reason, payoutRequestId: orig.payoutRequestId, gameId: orig.gameId,
        reference: orig.reference, receivedBy: req.user!.userId,
      }).returning();
      await audit(tx, { ...actorOf(req), action: "winnings.contribution_refunded", entity: "winnings_contribution", entityId: r!.id, note: p.data.reason });
    });
  } catch {
    res.status(409).json({ error: "This contribution has already been refunded" });
    return;
  }
  await syncBooks(true);
  res.json({ ok: true });
});

/**
 * The reserve's ledger and the checks on it: the month-by-month summary must
 * equal the calculations and draws it is built from, to the pesewa.
 */
router.get("/finance/reserve", requireAuth, requireRole(...MGMT), async (_req, res) => {
  await recomputeReserveFund(db);
  const totals = await reserveLedgerTotals();
  const [months, draws, summary, collected] = await Promise.all([
    db.execute(sql`SELECT period_date, total_contributed, total_allocated, balance FROM reserve_fund ORDER BY period_date DESC`),
    db.execute(sql`
      SELECT a.id, a.allocation_date, a.amount_drawn, a.reason, a.source, a.superseded_at, a.superseded_reason, a.created_at,
             w.full_code AS writer_code, w.full_name AS writer_name, g.name AS game_name, g.event_number
        FROM reserve_allocations a
        JOIN writers w ON w.id = a.writer_id
        LEFT JOIN games g ON g.id = a.game_id
       ORDER BY a.allocation_date DESC, a.created_at DESC LIMIT 3000`),
    db.execute(sql`SELECT coalesce(sum(total_contributed), 0) AS c, coalesce(sum(total_allocated), 0) AS a FROM reserve_fund`),
    db.execute(sql`SELECT coalesce(sum(amount_paid), 0) AS paid, coalesce(sum(amount_due), 0) AS due FROM agent_reserve_receipts`),
  ]);
  const s = summary.rows[0] as { c: string; a: string };
  const col = collected.rows[0] as { paid: string; due: string };
  res.json({
    totals,
    months: months.rows,
    draws: draws.rows,
    checks: {
      summaryContributed: Number(s.c),
      summaryDrawn: Number(s.a),
      contributedAgrees: Math.abs(Number(s.c) - totals.contributed) < 0.005,
      drawnAgrees: Math.abs(Number(s.a) - totals.drawn) < 0.005,
    },
    collectedFromAgencies: Number(col.paid),
  });
});

export default router;
