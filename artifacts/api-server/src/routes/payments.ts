import { Router } from "express";
import { db, paymentsTable, agentsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import {
  CreatePaymentBody,
  VoidPaymentParams,
  VoidPaymentBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { dispatchSystemNotification } from "../lib/notify";

const router = Router();


async function generateReceiptNumber(): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentsTable);
  const next = (count ?? 0) + 1;
  return `REC-${String(next).padStart(6, "0")}`;
}

router.get(
  "/payments",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const { agentId, dateFrom, dateTo } = req.query as Record<string, string>;
    const conditions = [];
    if (agentId) conditions.push(eq(paymentsTable.agentId, agentId));
    if (dateFrom) conditions.push(gte(paymentsTable.paymentDate, dateFrom));
    if (dateTo) conditions.push(lte(paymentsTable.paymentDate, dateTo));

    const payments = await db
      .select()
      .from(paymentsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(paymentsTable.createdAt));
    res.json(payments);
  },
);

router.post(
  "/payments",
  requireAuth,
  requireRole("cashier", "administrator"),
  async (req, res) => {
    const parse = CreatePaymentBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, parse.data.agentId))
      .limit(1);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const gross = Number(parse.data.grossAmount);
    const expenseTotal = (parse.data.expenseItems ?? []).reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
    const netAmount = (gross - expenseTotal).toFixed(2);

    const receiptNumber = await generateReceiptNumber();

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        agentId: parse.data.agentId,
        cashierId: req.user!.userId,
        transactionType: parse.data.transactionType,
        grossAmount: String(gross.toFixed(2)),
        amount: netAmount,
        expenseItems: parse.data.expenseItems ?? [],
        paymentDate: parse.data.paymentDate,
        receiptNumber,
      })
      .returning();

    // Update Agent's outstanding balance and notify
    const [agentRow] = await db
      .select({ userId: agentsTable.userId, outstandingDebt: agentsTable.outstandingDebt })
      .from(agentsTable)
      .where(eq(agentsTable.id, parse.data.agentId))
      .limit(1);

    if (agentRow) {
      const currentDebt = parseFloat(agentRow.outstandingDebt || "0");
      const pmtAmount = parseFloat(netAmount);
      let newDebt = currentDebt;
      if (parse.data.transactionType === "pay_out") {
        newDebt = currentDebt - pmtAmount;
      } else if (parse.data.transactionType === "pay_in") {
        newDebt = currentDebt + pmtAmount;
      }
      const debtSinceVal = newDebt < 0 
        ? (currentDebt >= 0 ? new Date() : undefined) 
        : null;

      await db
        .update(agentsTable)
        .set({
          outstandingDebt: newDebt.toFixed(2),
          debtSince: debtSinceVal,
        })
        .where(eq(agentsTable.id, parse.data.agentId));

      const txLabel =
        parse.data.transactionType === "pay_in" ? "Payment Received" : "Pay-Out Issued";
      const direction =
        parse.data.transactionType === "pay_in"
          ? `GH₵${Number(netAmount).toFixed(2)} has been received from you.`
          : `GH₵${Number(netAmount).toFixed(2)} has been paid out to you.`;
      await dispatchSystemNotification({
        sentBy: req.user!.userId,
        messageType: "payment_received",
        title: `${txLabel} — Receipt ${receiptNumber}`,
        body: `${direction} Gross: GH₵${gross.toFixed(2)}. Date: ${parse.data.paymentDate}.`,
        targetType: "agent",
        targetId: parse.data.agentId,
        recipientUserIds: [agentRow.userId],
      });
    }

    res.status(201).json(payment);
  },
);

router.patch(
  "/payments/:id/void",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = VoidPaymentParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = VoidPaymentBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const [existing] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, paramsResult.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    if (existing.isVoided) {
      res.status(409).json({ error: "Payment already voided" });
      return;
    }

    const [agentRow] = await db
      .select({ outstandingDebt: agentsTable.outstandingDebt })
      .from(agentsTable)
      .where(eq(agentsTable.id, existing.agentId))
      .limit(1);

    if (agentRow) {
      const currentDebt = parseFloat(agentRow.outstandingDebt || "0");
      const pmtAmount = parseFloat(existing.amount);
      let newDebt = currentDebt;
      if (existing.transactionType === "pay_out") {
        newDebt = currentDebt + pmtAmount;
      } else if (existing.transactionType === "pay_in") {
        newDebt = currentDebt - pmtAmount;
      }
      const debtSinceVal = newDebt < 0 
        ? (currentDebt >= 0 ? new Date() : undefined) 
        : null;

      await db
        .update(agentsTable)
        .set({
          outstandingDebt: newDebt.toFixed(2),
          debtSince: debtSinceVal,
        })
        .where(eq(agentsTable.id, existing.agentId));
    }

    const [payment] = await db
      .update(paymentsTable)
      .set({
        isVoided: true,
        voidedBy: req.user!.userId,
        voidedReason: bodyResult.data.reason,
      })
      .where(eq(paymentsTable.id, paramsResult.data.id))
      .returning();
    res.json(payment);
  },
);

export default router;
