import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { taskAssignees, tasks, users, projects } from "@/db/schema";
import { sendCardMessage } from "./feishu";
import {
  buildAssignedCard,
  buildCompletedCard,
  buildDueReminderCard,
  type CardTask,
  type ReminderItem,
} from "./feishu-card";

// notify 收的 task 来自 createTask/updateTask 返回 row，含 projectId/priority
type TaskRow = {
  id: string;
  title: string;
  dueDate: string | null;
  assigneeId: string | null;
  // 多负责人：调用方显式传入（createTask/updateTask）；缺省时回退到主负责人
  assigneeIds?: string[];
  projectId: string;
  priority: string;
  completionNote?: string | null;
  createdById?: string | null;
};

// 取用户 open_id（未绑返回 null）
async function openIdOf(userId: string): Promise<string | null> {
  const [row] = await db.select({ openId: users.feishuOpenId }).from(users).where(eq(users.id, userId));
  return row?.openId ?? null;
}

// 负责人 id 列表：优先显式传入的集合，回退主负责人
function assigneeIdListOf(task: TaskRow, explicit?: string[]): string[] {
  if (explicit) return explicit;
  if (task.assigneeIds) return task.assigneeIds;
  return task.assigneeId ? [task.assigneeId] : [];
}

// 补查卡片所需的 项目名 / 负责人名（多负责人以「、」连接）
async function enrich(task: TaskRow, assigneeIds?: string[]): Promise<CardTask> {
  const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, task.projectId));
  const ids = assigneeIdListOf(task, assigneeIds);
  let assigneeName: string | null = null;
  if (ids.length > 0) {
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ids));
    const names = ids.map((id) => rows.find((r) => r.id === id)?.name).filter((n): n is string => !!n);
    assigneeName = names.length > 0 ? names.join("、") : null;
  }
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    projectName: proj?.name ?? "（未知项目）",
    assigneeName,
    dueDate: task.dueDate,
    priority: task.priority,
    completionNote: task.completionNote ?? null,
  };
}

// 统一发送：失败仅记日志，绝不抛（fire-and-forget，通知不得阻断主业务）
async function safeSend(openId: string, card: unknown): Promise<boolean> {
  try {
    await sendCardMessage(openId, card);
    return true;
  } catch (e) {
    console.error("[notify] 飞书发送失败", e);
    return false;
  }
}

// 被指派通知：多负责人各发一封
export async function notifyTaskAssigned(task: TaskRow, assigneeIds?: string[]): Promise<void> {
  const ids = assigneeIdListOf(task, assigneeIds);
  if (ids.length === 0) return;
  const card = await enrich(task, ids);
  for (const userId of ids) {
    const openId = await openIdOf(userId);
    if (openId) await safeSend(openId, buildAssignedCard(card));
  }
}

export async function notifyTaskCompleted(task: TaskRow, actorId: string): Promise<void> {
  const creatorId = task.createdById ?? null;
  if (!creatorId || creatorId === actorId) return;
  const openId = await openIdOf(creatorId);
  if (!openId) return;
  await safeSend(openId, buildCompletedCard(await enrich(task)));
}

// 扫全库临期(明日到期)+逾期(已过期未 done)，按负责人聚合为一封卡片日报。返回发送人数与扫描任务数。
// 多负责人：同一任务会给它的每位已绑飞书的负责人各记一条。
export async function scanAndNotifyDue(): Promise<{ notified: number; tasksScanned: number }> {
  // 临期/逾期：status≠done 且 dueDate ≤ 明日（含逾期）
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .where(
      and(
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        // dueDate <= 明日（date 列与 CURRENT_DATE 比较）
        sql`${tasks.dueDate} <= CURRENT_DATE + INTERVAL '1 day'`,
      ),
    );
  if (rows.length === 0) return { notified: 0, tasksScanned: 0 };

  // 负责人（含多负责人）→ open_id：只取已绑飞书者
  const assigneeRows = await db
    .select({
      taskId: taskAssignees.taskId,
      userId: taskAssignees.userId,
      openId: users.feishuOpenId,
    })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(
      and(
        inArray(
          taskAssignees.taskId,
          rows.map((r) => r.id),
        ),
        isNotNull(users.feishuOpenId),
      ),
    );

  const byTask = new Map(rows.map((r) => [r.id, r]));
  // 按负责人聚合
  const byUser = new Map<string, { openId: string; overdue: ReminderItem[]; dueSoon: ReminderItem[] }>();
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const a of assigneeRows) {
    const task = byTask.get(a.taskId);
    if (!task || !a.openId) continue;
    const bucket = byUser.get(a.userId) ?? { openId: a.openId, overdue: [], dueSoon: [] };
    const item: ReminderItem = { id: task.id, title: task.title, projectId: task.projectId };
    if (task.dueDate && task.dueDate < todayStr) bucket.overdue.push(item);
    else bucket.dueSoon.push(item);
    byUser.set(a.userId, bucket);
  }

  let notified = 0;
  for (const { openId, overdue, dueSoon } of byUser.values()) {
    const ok = await safeSend(openId, buildDueReminderCard({ overdue, dueSoon }));
    if (ok) notified++;
  }
  return { notified, tasksScanned: rows.length };
}
