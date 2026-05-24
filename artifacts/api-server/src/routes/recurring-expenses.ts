import { Router } from "express";
import { db, recurringExpensesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateRecurringExpenseBody,
  UpdateRecurringExpenseBody,
  UpdateRecurringExpenseParams,
  DeleteRecurringExpenseParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get(
  "/recurring-expenses",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (_req, res) => {
    const categories = await db
      .select()
      .from(recurringExpensesTable)
      .orderBy(recurringExpensesTable.name);
    res.json(categories);
  },
);

router.post(
  "/recurring-expenses",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = CreateRecurringExpenseBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [category] = await db
      .insert(recurringExpensesTable)
      .values(parse.data)
      .returning();
    res.status(201).json(category);
  },
);

router.patch(
  "/recurring-expenses/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = UpdateRecurringExpenseParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = UpdateRecurringExpenseBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [existing] = await db
      .select()
      .from(recurringExpensesTable)
      .where(eq(recurringExpensesTable.id, paramsResult.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Recurring expense not found" });
      return;
    }
    const [category] = await db
      .update(recurringExpensesTable)
      .set({ ...bodyResult.data, updatedAt: new Date() })
      .where(eq(recurringExpensesTable.id, paramsResult.data.id))
      .returning();
    res.json(category);
  },
);

router.delete(
  "/recurring-expenses/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = DeleteRecurringExpenseParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const [existing] = await db
      .select()
      .from(recurringExpensesTable)
      .where(eq(recurringExpensesTable.id, paramsResult.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Recurring expense not found" });
      return;
    }
    await db
      .delete(recurringExpensesTable)
      .where(eq(recurringExpensesTable.id, paramsResult.data.id));
    res.status(204).send();
  },
);

export default router;
