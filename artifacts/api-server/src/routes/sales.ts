import { Router } from "express";
import { db, salesLogsTable, writersTable } from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { CreateSaleBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/sales", requireAuth, async (req, res) => {
  const { writerId, dateFrom, dateTo } = req.query as Record<string, string>;
  const conditions = [];
  if (writerId) conditions.push(eq(salesLogsTable.writerId, writerId));
  if (dateFrom) conditions.push(gte(salesLogsTable.saleDate, dateFrom));
  if (dateTo) conditions.push(lte(salesLogsTable.saleDate, dateTo));

  const sales = await db
    .select()
    .from(salesLogsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(salesLogsTable.createdAt));
  res.json(sales);
});

router.post(
  "/sales",
  requireAuth,
  requireRole("agent", "administrator"),
  async (req, res) => {
    const parse = CreateSaleBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [writer] = await db
      .select({ id: writersTable.id })
      .from(writersTable)
      .where(eq(writersTable.id, parse.data.writerId))
      .limit(1);
    if (!writer) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }
    const [sale] = await db
      .insert(salesLogsTable)
      .values({ ...parse.data, loggedBy: req.user!.userId })
      .returning();
    res.status(201).json(sale);
  },
);

export default router;
