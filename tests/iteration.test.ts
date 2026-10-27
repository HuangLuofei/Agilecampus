import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, setTaskSuccessors, listProjectTasks } from "@/lib/task";
import {
  createIteration,
  listIterations,
  getIterationStats,
  computeIterationStats,
} from "@/lib/iteration";
import { resetDb } from "./helpers";

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

describe("createIteration 权限与日期冲突", () => {
  beforeEach(resetDb);

  it("student 建迭代被拒，admin 成功", async () => {
    const { owner, student, project } = await scene();
    await expect(
      createIteration(student.id, project.id, { name: "冲刺一" }),
    ).rejects.toThrow("没有权限");

    const { iteration } = await createIteration(owner.id, project.id, {
      name: "冲刺一",
      startDate: "2026-10-01",
      endDate: "2026-10-07",
    });
    expect(iteration.name).toBe("冲刺一");
    expect(iteration.status).toBe("planned");
  });

  it("同项目日期重叠的迭代被标记冲突（提示不硬拦）", async () => {
    const { owner, project } = await scene();
    await createIteration(owner.id, project.id, {
      name: "甲",
      startDate: "2026-10-01",
      endDate: "2026-10-07",
    });
    const { conflicts } = await createIteration(owner.id, project.id, {
      name: "乙",
      startDate: "2026-10-05",
      endDate: "2026-10-12",
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].name).toBe("甲");
  });

  it("非成员 listIterations 被拒", async () => {
    const { owner, outsider, project } = await scene();
    await createIteration(owner.id, project.id, { name: "甲" });
    await expect(listIterations(outsider.id, project.id)).rejects.toThrow("没有权限");
  });
});

describe("computeIterationStats（阻塞派生，不落 status）", () => {
  it("统计 todo/doing/done + 逾期 + 完成率，前置已完成不阻塞", () => {
    const statusById = new Map([
      ["a", "todo"],
      ["b", "done"],
    ]);
    // a 依赖 b（b 已完成 → 不阻塞 a）
    const predecessorsBy = new Map([["a", ["b"]]]);
    const tasks = [
      { id: "a", status: "todo", dueDate: "2026-10-01" },
      { id: "b", status: "done", dueDate: null },
    ];
    const r = computeIterationStats(tasks, statusById, predecessorsBy, "2026-10-27");
    expect(r.total).toBe(2);
    expect(r.done).toBe(1);
    expect(r.todo).toBe(1);
    expect(r.blocked).toBe(0);
    expect(r.overdue).toBe(1); // a 截止 2026-10-01 已逾期
    expect(r.completionRate).toBe(50);
    expect(r.remaining).toBe(1);
  });

  it("前置未完成 → 后置任务阻塞", () => {
    const statusById = new Map([
      ["a", "todo"],
      ["b", "todo"],
    ]);
    const predecessorsBy = new Map([["a", ["b"]]]);
    const tasks = [{ id: "a", status: "todo", dueDate: null }];
    const r = computeIterationStats(tasks, statusById, predecessorsBy, "2026-10-27");
    expect(r.blocked).toBe(1);
  });
});

describe("getIterationStats（集成：阻塞派生自依赖）", () => {
  beforeEach(resetDb);

  it("后置任务依赖未完成前置 → blocked=1，但任务 status 仍为 todo", async () => {
    const { owner, student, project } = await scene();
    const { iteration } = await createIteration(owner.id, project.id, {
      name: "冲刺一",
      startDate: "2026-10-01",
      endDate: "2026-10-07",
    });
    const a = await createTask(student.id, project.id, { title: "前置", iterationId: iteration.id });
    const b = await createTask(student.id, project.id, { title: "后置", iterationId: iteration.id });
    await setTaskSuccessors(student.id, a.id, [b.id]);

    const stats = await getIterationStats(student.id, iteration.id);
    expect(stats.total).toBe(2);
    expect(stats.blocked).toBe(1);

    // 阻塞是派生的：不写回 tasks.status
    const rows = await listProjectTasks(student.id, project.id);
    expect(rows.find((t) => t.id === b.id)?.status).toBe("todo");
  });
});
