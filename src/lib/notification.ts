import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, projects, tasks, users, type NotificationType } from "@/db/schema";
import { AppError } from "./errors";
import { listTeamMembers } from "./team";

export async function createNotification(input: {
  userId: string;
  title: string;
  content: string;
  type: NotificationType;
  linkUrl?: string | null;
  actorId?: string | null;
  projectId?: string | null;
  taskEventId?: string | null;
  isRead?: boolean;
}) {
  const [notification] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      title: input.title,
      content: input.content,
      type: input.type,
      linkUrl: input.linkUrl ?? null,
      actorId: input.actorId ?? null,
      projectId: input.projectId ?? null,
      taskEventId: input.taskEventId ?? null,
      isRead: input.isRead ?? false,
    })
    .returning();
  return notification;
}

export async function listNotifications(actorId: string, limit = 40) {
  return db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      title: notifications.title,
      content: notifications.content,
      type: notifications.type,
      linkUrl: notifications.linkUrl,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt,
      actorId: notifications.actorId,
      projectId: notifications.projectId,
      announcementId: notifications.announcementId,
      actorName: users.name,
      projectName: projects.name,
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorId, users.id))
    .leftJoin(projects, eq(notifications.projectId, projects.id))
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
  // 变更类通知：指向具体某条 task_events 的详情页；不传则回退到项目页锚点
  linkUrl?: string | null;
  taskEventId?: string | null;
  // 变更类通知：让操作者本人也收到（默认排除）。与公告一致，本人那条直接标为已读
  includeActor?: boolean;
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
  if (input.actorId) {
    if (input.includeActor) recipients.add(input.actorId);
    else recipients.delete(input.actorId);
  }

  for (const userId of recipients) {
    try {
      await createNotification({
        userId,
        title: input.title,
        content: input.content,
        type: input.type,
        linkUrl: input.linkUrl ?? `/projects/${task.projectId}?task=${input.taskId}`,
        taskEventId: input.taskEventId ?? null,
        isRead: input.includeActor && userId === input.actorId,
      });
    } catch (e) {
      // 本函数以 fire-and-forget 方式调用，绝不反噬主业务：任务/事件可能已被并发删除
      console.error("[notify] 站内通知写入失败", e);
    }
  }
}

// 团队/项目级广播（文档变更、资源登记等）：发给团队全员。与公告一致，操作者本人那条直接标为已读。
// 同样以 fire-and-forget 调用，内部吞异常。
export async function notifyTeamMembers(input: {
  teamId: string;
  actorId?: string | null;
  title: string;
  content: string;
  type: NotificationType;
  linkUrl: string;
  projectId?: string | null;
}) {
  const members = await listTeamMembers(input.teamId);
  for (const m of members) {
    try {
      await createNotification({
        userId: m.id,
        title: input.title,
        content: input.content,
        type: input.type,
        linkUrl: input.linkUrl,
        actorId: input.actorId ?? null,
        projectId: input.projectId ?? null,
        isRead: m.id === input.actorId,
      });
    } catch (e) {
      console.error("[notify] 站内通知写入失败", e);
    }
  }
}
