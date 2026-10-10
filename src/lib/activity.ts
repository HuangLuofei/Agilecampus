import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  notifications,
  projects,
  taskEventComments,
  taskEvents,
  tasks,
  users,
  type ActorType,
  type TaskEventAction,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";

export async function recordTaskEvent(input: {
  taskId: string;
  action: TaskEventAction;
  actorId?: string | null;
  actorType?: ActorType;
  oldValue?: unknown;
  newValue?: unknown;
  tx?: DbTx;
}) {
  const exec = input.tx ?? db;
  const [event] = await exec
    .insert(taskEvents)
    .values({
      taskId: input.taskId,
      actorType: input.actorType ?? "human",
      actorId: input.actorId ?? null,
      action: input.action,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
    })
    .returning();
  return event;
}

export async function listTaskEvents(actorId: string, taskId: string) {
  const [task] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();

  return db
    .select({
      id: taskEvents.id,
      taskId: taskEvents.taskId,
      actorType: taskEvents.actorType,
      actorId: taskEvents.actorId,
      actorName: users.name,
      action: taskEvents.action,
      oldValue: taskEvents.oldValue,
      newValue: taskEvents.newValue,
      createdAt: taskEvents.createdAt,
    })
    .from(taskEvents)
    .leftJoin(users, eq(taskEvents.actorId, users.id))
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(desc(taskEvents.createdAt));
}

export function taskChangeEvents(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const fields: Array<[string, TaskEventAction]> = [
    ["status", "status_changed"],
    ["assigneeId", "assignee_changed"],
    ["dueDate", "due_date_changed"],
    ["priority", "priority_changed"],
    ["completionNote", "completion_note_changed"],
  ];
  return fields
    .filter(([field]) => before[field] !== after[field])
    .map(([field, action]) => ({
      action,
      oldValue: { [field]: before[field] ?? null },
      newValue: { [field]: after[field] ?? null },
    }));
}

const STATUS_LABEL: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成" };
const PRIORITY_LABEL: Record<string, string> = { low: "低", medium: "中", high: "高" };

export type TaskEventField = { label: string; before: string; after: string };

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "（空）";
  if (typeof value === "boolean") return value ? "是" : "否";
  return truncate(String(value));
}

// 把一条 task_events 翻成人话（actor / 时间由页面另行拼接）。纯函数，便于单测。
export function describeTaskEvent(
  event: { action: TaskEventAction; oldValue: unknown; newValue: unknown },
  assigneeNames: Record<string, string> = {},
): { summary: string; fields: TaskEventField[] } {
  const oldV = (event.oldValue ?? {}) as Record<string, unknown>;
  const newV = (event.newValue ?? {}) as Record<string, unknown>;
  const nameOf = (id: unknown) => (id ? (assigneeNames[String(id)] ?? "某成员") : "未指派");
  const row = (label: string, before: string, after: string): TaskEventField => ({
    label,
    before,
    after,
  });

  switch (event.action) {
    case "created": {
      const fields: TaskEventField[] = [row("任务名称", "（新任务）", displayValue(newV.title))];
      if (newV.assigneeId) fields.push(row("负责人", "未指派", nameOf(newV.assigneeId)));
      if (newV.priority)
        fields.push(
          row("优先级", "（默认）", PRIORITY_LABEL[String(newV.priority)] ?? String(newV.priority)),
        );
      if (newV.dueDate) fields.push(row("截止日期", "（未设置）", displayValue(newV.dueDate)));
      return { summary: "创建了该任务", fields };
    }
    case "status_changed": {
      const before = STATUS_LABEL[String(oldV.status)] ?? displayValue(oldV.status);
      const after = STATUS_LABEL[String(newV.status)] ?? displayValue(newV.status);
      return {
        summary: `将任务状态从「${before}」改为「${after}」`,
        fields: [row("状态", before, after)],
      };
    }
    case "assignee_changed": {
      const before = nameOf(oldV.assigneeId);
      const after = nameOf(newV.assigneeId);
      return { summary: `将负责人从「${before}」改为「${after}」`, fields: [row("负责人", before, after)] };
    }
    case "due_date_changed": {
      const before = displayValue(oldV.dueDate);
      const after = displayValue(newV.dueDate);
      return {
        summary: `将截止日期从「${before}」改为「${after}」`,
        fields: [row("截止日期", before, after)],
      };
    }
    case "priority_changed": {
      const before = PRIORITY_LABEL[String(oldV.priority)] ?? displayValue(oldV.priority);
      const after = PRIORITY_LABEL[String(newV.priority)] ?? displayValue(newV.priority);
      return { summary: `将优先级从「${before}」改为「${after}」`, fields: [row("优先级", before, after)] };
    }
    case "completion_note_changed":
      return {
        summary: "更新了完成情况",
        fields: [row("完成情况", displayValue(oldV.completionNote), displayValue(newV.completionNote))],
      };
    case "comment_created":
      return { summary: "发表了评论", fields: [] };
    case "comment_updated":
      return { summary: "编辑了评论", fields: [] };
    case "comment_deleted":
      return { summary: "删除了评论", fields: [] };
    case "deleted":
      return { summary: "删除了该任务", fields: [] };
    case "updated":
    default: {
      if ("successorIds" in newV || "successorIds" in oldV) {
        return { summary: "调整了任务依赖关系", fields: [] };
      }
      const fields: TaskEventField[] = [];
      if (oldV.title !== newV.title)
        fields.push(row("标题", displayValue(oldV.title), displayValue(newV.title)));
      if (oldV.description !== newV.description)
        fields.push(row("描述", displayValue(oldV.description), displayValue(newV.description)));
      if (oldV.milestoneId !== newV.milestoneId)
        fields.push(row("里程碑", oldV.milestoneId ? "有" : "无", newV.milestoneId ? "有" : "无"));
      if (oldV.startDate !== newV.startDate)
        fields.push(row("开始日期", displayValue(oldV.startDate), displayValue(newV.startDate)));
      return { summary: "更新了任务信息", fields };
    }
  }
}

// 变更事件访问收敛点：取到 event 与其所属任务，并校验访问者为其项目成员
async function requireTaskEventAccess(actorId: string, eventId: string) {
  const [event] = await db.select().from(taskEvents).where(eq(taskEvents.id, eventId));
  if (!event) throw new AppError("变更记录不存在");

  const [task] = await db
    .select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, event.taskId));
  if (!task) throw new AppError("变更记录不存在");

  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();
  return { event, task, access };
}

// 供变更详情页读取：一次取齐 event + 任务标题 + 项目名 + 操作者名（+ 改派时两名负责人）。
export async function getTaskEventForUser(actorId: string, eventId: string) {
  const { event, task } = await requireTaskEventAccess(actorId, eventId);

  let actorName = "未知";
  if (event.actorId) {
    const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, event.actorId));
    actorName = actor?.name ?? "未知";
  } else if (event.actorType === "ai") actorName = "AI 助手";
  else if (event.actorType === "system") actorName = "系统";

  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, task.projectId));

  const oldV = (event.oldValue ?? {}) as Record<string, unknown>;
  const newV = (event.newValue ?? {}) as Record<string, unknown>;
  const ids = new Set<string>();
  for (const v of [oldV.assigneeId, newV.assigneeId]) if (v) ids.add(String(v));
  const assigneeNames: Record<string, string> = {};
  if (ids.size > 0) {
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...ids]));
    for (const r of rows) assigneeNames[r.id] = r.name;
  }

  const { summary, fields } = describeTaskEvent(event, assigneeNames);
  return { event, task, projectName: project?.name ?? "—", actorName, summary, fields };
}

// 打开变更详情页即标读本人那条通知（只动自己的行，幂等；非收件人无命中则 no-op）
export async function markTaskEventNotificationRead(actorId: string, eventId: string) {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.taskEventId, eventId),
        eq(notifications.userId, actorId),
        eq(notifications.isRead, false),
      ),
    );
}

// 变更评论：项目成员皆可（不限该变更的收件人），不记 audit、不发通知
export async function listTaskEventComments(actorId: string, eventId: string) {
  await requireTaskEventAccess(actorId, eventId);
  return db
    .select({
      id: taskEventComments.id,
      eventId: taskEventComments.eventId,
      authorId: taskEventComments.authorId,
      authorName: users.name,
      content: taskEventComments.content,
      createdAt: taskEventComments.createdAt,
      updatedAt: taskEventComments.updatedAt,
    })
    .from(taskEventComments)
    .innerJoin(users, eq(taskEventComments.authorId, users.id))
    .where(and(eq(taskEventComments.eventId, eventId), isNull(taskEventComments.deletedAt)))
    .orderBy(asc(taskEventComments.createdAt));
}

export async function createTaskEventComment(actorId: string, eventId: string, content: string) {
  await requireTaskEventAccess(actorId, eventId);
  const trimmed = content.trim();
  if (!trimmed) throw new AppError("评论内容不能为空");
  if (trimmed.length > 2000) throw new AppError("评论不能超过 2000 字");
  const [created] = await db
    .insert(taskEventComments)
    .values({ eventId, authorId: actorId, content: trimmed })
    .returning();
  return created;
}

export async function updateTaskEventComment(actorId: string, commentId: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new AppError("评论内容不能为空");
  const [comment] = await db
    .select()
    .from(taskEventComments)
    .where(eq(taskEventComments.id, commentId));
  if (!comment || comment.deletedAt) throw new AppError("评论不存在");
  if (comment.authorId !== actorId) throw new ForbiddenError();
  await requireTaskEventAccess(actorId, comment.eventId);

  const [updated] = await db
    .update(taskEventComments)
    .set({ content: trimmed, updatedAt: new Date() })
    .where(eq(taskEventComments.id, commentId))
    .returning();
  return updated;
}

export async function deleteTaskEventComment(actorId: string, commentId: string) {
  const [comment] = await db
    .select()
    .from(taskEventComments)
    .where(eq(taskEventComments.id, commentId));
  if (!comment || comment.deletedAt) throw new AppError("评论不存在");
  const { access } = await requireTaskEventAccess(actorId, comment.eventId);
  if (comment.authorId !== actorId && access.role !== "admin" && access.role !== "teacher") {
    throw new ForbiddenError();
  }
  await db
    .update(taskEventComments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(taskEventComments.id, commentId));
}
