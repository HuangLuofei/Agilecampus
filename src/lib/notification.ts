import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, tasks, type NotificationType } from "@/db/schema";
import { AppError } from "./errors";

export async function createNotification(input: {
  userId: string;
  title: string;
  content: string;
  type: NotificationType;
  linkUrl?: string | null;
}) {
  const [notification] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      title: input.title,
      content: input.content,
      type: input.type,
      linkUrl: input.linkUrl ?? null,
    })
    .returning();
  return notification;
}

export async function listNotifications(actorId: string, limit = 40) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, actorId))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function countUnreadNotifications(actorId: string) {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, actorId), eq(notifications.isRead, false)));
  return rows.length;
}

export async function markNotificationRead(actorId: string, notificationId: string) {
  const [updated] = await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, actorId)))
    .returning();
  if (!updated) throw new AppError("通知不存在");
  return updated;
}

export async function markAllNotificationsRead(actorId: string) {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, actorId), eq(notifications.isRead, false)));
}

export async function notifyTaskParticipants(input: {
  taskId: string;
  actorId?: string | null;
  title: string;
  content: string;
  type: NotificationType;
  extraUserIds?: string[];
}) {
  const [task] = await db
    .select({
      projectId: tasks.projectId,
      assigneeId: tasks.assigneeId,
      createdById: tasks.createdById,
    })
    .from(tasks)
    .where(eq(tasks.id, input.taskId));
  if (!task) return;

  const recipients = new Set<string>();
  if (task.assigneeId) recipients.add(task.assigneeId);
  if (task.createdById) recipients.add(task.createdById);
  for (const id of input.extraUserIds ?? []) recipients.add(id);
  if (input.actorId) recipients.delete(input.actorId);

  for (const userId of recipients) {
    await createNotification({
      userId,
      title: input.title,
      content: input.content,
      type: input.type,
      linkUrl: `/projects/${task.projectId}?task=${input.taskId}`,
    });
  }
}
