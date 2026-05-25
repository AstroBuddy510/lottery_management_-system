import { Router } from "express";
import { db, gameTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/game-templates", requireAuth, async (req, res) => {
  try {
    const templates = await db
      .select()
      .from(gameTemplatesTable)
      .orderBy(gameTemplatesTable.createdAt);
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/game-templates",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { name, dayOfWeek, logoUrl, description, isActive } = req.body as {
      name: string;
      dayOfWeek: number;
      logoUrl?: string;
      description?: string;
      isActive?: boolean;
    };

    if (!name || dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) {
      res.status(400).json({ error: "name and valid dayOfWeek (0-6) are required" });
      return;
    }

    try {
      const [template] = await db
        .insert(gameTemplatesTable)
        .values({
          name,
          dayOfWeek,
          logoUrl: logoUrl ?? null,
          description: description ?? null,
          isActive: isActive ?? true,
        })
        .returning();

      res.status(201).json(template);
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "A template with this name already exists" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

router.put(
  "/game-templates/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const id = req.params["id"] as string;
    const { name, dayOfWeek, logoUrl, description, isActive } = req.body as {
      name?: string;
      dayOfWeek?: number;
      logoUrl?: string | null;
      description?: string | null;
      isActive?: boolean;
    };

    try {
      const [existing] = await db
        .select()
        .from(gameTemplatesTable)
        .where(eq(gameTemplatesTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Template not found" });
        return;
      }

      const updates: Record<string, any> = { updatedAt: new Date() };

      if (name !== undefined) updates.name = name;
      if (dayOfWeek !== undefined) {
        if (dayOfWeek < 0 || dayOfWeek > 6) {
          res.status(400).json({ error: "dayOfWeek must be between 0 and 6" });
          return;
        }
        updates.dayOfWeek = dayOfWeek;
      }
      if (logoUrl !== undefined) updates.logoUrl = logoUrl;
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.isActive = isActive;

      const [updated] = await db
        .update(gameTemplatesTable)
        .set(updates)
        .where(eq(gameTemplatesTable.id, id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "A template with this name already exists" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

router.delete(
  "/game-templates/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const id = req.params["id"] as string;

    try {
      const [existing] = await db
        .select()
        .from(gameTemplatesTable)
        .where(eq(gameTemplatesTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Template not found" });
        return;
      }

      await db.delete(gameTemplatesTable).where(eq(gameTemplatesTable.id, id));
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
