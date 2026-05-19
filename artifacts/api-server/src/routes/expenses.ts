import { Router } from "express";
import { db, expenseCategoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateExpenseCategoryBody,
  UpdateExpenseCategoryBody,
  UpdateExpenseCategoryParams,
  DeleteExpenseCategoryParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get(
  "/expenses",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (_req, res) => {
    const categories = await db
      .select()
      .from(expenseCategoriesTable)
      .orderBy(expenseCategoriesTable.name);
    res.json(categories);
  },
);

router.post(
  "/expenses",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = CreateExpenseCategoryBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [category] = await db
      .insert(expenseCategoriesTable)
      .values(parse.data)
      .returning();
    res.status(201).json(category);
  },
);

router.patch(
  "/expenses/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = UpdateExpenseCategoryParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = UpdateExpenseCategoryBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [existing] = await db
      .select()
      .from(expenseCategoriesTable)
      .where(eq(expenseCategoriesTable.id, paramsResult.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Expense category not found" });
      return;
    }
    const [category] = await db
      .update(expenseCategoriesTable)
      .set({ ...bodyResult.data, updatedAt: new Date() })
      .where(eq(expenseCategoriesTable.id, paramsResult.data.id))
      .returning();
    res.json(category);
  },
);

router.delete(
  "/expenses/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = DeleteExpenseCategoryParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const [existing] = await db
      .select()
      .from(expenseCategoriesTable)
      .where(eq(expenseCategoriesTable.id, paramsResult.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Expense category not found" });
      return;
    }
    await db
      .delete(expenseCategoriesTable)
      .where(eq(expenseCategoriesTable.id, paramsResult.data.id));
    res.status(204).send();
  },
);

export default router;
