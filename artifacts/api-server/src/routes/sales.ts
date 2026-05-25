import { Router } from "express";
import { db, salesLogsTable, writersTable, agentsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { CreateSaleBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/sales", requireAuth, async (req, res) => {
  const { writerId, dateFrom, dateTo } = req.query as Record<string, string>;
  const conditions = [];
  if (dateFrom) conditions.push(gte(salesLogsTable.saleDate, dateFrom));
  if (dateTo) conditions.push(lte(salesLogsTable.saleDate, dateTo));

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
    const agentWriters = await db
      .select({ id: writersTable.id })
      .from(writersTable)
      .where(eq(writersTable.agentId, agentRecord.id));
    const agentWriterIds = agentWriters.map(w => w.id);
    if (agentWriterIds.length === 0) {
      res.json([]);
      return;
    }
    if (writerId) {
      if (!agentWriterIds.includes(writerId)) {
        res.json([]);
        return;
      }
      conditions.push(eq(salesLogsTable.writerId, writerId));
    } else {
      conditions.push(inArray(salesLogsTable.writerId, agentWriterIds));
    }
  } else if (writerId) {
    conditions.push(eq(salesLogsTable.writerId, writerId));
  }

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
