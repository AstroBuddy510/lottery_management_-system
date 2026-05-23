import { Router } from "express";
import { db, paymentsTable, agentsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import {
  CreatePaymentBody,
  VoidPaymentParams,
  VoidPaymentBody,
  RequestPaymentBody,
  ApprovePaymentParams,
  RejectPaymentParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { dispatchSystemNotification } from "../lib/notify";
import { verifyLedgerAndEscalate } from "../lib/accountant";

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
  requireRole("director", "administrator", "cashier", "agent"),
  async (req, res) => {
    const { agentId, dateFrom, dateTo, status } = req.query as Record<string, string>;
    const conditions = [];

    // Role-based gate: agents can only view their own payments
    if (req.user!.role === "agent") {
      const [agentRecord] = await db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(eq(agentsTable.userId, req.user!.userId))
        .limit(1);
      if (!agentRecord) {
        res.status(404).json({ error: "Agent record not found" });
        return;
      }
      conditions.push(eq(paymentsTable.agentId, agentRecord.id));
    } else if (agentId) {
      conditions.push(eq(paymentsTable.agentId, agentId));
    }

    if (dateFrom) conditions.push(gte(paymentsTable.paymentDate, dateFrom));
    if (dateTo) conditions.push(lte(paymentsTable.paymentDate, dateTo));

    if (status) {
      conditions.push(eq(paymentsTable.status, status));
    } else {
      // By default, only show completed (or voided) payments in general lists
      conditions.push(inArray(paymentsTable.status, ["completed", "voided"]));
    }

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

    const [agentRow] = await db
      .select({ userId: agentsTable.userId, outstandingDebt: agentsTable.outstandingDebt, fullCode: agentsTable.fullCode })
      .from(agentsTable)
      .where(eq(agentsTable.id, parse.data.agentId))
      .limit(1);

    if (!agentRow) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const currentDebt = parseFloat(agentRow.outstandingDebt || "0");
    const gross = Number(parse.data.grossAmount);
    const expenseTotal = (parse.data.expenseItems ?? []).reduce(
      (sum, item) => sum + Number(item.amount),
      0,
    );
    const netAmountVal = gross - expenseTotal;
    const netAmount = netAmountVal.toFixed(2);

    // Accountant Validations
    if (parse.data.transactionType === "pay_out") {
      if (currentDebt <= 0) {
        res.status(400).json({ error: `Cannot payout. Company does not owe any money to agent ${agentRow.fullCode} (Outstanding Balance: GH₵ ${currentDebt.toFixed(2)})` });
        return;
      }
      if (netAmountVal > currentDebt) {
        res.status(400).json({ error: `Cannot payout. Payout amount GH₵ ${netAmountVal.toFixed(2)} exceeds what the company owes the agent (GH₵ ${currentDebt.toFixed(2)})` });
        return;
      }
    } else if (parse.data.transactionType === "pay_in") {
      if (currentDebt >= 0) {
        res.status(400).json({ error: `Cannot accept pay-in. Agent ${agentRow.fullCode} does not owe the company any debt (Outstanding Balance: GH₵ ${currentDebt.toFixed(2)})` });
        return;
      }
      const absoluteDebt = Math.abs(currentDebt);
      if (netAmountVal > absoluteDebt) {
        res.status(400).json({ error: `Cannot accept pay-in. Pay-in amount GH₵ ${netAmountVal.toFixed(2)} exceeds what the agent owes the company (GH₵ ${absoluteDebt.toFixed(2)})` });
        return;
      }
    }

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

    // Verify ledger and escalate conflicts
    verifyLedgerAndEscalate(parse.data.agentId, req.user!.userId).catch(console.error);

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

    // Verify ledger and escalate conflicts
    verifyLedgerAndEscalate(payment.agentId, req.user!.userId).catch(console.error);

    res.json(payment);
  },
);

router.post(
  "/payments/request",
  requireAuth,
  requireRole("agent"),
  async (req, res) => {
    const parse = RequestPaymentBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const [agentRecord] = await db
      .select({ id: agentsTable.id, outstandingDebt: agentsTable.outstandingDebt, fullCode: agentsTable.fullCode })
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.userId))
      .limit(1);

    if (!agentRecord) {
      res.status(404).json({ error: "Agent record not found" });
      return;
    }

    const currentDebt = parseFloat(agentRecord.outstandingDebt || "0");
    const amount = Number(parse.data.amount);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: "Amount must be a positive number" });
      return;
    }

    // Accountant Validations for Agent Cash Requests (they are always pay_in)
    if (parse.data.paymentMethod === "cash") {
      if (currentDebt >= 0) {
        res.status(400).json({ error: `Cannot request cash payment. You do not owe the company any debt (Outstanding Balance: GH₵ ${currentDebt.toFixed(2)})` });
        return;
      }
      const absoluteDebt = Math.abs(currentDebt);
      if (amount > absoluteDebt) {
        res.status(400).json({ error: `Cannot request cash payment. Amount GH₵ ${amount.toFixed(2)} exceeds your outstanding debt to the company (GH₵ ${absoluteDebt.toFixed(2)})` });
        return;
      }
    }

    const todayStr = new Date().toISOString().split("T")[0];

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        agentId: agentRecord.id,
        cashierId: null,
        transactionType: "pay_in",
        status: "pending",
        grossAmount: amount.toFixed(2),
        amount: amount.toFixed(2),
        paymentDate: todayStr,
        paymentMethod: parse.data.paymentMethod,
        notes: parse.data.notes ?? null,
      })
      .returning();

    res.status(201).json(payment);
  },
);

router.post(
  "/payments/:id/approve",
  requireAuth,
  requireRole("cashier", "administrator"),
  async (req, res) => {
    const paramsResult = ApprovePaymentParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }

    const [existing] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, paramsResult.data.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Payment request not found" });
      return;
    }

    if (existing.status !== "pending") {
      res.status(400).json({ error: `Payment request is not pending (status: ${existing.status})` });
      return;
    }

    const [agentRow] = await db
      .select({ userId: agentsTable.userId, outstandingDebt: agentsTable.outstandingDebt, fullCode: agentsTable.fullCode })
      .from(agentsTable)
      .where(eq(agentsTable.id, existing.agentId))
      .limit(1);

    if (!agentRow) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const currentDebt = parseFloat(agentRow.outstandingDebt || "0");
    const pmtAmount = parseFloat(existing.amount);

    // Accountant Validations on Approval (they are always pay_in)
    if (existing.transactionType === "pay_in") {
      if (currentDebt >= 0) {
        res.status(400).json({ error: `Cannot approve. Agent ${agentRow.fullCode} does not owe the company any debt (Outstanding Balance: GH₵ ${currentDebt.toFixed(2)})` });
        return;
      }
      const absoluteDebt = Math.abs(currentDebt);
      if (pmtAmount > absoluteDebt) {
        res.status(400).json({ error: `Cannot approve. Pay-in amount GH₵ ${pmtAmount.toFixed(2)} exceeds what the agent owes the company (GH₵ ${absoluteDebt.toFixed(2)})` });
        return;
      }
    }

    const receiptNumber = await generateReceiptNumber();
    const todayStr = new Date().toISOString().split("T")[0];

    // Atomically update balance and mark payment as completed
    const [payment] = await db
      .update(paymentsTable)
      .set({
        status: "completed",
        cashierId: req.user!.userId,
        receiptNumber,
        paymentDate: todayStr,
      })
      .where(eq(paymentsTable.id, paramsResult.data.id))
      .returning();

    const newDebt = currentDebt + pmtAmount; // since it is pay_in
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

    await dispatchSystemNotification({
      sentBy: req.user!.userId,
      messageType: "payment_received",
      title: `Payment Approved — Receipt ${receiptNumber}`,
      body: `Your cash payment request of GH₵${pmtAmount.toFixed(2)} has been approved and collected by cashier.`,
      targetType: "agent",
      targetId: existing.agentId,
      recipientUserIds: [agentRow.userId],
    });

    // Verify ledger and escalate conflicts
    verifyLedgerAndEscalate(existing.agentId, req.user!.userId).catch(console.error);

    res.json(payment);
  },
);

router.post(
  "/payments/:id/reject",
  requireAuth,
  requireRole("cashier", "administrator"),
  async (req, res) => {
    const paramsResult = RejectPaymentParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }

    const [existing] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, paramsResult.data.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Payment request not found" });
      return;
    }

    if (existing.status !== "pending") {
      res.status(400).json({ error: `Payment request is not pending` });
      return;
    }

    const [payment] = await db
      .update(paymentsTable)
      .set({
        status: "rejected",
      })
      .where(eq(paymentsTable.id, paramsResult.data.id))
      .returning();

    res.json(payment);
  },
);

export default router;
