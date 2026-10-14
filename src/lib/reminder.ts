import { and, eq, gte, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { notifications, projects, taskAssignees, tasks, teamMembers, users } from "@/db/schema";
import { classifyDue, DUE_SOON_DAYS, toDayString, todayStartMs } from "./due";
import { createNotification } from "./notification";
import { listManagedProjectIds } from "./project";
import { assigneesByTask, isAssigneeOf } from "./task";

const DAY = 86_400_000;

// 为某人尚未完成的临期/逾期任务生成站内提醒。按「同一任务每天至多一条」去重，重复调用无副作用。
// 提醒范围（两条并集）：
//   1) 我是负责人之一的任务 —— 组员的常规口径（多负责人，故按 isAssigneeOf 判定集合归属）；
//   2) 我作为团队管理员（team_role=admin）负责的项目内的全部任务 —— 管理者的兜底口径，
//      即使任务负责人不是我，也要提醒我，避免「组长没盯住组员的逾期」。
// 普通成员（student）只命中第 1 条，行为与原先完全一致。
export async function syncDueSoonNotifications(
  userId: string,
): Promise<{ dueSoon: number; overdue: number; managed: number; projectIds: string[] }> {
  const todayMs = todayStartMs();
  const horizon = toDayString(todayMs + DUE_SOON_DAYS * DAY);

  const managedProjectIds = await listManagedProjectIds(userId);
  const scope = [isAssigneeOf(userId)];
  if (managedProjectIds.length > 0) {
    scope.push(inArray(tasks.projectId, managedProjectIds));
  }

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      projectName: projects.name,
      dueDate: tasks.dueDate,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(
      and(
        or(...scope),
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        lte(tasks.dueDate, horizon),
      ),
    );

  // 「是否我负责」= 主负责人 或 多负责人关联表里有我
  const myAssignedTaskIds = new Set(
    (
      await db
        .select({ id: taskAssignees.taskId })
        .from(taskAssignees)
        .where(eq(taskAssignees.userId, userId))
    ).map((r) => r.id),
  );

  const items = rows
    .map((r) => ({
      ...r,
      mine: r.assigneeId === userId || myAssignedTaskIds.has(r.id),
      state: classifyDue(r.dueDate, r.status, todayMs),
    }))
    .filter((r) => r.state !== "ok");

  const dueSoon = items.filter((r) => r.state === "soon").length;
  const overdue = items.filter((r) => r.state === "overdue").length;
  // 其中「不是我负责、但在我管理的项目里」的条数：红条据此说明提醒来源
  const managed = items.filter((r) => !r.mine).length;
  // 涉及的项目的去重集合：红条据此决定「查看提醒」能否直接跳某个项目看板
  const projectIds = [...new Set(items.map((r) => r.projectId))];
  if (items.length === 0) return { dueSoon: 0, overdue: 0, managed: 0, projectIds: [] };

  // 管理者视角的文案要写清另一位（或几位）负责人
  const notMine = items.filter((r) => !r.mine);
  const byAssignee = await assigneesByTask(notMine.map((r) => r.id));

  // 当日去重：今天已经提醒过的同一任务不再重复
  const existing = await db
    .select({ linkUrl: notifications.linkUrl })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "task_due_soon"),
        gte(notifications.createdAt, new Date(todayMs)),
      ),
    );
  const seen = new Set(existing.map((e) => e.linkUrl));

  for (const r of items) {
    const linkUrl = `/projects/${r.projectId}?task=${r.id}`;
    if (seen.has(linkUrl)) continue;
    // 管理者视角下补上项目与负责人，便于区分「别人负责但我需要盯」的任务
    const names = byAssignee.get(r.id)?.map((a) => a.name).join("、") ?? r.assigneeName ?? "未分配";
    const suffix = r.mine ? "" : `（项目：${r.projectName ?? "—"}｜负责人：${names}）`;
    try {
      await createNotification({
        userId,
        type: "task_due_soon",
        title: r.state === "overdue" ? "任务已逾期" : "任务即将到期",
        content:
          r.state === "overdue"
            ? `任务《${r.title}》已逾期（截止 ${r.dueDate}）${suffix}`
            : `任务《${r.title}》将于 ${r.dueDate} 到期${suffix}`,
        linkUrl,
        projectId: r.projectId,
      });
    } catch (e) {
      console.error("[reminder] 到期提醒写入失败", e);
    }
  }

  return { dueSoon, overdue, managed, projectIds };
}

// 给所有相关人各跑一遍（供 cron 调用：覆盖尚未登录的用户）。
// 需要跑的人 = 自己名下有待到期/逾期任务的负责人 ∪ 其管理项目内存在这类任务的团队管理员。
export async function syncDueSoonNotificationsForAll(): Promise<{ users: number }> {
  const todayMs = todayStartMs();
  const horizon = toDayString(todayMs + DUE_SOON_DAYS * DAY);

  // 负责人（多负责人关联表 ∪ 主负责人兜底），限「未完成且已临期/逾期」的任务
  const assignees = await db
    .selectDistinct({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
    .where(
      and(ne(tasks.status, "done"), isNotNull(tasks.dueDate), lte(tasks.dueDate, horizon)),
    );

  const primaryAssignees = await db
    .selectDistinct({ userId: tasks.assigneeId })
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.assigneeId),
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        lte(tasks.dueDate, horizon),
      ),
    );

  const admins = await db
    .selectDistinct({ userId: teamMembers.userId })
    .from(teamMembers)
    .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
    .innerJoin(tasks, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(teamMembers.role, "admin"),
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        lte(tasks.dueDate, horizon),
      ),
    );

  const targets = new Set<string>();
  for (const r of assignees) targets.add(r.userId);
  for (const r of primaryAssignees) if (r.userId) targets.add(r.userId);
  for (const r of admins) targets.add(r.userId);

  let users = 0;
  for (const id of targets) {
    await syncDueSoonNotifications(id);
    users++;
  }
  return { users };
}
