import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { taskEvents, weeklyReports } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import {
  buildWeeklyReportContent,
  generateWeeklyReport,
  createWeeklyReport,
  publishWeeklyReport,
  listWeeklyReports,
  type GatheredReportData,
} from "@/lib/weekly-report";
import { resetDb } from "./helpers";

const EMPTY_DATA: GatheredReportData = {
  completed: [],
  inProgress: [],
  risks: [],
  contributions: [],
  pending: [],
  openMilestones: [],
  decisions: [],
  announcements: [],
  importantChat: [],
  comments: [],
};

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, outsider, project };
}

describe("buildWeeklyReportContent（纯函数）", () => {
  it("无数据 → 数据不足提示", () => {
    const { title, content } = buildWeeklyReportContent({
      scopeName: "团队",
      startDate: "2026-10-20",
      endDate: "2026-10-27",
      generatedAt: "2026-10-27 10:00:00",
      includeRisks: true,
      hasData: false,
      data: EMPTY_DATA,
    });
    expect(title).toContain("2026-10-20");
    expect(content).toContain("数据不足");
  });

  it("includeRisks=false 省略风险与下一周期建议", () => {
    const { content } = buildWeeklyReportContent({
      scopeName: "团队",
      startDate: "2026-10-20",
      endDate: "2026-10-27",
      generatedAt: "2026-10-27 10:00:00",
      includeRisks: false,
      hasData: true,
      data: { ...EMPTY_DATA, completed: [{ title: "甲", assignee: "student" }] },
    });
    expect(content).toContain("本周期完成事项");
    expect(content).toContain("甲");
    expect(content).not.toContain("逾期/阻塞风险");
    expect(content).not.toContain("下一周期建议");
  });
});

describe("generateWeeklyReport", () => {
  beforeEach(resetDb);

  it("只统计区间内事件（窗口外的完成不计入）", async () => {
    const { student, project } = await scene();
    const today = new Date().toLocaleDateString("sv-SE");

    const inTask = await createTask(student.id, project.id, { title: "范围内完成的任务" });
    await updateTask(student.id, inTask.id, { status: "done" });

    const outTask = await createTask(student.id, project.id, { title: "范围外完成的任务" });
    await updateTask(student.id, outTask.id, { status: "done" });
    // 把「完成」事件回拨到两天前，落在窗口外
    await db
      .update(taskEvents)
      .set({ createdAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(and(eq(taskEvents.taskId, outTask.id), eq(taskEvents.action, "status_changed")));

    const { content } = await generateWeeklyReport(student.id, {
      teamId: project.teamId,
      projectId: project.id,
      startDate: today,
      endDate: today,
    });
    expect(content).toContain("范围内完成的任务");
    expect(content).not.toContain("范围外完成的任务");
  });

  it("无任何事件 → 数据不足", async () => {
    const { student, project } = await scene();
    const today = new Date().toLocaleDateString("sv-SE");
    const { content } = await generateWeeklyReport(student.id, {
      teamId: project.teamId,
      projectId: project.id,
      startDate: today,
      endDate: today,
    });
    expect(content).toContain("数据不足");
  });

  it("非成员被拒", async () => {
    const { outsider, team, project } = await scene();
    await expect(
      generateWeeklyReport(outsider.id, {
        teamId: team.id,
        projectId: project.id,
        startDate: "2026-10-20",
        endDate: "2026-10-27",
      }),
    ).rejects.toThrow("没有权限");
  });
});

describe("周报发布权限", () => {
  beforeEach(resetDb);

  it("成员可起草草稿但不可发布，组长可发布", async () => {
    const { owner, student, team, project } = await scene();
    const today = new Date().toLocaleDateString("sv-SE");
    const { title, content } = await generateWeeklyReport(student.id, {
      teamId: team.id,
      projectId: project.id,
      startDate: today,
      endDate: today,
    });

    const draft = await createWeeklyReport(student.id, {
      teamId: team.id,
      projectId: project.id,
      periodStart: today,
      periodEnd: today,
      title,
      content,
    });
    expect(draft.status).toBe("draft");

    await expect(publishWeeklyReport(student.id, draft.id)).rejects.toThrow("没有权限");

    const published = await publishWeeklyReport(owner.id, draft.id);
    expect(published.status).toBe("published");

    const rows = await listWeeklyReports(student.id, team.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("published");
  });
});
