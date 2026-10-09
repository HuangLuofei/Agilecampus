import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, projects, tasks, users, type NotificationType } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { listTeamMembers } from "./team";

export async function createNotification(input: {
  userId: string;
  title: string;
  content: string;
  type: NotificationType;
  linkUrl?: string | null;
  actorId?: string | null;
  projectId?: string | null;
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
    })
    .returning();
  return notification;
}

// 发布公告：项目成员对项目所在团队广播，写明发布者与对应项目（排除发布者本人）
export async function publishAnnouncement(
  actorId: string,
  projectId: string,
  input: { title: string; content: string },
) {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new AppError("公告标题不能为空");
  if (!content) throw new AppError("公告内容不能为空");

  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const members = await listTeamMembers(access.project.teamId);
  for (const m of members) {
    if (m.id === actorId) continue;
    await createNotification({
      userId: m.id,
      title,
      content,
      type: "announcement",
      linkUrl: `/projects/${projectId}`,
      actorId,
      projectId,
    });
  }
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
