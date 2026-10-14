import { and, asc, desc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, taskEvents, tasks, teamMembers, users } from "@/db/schema";
import { toDayString, todayStartMs } from "./due";
import { listMyProjects, listMyTeamsWithProjects } from "./project";
import { isAssigneeOf } from "./task";

const ACTION_LABEL: Record<string, string> = {
  created: "创建了任务",
  updated: "更新了任务",
  status_changed: "更新了任务状态",
  assignee_changed: "调整了负责人",
  due_date_changed: "调整了截止时间",
  priority_changed: "调整了优先级",
  completion_note_changed: "更新了完成情况",
  comment_created: "评论了任务",
  comment_updated: "编辑了评论",
  comment_deleted: "删除了评论",
  deleted: "删除了任务",
};

function initial(name: string): string {
  return name.trim()?.[0] ?? "某";
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return d.toLocaleDateString("zh-CN");
}

// 我的任务口径：进行中=doing、待我处理=todo、已逾期=非完成且超期，均只统计指派给我的任务。
// 「指派给我」按多负责人集合判定（isAssigneeOf：主负责人 ∪ 关联表）。
async function getTaskStats(actorId: string) {
  const today = toDayString(todayStartMs());
  const [doing, todo, overdue] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(isAssigneeOf(actorId), eq(tasks.status, "doing"))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(isAssigneeOf(actorId), eq(tasks.status, "todo"))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          isAssigneeOf(actorId),
          ne(tasks.status, "done"),
          isNotNull(tasks.dueDate),
          lt(tasks.dueDate, today),
        ),
      ),
  ]);
  return {
    doingCount: doing[0]?.c ?? 0,
    todoCount: todo[0]?.c ?? 0,
    overdueCount: overdue[0]?.c ?? 0,
  };
}

// 我的任务列表（未完成），供「我的任务」页与统计卡跳转
export async function listMyTasks(actorId: string) {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(isAssigneeOf(actorId), ne(tasks.status, "done")))
    .orderBy(asc(tasks.dueDate));
}

async function listRecentActivity(projectIds: string[]) {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({
      id: taskEvents.id,
      actorType: taskEvents.actorType,
      actorName: users.name,
      action: taskEvents.action,
      taskId: tasks.id,
      taskTitle: tasks.title,
      projectId: tasks.projectId,
      createdAt: taskEvents.createdAt,
    })
    .from(taskEvents)
    .innerJoin(tasks, eq(taskEvents.taskId, tasks.id))
    .leftJoin(users, eq(taskEvents.actorId, users.id))
    .where(inArray(tasks.projectId, projectIds))
    .orderBy(desc(taskEvents.createdAt))
    .limit(8);

  return rows.map((r) => {
    const actorName =
      r.actorName ?? (r.actorType === "ai" ? "AI 助手" : r.actorType === "system" ? "系统" : "某成员");
    return {
      id: r.id,
      actorName,
      initial: initial(actorName),
      label: ACTION_LABEL[r.action] ?? "更新了任务",
      taskTitle: r.taskTitle,
      linkUrl: `/projects/${r.projectId}?task=${r.taskId}`,
      timeLabel: timeAgo(r.createdAt),
    };
  });
}

async function listTodos(actorId: string) {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .where(and(isAssigneeOf(actorId), ne(tasks.status, "done")))
    .limit(40);

  const today = toDayString(todayStartMs());
  const sorted = [...rows].sort((a, b) => {
    const da = a.dueDate ?? "9999-12-31";
    const dbv = b.dueDate ?? "9999-12-31";
    return da < dbv ? -1 : da > dbv ? 1 : 0;
  });

  return sorted.slice(0, 6).map((r) => ({
    id: r.id,
    title: r.title,
    linkUrl: `/projects/${r.projectId}?task=${r.id}`,
    dueLabel: r.dueDate ?? "无截止",
    overdue: r.dueDate ? r.dueDate < today : false,
  }));
}

// 工作台聚合：团队（含角色/成员）+ 项目（含统计/描述/日期）+ 统计卡片 + 最近动态 + 我的待办
export async function getDashboardData(actorId: string) {
  const [teams, projects] = await Promise.all([
    listMyTeamsWithProjects(actorId),
    listMyProjects(actorId),
  ]);

  const teamIds = teams.map((t) => t.id);
  const projectIds = projects.map((p) => p.id);

  const [stats, activity, todos] = await Promise.all([
    getTaskStats(actorId),
    listRecentActivity(projectIds),
    listTodos(actorId),
  ]);

  const members = teamIds.length
    ? await db
        .select({ teamId: teamMembers.teamId, id: users.id, name: users.name })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(inArray(teamMembers.teamId, teamIds))
    : [];

  const membersByTeam = new Map<string, { id: string; name: string }[]>();
  for (const m of members) {
    const arr = membersByTeam.get(m.teamId) ?? [];
    arr.push({ id: m.id, name: m.name });
    membersByTeam.set(m.teamId, arr);
  }

  return {
    teams: teams.map((t) => ({ ...t, members: membersByTeam.get(t.id) ?? [] })),
    projects,
    stats: {
      projectCount: projects.filter((p) => p.status === "active").length,
      ...stats,
    },
    activity,
    todos,
  };
}
