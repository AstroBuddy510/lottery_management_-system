import { Router } from "express";
import { db, paymentsTable, cashierTimeWindowsTable, agentsTable } from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  CreatePaymentBody,
  VoidPaymentParams,
  VoidPaymentBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function isWithinTimeWindow(
  windows: Array<{
    dayOfWeek: number | null;
    windowOpen: string;
    windowClose: string;
    isActive: boolean;
  }>,
): boolean {
  const now = new Date();
  const day = now.getDay();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const timeStr = `${hh}:${mm}`;

  const applicable = windows.filter(
    (w) => w.isActive && (w.dayOfWeek === null || w.dayOfWeek === day),
  );
  if (applicable.length === 0) return false;

  return applicable.some(
    (w) =>
      timeStr >= w.windowOpen.slice(0, 5) &&
      timeStr <= w.windowClose.slice(0, 5),
  );
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
    if (req.user!.role === "cashier") {
      const windows = await db.select().from(cashierTimeWindowsTable);
      if (!isWithinTimeWindow(windows)) {
        res.status(403).json({
          error: "Payment collection is outside the allowed time window",
        });
        return;
      }
    }

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

    const [payment] = await db
      .insert(paymentsTable)
      .values({ ...parse.data, cashierId: req.user!.userId })
      .returning();
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
