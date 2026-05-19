import { Router } from "express";
import { db } from "@workspace/db";
import { gamesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/games", requireAuth, async (req, res) => {
  const games = await db
    .select()
    .from(gamesTable)
    .orderBy(asc(gamesTable.dayOfWeek), asc(gamesTable.name));
  res.json(games);
});

router.post(
  "/games",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { name, dayOfWeek, isActive } = req.body as {
      name: string;
      dayOfWeek?: number | null;
      isActive?: boolean;
    };
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [game] = await db
      .insert(gamesTable)
      .values({
        name,
        dayOfWeek: dayOfWeek != null ? Number(dayOfWeek) : null,
        isActive: isActive ?? true,
      })
      .returning();
    res.status(201).json(game);
  },
);

router.put(
  "/games/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { id } = req.params;
    const { name, dayOfWeek, isActive } = req.body as {
      name?: string;
      dayOfWeek?: number | null;
      isActive?: boolean;
    };
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (dayOfWeek !== undefined)
      updates.dayOfWeek = dayOfWeek != null ? Number(dayOfWeek) : null;
    if (isActive !== undefined) updates.isActive = isActive;
    const [game] = await db
      .update(gamesTable)
      .set(updates)
      .where(eq(gamesTable.id, id))
      .returning();
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    res.json(game);
  },
);

router.delete(
  "/games/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { id } = req.params;
    await db.delete(gamesTable).where(eq(gamesTable.id, id));
    res.status(204).send();
  },
);

export default router;
