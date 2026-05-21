import { db } from "@workspace/db";
import { notificationsTable, notificationReceiptsTable } from "@workspace/db";

type MessageType =
  | "announcement"
  | "alert"
  | "reminder"
  | "payment_received"
  | "wins_summary"
  | "deficit_alert"
  | "debt_query"
  | "change_request"
  | "change_request_update";

type TargetType = "all" | "all_agents" | "agent" | "writer" | "system";

interface DispatchOptions {
  sentBy: string;
  messageType: MessageType;
  title: string;
  body: string;
  targetType: TargetType;
  targetId?: string;
  recipientUserIds: string[];
}

export async function dispatchSystemNotification(
  opts: DispatchOptions,
): Promise<void> {
  if (opts.recipientUserIds.length === 0) return;

  const [notification] = await db
    .insert(notificationsTable)
    .values({
      sentBy: opts.sentBy,
      messageType: opts.messageType,
      title: opts.title,
      body: opts.body,
      targetType: opts.targetType,
      targetId: opts.targetId,
    })
    .returning();

  if (!notification) return;

  await db.insert(notificationReceiptsTable).values(
    opts.recipientUserIds.map((uid) => ({
      notificationId: notification.id,
      userId: uid,
    })),
  );
}
