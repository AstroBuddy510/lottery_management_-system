import { Router, type RequestHandler } from "express";
import { db, paymentsTable, agentsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { dispatchSystemNotification } from "../lib/notify";
import { paystackConfigured, paystackSecret, verifyWebhook } from "../lib/paystack";
import { handlePurchaseWebhook } from "./writer-token-purchases";
import { handleSettlementWebhook } from "./postpaid-settlement";

const router = Router();


async function generateReceiptNumber(): Promise<string> {
  const [result] = await db
    .select({
      maxReceipt: sql<string | null>`max(${paymentsTable.receiptNumber})`
    })
    .from(paymentsTable)
    .where(sql`${paymentsTable.receiptNumber} LIKE 'REC-%'`);

  let next = 1;
  if (result && result.maxReceipt) {
    const numPart = result.maxReceipt.replace("REC-", "");
    const parsed = parseInt(numPart, 10);
    if (!isNaN(parsed)) {
      next = parsed + 1;
    }
  }
  return `REC-${String(next).padStart(6, "0")}`;
}

/**
 * The one URL Paystack is told about.
 *
 * Paystack posts every event for the business to a SINGLE address set in its
 * dashboard. This codebase grew three webhook paths - agent payments, writer
 * e-token purchases and postpaid settlements - and only one of them could ever
 * have been registered. The other two would simply never have fired, and the
 * failure would have been silent: money taken by mobile money, nothing
 * credited, and no error anywhere to explain it.
 *
 * So everything arrives here and is handed to the right handler by the
 * `purpose` recorded in the charge's metadata when it was started. The three
 * original paths still work, which keeps anything already pointed at them
 * going, and each handler checks the signature itself - the check is cheap and
 * a handler should not depend on having been called by a trusted caller.
 */
router.post("/paystack/webhook", async (req, res) => {
  const check = verifyWebhook(req);
  if (!check.ok) {
    res.status(check.status).json({ error: check.reason });
    return;
  }

  const purpose = (req.body as { data?: { metadata?: { purpose?: string } } })?.data?.metadata?.purpose;

  if (purpose === "writer_token_purchase") {
    await handlePurchaseWebhook(req, res, () => {});
    return;
  }
  if (purpose === "postpaid_settlement") {
    await handleSettlementWebhook(req, res, () => {});
    return;
  }
  // Agent payments predate the purpose tag, so they are the default.
  await handleAgentPaymentWebhook(req, res, () => {});
});

/**
 * Is this deployment wired to Paystack?
 *
 * Reports only yes or no and the key's mode - never the key, or any part of
 * it. It exists so an administrator can confirm the environment variable
 * actually reached the running server, which is otherwise only discoverable
 * by attempting a real payment.
 */
router.get(
  "/payments/paystack/status",
  requireAuth,
  requireRole("director", "administrator"),
  (_req, res) => {
    const key = paystackSecret();
    res.json({
      configured: paystackConfigured(),
      mode: key.startsWith("sk_live") ? "live" : key.startsWith("sk_test") ? "test" : "unset",
      // The single address to register in the Paystack dashboard. Everything
      // is dispatched from there by the purpose on the charge.
      webhookUrl: "/api/paystack/webhook",
    });
  },
);

// 1. Initialize Paystack Transaction
router.post(
  "/payments/paystack/initialize",
  requireAuth,
  requireRole("agent"),
  async (req, res) => {
    try {
      const { amount } = req.body;
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        res.status(400).json({ error: "Invalid amount" });
        return;
      }
      // Say so plainly rather than letting Paystack reject a placeholder key
      // and surfacing its error as if the agent had done something wrong.
      if (!paystackConfigured()) {
        res.status(503).json({ error: "Online payments are not configured. Contact your administrator." });
        return;
      }

      const userId = req.user!.userId;
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.userId, userId))
        .limit(1);

      if (!agent) {
        res.status(404).json({ error: "Agent record not found" });
        return;
      }

      // Paystack requires an email. If user email is missing, construct a fallback using phone
      const email = user.email || `${user.phone || userId}@lottery.com`;
      const amountInKobo = Math.round(Number(amount) * 100);

      // Call Paystack API
      const response = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paystackSecret()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: amountInKobo,
          currency: "GHS",
          callback_url: `${req.headers.origin || "http://localhost:22333"}/online-payment?success=true`,
          metadata: {
            agentId: agent.id,
            userId: user.id,
            grossAmount: Number(amount).toFixed(2),
          },
        }),
      });

      const data = await response.json() as any;

      if (!response.ok || !data.status) {
        res.status(400).json({
          error: "Paystack initialization failed",
          details: data.message || "Unknown error",
        });
        return;
      }

      res.json({
        authorization_url: data.data.authorization_url,
        access_code: data.data.access_code,
        reference: data.data.reference,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  }
);

// 2. Webhook for Paystack payment confirmation
export const handleAgentPaymentWebhook: RequestHandler = async (req, res) => {
  try {
    /**
     * The signature decides, and there is no way past it.
     *
     * This used to wave a request through on a failed signature so long as it
     * called itself a charge.success, on the reasoning that re-serialising the
     * body could make a genuine signature fail. That reasoning was sound and
     * the remedy was not: it meant an unsigned request that simply said
     * "charge.success" got the same treatment as a signed one. The real cause
     * is fixed properly now - the raw bytes Paystack signed are kept and
     * checked against - so nothing needs to be let through on trust.
     */
    const check = verifyWebhook(req);
    if (!check.ok) {
      res.status(check.status).json({ error: check.reason });
      return;
    }

    const { event, data } = req.body;
    if (event !== "charge.success" || data.status !== "success") {
      res.status(200).json({ message: "Event ignored" });
      return;
    }

    const reference = data.reference;

    // Secure Verify with Paystack API directly
    const verifyUrl = `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`;
    const verifyResponse = await fetch(verifyUrl, {
      headers: {
        Authorization: `Bearer ${paystackSecret()}`,
      },
    });

    const verifyData = await verifyResponse.json() as any;

    if (!verifyResponse.ok || !verifyData.status || verifyData.data.status !== "success") {
      res.status(400).json({ error: "Transaction verification with Paystack failed" });
      return;
    }

    // Extract metadata
    const metadata = verifyData.data.metadata;
    if (!metadata || !metadata.agentId || !metadata.userId) {
      res.status(400).json({ error: "Missing metadata in transaction" });
      return;
    }

    const agentId = metadata.agentId;
    const userId = metadata.userId;
    const grossAmount = metadata.grossAmount;
    const paidAmount = (verifyData.data.amount / 100).toFixed(2);

    // Check if reference is already processed
    const [existing] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.paystackReference, reference))
      .limit(1);

    if (existing) {
      res.status(200).json({ message: "Payment already recorded" });
      return;
    }

    // Find system administrator to act as cashier
    const [admin] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "administrator"))
      .limit(1);

    const cashierId = admin?.id || userId; // Fallback to user themselves if no admin

    const receiptNumber = await generateReceiptNumber();

    // Insert payment record
    const [newPayment] = await db
      .insert(paymentsTable)
      .values({
        agentId,
        cashierId,
        transactionType: "pay_in",
        grossAmount,
        amount: paidAmount,
        expenseItems: [],
        paymentDate: new Date().toISOString().split("T")[0],
        receiptNumber,
        paymentMethod: "paystack",
        paystackReference: reference,
      })
      .returning();

    // Update Agent's outstanding debt
    const [agentToUpdate] = await db
      .select({ outstandingDebt: agentsTable.outstandingDebt })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1);

    if (agentToUpdate) {
      const currentDebt = parseFloat(agentToUpdate.outstandingDebt || "0");
      const newDebt = currentDebt + parseFloat(paidAmount);
      const debtSinceVal = newDebt < 0 
        ? (currentDebt >= 0 ? new Date() : undefined) 
        : null;
      await db
        .update(agentsTable)
        .set({
          outstandingDebt: newDebt.toFixed(2),
          debtSince: debtSinceVal,
        })
        .where(eq(agentsTable.id, agentId));
    }

    // Dispatch System Notification to Agent
    const [agentRow] = await db
      .select({ userId: agentsTable.userId })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1);

    if (agentRow) {
      await dispatchSystemNotification({
        sentBy: cashierId,
        messageType: "payment_received",
        title: `Online Deposit Successful — Receipt ${receiptNumber}`,
        body: `GH₵${Number(paidAmount).toFixed(2)} has been successfully deposited via Paystack.`,
        targetType: "agent",
        targetId: agentId,
        recipientUserIds: [agentRow.userId],
      });
    }

    res.status(201).json({ status: "success", payment: newPayment });
  } catch (error: any) {
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};

router.post("/payments/paystack/webhook", handleAgentPaymentWebhook);

export default router;
