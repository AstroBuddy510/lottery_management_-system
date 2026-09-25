import { Router, type RequestHandler } from "express";
import {
  db,
  writersTable,
  writerTokenWalletsTable,
  writerTokenTransactionsTable,
  writerTokenPurchasesTable,
  cashierTokenWalletsTable,
  cashierTokenTransactionsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { dispatchSystemNotification } from "../lib/notify";
import { paystackConfigured, paystackSecret, verifyWebhook, verifyCharge } from "../lib/paystack";

const router = Router();


/**
 * Writers buy e-token units with mobile money through Paystack.
 *
 * Paying and crediting are separate steps on purpose. Paystack confirming a
 * charge only marks the request paid; a cashier issues the units. That keeps
 * a person between money arriving and betting credit existing, and records
 * who issued it.
 */

const buySchema = z.object({
  amount: z.number().positive().max(100000),
});

/** Start a purchase: create the request, then hand back Paystack's checkout URL. */
router.post(
  "/writer-tokens/purchase/initialize",
  requireAuth,
  requireRole("writer"),
  async (req, res) => {
    const parse = buySchema.safeParse({ amount: Number(req.body?.amount) });
    if (!parse.success) {
      res.status(400).json({ error: "Enter a valid amount" });
      return;
    }
    const amount = parse.data.amount;

    const [writer] = await db
      .select()
      .from(writersTable)
      .where(eq(writersTable.id, req.user!.userId))
      .limit(1);
    if (!writer || !writer.isActive) {
      res.status(403).json({ error: "Account inactive" });
      return;
    }
    if (writer.operationModel !== "prepaid") {
      res.status(400).json({ error: "Only prepaid accounts buy units" });
      return;
    }
    if (!paystackConfigured()) {
      res.status(503).json({ error: "Payments are not configured. Contact your administrator." });
      return;
    }

    const [purchase] = await db
      .insert(writerTokenPurchasesTable)
      .values({
        writerId: writer.id,
        amount: amount.toFixed(2),
        status: "pending",
        paymentMethod: "momo",
      })
      .returning();

    // Paystack requires an email; writers have phones, so derive a stable one.
    const email = `${writer.phone ?? writer.id}@vision2000lotto.com`;

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100),
        currency: "GHS",
        channels: ["mobile_money"],
        callback_url: `${req.headers.origin ?? ""}/writer/wallet?purchase=done`,
        metadata: {
          purpose: "writer_token_purchase",
          purchaseId: purchase.id,
          writerId: writer.id,
        },
      }),
    });

    const data = (await response.json()) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url: string; reference: string };
    };

    if (!response.ok || !data.status || !data.data) {
      await db
        .update(writerTokenPurchasesTable)
        .set({ status: "failed", notes: data.message ?? "Initialisation failed" })
        .where(eq(writerTokenPurchasesTable.id, purchase.id));
      res.status(400).json({ error: "Could not start payment", details: data.message });
      return;
    }

    await db
      .update(writerTokenPurchasesTable)
      .set({ paystackReference: data.data.reference })
      .where(eq(writerTokenPurchasesTable.id, purchase.id));

    res.json({
      purchaseId: purchase.id,
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    });
  },
);

/**
 * Paystack calls this when a charge succeeds. The signature is verified, and
 * the charge is then re-verified against Paystack directly - a valid-looking
 * body is not on its own proof that money moved.
 */
export const handlePurchaseWebhook: RequestHandler = async (req, res) => {
  const check = verifyWebhook(req);
  if (!check.ok) {
    res.status(check.status).json({ error: check.reason });
    return;
  }

  const { event, data } = req.body ?? {};
  if (event !== "charge.success" || data?.metadata?.purpose !== "writer_token_purchase") {
    res.status(200).json({ message: "Ignored" });
    return;
  }

  const reference = String(data.reference);

  const charge = await verifyCharge(reference);
  if (!charge.ok) {
    res.status(400).json({ error: "Verification failed", reason: charge.reason });
    return;
  }

  // Only a pending request moves to paid, so a replayed webhook is a no-op.
  const [updated] = await db
    .update(writerTokenPurchasesTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(
      and(
        eq(writerTokenPurchasesTable.paystackReference, reference),
        eq(writerTokenPurchasesTable.status, "pending"),
      ),
    )
    .returning();

  if (!updated) {
    res.status(200).json({ message: "Already processed" });
    return;
  }

  const [writer] = await db
    .select({ fullName: writersTable.fullName, fullCode: writersTable.fullCode })
    .from(writersTable)
    .where(eq(writersTable.id, updated.writerId))
    .limit(1);

  // Tell the cashiers there is a paid request waiting to be credited.
  try {
    const staff = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.isActive, true),
          sql`${usersTable.role} in ('cashier', 'administrator', 'director')`,
        ),
      );
    if (staff.length > 0) {
      await dispatchSystemNotification({
        sentBy: staff[0].id,
        messageType: "payment_received",
        title: "Writer unit purchase paid",
        body: `${writer?.fullName ?? "A writer"} (${writer?.fullCode ?? "—"}) paid GH₵${Number(updated.amount).toFixed(2)} for units. Credit them in Payments → Unit Requests.`,
        targetType: "system",
        recipientUserIds: staff.map((u) => u.id),
      });
    }
  } catch {
    // A notification failure must not undo a confirmed payment.
  }

  res.status(200).json({ message: "Recorded" });
};

router.post("/writer-tokens/purchase/webhook", handlePurchaseWebhook);

/** A writer's own purchase history. */
/**
 * Ask to buy units with cash.
 *
 * Nothing is charged here: the writer hands the money to the cashier, who
 * confirms receipt and issues the units in one action. So the request is
 * created "pending" and stays there until a cashier has the cash in hand -
 * which is why, unlike the MoMo path, this needs no payment provider and
 * works when Paystack is not configured at all.
 */
router.post(
  "/writer-tokens/purchase/request-cash",
  requireAuth,
  requireRole("writer"),
  async (req, res) => {
    const parse = buySchema.safeParse({ amount: Number(req.body?.amount) });
    if (!parse.success) {
      res.status(400).json({ error: "Enter a valid amount" });
      return;
    }

    const [writer] = await db
      .select()
      .from(writersTable)
      .where(eq(writersTable.id, req.user!.userId))
      .limit(1);
    if (!writer || !writer.isActive) {
      res.status(403).json({ error: "Account inactive" });
      return;
    }
    if (writer.operationModel !== "prepaid") {
      res.status(400).json({ error: "Only prepaid accounts buy units" });
      return;
    }

    const [purchase] = await db
      .insert(writerTokenPurchasesTable)
      .values({
        writerId: writer.id,
        amount: parse.data.amount.toFixed(2),
        status: "pending",
        paymentMethod: "cash",
      })
      .returning();

    res.status(201).json({
      purchase,
      message: `Pay GHS ${parse.data.amount.toFixed(2)} to your cashier. Your units are added once they confirm the cash.`,
    });
  },
);

router.get("/writer-tokens/purchases", requireAuth, requireRole("writer"), async (req, res) => {
  const rows = await db
    .select()
    .from(writerTokenPurchasesTable)
    .where(eq(writerTokenPurchasesTable.writerId, req.user!.userId))
    .orderBy(desc(writerTokenPurchasesTable.createdAt))
    .limit(50);
  res.json(rows);
});

/** Paid requests awaiting a cashier, newest first. */
router.get(
  "/writer-tokens/purchase-requests",
  requireAuth,
  requireRole("cashier", "administrator", "director"),
  async (req, res) => {
    const status = typeof req.query["status"] === "string" ? req.query["status"] : "paid";
    const rows = await db
      .select({
        id: writerTokenPurchasesTable.id,
        amount: writerTokenPurchasesTable.amount,
        status: writerTokenPurchasesTable.status,
        paymentMethod: writerTokenPurchasesTable.paymentMethod,
        paystackReference: writerTokenPurchasesTable.paystackReference,
        paidAt: writerTokenPurchasesTable.paidAt,
        creditedAt: writerTokenPurchasesTable.creditedAt,
        createdAt: writerTokenPurchasesTable.createdAt,
        writerId: writersTable.id,
        writerName: writersTable.fullName,
        writerCode: writersTable.fullCode,
        writerPhone: writersTable.phone,
      })
      .from(writerTokenPurchasesTable)
      .innerJoin(writersTable, eq(writerTokenPurchasesTable.writerId, writersTable.id))
      // MoMo requests arrive already paid; cash ones sit pending until the
      // cashier has the money, so both belong in the same queue.
      .where(
        status === "paid"
          ? or(
              eq(writerTokenPurchasesTable.status, "paid"),
              and(
                eq(writerTokenPurchasesTable.status, "pending"),
                eq(writerTokenPurchasesTable.paymentMethod, "cash"),
              ),
            )
          : eq(writerTokenPurchasesTable.status, status as "paid"),
      )
      .orderBy(desc(writerTokenPurchasesTable.createdAt))
      .limit(200);
    res.json(rows);
  },
);

/**
 * Issue the units. Only a paid request can be credited, and the status is
 * re-checked inside the UPDATE so two cashiers cannot both credit it.
 */
router.post(
  "/writer-tokens/purchase-requests/:purchaseId/credit",
  requireAuth,
  requireRole("cashier", "administrator", "director"),
  async (req, res) => {
    const purchaseId = req.params["purchaseId"] as string;

    // A MoMo request is claimed from "paid"; a cash one from "pending",
    // because no provider ever confirmed it - the cashier taking the money IS
    // the confirmation. Either way the status is re-checked inside the UPDATE
    // so two cashiers cannot both claim it.
    const now = new Date();
    const [claimed] = await db
      .update(writerTokenPurchasesTable)
      .set({
        status: "credited",
        creditedBy: req.user!.userId,
        creditedAt: now,
        // Cash has no provider timestamp, so the moment the cashier takes it
        // IS when it was paid. A MoMo request already has the real one from
        // the webhook and must keep it.
        paidAt: sql`coalesce(${writerTokenPurchasesTable.paidAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(
        and(
          eq(writerTokenPurchasesTable.id, purchaseId),
          or(
            eq(writerTokenPurchasesTable.status, "paid"),
            and(
              eq(writerTokenPurchasesTable.status, "pending"),
              eq(writerTokenPurchasesTable.paymentMethod, "cash"),
            ),
          ),
        ),
      )
      .returning();

    if (!claimed) {
      const [existing] = await db
        .select({ status: writerTokenPurchasesTable.status })
        .from(writerTokenPurchasesTable)
        .where(eq(writerTokenPurchasesTable.id, purchaseId))
        .limit(1);
      res.status(existing ? 409 : 404).json({
        error: existing ? `Request is already ${existing.status}` : "Request not found",
      });
      return;
    }

    const amount = Number(claimed.amount);

    // Units are disbursed from this cashier's float, not created here. If the
    // float cannot cover it the whole credit is rolled back, including the
    // status claim above, so the request stays available to whoever recharges.
    try {
      const out = await db.transaction(async (tx) => {
        const [float] = await tx
          .select()
          .from(cashierTokenWalletsTable)
          .where(eq(cashierTokenWalletsTable.cashierId, req.user!.userId))
          .limit(1);

        const floatBalance = float ? Number(float.balance) : 0;
        if (floatBalance < amount) {
          throw new Error(
            `Your float holds ${floatBalance.toFixed(2)} but this request needs ${amount.toFixed(2)}. Ask an administrator to recharge you.`,
          );
        }

        const newFloat = floatBalance - amount;
        await tx
          .update(cashierTokenWalletsTable)
          .set({
            balance: newFloat.toFixed(2),
            totalDisbursed: (Number(float!.totalDisbursed) + amount).toFixed(2),
          })
          .where(eq(cashierTokenWalletsTable.cashierId, req.user!.userId));

        await tx.insert(cashierTokenTransactionsTable).values({
          cashierId: req.user!.userId,
          transactionType: "disbursement",
          amount: amount.toFixed(2),
          balanceAfter: newFloat.toFixed(2),
          writerId: claimed.writerId,
          purchaseId: claimed.id,
          createdBy: req.user!.userId,
        });

        // Credit the wallet, creating it on a first purchase.
        const [wallet] = await tx
          .select()
          .from(writerTokenWalletsTable)
          .where(eq(writerTokenWalletsTable.writerId, claimed.writerId))
          .limit(1);

        let newBalance: number;
        if (wallet) {
          newBalance = Number(wallet.balance) + amount;
          await tx
            .update(writerTokenWalletsTable)
            .set({
              balance: newBalance.toFixed(2),
              totalPurchased: (Number(wallet.totalPurchased) + amount).toFixed(2),
            })
            .where(eq(writerTokenWalletsTable.writerId, claimed.writerId));
        } else {
          newBalance = amount;
          await tx.insert(writerTokenWalletsTable).values({
            writerId: claimed.writerId,
            balance: newBalance.toFixed(2),
            totalPurchased: amount.toFixed(2),
          });
        }

        const [txn] = await tx
          .insert(writerTokenTransactionsTable)
          .values({
            writerId: claimed.writerId,
            transactionType: "purchase",
            amount: amount.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
            referenceId: claimed.id,
            description: `Unit purchase${claimed.paystackReference ? ` · ${claimed.paystackReference}` : ""}`,
            createdBy: req.user!.userId,
          })
          .returning();

        await tx
          .update(writerTokenPurchasesTable)
          .set({ transactionId: txn.id })
          .where(eq(writerTokenPurchasesTable.id, claimed.id));

        return { txnId: txn.id, balance: newBalance.toFixed(2), float: newFloat.toFixed(2) };
      });

      res.json({
        purchase: { ...claimed, transactionId: out.txnId },
        balance: out.balance,
        floatBalance: out.float,
      });
    } catch (e) {
      // Put the request back so it can be credited once the float is topped up.
      await db
        .update(writerTokenPurchasesTable)
        .set({ status: "paid", creditedBy: null, creditedAt: null })
        .where(eq(writerTokenPurchasesTable.id, claimed.id));
      res.status(409).json({ error: (e as Error).message });
    }
  },
);

export default router;
