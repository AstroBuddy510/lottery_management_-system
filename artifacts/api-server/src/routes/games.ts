import { Router } from "express";
import { db, gamesTable, dailyCalculationsTable } from "@workspace/db";
import { eq, lt, and, not, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

async function generateEventNumber(): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gamesTable)
    .where(sql`date(created_at at time zone 'utc') = current_date`);
  const next = (count ?? 0) + 1;
  return `VS-EVT-${dateStr}-${String(next).padStart(4, "0")}`;
}

async function autoClosePastGames(): Promise<void> {
  await db
    .update(gamesTable)
    .set({ status: "closed", updatedAt: new Date() })
    .where(and(lt(gamesTable.closeAt, new Date()), not(eq(gamesTable.status, "closed"))));
}

router.get("/games", requireAuth, async (req, res) => {
  await autoClosePastGames();
  const games = await db
    .select()
    .from(gamesTable)
    .orderBy(gamesTable.createdAt);

  const calculations = await db
    .select({ gameId: dailyCalculationsTable.gameId })
    .from(dailyCalculationsTable)
    .groupBy(dailyCalculationsTable.gameId);

  const calculatedGameIds = new Set(
    calculations.map((c) => c.gameId).filter(Boolean)
  );

  const gamesWithStatus = games.map((g) => ({
    ...g,
    calculationsRun: calculatedGameIds.has(g.id),
  }));

  res.json(gamesWithStatus);
});

router.post(
  "/games",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { name, description, logoUrl, goLiveAt, closeAt } = req.body as {
      name: string;
      description?: string;
      logoUrl?: string;
      goLiveAt: string;
      closeAt: string;
    };

    if (!name || !goLiveAt || !closeAt) {
      res.status(400).json({ error: "name, goLiveAt, and closeAt are required" });
      return;
    }

    const goLiveDate = new Date(goLiveAt);
    const closeDate = new Date(closeAt);

    if (isNaN(goLiveDate.getTime()) || isNaN(closeDate.getTime())) {
      res.status(400).json({ error: "Invalid date format" });
      return;
    }
    if (closeDate <= goLiveDate) {
      res.status(400).json({ error: "closeAt must be after goLiveAt" });
      return;
    }

    const eventNumber = await generateEventNumber();

    const [game] = await db
      .insert(gamesTable)
      .values({
        eventNumber,
        name,
        description: description ?? null,
        logoUrl: logoUrl ?? null,
        goLiveAt: goLiveDate,
        closeAt: closeDate,
        status: "offline",
        createdBy: req.user!.userId,
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
    const id = req.params["id"] as string;
    const { name, description, logoUrl, goLiveAt, closeAt, status } = req.body as {
      name?: string;
      description?: string | null;
      logoUrl?: string | null;
      goLiveAt?: string;
      closeAt?: string;
      status?: "offline" | "live";
    };

    const [existing] = await db
      .select()
      .from(gamesTable)
      .where(eq(gamesTable.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    if (existing.status === "closed") {
      res.status(409).json({ error: "Cannot modify a closed game" });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (logoUrl !== undefined) updates.logoUrl = logoUrl;
    if (goLiveAt !== undefined) updates.goLiveAt = new Date(goLiveAt);
    if (closeAt !== undefined) updates.closeAt = new Date(closeAt);

    if (status !== undefined) {
      if (status === "live") {
        const effectiveClose = closeAt ? new Date(closeAt) : existing.closeAt;
        if (effectiveClose <= new Date()) {
          res.status(409).json({ error: "Cannot go live — close time has already passed" });
          return;
        }
      }
      updates.status = status;
    }

    const [updated] = await db
      .update(gamesTable)
      .set(updates)
      .where(eq(gamesTable.id, id))
      .returning();

    res.json(updated);
  },
);

router.delete(
  "/games/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const id = req.params["id"] as string;
    const [existing] = await db
      .select()
      .from(gamesTable)
      .where(eq(gamesTable.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Game not found" });
      return;
    }

    await db.delete(gamesTable).where(eq(gamesTable.id, id));
    res.status(204).send();
  },
);

export default router;
