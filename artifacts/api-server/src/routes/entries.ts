import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, grossEntriesTable, winsEntriesTable, writersTable, agentsTable, gamesTable, dailyCalculationsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, inArray, sql, not } from "drizzle-orm";
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
    const { writerId, dateFrom, dateTo, gameId } = req.query as Record<string, string>;
    const conditions = [];
    if (dateFrom) conditions.push(gte(grossEntriesTable.entryDate, dateFrom));
    if (dateTo) conditions.push(lte(grossEntriesTable.entryDate, dateTo));
    if (gameId && gameId !== "undefined" && gameId !== "null") conditions.push(eq(grossEntriesTable.gameId, gameId));

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
        conditions.push(eq(grossEntriesTable.writerId, writerId));
      } else {
        conditions.push(inArray(grossEntriesTable.writerId, agentWriterIds));
      }
    } else if (writerId) {
      conditions.push(eq(grossEntriesTable.writerId, writerId));
    }

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

    let gameId = parse.data.gameId;
    if (!gameId && parse.data.entryDate) {
      const [game] = await db
        .select()
        .from(gamesTable)
        .where(
          and(
            not(eq(gamesTable.status, "closed")),
            sql`date(go_live_at at time zone 'utc') = ${parse.data.entryDate}`
          )
        )
        .limit(1);
      if (game) {
        gameId = game.id;
      }
    }

    let isLate = false;
    if (gameId) {
      const [game] = await db
        .select()
        .from(gamesTable)
        .where(eq(gamesTable.id, gameId))
        .limit(1);
      if (game) {
        if (game.status === "closed") {
          res.status(409).json({ error: "Cannot create gross entry: Game is fully locked/closed." });
          return;
        }
        if (new Date(game.closeAt) <= new Date()) {
          isLate = true;
        }
      }
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

      if (!gameId) {
        res.status(400).json({ error: "gameId is required" });
        return;
      }
    }

    const [entry] = await db
      .insert(grossEntriesTable)
      .values({
        ...parse.data,
        gameId: gameId || undefined,
        bookletsCount: parse.data.bookletsCount ?? 0,
        enteredBy: req.user!.userId,
        isLate,
        adminConfirmed: false,
      })
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

    if (existing.gameId) {
      const [game] = await db
        .select()
        .from(gamesTable)
        .where(eq(gamesTable.id, existing.gameId))
        .limit(1);
      if (game && game.status === "closed") {
        res.status(409).json({ error: "Cannot edit gross entry: Game is fully locked/closed." });
        return;
      }
    }

    if (existing.locked) {
      if (req.user!.role !== "administrator" && req.user!.role !== "director") {
        res.status(409).json({ error: "Entry is locked and cannot be modified" });
        return;
      }
      const pin = bodyResult.data.pin;
      if (!pin) {
        res.status(400).json({ error: "Entry is locked. Admin PIN is required to override." });
        return;
      }
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, req.user!.userId))
        .limit(1);
      if (!user || !user.pinHash) {
        res.status(401).json({ error: "Admin account not found or PIN not set." });
        return;
      }
      const valid = await bcrypt.compare(pin, user.pinHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid PIN" });
        return;
      }
    }

    // Agents can only edit entries for their own writers
    if (req.user!.role === "agent") {
      const agentId = await getAgentIdForUser(req.user!.userId);
      if (!agentId || !(await writerBelongsToAgent(existing.writerId, agentId))) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      // Check if game is closed
      if (!existing.gameId) {
        res.status(400).json({ error: "Entry is not associated with a game" });
        return;
      }
      const [game] = await db
        .select()
        .from(gamesTable)
        .where(eq(gamesTable.id, existing.gameId))
        .limit(1);
      if (!game) {
        res.status(404).json({ error: "Game not found" });
        return;
      }
      const isClosed = game.status === "closed" || new Date(game.closeAt) <= new Date();
      if (isClosed) {
        res.status(409).json({ error: "Cannot edit gross entry: Game is closed" });
        return;
      }
    }

    const [entry] = await db
      .update(grossEntriesTable)
      .set({
        grossAmount: bodyResult.data.grossAmount,
        bookletsCount: bodyResult.data.bookletsCount ?? undefined,
      })
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
    const { writerId, dateFrom, dateTo, gameId } = req.query as Record<string, string>;
    const conditions = [];
    if (dateFrom) conditions.push(gte(winsEntriesTable.entryDate, dateFrom));
    if (dateTo) conditions.push(lte(winsEntriesTable.entryDate, dateTo));
    if (gameId && gameId !== "undefined" && gameId !== "null") conditions.push(eq(winsEntriesTable.gameId, gameId));

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
        conditions.push(eq(winsEntriesTable.writerId, writerId));
      } else {
        conditions.push(inArray(winsEntriesTable.writerId, agentWriterIds));
      }
    } else if (writerId) {
      conditions.push(eq(winsEntriesTable.writerId, writerId));
    }

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

    let gameId = parse.data.gameId;
    if (!gameId && parse.data.entryDate) {
      const [game] = await db
        .select()
        .from(gamesTable)
        .where(
          and(
            not(eq(gamesTable.status, "closed")),
            sql`date(go_live_at at time zone 'utc') = ${parse.data.entryDate}`
          )
        )
        .limit(1);
      if (game) {
        gameId = game.id;
      }
    }

    if (gameId) {
      const [game] = await db
        .select()
        .from(gamesTable)
        .where(eq(gamesTable.id, gameId))
        .limit(1);
      if (game && game.status === "closed") {
        res.status(409).json({ error: "Cannot create wins entry: Game is fully locked/closed." });
        return;
      }
    }

    // Check if calculations have run for this game (applies to all roles)
    if (gameId) {
      const calculations = await db
        .select()
        .from(dailyCalculationsTable)
        .where(eq(dailyCalculationsTable.gameId, gameId))
        .limit(1);
      if (calculations.length > 0) {
        // Flag as oversight for approval instead of blocking completely
        const [entry] = await db
          .insert(winsEntriesTable)
          .values({
            ...parse.data,
            gameId: gameId || undefined,
            enteredBy: req.user!.userId,
            oversight: true,
            status: "Request Approval",
          })
          .returning();
        res.status(201).json(entry);
        return;
      }
    }

    const [entry] = await db
      .insert(winsEntriesTable)
      .values({
        ...parse.data,
        gameId: gameId || undefined,
        enteredBy: req.user!.userId,
        oversight: false,
        status: "approved",
      })
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

    if (existing.gameId) {
      const [game] = await db
        .select()
        .from(gamesTable)
        .where(eq(gamesTable.id, existing.gameId))
        .limit(1);
      if (game && game.status === "closed") {
        res.status(409).json({ error: "Cannot edit wins entry: Game is fully locked/closed." });
        return;
      }
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

      // Check if calculations have run for this game
      if (!existing.gameId) {
        res.status(400).json({ error: "Entry is not associated with a game" });
        return;
      }
      const calculations = await db
        .select()
        .from(dailyCalculationsTable)
        .where(eq(dailyCalculationsTable.gameId, existing.gameId))
        .limit(1);
      if (calculations.length > 0) {
        if (!existing.oversight || existing.status !== "Request Approval") {
          res.status(409).json({ error: "Cannot edit wins entry: Calculations have already been run for this game" });
          return;
        }
      }
    }

    const updates: Record<string, any> = {};
    if (bodyResult.data.winsAmount !== undefined) {
      updates.winsAmount = bodyResult.data.winsAmount;
    }
    if (req.user!.role === "director" || req.user!.role === "administrator") {
      if (bodyResult.data.status !== undefined) {
        updates.status = bodyResult.data.status;
      }
      if (bodyResult.data.locked !== undefined) {
        updates.locked = bodyResult.data.locked;
      }
    }

    const [entry] = await db
      .update(winsEntriesTable)
      .set(updates)
      .where(eq(winsEntriesTable.id, paramsResult.data.id))
      .returning();
    res.json(entry);
  },
);

router.post(
  "/entries/gross/:id/confirm",
  requireAuth,
  requireRole("administrator", "director"),
  async (req, res) => {
    const id = String(req.params.id);
    const [existing] = await db
      .select()
      .from(grossEntriesTable)
      .where(eq(grossEntriesTable.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Gross entry not found" });
      return;
    }

    const [updated] = await db
      .update(grossEntriesTable)
      .set({ adminConfirmed: true })
      .where(eq(grossEntriesTable.id, id))
      .returning();

    res.json(updated);
  }
);

export default router;
