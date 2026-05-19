import { Router } from "express";
import { db, systemSettingsTable, cashierTimeWindowsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  CreateSettingsBody,
  CreateTimeWindowBody,
  UpdateTimeWindowParams,
  UpdateTimeWindowBody,
  DeleteTimeWindowParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/settings", requireAuth, async (req, res) => {
  const [settings] = await db
    .select()
    .from(systemSettingsTable)
    .orderBy(desc(systemSettingsTable.updatedAt))
    .limit(1);
  if (!settings) {
    res.status(404).json({ error: "No settings configured yet" });
    return;
  }
  res.json(settings);
});

router.post(
  "/settings",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = CreateSettingsBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [settings] = await db
      .insert(systemSettingsTable)
      .values({ ...parse.data, updatedBy: req.user!.userId })
      .returning();
    res.status(201).json(settings);
  },
);

router.get("/settings/time-windows", requireAuth, async (req, res) => {
  const windows = await db.select().from(cashierTimeWindowsTable);
  res.json(windows);
});

router.post(
  "/settings/time-windows",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = CreateTimeWindowBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [window] = await db
      .insert(cashierTimeWindowsTable)
      .values(parse.data)
      .returning();
    res.status(201).json(window);
  },
);

router.patch(
  "/settings/time-windows/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = UpdateTimeWindowParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = UpdateTimeWindowBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (bodyResult.data.windowOpen !== undefined)
      updates.windowOpen = bodyResult.data.windowOpen;
    if (bodyResult.data.windowClose !== undefined)
      updates.windowClose = bodyResult.data.windowClose;
    if (bodyResult.data.isActive !== undefined)
      updates.isActive = bodyResult.data.isActive;
    if (bodyResult.data.dayOfWeek !== undefined)
      updates.dayOfWeek = bodyResult.data.dayOfWeek;

    const [window] = await db
      .update(cashierTimeWindowsTable)
      .set(updates)
      .where(eq(cashierTimeWindowsTable.id, paramsResult.data.id))
      .returning();
    if (!window) {
      res.status(404).json({ error: "Time window not found" });
      return;
    }
    res.json(window);
  },
);

router.delete(
  "/settings/time-windows/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = DeleteTimeWindowParams.safeParse(req.params);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    await db
      .delete(cashierTimeWindowsTable)
      .where(eq(cashierTimeWindowsTable.id, parse.data.id));
    res.json({ success: true });
  },
);

export default router;
