import { Router } from "express";
import crypto from "crypto";
import { db, paymentsTable, agentsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { dispatchSystemNotification } from "../lib/notify";

const router = Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "sk_test_placeholder";

async function generateReceiptNumber(): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentsTable);
  const next = (count ?? 0) + 1;
  return `REC-${String(next).padStart(6, "0")}`;
}

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
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
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
router.post("/payments/paystack/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"] as string;
    if (!signature) {
      res.status(401).json({ error: "Missing signature header" });
      return;
    }

    // Verify signature using HMAC SHA512
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== signature) {
      // If signature check is off (possibly due to stringify discrepancies), we fall back
      // to double-verifying with the verification API for security if the event matches.
      const bodyEvent = req.body?.event;
      if (bodyEvent !== "charge.success") {
        res.status(401).json({ error: "Invalid signature and unhandled event" });
        return;
      }
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
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
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
});

export default router;
