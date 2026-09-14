import { Router } from "express";
import { db, betTypesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { MECHANICS, MECHANIC_SPECS, type Mechanic } from "../lib/bet-engine";

const router = Router();

const betTypeSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  description: z.string().optional(),
  mechanic: z.enum(MECHANICS as [Mechanic, ...Mechanic[]]),
  minNumbers: z.number().int().min(0).max(40).optional(),
  maxNumbers: z.number().int().min(0).max(40).optional(),
  payoutMultiplier: z.number().min(1),
  isActive: z.boolean().default(true),
});

/**
 * The mechanic decides how many numbers a selection may hold, so a range that
 * contradicts it would be accepted at creation and then rejected on every
 * bet. Clamp to what the engine will actually allow.
 */
function normalise(data: {
  mechanic: Mechanic;
  minNumbers?: number;
  maxNumbers?: number;
}) {
  const spec = MECHANIC_SPECS[data.mechanic];
  const min = Math.max(data.minNumbers ?? spec.minNumbers, spec.minNumbers);
  const max = Math.min(data.maxNumbers ?? spec.maxNumbers, spec.maxNumbers);
  return {
    minNumbers: Math.min(min, max),
    maxNumbers: Math.max(min, max),
    // Kept in step for anything still reading the old columns.
    numbersRequired: Math.min(min, max),
    isPermutation: data.mechanic === "perm_two" || data.mechanic === "perm_three",
  };
}

const updateBetTypeSchema = betTypeSchema.partial();

router.get("/bet-types/mechanics", requireAuth, async (_req, res) => {
  res.json(
    MECHANICS.map((m) => ({
      mechanic: m,
      ...MECHANIC_SPECS[m],
    })),
  );
});

router.get("/bet-types", requireAuth, async (req, res) => {
  const betTypes = await db.select().from(betTypesTable).orderBy(betTypesTable.createdAt);
  res.json(betTypes);
});

router.post("/bet-types", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const parse = betTypeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid data", details: parse.error.issues });
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
      ...normalise(data),
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
    res.status(400).json({ error: "Invalid data", details: parse.error.issues });
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
  // A partial edit - the active toggle, say - must not silently re-derive the
  // number range from a mechanic that was not sent.
  const mechanic = (data.mechanic ?? existing.mechanic) as Mechanic;
  if (data.mechanic !== undefined || data.minNumbers !== undefined || data.maxNumbers !== undefined) {
    Object.assign(
      updates,
      normalise({
        mechanic,
        minNumbers: data.minNumbers ?? existing.minNumbers,
        maxNumbers: data.maxNumbers ?? existing.maxNumbers,
      }),
    );
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
