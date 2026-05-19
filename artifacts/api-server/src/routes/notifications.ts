import { Router } from "express";
import { db } from "@workspace/db";
import {
  notificationsTable,
  notificationReceiptsTable,
  usersTable,
  agentsTable,
} from "@workspace/db";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { SendNotificationBody, MarkNotificationReadParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get(
  "/notifications/unread-count",
  requireAuth,
  async (req, res) => {
    const [result] = await db
      .select({ count: count() })
      .from(notificationReceiptsTable)
      .where(
        and(
          eq(notificationReceiptsTable.userId, req.user!.userId),
          isNull(notificationReceiptsTable.readAt),
        ),
      );
    res.json({ count: Number(result?.count ?? 0) });
  },
);

router.get("/notifications", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const notifications = await db
    .select({
      id: notificationsTable.id,
      messageType: notificationsTable.messageType,
      title: notificationsTable.title,
      body: notificationsTable.body,
      targetType: notificationsTable.targetType,
      targetId: notificationsTable.targetId,
      createdAt: notificationsTable.createdAt,
      sentBy: notificationsTable.sentBy,
      readAt: notificationReceiptsTable.readAt,
    })
    .from(notificationReceiptsTable)
    .innerJoin(
      notificationsTable,
      eq(notificationReceiptsTable.notificationId, notificationsTable.id),
    )
    .where(eq(notificationReceiptsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt));
  res.json(notifications);
});

router.post(
  "/notifications",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = SendNotificationBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { messageType, title, body, targetType, targetId } = parse.data;

    const [notification] = await db
      .insert(notificationsTable)
      .values({ sentBy: req.user!.userId, messageType, title, body, targetType, targetId })
      .returning();

    let recipientIds: string[] = [];
    if (targetType === "all") {
      const users = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.isActive, true));
      recipientIds = users.map((u) => u.id);
    } else if (targetType === "all_agents") {
      const agents = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.isActive, true));
      recipientIds = agents.map((a) => a.userId);
    } else if (targetType === "agent" && targetId) {
      const [agent] = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.id, targetId))
        .limit(1);
      if (agent) recipientIds = [agent.userId];
    }

    if (recipientIds.length > 0) {
      await db.insert(notificationReceiptsTable).values(
        recipientIds.map((uid) => ({
          notificationId: notification!.id,
          userId: uid,
        })),
      );
    }

    res.status(201).json({ ...notification, recipientCount: recipientIds.length });
  },
);

router.patch(
  "/notifications/:id/read",
  requireAuth,
  async (req, res) => {
    const parse = MarkNotificationReadParams.safeParse(req.params);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const [receipt] = await db
      .update(notificationReceiptsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationReceiptsTable.notificationId, parse.data.id),
          eq(notificationReceiptsTable.userId, req.user!.userId),
          isNull(notificationReceiptsTable.readAt),
        ),
      )
      .returning();
    if (!receipt) {
      res.status(404).json({ error: "Notification not found or already read" });
      return;
    }
    res.json({ success: true, readAt: receipt.readAt });
  },
);

export default router;
