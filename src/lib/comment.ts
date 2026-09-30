import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { taskComments, tasks, users } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { notifyTaskParticipants } from "./notification";
import { recordTaskEvent } from "./activity";

async function getTaskAccess(actorId: string, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();
  return { task, access };
}

export async function listTaskComments(actorId: string, taskId: string) {
  await getTaskAccess(actorId, taskId);
  return db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      authorId: taskComments.authorId,
      authorName: users.name,
      content: taskComments.content,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
    })
    .from(taskComments)
    .innerJoin(users, eq(taskComments.authorId, users.id))
    .where(and(eq(taskComments.taskId, taskId), isNull(taskComments.deletedAt)))
    .orderBy(asc(taskComments.createdAt));
}

export async function createTaskComment(actorId: string, taskId: string, content: string) {
  const { task } = await getTaskAccess(actorId, taskId);
  const trimmed = content.trim();
  if (!trimmed) throw new AppError("评论内容不能为空");
  if (trimmed.length > 2000) throw new AppError("评论不能超过 2000 字");

  const comment = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(taskComments)
      .values({ taskId, authorId: actorId, content: trimmed })
      .returning();
    await recordTaskEvent({
      taskId,
      actorId,
      action: "comment_created",
      newValue: { commentId: created.id, content: trimmed },
      tx,
    });
    return created;
  });

  await notifyTaskParticipants({
    taskId,
    actorId,
    title: "任务有新评论",
    content: `有人在任务“${task.title}”下发表了评论`,
    type: "task_commented",
  });
  return comment;
}

export async function updateTaskComment(actorId: string, commentId: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new AppError("评论内容不能为空");
  const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, commentId));
  if (!comment || comment.deletedAt) throw new AppError("评论不存在");
  if (comment.authorId !== actorId) throw new ForbiddenError();
  await getTaskAccess(actorId, comment.taskId);

  const [updated] = await db
    .update(taskComments)
    .set({ content: trimmed, updatedAt: new Date() })
    .where(eq(taskComments.id, commentId))
    .returning();
  await recordTaskEvent({
    taskId: comment.taskId,
    actorId,
    action: "comment_updated",
    oldValue: { commentId, content: comment.content },
    newValue: { commentId, content: trimmed },
  });
  return updated;
}

export async function deleteTaskComment(actorId: string, commentId: string) {
  const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, commentId));
  if (!comment || comment.deletedAt) throw new AppError("评论不存在");
  const { access } = await getTaskAccess(actorId, comment.taskId);
  if (comment.authorId !== actorId && access.role !== "admin" && access.role !== "teacher") {
    throw new ForbiddenError();
  }
  await db
    .update(taskComments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(taskComments.id, commentId));
  await recordTaskEvent({
    taskId: comment.taskId,
    actorId,
    action: "comment_deleted",
    oldValue: { commentId, content: comment.content },
    newValue: { commentId, deleted: true },
  });
}
