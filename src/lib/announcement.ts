import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { announcementComments, announcements, notifications, projects, users } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { listTeamMembers } from "./team";

export type Announcement = typeof announcements.$inferSelect;

async function getAnnouncementAccess(actorId: string, announcementId: string) {
  const [announcement] = await db
    .select()
    .from(announcements)
    .where(eq(announcements.id, announcementId));
  if (!announcement) throw new AppError("公告不存在");
  const access = await getProjectForUser(actorId, announcement.projectId);
  if (!access) throw new ForbiddenError();
  return { announcement, access };
}

// 发布公告：事务内写 1 条 announcements + N 条 notifications（项目所在团队成员，含发布者）。
// 每条通知 linkUrl 指向公告详情页；发布者本人那条直接标为已读。
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

  return db.transaction(async (tx) => {
    const [announcement] = await tx
      .insert(announcements)
      .values({ projectId, authorId: actorId, title, content })
      .returning();

    if (members.length > 0) {
      await tx.insert(notifications).values(
        members.map((m) => ({
          userId: m.id,
          title,
          content,
          type: "announcement" as const,
          linkUrl: `/messages/announcements/${announcement.id}`,
          actorId,
          projectId,
          announcementId: announcement.id,
          isRead: m.id === actorId,
        })),
      );
    }
    return announcement;
  });
}

export async function getAnnouncementForUser(actorId: string, announcementId: string) {
  const { announcement } = await getAnnouncementAccess(actorId, announcementId);

  const [author] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, announcement.authorId));
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, announcement.projectId));

  return {
    announcement,
    authorName: author?.name ?? "未知",
    projectName: project?.name ?? "—",
  };
}

// 评论：项目成员皆可（不限发布时的收件人），不记 audit、不发通知
export async function listAnnouncementComments(actorId: string, announcementId: string) {
  await getAnnouncementAccess(actorId, announcementId);
  return db
    .select({
      id: announcementComments.id,
      announcementId: announcementComments.announcementId,
      authorId: announcementComments.authorId,
      authorName: users.name,
      content: announcementComments.content,
      createdAt: announcementComments.createdAt,
      updatedAt: announcementComments.updatedAt,
    })
    .from(announcementComments)
    .innerJoin(users, eq(announcementComments.authorId, users.id))
    .where(
      and(
        eq(announcementComments.announcementId, announcementId),
        isNull(announcementComments.deletedAt),
      ),
    )
    .orderBy(asc(announcementComments.createdAt));
}

export async function createAnnouncementComment(
  actorId: string,
  announcementId: string,
  content: string,
) {
  await getAnnouncementAccess(actorId, announcementId);
  const trimmed = content.trim();
  if (!trimmed) throw new AppError("评论内容不能为空");
  if (trimmed.length > 2000) throw new AppError("评论不能超过 2000 字");
  const [created] = await db
    .insert(announcementComments)
    .values({ announcementId, authorId: actorId, content: trimmed })
    .returning();
  return created;
}

export async function updateAnnouncementComment(
  actorId: string,
  commentId: string,
  content: string,
) {
  const trimmed = content.trim();
  if (!trimmed) throw new AppError("评论内容不能为空");
  const [comment] = await db
    .select()
    .from(announcementComments)
    .where(eq(announcementComments.id, commentId));
  if (!comment || comment.deletedAt) throw new AppError("评论不存在");
  if (comment.authorId !== actorId) throw new ForbiddenError();
  await getAnnouncementAccess(actorId, comment.announcementId);

  const [updated] = await db
    .update(announcementComments)
    .set({ content: trimmed, updatedAt: new Date() })
    .where(eq(announcementComments.id, commentId))
    .returning();
  return updated;
}

export async function deleteAnnouncementComment(actorId: string, commentId: string) {
  const [comment] = await db
    .select()
    .from(announcementComments)
    .where(eq(announcementComments.id, commentId));
  if (!comment || comment.deletedAt) throw new AppError("评论不存在");
  const { access } = await getAnnouncementAccess(actorId, comment.announcementId);
  if (comment.authorId !== actorId && access.role !== "admin" && access.role !== "teacher") {
    throw new ForbiddenError();
  }
  await db
    .update(announcementComments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(announcementComments.id, commentId));
}

// 打开详情页即标读本人那条通知（只动自己的行，幂等；非收件人无命中则 no-op）
export async function markAnnouncementRead(actorId: string, announcementId: string) {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.announcementId, announcementId),
        eq(notifications.userId, actorId),
        eq(notifications.isRead, false),
      ),
    );
}

// 已读统计：分母=该公告 fan-out 出的通知行数（发布时固定），分子=其中 isRead
export async function getAnnouncementReadStats(actorId: string, announcementId: string) {
  await getAnnouncementAccess(actorId, announcementId);
  const rows = await db
    .select({
      userId: notifications.userId,
      isRead: notifications.isRead,
      name: users.name,
    })
    .from(notifications)
    .innerJoin(users, eq(notifications.userId, users.id))
    .where(eq(notifications.announcementId, announcementId));

  return {
    total: rows.length,
    readCount: rows.filter((r) => r.isRead).length,
    readers: rows.map((r) => ({ userId: r.userId, name: r.name, isRead: r.isRead })),
  };
}
