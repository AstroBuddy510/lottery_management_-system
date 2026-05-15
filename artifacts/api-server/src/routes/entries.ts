import { Router } from "express";
import { db, grossEntriesTable, winsEntriesTable } from "@workspace/db";
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

router.get(
  "/entries/gross",
  requireAuth,
  requireRole("director", "administrator", "gross_entry"),
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
  requireRole("gross_entry", "administrator"),
  async (req, res) => {
    const parse = CreateGrossEntryBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
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
  requireRole("gross_entry", "administrator"),
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
  requireRole("director", "administrator", "wins_entry"),
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
  requireRole("wins_entry", "administrator"),
  async (req, res) => {
    const parse = CreateWinsEntryBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
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
  requireRole("wins_entry", "administrator"),
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
    const [entry] = await db
      .update(winsEntriesTable)
      .set({ winsAmount: bodyResult.data.winsAmount })
      .where(eq(winsEntriesTable.id, paramsResult.data.id))
      .returning();
    res.json(entry);
  },
);

export default router;
