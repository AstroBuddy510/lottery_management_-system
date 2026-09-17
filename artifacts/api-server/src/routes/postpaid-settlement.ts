import { Router } from "express";
import crypto from "crypto";
import { db, postpaidDailyLedgerTable, writersTable, gamesTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { quoteDueLedgers, currentWriterCommissionPct } from "../lib/postpaid";
import { dispatchSystemNotification } from "../lib/notify";
import { logger } from "../lib/logger";

const router = Router();

const PAYSTACK_SECRET_KEY = process.env["PAYSTACK_SECRET_KEY"] || "";

router.get("/postpaid/ledger", requireAuth, requireRole("director", "administrator", "cashier", "writer"), async (req, res) => {
  const writerId = req.user!.role === "writer" ? req.user!.userId : (req.query.writerId as string);
  const query = db.select().from(postpaidDailyLedgerTable);
  if (writerId) query.where(eq(postpaidDailyLedgerTable.writerId, writerId));
  
  const ledgers = await query.orderBy(desc(postpaidDailyLedgerTable.ledgerDate)).limit(100);
  res.json(ledgers);
});

/**
 * Everything still owed, for the cashier's desk.
 *
 * Quotes anything newly due first, so a cashier opening this page right after
 * betting shut sees the same figures the writer is looking at. Both `open` and
 * `calculated` are outstanding - `calculated` only means the figure has been
 * worked out, not that the money has arrived.
 */
router.get("/postpaid/outstanding", requireAuth, requireRole("director", "administrator", "cashier"), async (req, res) => {
  await quoteDueLedgers(db);

  const ledgers = await db.select({
    ledger: postpaidDailyLedgerTable,
    writer: {
      fullName: writersTable.fullName,
      fullCode: writersTable.fullCode,
      phone: writersTable.phone,
    },
    game: {
      name: gamesTable.name,
      eventNumber: gamesTable.eventNumber,
      status: gamesTable.status,
      closeAt: gamesTable.closeAt,
    },
  })
  .from(postpaidDailyLedgerTable)
  .leftJoin(writersTable, eq(postpaidDailyLedgerTable.writerId, writersTable.id))
  .leftJoin(gamesTable, eq(postpaidDailyLedgerTable.gameId, gamesTable.id))
  .where(sql`${postpaidDailyLedgerTable.settlementStatus} in ('open', 'calculated', 'overdue')`)
  .orderBy(desc(postpaidDailyLedgerTable.ledgerDate));

  const totals = ledgers.reduce(
    (acc, r) => ({
      grossSales: acc.grossSales + Number(r.ledger.totalStakes),
      commission: acc.commission + Number(r.ledger.commissionAmount),
      payable: acc.payable + Number(r.ledger.amountPayable),
      winsRecorded: acc.winsRecorded + Number(r.ledger.totalWinnings),
    }),
    { grossSales: 0, commission: 0, payable: 0, winsRecorded: 0 },
  );

  res.json({
    ledgers,
    // So the cashier can account for the day without adding up the column:
    // gross sales taken, commission the writers keep, cash she should receive.
    totals: {
      grossSales: totals.grossSales.toFixed(2),
      commission: totals.commission.toFixed(2),
      payable: totals.payable.toFixed(2),
      winsRecorded: totals.winsRecorded.toFixed(2),
    },
  });
});

/**
 * What a postpaid writer owes on a draw whose betting has closed.
 *
 * Gross sales minus their commission. Wins recorded against their sales are
 * reported too, but purely so they can see them - the company pays winners
 * through the agents, so a win never reduces what the writer hands in.
 *
 * Betting closing is the trigger, not the game record flipping to `closed`:
 * that happens when calculations run, which is this writer's deadline and far
 * too late to be telling them what they owe.
 */
router.get("/postpaid/my-settlement", requireAuth, requireRole("writer"), async (req, res) => {
  const writerId = req.user!.userId;
  const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : undefined;

  const [writer] = await db
    .select({ operationModel: writersTable.operationModel, fullName: writersTable.fullName })
    .from(writersTable)
    .where(eq(writersTable.id, writerId))
    .limit(1);

  if (!writer || writer.operationModel !== "postpaid") {
    res.json({ applicable: false, settlements: [] });
    return;
  }

  // Quote anything that has just become due, so the prompt appears the moment
  // betting shuts rather than whenever someone next runs a report.
  await quoteDueLedgers(db, { writerId, ...(gameId ? { gameId } : {}) });

  const conditions = [
    eq(postpaidDailyLedgerTable.writerId, writerId),
    sql`${postpaidDailyLedgerTable.settlementStatus} <> 'settled'`,
    // Betting has shut, however the game record happens to be marked.
    sql`(${gamesTable.closeAt} <= now() or ${gamesTable.status} = 'closed')`,
  ];
  if (gameId) conditions.push(eq(postpaidDailyLedgerTable.gameId, gameId));

  const rows = await db
    .select({
      ledgerId: postpaidDailyLedgerTable.id,
      ledgerDate: postpaidDailyLedgerTable.ledgerDate,
      grossSales: postpaidDailyLedgerTable.totalStakes,
      winsRecorded: postpaidDailyLedgerTable.totalWinnings,
      commissionPct: postpaidDailyLedgerTable.commissionPct,
      commissionAmount: postpaidDailyLedgerTable.commissionAmount,
      amountPayable: postpaidDailyLedgerTable.amountPayable,
      settlementStatus: postpaidDailyLedgerTable.settlementStatus,
      paymentDeclaredAt: postpaidDailyLedgerTable.paymentDeclaredAt,
      paymentDeclaredMethod: postpaidDailyLedgerTable.paymentDeclaredMethod,
      unsettledAtCalculation: postpaidDailyLedgerTable.unsettledAtCalculation,
      gameId: postpaidDailyLedgerTable.gameId,
      gameName: gamesTable.name,
      eventNumber: gamesTable.eventNumber,
      gameStatus: gamesTable.status,
      closeAt: gamesTable.closeAt,
      closedAt: gamesTable.closedAt,
    })
    .from(postpaidDailyLedgerTable)
    .innerJoin(gamesTable, eq(postpaidDailyLedgerTable.gameId, gamesTable.id))
    .where(and(...(conditions as never[])))
    .orderBy(desc(postpaidDailyLedgerTable.ledgerDate));

  const totalPayable = rows.reduce((sum, r) => sum + Number(r.amountPayable), 0);
  const declared = rows.filter((r) => r.paymentDeclaredAt !== null);

  res.json({
    applicable: true,
    writerName: writer.fullName,
    totalPayable: totalPayable.toFixed(2),
    totalGrossSales: rows.reduce((s, r) => s + Number(r.grossSales), 0).toFixed(2),
    totalCommission: rows.reduce((s, r) => s + Number(r.commissionAmount), 0).toFixed(2),
    totalWinsRecorded: rows.reduce((s, r) => s + Number(r.winsRecorded), 0).toFixed(2),
    awaitingConfirmation: declared.length,
    settlements: rows,
  });
});

const declareSchema = z.object({
  method: z.enum(["cash", "momo"]),
});

/**
 * The writer says they are paying.
 *
 * Cash is a declaration, not a settlement: the cashier confirming the money is
 * in hand is what closes the ledger. Mobile money goes to Paystack and settles
 * on its webhook, because there the money moving IS the confirmation.
 */
router.post("/postpaid/pay/:ledgerId", requireAuth, requireRole("writer"), async (req, res) => {
  const ledgerId = req.params["ledgerId"] as string;
  const parse = declareSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Choose cash or mobile money" });
    return;
  }

  const [ledger] = await db
    .select()
    .from(postpaidDailyLedgerTable)
    .where(
      and(
        eq(postpaidDailyLedgerTable.id, ledgerId),
        // A writer may only pay their own account.
        eq(postpaidDailyLedgerTable.writerId, req.user!.userId),
      ),
    )
    .limit(1);

  if (!ledger) {
    res.status(404).json({ error: "Settlement not found" });
    return;
  }
  if (ledger.settlementStatus === "settled") {
    res.status(400).json({ error: "This settlement is already paid" });
    return;
  }
  const payable = Number(ledger.amountPayable);
  if (!(payable > 0)) {
    res.status(400).json({ error: "There is nothing to pay on this draw" });
    return;
  }

  if (parse.data.method === "cash") {
    const [updated] = await db
      .update(postpaidDailyLedgerTable)
      .set({ paymentDeclaredAt: new Date(), paymentDeclaredMethod: "cash" })
      .where(eq(postpaidDailyLedgerTable.id, ledgerId))
      .returning();

    const [writer] = await db
      .select({ fullName: writersTable.fullName, fullCode: writersTable.fullCode })
      .from(writersTable)
      .where(eq(writersTable.id, req.user!.userId))
      .limit(1);

    // Tell the cashiers somebody is on their way with money.
    try {
      const cashiers = await db.execute(
        sql`select id from users where role in ('cashier', 'administrator', 'director') and is_active = true`,
      );
      const ids = (cashiers.rows ?? []).map((r: Record<string, unknown>) => String(r["id"]));
      await dispatchSystemNotification({
        sentBy: req.user!.userId,
        messageType: "payment_received",
        title: "Postpaid settlement declared",
        body: `${writer?.fullName ?? "A writer"} (${writer?.fullCode ?? ""}) is paying GHS ${payable.toFixed(2)} in cash. Confirm receipt on the Postpaid Settlement page.`,
        targetType: "system",
        recipientUserIds: ids,
      });
    } catch (err) {
      // A notification must never cost the writer their declaration.
      logger.error({ err, ledgerId }, "Could not notify cashiers of a declared settlement");
    }

    res.json({
      method: "cash",
      status: "awaiting_confirmation",
      amount: payable.toFixed(2),
      message: "Hand the cash to your cashier. It clears once they confirm receipt.",
      ledger: updated,
    });
    return;
  }

  if (!PAYSTACK_SECRET_KEY) {
    res.status(503).json({ error: "Mobile money is not configured yet. Pay your cashier in cash." });
    return;
  }

  const [writer] = await db
    .select({ phone: writersTable.phone, id: writersTable.id })
    .from(writersTable)
    .where(eq(writersTable.id, req.user!.userId))
    .limit(1);

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: `${writer?.phone ?? req.user!.userId}@vision2000lotto.com`,
      amount: Math.round(payable * 100),
      currency: "GHS",
      channels: ["mobile_money"],
      callback_url: `${req.headers.origin ?? ""}/writer/dashboard?settlement=done`,
      metadata: {
        purpose: "postpaid_settlement",
        ledgerId,
        writerId: req.user!.userId,
      },
    }),
  });

  const data = (await response.json()) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url: string; reference: string };
  };

  if (!response.ok || !data.status || !data.data) {
    res.status(400).json({ error: "Could not start the payment", details: data.message });
    return;
  }

  await db
    .update(postpaidDailyLedgerTable)
    .set({
      paymentDeclaredAt: new Date(),
      paymentDeclaredMethod: "momo",
      settlementReference: data.data.reference,
    })
    .where(eq(postpaidDailyLedgerTable.id, ledgerId));

  res.json({
    method: "momo",
    authorization_url: data.data.authorization_url,
    reference: data.data.reference,
    amount: payable.toFixed(2),
  });
});

/**
 * Paystack confirms a settlement paid by mobile money.
 *
 * Signature checked, then the charge re-verified against Paystack directly - a
 * valid-looking body is not on its own proof that money moved. Only a ledger
 * that is still unsettled moves, so a replayed webhook is a no-op.
 */
router.post("/postpaid/settlement-webhook", async (req, res) => {
  const signature = req.headers["x-paystack-signature"] as string | undefined;
  if (!signature || !PAYSTACK_SECRET_KEY) {
    res.status(401).json({ error: "Unauthorised" });
    return;
  }
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest("hex");
  if (hash !== signature) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const { event, data } = req.body ?? {};
  if (event !== "charge.success" || data?.metadata?.purpose !== "postpaid_settlement") {
    res.status(200).json({ message: "Ignored" });
    return;
  }

  const reference = String(data.reference);
  const verifyRes = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
  );
  const verify = (await verifyRes.json()) as { status?: boolean; data?: { status: string } };
  if (!verifyRes.ok || !verify.status || verify.data?.status !== "success") {
    res.status(400).json({ error: "Verification failed" });
    return;
  }

  const [updated] = await db
    .update(postpaidDailyLedgerTable)
    .set({
      settlementStatus: "settled",
      settlementMethod: "momo",
      settledAt: new Date(),
    })
    .where(
      and(
        eq(postpaidDailyLedgerTable.settlementReference, reference),
        sql`${postpaidDailyLedgerTable.settlementStatus} <> 'settled'`,
      ),
    )
    .returning();

  res.status(200).json({ message: updated ? "Settled" : "Already processed" });
});

/**
 * The cashier confirms the money is in hand.
 *
 * This is the only thing that settles a cash payment. The writer declaring is
 * a heads-up, not a receipt.
 */
router.post(
  "/postpaid/confirm/:ledgerId",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const ledgerId = req.params["ledgerId"] as string;
    const method = typeof req.body?.settlementMethod === "string" ? req.body.settlementMethod : "cash";
    const reference = typeof req.body?.settlementReference === "string" ? req.body.settlementReference : null;

    const [ledger] = await db
      .select()
      .from(postpaidDailyLedgerTable)
      .where(eq(postpaidDailyLedgerTable.id, ledgerId))
      .limit(1);
    if (!ledger) {
      res.status(404).json({ error: "Settlement not found" });
      return;
    }
    if (ledger.settlementStatus === "settled") {
      res.status(400).json({ error: "Already settled" });
      return;
    }

    const [updated] = await db
      .update(postpaidDailyLedgerTable)
      .set({
        settlementStatus: "settled",
        settlementMethod: method,
        settlementReference: reference,
        settledAt: new Date(),
        settledBy: req.user!.userId,
      })
      .where(eq(postpaidDailyLedgerTable.id, ledgerId))
      .returning();

    res.json(updated);
  },
);

export default router;
