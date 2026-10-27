import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, documents, projects, taskAssignees, taskDependencies, taskEvents, tasks, teamMembers, teams, users } from "@/db/schema";
import { getDashboardData, listMyTasks } from "@/lib/dashboard";
import { getWorkbenchReminders } from "@/lib/workbench-reminders";
import { getWorkbenchScope } from "@/lib/workbench";
import { listMyAssets } from "@/lib/my-assets";
import { toDayString, todayStartMs } from "@/lib/due";
import { ForbiddenError } from "@/lib/errors";
import { resetDb } from "./helpers";

const day = (offset: number) => toDayString(todayStartMs() + offset * 86_400_000);

// Seed read-model fixtures directly: no asynchronous notification side effects between tests.
async function scene() {
  const [actor, leader, student] = await db.insert(users).values([
    { name: "当前用户", email: "wb-actor@example.test", passwordHash: "unused" },
    { name: "另一组组长", email: "wb-leader@example.test", passwordHash: "unused" },
    { name: "普通成员", email: "wb-student@example.test", passwordHash: "unused" },
  ]).returning();
  const [a, b, empty, foreign] = await db.insert(teams).values([
    { name: "甲组", inviteCode: "wb-a" },
    { name: "乙组", inviteCode: "wb-b" },
    { name: "空小组", inviteCode: "wb-empty" },
    { name: "无权访问组", inviteCode: "wb-foreign" },
  ]).returning();
  await db.insert(teamMembers).values([
    { teamId: a.id, userId: actor.id, role: "admin" },
    { teamId: b.id, userId: actor.id, role: "student" },
    { teamId: empty.id, userId: actor.id, role: "student" },
    { teamId: a.id, userId: student.id, role: "student" },
    { teamId: a.id, userId: leader.id, role: "student" },
    { teamId: b.id, userId: leader.id, role: "admin" },
    { teamId: foreign.id, userId: leader.id, role: "admin" },
  ]);
  const [pa, pb, pf] = await db.insert(projects).values([
    { name: "同名项目", teamId: a.id },
    { name: "同名项目", teamId: b.id },
    { name: "不可见项目", teamId: foreign.id },
  ]).returning();
  const [overdue, doing, done, unassigned, bTask, foreignTask] = await db.insert(tasks).values([
    { projectId: pa.id, title: "同名任务", assigneeId: actor.id, dueDate: day(-1) },
    { projectId: pa.id, title: "共同负责", assigneeId: leader.id, status: "doing", dueDate: day(1) },
    { projectId: pa.id, title: "已完成", assigneeId: actor.id, status: "done", dueDate: day(-2) },
    { projectId: pa.id, title: "组长兜底", dueDate: day(-1) },
    { projectId: pb.id, title: "同名任务", assigneeId: actor.id, priority: "high", dueDate: day(2) },
    { projectId: pf.id, title: "退组遗留指派", assigneeId: actor.id, dueDate: day(-5) },
  ]).returning();
  await db.insert(taskAssignees).values([
    { taskId: doing.id, userId: leader.id, position: 0 },
    { taskId: doing.id, userId: actor.id, position: 1 },
  ]);
  await db.insert(taskEvents).values([overdue, bTask, foreignTask].map((task) => ({
    taskId: task.id, actorId: actor.id, actorType: "human" as const, action: "created" as const,
  })));
  await db.insert(documents).values([
    { projectId: pa.id, title: "甲组文档", createdById: actor.id },
    { projectId: pb.id, title: "乙组文档", createdById: actor.id },
  ]);
  await db.insert(assets).values([
    { projectId: pa.id, name: "甲组链接", assetType: "link", url: "https://example.test/a" },
    { projectId: pb.id, name: "已归档文件", assetType: "file", url: "/unused", isArchived: true },
  ]);
  return { actor, leader, student, a, b, empty, foreign, pa, pb, pf, overdue, doing, done, unassigned, bTask };
}

describe("工作台真实数据库回归（须独立 *_test 库）", () => {
  beforeEach(resetDb);

  it("按小组统一筛选统计、待办、动态、资产和项目；跨组同名仍有归属", async () => {
    const { actor, a, pa, pb } = await scene();
    const all = await getDashboardData(actor.id);
    expect(all.projects.map((p) => p.id).sort()).toEqual([pa.id, pb.id].sort());
    expect(all.totalProjectCount).toBe(2);
    expect(all.stats.assetCount).toBe(3);
    const data = await getDashboardData(actor.id, a.id);
    expect(data.projects.map((p) => p.id)).toEqual([pa.id]);
    expect(data.stats).toMatchObject({ todoCount: 1, doingCount: 1, overdueCount: 1, assetCount: 2 });
    expect(data.todos).toHaveLength(2);
    expect(data.todos.every((t) => t.teamName === "甲组" && t.projectName === "同名项目")).toBe(true);
    expect(data.activity).toHaveLength(1);
    expect(data.activity[0].teamName).toBe("甲组");
    expect(new URL(data.activity[0].linkUrl, "https://example.test").searchParams.get("team")).toBe(a.id);
    expect(data.reminders.every((t) => t.teamId === a.id)).toBe(true);
    const scope = await getWorkbenchScope(actor.id, a.id);
    expect((await listMyAssets(scope.projectIds)).map((row) => row.title).sort()).toEqual(["甲组文档", "甲组链接"]);
  });

  it("空小组显示零统计，没有动态、待办、提醒和其他组资产", async () => {
    const { actor, empty } = await scene();
    const data = await getDashboardData(actor.id, empty.id);
    expect(data.selectedTeam?.name).toBe("空小组");
    expect(data.teams).toHaveLength(3);
    expect(data.projects).toEqual([]);
    expect(data.stats).toEqual({ projectCount: 0, assetCount: 0, todoCount: 0, doingCount: 0, overdueCount: 0 });
    expect(data.todos).toEqual([]);
    expect(data.activity).toEqual([]);
    expect(data.reminders).toEqual([]);
    expect(await listMyTasks(actor.id, empty.id)).toEqual([]);
  });

  it("未加入的小组被拒绝；历史指派也不泄漏到全局任务或提醒", async () => {
    const { actor, foreign } = await scene();
    await expect(getDashboardData(actor.id, foreign.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listMyTasks(actor.id, foreign.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listMyTasks(actor.id)).some((t) => t.title === "退组遗留指派")).toBe(false);
    expect((await getWorkbenchReminders(actor.id)).items.some((t) => t.title === "退组遗留指派")).toBe(false);
  });

  it("次要负责人仍计入我的任务；退出小组后不再看到遗留指派", async () => {
    const { actor, a, doing } = await scene();
    expect((await listMyTasks(actor.id, a.id)).map((t) => t.id)).toContain(doing.id);
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, a.id), eq(teamMembers.userId, actor.id)));
    expect((await listMyTasks(actor.id)).some((t) => t.teamId === a.id)).toBe(false);
    expect((await getWorkbenchReminders(actor.id)).items.some((t) => t.teamId === a.id)).toBe(false);
  });

  it("项目健康计数不受多个前置关联影响，所有前置完成后解除派生阻塞", async () => {
    const { actor, a, pa, overdue, doing, unassigned } = await scene();
    await db.insert(taskDependencies).values([
      { predecessorId: overdue.id, successorId: unassigned.id },
      { predecessorId: doing.id, successorId: unassigned.id },
    ]);
    const before = (await getDashboardData(actor.id, a.id)).projects.find((p) => p.id === pa.id)!;
    expect(before).toMatchObject({ taskTotal: 4, todoCount: 2, doingCount: 1, doneCount: 1, overdueCount: 2, blockedCount: 1 });
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, overdue.id));
    expect((await getDashboardData(actor.id, a.id)).projects[0].blockedCount).toBe(1);
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, doing.id));
    expect((await getDashboardData(actor.id, a.id)).projects[0].blockedCount).toBe(0);
  });

  it("超过 40 条任务时，最早到期任务仍排在工作台前六条内", async () => {
    const { actor, a, pa } = await scene();
    await db.insert(tasks).values(Array.from({ length: 45 }, (_, index) => ({
      projectId: pa.id, assigneeId: actor.id, title: `普通任务${index}`, dueDate: null,
    })));
    const [urgent] = await db.insert(tasks).values({
      projectId: pa.id, assigneeId: actor.id, title: "最后创建但最早到期", dueDate: day(-10),
    }).returning();
    const data = await getDashboardData(actor.id, a.id);
    expect(data.todos).toHaveLength(6);
    expect(data.todos[0].id).toBe(urgent.id);
    expect(data.todos[0].overdue).toBe(true);
  });

  it("成员只看本人提醒，组长含未分配风险；强提醒按任务去重", async () => {
    const { actor, student, a, b, pa, pb, overdue, doing, unassigned } = await scene();
    const data = await getWorkbenchReminders(actor.id);
    expect(data.byTeam.find((t) => t.teamId === a.id)).toEqual({ teamId: a.id, overdue: 2, dueSoon: 1, urgent: 2, projectIds: [pa.id] });
    expect(data.byTeam.find((t) => t.teamId === b.id)).toEqual({ teamId: b.id, overdue: 0, dueSoon: 1, urgent: 1, projectIds: [pb.id] });
    expect(data.items.filter((t) => t.id === overdue.id)).toHaveLength(1);
    expect(data.items.map((t) => t.id)).toContain(unassigned.id);
    expect((await getWorkbenchReminders(student.id)).items).toEqual([]);
    await db.insert(taskAssignees).values({ taskId: doing.id, userId: student.id, position: 2 });
    const own = await getWorkbenchReminders(student.id);
    expect(own.items.map((t) => t.id)).toEqual([doing.id]);
    expect(own.items[0].urgent).toBe(false);
  });
});
