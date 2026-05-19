import { Router } from "express";
import { db, grossEntriesTable, winsEntriesTable, writersTable, agentsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  CreateGrossEntryBody,
  UpdateGrossEntryParams,
  UpdateGrossEntryBody,
  CreateWinsEntryBody,
  UpdateWinsEntryParams,
  UpdateWinsEntryBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

async function getAgentIdForUser(userId: string): Promise<string | null> {
  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId))
    .limit(1);
  return agent?.id ?? null;
}

async function writerBelongsToAgent(writerId: string, agentId: string): Promise<boolean> {
  const [writer] = await db
    .select({ id: writersTable.id })
    .from(writersTable)
    .where(and(eq(writersTable.id, writerId), eq(writersTable.agentId, agentId)))
    .limit(1);
  return !!writer;
}

router.get(
  "/entries/gross",
  requireAuth,
  requireRole("director", "administrator", "gross_entry", "agent"),
  async (req, res) => {
    const { writerId, dateFrom, dateTo } = req.query as Record<string, string>;
    const conditions = [];
    if (writerId) conditions.push(eq(grossEntriesTable.writerId, writerId));
    if (dateFrom) conditions.push(gte(grossEntriesTable.entryDate, dateFrom));
    if (dateTo) conditions.push(lte(grossEntriesTable.entryDate, dateTo));

    const entries = await db
      .select()
      .from(grossEntriesTable)
      .where(conditions.length ? and(...conditions) : undefined);
    res.json(entries);
  },
);

router.post(
  "/entries/gross",
  requireAuth,
  requireRole("gross_entry", "administrator", "director", "agent"),
  async (req, res) => {
    const parse = CreateGrossEntryBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    // Agents can only add entries for their own writers
    if (req.user!.role === "agent") {
      const agentId = await getAgentIdForUser(req.user!.userId);
      if (!agentId) {
        res.status(403).json({ error: "No agent profile found for this user" });
        return;
      }
      const owns = await writerBelongsToAgent(parse.data.writerId, agentId);
      if (!owns) {
        res.status(403).json({ error: "Writer does not belong to your agent account" });
        return;
      }
    }

    const [entry] = await db
      .insert(grossEntriesTable)
      .values({ ...parse.data, enteredBy: req.user!.userId })
      .returning();
    res.status(201).json(entry);
  },
);

router.patch(
  "/entries/gross/:id",
  requireAuth,
  requireRole("gross_entry", "administrator", "director", "agent"),
  async (req, res) => {
    const paramsResult = UpdateGrossEntryParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = UpdateGrossEntryBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [existing] = await db
      .select()
      .from(grossEntriesTable)
      .where(eq(grossEntriesTable.id, paramsResult.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    if (existing.locked) {
      res.status(409).json({ error: "Entry is locked and cannot be modified" });
      return;
    }

    // Agents can only edit entries for their own writers
    if (req.user!.role === "agent") {
      const agentId = await getAgentIdForUser(req.user!.userId);
      if (!agentId || !(await writerBelongsToAgent(existing.writerId, agentId))) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const [entry] = await db
      .update(grossEntriesTable)
      .set({ grossAmount: bodyResult.data.grossAmount })
      .where(eq(grossEntriesTable.id, paramsResult.data.id))
      .returning();
    res.json(entry);
  },
);

router.get(
  "/entries/wins",
  requireAuth,
  requireRole("director", "administrator", "wins_entry", "agent"),
  async (req, res) => {
    const { writerId, dateFrom, dateTo } = req.query as Record<string, string>;
    const conditions = [];
    if (writerId) conditions.push(eq(winsEntriesTable.writerId, writerId));
    if (dateFrom) conditions.push(gte(winsEntriesTable.entryDate, dateFrom));
    if (dateTo) conditions.push(lte(winsEntriesTable.entryDate, dateTo));

    const entries = await db
      .select()
      .from(winsEntriesTable)
      .where(conditions.length ? and(...conditions) : undefined);
    res.json(entries);
  },
);

router.post(
  "/entries/wins",
  requireAuth,
  requireRole("wins_entry", "administrator", "director", "agent"),
  async (req, res) => {
    const parse = CreateWinsEntryBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    // Agents can only add entries for their own writers
    if (req.user!.role === "agent") {
      const agentId = await getAgentIdForUser(req.user!.userId);
      if (!agentId) {
        res.status(403).json({ error: "No agent profile found for this user" });
        return;
      }
      const owns = await writerBelongsToAgent(parse.data.writerId, agentId);
      if (!owns) {
        res.status(403).json({ error: "Writer does not belong to your agent account" });
        return;
      }
    }

    const [entry] = await db
      .insert(winsEntriesTable)
      .values({ ...parse.data, enteredBy: req.user!.userId })
      .returning();
    res.status(201).json(entry);
  },
);

router.patch(
  "/entries/wins/:id",
  requireAuth,
  requireRole("wins_entry", "administrator", "director", "agent"),
  async (req, res) => {
    const paramsResult = UpdateWinsEntryParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = UpdateWinsEntryBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [existing] = await db
      .select()
      .from(winsEntriesTable)
      .where(eq(winsEntriesTable.id, paramsResult.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    if (existing.locked) {
      res.status(409).json({ error: "Entry is locked and cannot be modified" });
      return;
    }

    // Agents can only edit entries for their own writers
    if (req.user!.role === "agent") {
      const agentId = await getAgentIdForUser(req.user!.userId);
      if (!agentId || !(await writerBelongsToAgent(existing.writerId, agentId))) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const [entry] = await db
      .update(winsEntriesTable)
      .set({ winsAmount: bodyResult.data.winsAmount })
      .where(eq(winsEntriesTable.id, paramsResult.data.id))
      .returning();
    res.json(entry);
  },
);

export default router;
