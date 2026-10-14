import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import type { DbTx } from "@/db";
import {
  labels,
  milestones,
  taskAssignees,
  taskDependencies,
  taskLabels,
  tasks,
  users,
  type TaskPriority,
  type TaskStatus,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getTeamMembership } from "./team";
import { getProjectForUser } from "./project";
import { notifyTaskParticipants } from "./notification";
import { recordTaskEvent, taskChangeEvents } from "./activity";

// 任务写操作角色：admin + student（teacher 只读，设计文档 §5）
const TASK_WRITE_ROLES = ["admin", "student"];

async function requireProjectAccess(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

// 供 lib/label.ts 复用：贴标签属任务写操作，权限口径须与 createTask/updateTask 一致
export async function requireTaskWrite(actorId: string, projectId: string) {
  const access = await requireProjectAccess(actorId, projectId);
  if (!TASK_WRITE_ROLES.includes(access.role)) throw new ForbiddenError();
  return access;
}

async function validateAssignee(teamId: string, assigneeId: string) {
  const membership = await getTeamMembership(assigneeId, teamId);
  if (!membership) throw new AppError("负责人不是团队成员");
}

// 负责人集合规范化：去空值、按传入顺序去重（首位即主负责人）
export function normalizeAssigneeIds(ids?: (string | null | undefined)[] | null): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) if (id && !out.includes(id)) out.push(id);
  return out;
}

async function validateAssignees(teamId: string, ids: string[]) {
  for (const id of ids) await validateAssignee(teamId, id);
}

// 「某任务是否指派给了我」：主负责人字段 ∪ 多负责人关联表。
// 保留主负责人分支是为了兼容关联表启用前的历史行，以及与单值写入路径保持一致。
export function isAssigneeOf(userId: string) {
  return or(
    eq(tasks.assigneeId, userId),
    inArray(
      tasks.id,
      db
        .select({ id: taskAssignees.taskId })
        .from(taskAssignees)
        .where(eq(taskAssignees.userId, userId)),
    ),
  );
}

// 关联表里某任务的负责人 id 列表（按指派顺序，首位为主负责人）
async function currentAssigneeIds(exec: DbTx | typeof db, taskId: string): Promise<string[]> {
  const rows = await exec
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, taskId))
    .orderBy(taskAssignees.position);
  return rows.map((r) => r.userId);
}

// 覆写任务的负责人集合（先删后插）。仅动关联表；tasks.assigneeId 由调用方同步。
export async function setTaskAssignees(
  exec: DbTx | typeof db,
  taskId: string,
  userIds: string[],
) {
  const ids = normalizeAssigneeIds(userIds);
  await exec.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
  if (ids.length > 0) {
    // position 即「第几个被选中」，落库后读回来的顺序才稳定，主负责人 = position 0
    await exec
      .insert(taskAssignees)
      .values(ids.map((userId, i) => ({ taskId, userId, position: i })));
  }
}

// 另发一次查询按 taskId 归并负责人，理由同 labelsByTask：join 会造成行乘积，
// 污染调用方「一行一任务」的假设。
export async function assigneesByTask(
  taskIds: string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const map = new Map<string, { id: string; name: string }[]>();
  if (taskIds.length === 0) return map;

  const rows = await db
    .select({ taskId: taskAssignees.taskId, id: users.id, name: users.name })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(inArray(taskAssignees.taskId, taskIds))
    .orderBy(taskAssignees.taskId, taskAssignees.position);

  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.taskId, list);
  }
  return map;
}

async function validateMilestone(projectId: string, milestoneId: string) {
  const [m] = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId)));
  if (!m) throw new AppError("里程碑不属于该项目");
}

// 父任务须存在且同项目——防跨项目挂载
async function validateParentTask(projectId: string, parentTaskId: string) {
  const [p] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, parentTaskId), eq(tasks.projectId, projectId)));
  if (!p) throw new AppError("父任务不属于该项目");
}

export async function createTask(
  actorId: string,
  projectId: string,
  input: {
    title: string;
    description?: string;
    assigneeId?: string;
    // 多负责人（新）。与 assigneeId 二选一：同时给出时以 assigneeIds 为准。
    assigneeIds?: string[];
    startDate?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
    parentTaskId?: string;
  },
  opts?: { tx?: DbTx; actorType?: "human" | "ai" | "system" },
) {
  const exec = opts?.tx ?? db;
  const access = await requireTaskWrite(actorId, projectId);
  const assigneeIds = normalizeAssigneeIds(
    input.assigneeIds ?? (input.assigneeId ? [input.assigneeId] : []),
  );
  if (assigneeIds.length > 0) await validateAssignees(access.project.teamId, assigneeIds);
  if (input.milestoneId) await validateMilestone(projectId, input.milestoneId);
  if (input.parentTaskId) await validateParentTask(projectId, input.parentTaskId);

  const [task] = await exec
    .insert(tasks)
    .values({
      projectId,
      createdById: actorId,
      title: input.title,
      description: input.description,
      // 主负责人 = 集合首位，保持既有单值读取路径可用
      assigneeId: assigneeIds[0] ?? null,
      startDate: input.startDate,
      dueDate: input.dueDate,
      milestoneId: input.milestoneId,
      parentTaskId: input.parentTaskId,
      priority: input.priority ?? "medium",
      sortOrder: Date.now(),
    })
    .returning();

  await setTaskAssignees(exec, task.id, assigneeIds);

  const createdEvent = await recordTaskEvent({
    taskId: task.id,
    actorId,
    actorType: opts?.actorType,
    action: "created",
    newValue: {
      title: task.title,
      projectId: task.projectId,
      assigneeIds,
      assigneeId: task.assigneeId,
      dueDate: task.dueDate,
      priority: task.priority,
    },
    tx: opts?.tx,
  });

  // 非事务路径：即时站内通知（fire-and-forget，通知内部已吞异常）。
  if (!opts?.tx) {
    void notifyTaskParticipants({
      taskId: task.id,
      actorId,
      title: "新任务已创建",
      content: `任务“${task.title}”已创建`,
      type: assigneeIds.length > 0 ? "task_assigned" : "task_updated",
      linkUrl: `/messages/changes/${createdEvent.id}`,
      taskEventId: createdEvent.id,
    });
  }
  return task;
}

export async function updateTask(
  actorId: string,
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    assigneeId?: string | null;
    // 多负责人（新）。两种写法并存：assigneeIds 优先，assigneeId 视为 [id] / []。
    assigneeIds?: string[] | null;
    startDate?: string | null;
    dueDate?: string | null;
    milestoneId?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    completionNote?: string | null;
  },
  opts?: { tx?: DbTx; actorType?: "human" | "ai" | "system" },
) {
  const exec = opts?.tx ?? db;
  const [task] = await exec.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");

  const access = await requireTaskWrite(actorId, task.projectId);

  // undefined = 本次不动负责人；[] = 清空为未指派
  const assigneePatch =
    patch.assigneeIds !== undefined
      ? normalizeAssigneeIds(patch.assigneeIds)
      : patch.assigneeId !== undefined
        ? normalizeAssigneeIds(patch.assigneeId ? [patch.assigneeId] : [])
        : undefined;
  if (assigneePatch && assigneePatch.length > 0) {
    await validateAssignees(access.project.teamId, assigneePatch);
  }
  if (patch.milestoneId) await validateMilestone(task.projectId, patch.milestoneId);

  const beforeAssigneeIds = assigneePatch !== undefined ? await currentAssigneeIds(exec, taskId) : [];

  // 显式白名单构造，勿用 ...patch 展开：运行时宽对象可夹带 projectId/sortOrder 等越权字段
  const [updated] = await exec
    .update(tasks)
    // updatedAt 取 DB 时钟（now()）而非宿主机 new Date()：与 createdAt 的 defaultNow() 同源，保证单调性
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(assigneePatch !== undefined && { assigneeId: assigneePatch[0] ?? null }),
      ...(patch.startDate !== undefined && { startDate: patch.startDate }),
      ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
      ...(patch.milestoneId !== undefined && { milestoneId: patch.milestoneId }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.completionNote !== undefined && { completionNote: patch.completionNote }),
      updatedAt: sql`now()`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!updated) throw new AppError("任务不存在");

  if (assigneePatch !== undefined) await setTaskAssignees(exec, taskId, assigneePatch);

  const changes = taskChangeEvents(
    {
      status: task.status,
      dueDate: task.dueDate,
      priority: task.priority,
      completionNote: task.completionNote,
    },
    {
      status: updated.status,
      dueDate: updated.dueDate,
      priority: updated.priority,
      completionNote: updated.completionNote,
    },
  );
  // 负责人变更单独记：集合语义下按「排序后是否同集」判定，不能用引用比较
  const sameAssignees =
    assigneePatch === undefined ||
    [...beforeAssigneeIds].sort().join(",") === [...assigneePatch].sort().join(",");
  if (!sameAssignees) {
    changes.unshift({
      action: "assignee_changed" as const,
      oldValue: { assigneeIds: beforeAssigneeIds },
      newValue: { assigneeIds: assigneePatch },
    });
  }

  const eventIds: string[] = [];
  for (const change of changes) {
    const ev = await recordTaskEvent({
      taskId,
      actorId,
      actorType: opts?.actorType,
      action: change.action,
      oldValue: change.oldValue,
      newValue: change.newValue,
      tx: opts?.tx,
    });
    eventIds.push(ev.id);
  }
  if (
    task.title !== updated.title ||
    task.description !== updated.description ||
    task.milestoneId !== updated.milestoneId ||
    task.startDate !== updated.startDate
  ) {
    await recordTaskEvent({
      taskId,
      actorId,
      actorType: opts?.actorType,
      action: "updated",
      oldValue: {
        title: task.title,
        description: task.description,
        milestoneId: task.milestoneId,
        startDate: task.startDate,
      },
      newValue: {
        title: updated.title,
        description: updated.description,
        milestoneId: updated.milestoneId,
        startDate: updated.startDate,
      },
      tx: opts?.tx,
    });
  }

  if (!opts?.tx) {
    if (changes.length > 0) {
      // 一次 update 可能记多条 event，通知链到主事件（changes[0]）
      const primaryEventId = eventIds[0] ?? null;
      void notifyTaskParticipants({
        taskId,
        actorId,
        title: "任务已更新",
        content: `任务“${updated.title}”发生了新的变更`,
        type: patch.status === "done" ? "task_completed" : "task_updated",
        linkUrl: primaryEventId ? `/messages/changes/${primaryEventId}` : null,
        taskEventId: primaryEventId,
        // 操作者本人也进列表（与公告一致，本人那条直接算已读），方便回看/评论自己的变更
        includeActor: true,
      });
    }
  }
  return updated;
}

export async function deleteTask(actorId: string, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, task.projectId);
  await recordTaskEvent({
    taskId,
    actorId,
    action: "deleted",
    oldValue: { title: task.title, projectId: task.projectId },
  });
  await db.delete(tasks).where(eq(tasks.id, taskId));
}

export type TaskLabel = { id: string; name: string; color: string };

// 另发一次查询按 taskId 归并，不用 leftJoin：join 会造成行乘积，
// 污染既有 orderBy(sortOrder) 与调用方「一行一任务」的假设。
async function labelsByTask(taskIds: string[]): Promise<Map<string, TaskLabel[]>> {
  const map = new Map<string, TaskLabel[]>();
  if (taskIds.length === 0) return map;

  const rows = await db
    .select({
      taskId: taskLabels.taskId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(inArray(taskLabels.taskId, taskIds))
    .orderBy(labels.name);

  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.taskId, list);
  }
  return map;
}

export async function listProjectTasks(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      sortOrder: tasks.sortOrder,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      updatedAt: tasks.updatedAt,
      completionNote: tasks.completionNote,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(tasks.sortOrder);

  const byTask = await labelsByTask(rows.map((r) => r.id));
  const byAssignee = await assigneesByTask(rows.map((r) => r.id));
  return rows.map((r) => {
    const assignees = byAssignee.get(r.id) ?? [];
    return {
      ...r,
      labels: byTask.get(r.id) ?? [],
      // assigneeId/assigneeName 为主负责人（既有单值路径的兼容字段），assignees 为完整集合
      assignees,
      assigneeIds: assignees.map((a) => a.id),
    };
  });
}

// 列某任务之下的子任务（直接子级，不递归）
export async function listSubtasks(actorId: string, parentTaskId: string) {
  const [parent] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, parentTaskId));
  if (!parent) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, parent.projectId);

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      completionNote: tasks.completionNote,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.parentTaskId, parentTaskId))
    .orderBy(tasks.sortOrder);

  const byAssignee = await assigneesByTask(rows.map((r) => r.id));
  return rows.map((r) => {
    const assignees = byAssignee.get(r.id) ?? [];
    return { ...r, assignees, assigneeIds: assignees.map((a) => a.id) };
  });
}

// 在某任务下建子任务：projectId 由父任务推得，调用方无须再传。
// 新建行必无既有子级，故不可能成环，无须环检测。
export async function createSubtask(
  actorId: string,
  parentTaskId: string,
  input: {
    title: string;
    description?: string;
    assigneeId?: string;
    assigneeIds?: string[];
    startDate?: string;
    dueDate?: string;
    milestoneId?: string;
    priority?: TaskPriority;
  },
) {
  const [parent] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, parentTaskId));
  if (!parent) throw new AppError("任务不存在");
  return createTask(actorId, parent.projectId, { ...input, parentTaskId });
}

// 单任务详情（供 Agent API 按 id 直取）。权限口径同 listProjectTasks：项目成员即可读。
// 注：「任务不存在」先于权限返回，沿既有 updateTask/deleteTask 之口径（BACKLOG 已录此债）。
export async function getTaskDetail(actorId: string, taskId: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      description: tasks.description,
      completionNote: tasks.completionNote,
      status: tasks.status,
      priority: tasks.priority,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      milestoneId: tasks.milestoneId,
      parentTaskId: tasks.parentTaskId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      updatedAt: tasks.updatedAt,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.id, taskId));
  if (!row) throw new AppError("任务不存在");
  await requireProjectAccess(actorId, row.projectId);
  const byTask = await labelsByTask([row.id]);
  const byAssignee = await assigneesByTask([row.id]);
  const assignees = byAssignee.get(row.id) ?? [];
  return {
    ...row,
    labels: byTask.get(row.id) ?? [],
    assignees,
    assigneeIds: assignees.map((a) => a.id),
  };
}

// 设置 predecessor 的后置任务（先删旧再插新）。简单关联：仅防直接成环，不强制阻断执行。
export async function setTaskSuccessors(
  actorId: string,
  predecessorId: string,
  successorIds: string[],
) {
  const [pred] = await db.select().from(tasks).where(eq(tasks.id, predecessorId));
  if (!pred) throw new AppError("任务不存在");
  await requireTaskWrite(actorId, pred.projectId);

  for (const sid of successorIds) {
    if (sid === predecessorId) throw new AppError("后置任务不可构成循环");
    const [s] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, sid));
    if (!s || s.projectId !== pred.projectId)
      throw new AppError("后置任务不属于该项目");
    const [back] = await db
      .select({ id: taskDependencies.id })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.predecessorId, sid),
          eq(taskDependencies.successorId, predecessorId),
        ),
      );
    if (back) throw new AppError("后置任务不可构成循环");
  }

  await db.transaction(async (tx) => {
    await tx.delete(taskDependencies).where(eq(taskDependencies.predecessorId, predecessorId));
    if (successorIds.length > 0) {
      await tx
        .insert(taskDependencies)
        .values(successorIds.map((sid) => ({ predecessorId, successorId: sid })));
    }
  });
  await recordTaskEvent({
    taskId: predecessorId,
    actorId,
    action: "updated",
    newValue: { successorIds },
  });
}

export async function listProjectDependencies(actorId: string, projectId: string) {
  await requireProjectAccess(actorId, projectId);
  return db
    .select({
      predecessorId: taskDependencies.predecessorId,
      successorId: taskDependencies.successorId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
    .where(eq(tasks.projectId, projectId));
}
