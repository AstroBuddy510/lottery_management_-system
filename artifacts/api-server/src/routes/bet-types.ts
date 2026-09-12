import { Router } from "express";
import { db, betTypesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

const betTypeSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  description: z.string().optional(),
  numbersRequired: z.number().int().min(1).max(5),
  payoutMultiplier: z.number().min(1),
  isPermutation: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const updateBetTypeSchema = betTypeSchema.partial();

router.get("/bet-types", requireAuth, async (req, res) => {
  const betTypes = await db.select().from(betTypesTable).orderBy(betTypesTable.createdAt);
  res.json(betTypes);
});

router.post("/bet-types", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const parse = betTypeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid data", details: parse.error.errors });
    return;
  }
  const data = parse.data;
  
  const existing = await db.select().from(betTypesTable).where(eq(betTypesTable.code, data.code)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Bet type with this code already exists" });
    return;
  }

  const [created] = await db
    .insert(betTypesTable)
    .values({
      ...data,
      payoutMultiplier: data.payoutMultiplier.toString(),
      updatedBy: req.user!.userId,
    })
    .returning();

  res.status(201).json(created);
});

router.put("/bet-types/:id", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const id = req.params["id"] as string;
  const parse = updateBetTypeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid data", details: parse.error.errors });
    return;
  }
  const data = parse.data;

  const [existing] = await db.select().from(betTypesTable).where(eq(betTypesTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Bet type not found" });
    return;
  }

  const updates: Record<string, any> = { ...data };
  if (data.payoutMultiplier !== undefined) {
    updates.payoutMultiplier = data.payoutMultiplier.toString();
  }
  updates.updatedBy = req.user!.userId;
  updates.updatedAt = new Date();

  const [updated] = await db.update(betTypesTable).set(updates).where(eq(betTypesTable.id, id)).returning();
  res.json(updated);
});

router.delete("/bet-types/:id", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const id = req.params["id"] as string;
  await db.update(betTypesTable).set({ isActive: false }).where(eq(betTypesTable.id, id));
  res.status(204).send();
});

export default router;
