import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  announcements,
  milestones,
  projects,
  taskComments,
  taskDependencies,
  taskEvents,
  tasks,
  teams,
  users,
  weeklyReports,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getTeamMembership } from "./team";
import { isTeamLead } from "./team-permissions";
import { listMyRooms, listRoomMessages } from "./chat";
import { parseDay } from "./due";

const DAY = 86_400_000;

// ── 数据范围 ──────────────────────────────────────────────
// 团队内任意角色皆可读/生成草稿；正式发布仅组长（canPublishReport / isTeamLead）。
async function requireTeamMember(actorId: string, teamId: string) {
  const member = await getTeamMembership(actorId, teamId);
  if (!member) throw new ForbiddenError();
  return member;
}

function rangeBounds(startDate: string, endDate: string) {
  const startMs = parseDay(startDate);
  const endMs = parseDay(endDate);
  if (startMs === null || endMs === null) return null;
  // [startMs, endExclusiveMs) 含整个结束日（本地时区，与 due.ts 口径一致）
  return { startMs, endExclusiveMs: endMs + DAY };
}

function actorLabelOf(actorType: string, actorName: string | null): string {
  if (actorType === "ai") return "AI 助手";
  if (actorType === "system") return "系统";
  return actorName ?? "未知成员";
}

function truncate(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ── 汇总后的结构化数据（buildWeeklyReportContent 的输入，纯数据、便于单测） ──
export type GatheredReportData = {
  completed: { title: string; assignee: string; note?: string }[];
  inProgress: { title: string; assignee: string }[];
  risks: { title: string; detail: string }[];
  contributions: { name: string; completed: number; created: number }[];
  pending: { title: string; dueDate: string | null }[];
  openMilestones: { title: string; targetDate: string | null }[];
  decisions: { title: string; detail: string }[];
  announcements: { title: string; content: string; author: string }[];
  importantChat: { sender: string; content: string }[];
  comments: { taskTitle: string; author: string; content: string }[];
};

function bullets(items: string[]): string {
  return items.length > 0 ? items.map((s) => `- ${s}`).join("\n") : "- 无";
}

// 纯函数：把结构化数据拼成固定结构的 Markdown 周报。hasData=false 时只给「数据不足」提示。
export function buildWeeklyReportContent(opts: {
  scopeName: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  includeRisks: boolean;
  hasData: boolean;
  data: GatheredReportData;
}): { title: string; content: string } {
  const { scopeName, startDate, endDate, generatedAt, includeRisks, hasData, data } = opts;
  const title = `${scopeName} 周报（${startDate} ~ ${endDate}）`;
  const meta = `> 数据范围：${startDate} ~ ${endDate}｜生成时间：${generatedAt}｜范围：${scopeName}`;

  if (!hasData) {
    return {
      title,
      content: [
        meta,
        "",
        "本时间范围内没有可用的工作记录（任务事件、公告、重要讨论、评论），数据不足，无法生成周报。请调整日期范围后重试。",
      ].join("\n"),
    };
  }

  const sections: string[] = [meta];

  sections.push("", "## 本周期完成事项");
  sections.push(
    bullets(
      data.completed.map((c) =>
        c.note ? `${c.title}（${c.assignee}）完成说明：${c.note}` : `${c.title}（${c.assignee}）`,
      ),
    ),
  );

  sections.push("", "## 进行中事项");
  sections.push(bullets(data.inProgress.map((t) => `${t.title}（${t.assignee}）`)));

  if (includeRisks) {
    sections.push("", "## 逾期/阻塞风险");
    sections.push(bullets(data.risks.map((r) => `${r.title}：${r.detail}`)));
  }

  sections.push("", "## 成员贡献");
  sections.push(
    bullets(data.contributions.map((c) => `${c.name}：完成 ${c.completed} 项，新建 ${c.created} 项`)),
  );

  if (includeRisks) {
    sections.push("", "## 下一周期建议");
    sections.push(
      bullets([
        ...data.pending.map((t) => (t.dueDate ? `${t.title}（截止 ${t.dueDate}）` : t.title)),
        ...data.openMilestones.map((m) =>
          m.targetDate ? `里程碑「${m.title}」（目标 ${m.targetDate}）` : `里程碑「${m.title}」`,
        ),
      ]),
    );
  }

  sections.push("", "## 需要组长决策的问题");
  sections.push(bullets(data.decisions.map((d) => `${d.title}：${d.detail}`)));

  if (data.announcements.length > 0) {
    sections.push("", "## 本周公告");
    sections.push(
      data.announcements.map((a) => `- **${a.title}**（${a.author}）：${truncate(a.content)}`).join("\n"),
    );
  }
  if (data.importantChat.length > 0) {
    sections.push("", "## 重要讨论摘要");
    sections.push(data.importantChat.map((m) => `- ${m.sender}：${truncate(m.content)}`).join("\n"));
  }
  if (data.comments.length > 0) {
    sections.push("", "## 任务评论摘录");
    sections.push(data.comments.map((c) => `- ${c.taskTitle} · ${c.author}：${truncate(c.content)}`).join("\n"));
  }

  return { title, content: sections.join("\n") };
}

// ── 汇总：只读取区间内的事件/公告/重要讨论/评论；「当前状态」仅用于进行中/待办/里程碑现状 ──
async function gatherReportData(
  actorId: string,
  projectIds: string[],
  bounds: { startMs: number; endExclusiveMs: number },
): Promise<{ data: GatheredReportData; hasData: boolean }> {
  const start = new Date(bounds.startMs);
  const end = new Date(bounds.endExclusiveMs);
  const todayStr = new Date().toLocaleDateString("sv-SE");

  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      completionNote: tasks.completionNote,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(inArray(tasks.projectId, projectIds));

  const [eventRows, depRows, milestoneRows, announcementRows, commentRows] = await Promise.all([
    db
      .select({
        taskId: taskEvents.taskId,
        action: taskEvents.action,
        oldValue: taskEvents.oldValue,
        newValue: taskEvents.newValue,
        createdAt: taskEvents.createdAt,
        actorType: taskEvents.actorType,
        actorName: users.name,
        taskTitle: tasks.title,
      })
      .from(taskEvents)
      .innerJoin(tasks, eq(taskEvents.taskId, tasks.id))
      .leftJoin(users, eq(taskEvents.actorId, users.id))
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          gte(taskEvents.createdAt, start),
          lt(taskEvents.createdAt, end),
        ),
      )
      .orderBy(taskEvents.createdAt),
    db
      .select({ predecessorId: taskDependencies.predecessorId, successorId: taskDependencies.successorId })
      .from(taskDependencies)
      .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
      .where(inArray(tasks.projectId, projectIds)),
    db
      .select({ id: milestones.id, title: milestones.title, targetDate: milestones.targetDate, status: milestones.status })
      .from(milestones)
      .where(inArray(milestones.projectId, projectIds))
      .orderBy(milestones.targetDate),
    db
      .select({ title: announcements.title, content: announcements.content, authorName: users.name, createdAt: announcements.createdAt })
      .from(announcements)
      .leftJoin(users, eq(announcements.authorId, users.id))
      .where(
        and(
          inArray(announcements.projectId, projectIds),
          gte(announcements.createdAt, start),
          lt(announcements.createdAt, end),
        ),
      )
      .orderBy(announcements.createdAt),
    db
      .select({ taskTitle: tasks.title, authorName: users.name, content: taskComments.content, createdAt: taskComments.createdAt })
      .from(taskComments)
      .innerJoin(tasks, eq(taskComments.taskId, tasks.id))
      .innerJoin(users, eq(taskComments.authorId, users.id))
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          isNull(taskComments.deletedAt),
          gte(taskComments.createdAt, start),
          lt(taskComments.createdAt, end),
        ),
      )
      .orderBy(taskComments.createdAt),
  ]);

  // 重要讨论：仅取小组级重要/我收藏的消息，且落在区间内（默认不读普通聊天）
  const importantChat: { sender: string; content: string }[] = [];
  if (projectIds.length > 0) {
    const { groupRooms } = await listMyRooms(actorId);
    for (const pid of projectIds) {
      const roomId = groupRooms[pid]?.roomId;
      if (!roomId) continue;
      const msgs = await listRoomMessages(actorId, roomId, "important");
      for (const m of msgs) {
        if (m.createdAt.getTime() >= bounds.startMs && m.createdAt.getTime() < bounds.endExclusiveMs) {
          importantChat.push({ sender: m.senderName ?? "未知", content: m.content });
        }
      }
    }
  }

  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const predecessorsBy = new Map<string, string[]>();
  for (const d of depRows) {
    const list = predecessorsBy.get(d.successorId) ?? [];
    list.push(d.predecessorId);
    predecessorsBy.set(d.successorId, list);
  }
  const isBlocked = (taskId: string) =>
    (predecessorsBy.get(taskId) ?? []).some((p) => (taskById.get(p)?.status ?? "todo") !== "done");

  const completed: GatheredReportData["completed"] = [];
  const createdBy = new Map<string, number>();
  const doneBy = new Map<string, number>();
  const seenDone = new Set<string>();
  for (const ev of eventRows) {
    const nv = (ev.newValue ?? {}) as Record<string, unknown>;
    const actor = actorLabelOf(ev.actorType, ev.actorName);
    if (ev.action === "created") {
      createdBy.set(actor, (createdBy.get(actor) ?? 0) + 1);
    } else if (ev.action === "status_changed" && nv.status === "done") {
      if (seenDone.has(ev.taskId)) continue;
      seenDone.add(ev.taskId);
      const t = taskById.get(ev.taskId);
      completed.push({
        title: t?.title ?? ev.taskTitle ?? "（已删除任务）",
        assignee: t?.assigneeName ?? "未分配",
        note: t?.completionNote ?? undefined,
      });
      doneBy.set(actor, (doneBy.get(actor) ?? 0) + 1);
    }
  }

  const contributions: GatheredReportData["contributions"] = [];
  for (const name of new Set([...createdBy.keys(), ...doneBy.keys()])) {
    contributions.push({ name, completed: doneBy.get(name) ?? 0, created: createdBy.get(name) ?? 0 });
  }

  const overdueTasks = taskRows.filter(
    (t) => t.status !== "done" && t.dueDate != null && t.dueDate < todayStr,
  );
  const blockedTasks = taskRows.filter((t) => isBlocked(t.id));

  const data: GatheredReportData = {
    completed,
    inProgress: taskRows
      .filter((t) => t.status === "doing")
      .map((t) => ({ title: t.title, assignee: t.assigneeName ?? "未分配" })),
    risks: [
      ...overdueTasks.map((t) => ({ title: t.title, detail: `截止 ${t.dueDate} 已逾期` })),
      ...blockedTasks.map((t) => ({ title: t.title, detail: "被前置任务阻塞" })),
    ],
    contributions,
    pending: taskRows
      .filter((t) => t.status === "todo")
      .map((t) => ({ title: t.title, dueDate: t.dueDate })),
    openMilestones: milestoneRows
      .filter((m) => m.status === "open")
      .map((m) => ({ title: m.title, targetDate: m.targetDate })),
    decisions: [
      ...blockedTasks.map((t) => ({ title: t.title, detail: "依赖未完成，需协调解锁" })),
      ...overdueTasks.map((t) => ({ title: t.title, detail: `已逾期，需重新排期（截止 ${t.dueDate}）` })),
    ],
    announcements: announcementRows.map((a) => ({
      title: a.title,
      content: a.content,
      author: a.authorName ?? "未知",
    })),
    importantChat,
    comments: commentRows.map((c) => ({
      taskTitle: c.taskTitle,
      author: c.authorName ?? "未知",
      content: c.content,
    })),
  };

  const hasData =
    eventRows.length > 0 ||
    announcementRows.length > 0 ||
    importantChat.length > 0 ||
    commentRows.length > 0;

  return { data, hasData };
}

// ── 生成：校验成员身份 + 日期范围，汇总后返回 title/content/hasData（不落库） ──
export async function generateWeeklyReport(
  actorId: string,
  input: {
    teamId: string;
    projectId?: string | null;
    startDate: string;
    endDate: string;
    includeRisks?: boolean;
  },
) {
  await requireTeamMember(actorId, input.teamId);
  const includeRisks = input.includeRisks ?? true;
  const bounds = rangeBounds(input.startDate, input.endDate);
  if (!bounds) throw new AppError("日期范围无效");

  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, input.teamId));
  const teamName = team?.name ?? "团队";

  let projectIds: string[];
  let projectName: string | null = null;
  if (input.projectId) {
    const [p] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.teamId, input.teamId)));
    if (!p) throw new AppError("项目不属于该团队");
    projectIds = [p.id];
    projectName = p.name;
  } else {
    const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.teamId, input.teamId));
    projectIds = rows.map((r) => r.id);
  }

  const { data, hasData } = await gatherReportData(actorId, projectIds, bounds);
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });

  return buildWeeklyReportContent({
    scopeName: projectName ? `${teamName} · ${projectName}` : teamName,
    startDate: input.startDate,
    endDate: input.endDate,
    generatedAt,
    includeRisks,
    hasData,
    data,
  });
}

// ── 保存 / 发布 / 编辑 / 删除 ──────────────────────────────

export async function listWeeklyReports(actorId: string, teamId: string) {
  await requireTeamMember(actorId, teamId);
  return db
    .select({
      id: weeklyReports.id,
      title: weeklyReports.title,
      status: weeklyReports.status,
      periodStart: weeklyReports.periodStart,
      periodEnd: weeklyReports.periodEnd,
      projectName: projects.name,
      draftByName: users.name,
      createdAt: weeklyReports.createdAt,
    })
    .from(weeklyReports)
    .leftJoin(projects, eq(weeklyReports.projectId, projects.id))
    .leftJoin(users, eq(weeklyReports.draftBy, users.id))
    .where(eq(weeklyReports.teamId, teamId))
    .orderBy(desc(weeklyReports.createdAt));
}

export async function createWeeklyReport(
  actorId: string,
  input: {
    teamId: string;
    projectId?: string | null;
    periodStart: string;
    periodEnd: string;
    title: string;
    content: string;
  },
) {
  await requireTeamMember(actorId, input.teamId);
  const [report] = await db
    .insert(weeklyReports)
    .values({
      teamId: input.teamId,
      projectId: input.projectId ?? null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      title: input.title,
      content: input.content,
      status: "draft",
      draftBy: actorId,
    })
    .returning();
  return report;
}

export async function getWeeklyReportForUser(actorId: string, reportId: string) {
  const [report] = await db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId));
  if (!report) throw new AppError("周报不存在");
  await requireTeamMember(actorId, report.teamId);

  const [draftBy, publishedBy, project] = await Promise.all([
    report.draftBy ? db.select({ name: users.name }).from(users).where(eq(users.id, report.draftBy)) : [],
    report.publishedBy ? db.select({ name: users.name }).from(users).where(eq(users.id, report.publishedBy)) : [],
    report.projectId
      ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, report.projectId))
      : [],
  ]);

  return {
    report,
    draftByName: draftBy[0]?.name ?? null,
    publishedByName: publishedBy[0]?.name ?? null,
    projectName: project[0]?.name ?? null,
  };
}

export async function updateWeeklyReport(
  actorId: string,
  reportId: string,
  patch: { title?: string; content?: string },
) {
  const [report] = await db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId));
  if (!report) throw new AppError("周报不存在");
  const member = await requireTeamMember(actorId, report.teamId);
  if (report.status !== "draft") throw new AppError("已发布周报不可编辑");
  if (report.draftBy !== actorId && !isTeamLead(member.role)) throw new ForbiddenError();

  const [updated] = await db
    .update(weeklyReports)
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.content !== undefined && { content: patch.content }),
      updatedAt: new Date(),
    })
    .where(eq(weeklyReports.id, reportId))
    .returning();
  return updated;
}

export async function publishWeeklyReport(actorId: string, reportId: string) {
  const [report] = await db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId));
  if (!report) throw new AppError("周报不存在");
  const member = await requireTeamMember(actorId, report.teamId);
  if (!isTeamLead(member.role)) throw new ForbiddenError();
  if (report.status === "published") throw new AppError("周报已发布");

  const [updated] = await db
    .update(weeklyReports)
    .set({ status: "published", publishedBy: actorId, updatedAt: new Date() })
    .where(eq(weeklyReports.id, reportId))
    .returning();
  return updated;
}

export async function deleteWeeklyReport(actorId: string, reportId: string) {
  const [report] = await db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId));
  if (!report) throw new AppError("周报不存在");
  const member = await requireTeamMember(actorId, report.teamId);
  if (report.draftBy !== actorId && !isTeamLead(member.role)) throw new ForbiddenError();
  await db.delete(weeklyReports).where(eq(weeklyReports.id, reportId));
}
