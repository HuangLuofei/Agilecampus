import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { taskEvents, tasks } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createIteration } from "@/lib/iteration";
import { createTask } from "@/lib/task";
import { buildBurndown } from "@/lib/burndown";
import { parseDay, toDayString } from "@/lib/due";
import { resetDb } from "./helpers";

const DAY = 86_400_000;

// 以「今天」为锚点的本地日期（与 due.ts 的本地零点口径一致）
function localDay(offset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("sv-SE");
}

// 本地时区某日某点的绝对时间（parseDay 同源，round-trip 稳定）
function at(day: string, hour = 12): Date {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`);
}

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, project };
}

// 直插任务 + 事件并显式指定 createdAt，以精确控制燃尽图重建
async function insertTask(projectId: string, createdById: string, title: string, iterationId: string | null) {
  const [task] = await db
    .insert(tasks)
    .values({
      projectId,
      createdById,
      title,
      iterationId,
      status: "todo",
      priority: "medium",
      sortOrder: 1,
    })
    .returning();
  return task;
}

async function insertEvent(
  taskId: string,
  action: "created" | "updated" | "status_changed",
  newValue: unknown,
  oldValue: unknown,
  createdAt: Date,
) {
  await db.insert(taskEvents).values({
    taskId,
    actorType: "human",
    action,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    createdAt,
  });
}

describe("buildBurndown（事件重建）", () => {
  beforeEach(resetDb);

  it("完成日/中途加入/起始总量正确", async () => {
    const { owner, student, project } = await scene();
    const start = localDay(-2);
    const end = localDay(0);
    const d3 = localDay(-3);
    const d2 = localDay(-2);
    const d1 = localDay(-1);
    const { iteration } = await createIteration(owner.id, project.id, {
      name: "冲刺",
      startDate: start,
      endDate: end,
    });

    const t1 = await insertTask(project.id, owner.id, "始终未完成", iteration.id);
    const t2 = await insertTask(project.id, owner.id, "末日完成", iteration.id);
    const t3 = await insertTask(project.id, owner.id, "次末完成", iteration.id);
    const t4 = await insertTask(project.id, owner.id, "中途加入", iteration.id);

    // t1：一直 todo
    await insertEvent(t1.id, "created", { iterationId: iteration.id }, null, at(d3));
    // t2：D-1 完成
    await insertEvent(t2.id, "created", { iterationId: iteration.id }, null, at(d3));
    await insertEvent(t2.id, "status_changed", { status: "done" }, { status: "todo" }, at(d1));
    // t3：D-2 完成
    await insertEvent(t3.id, "created", { iterationId: iteration.id }, null, at(d3));
    await insertEvent(t3.id, "status_changed", { status: "done" }, { status: "todo" }, at(d2));
    // t4：D-3 建在迭代外，D-2 经 updated 移入
    await insertEvent(t4.id, "created", { iterationId: null }, null, at(d3));
    await insertEvent(t4.id, "updated", { iterationId: iteration.id }, { iterationId: null }, at(d2));

    const b = await buildBurndown(student.id, iteration.id);
    expect(b.hasData).toBe(true);
    expect(b.days).toEqual([d2, d1, end]);
    // 起始总量：D-3 时 t1/t2/t3 已在迭代内且未完成（t4 尚未移入）→ 3
    expect(b.totalAtStart).toBe(3);
    expect(b.ideal).toEqual([3, 2, 0]);
    // D-2：t1+t2+t4（t3 已 done）；D-1、D0：t1+t4（t2 亦 done）
    expect(b.actual).toEqual([3, 2, 2]);
  });

  it("未来日 actual 为 null，任务创建前不计入", async () => {
    const { owner, student, project } = await scene();
    const { iteration } = await createIteration(owner.id, project.id, {
      name: "冲刺",
      startDate: localDay(-1),
      endDate: localDay(1),
    });
    // 今天建的任务（创建事件落在「今天」）
    await createTask(student.id, project.id, { title: "今天建的任务", iterationId: iteration.id });

    const b = await buildBurndown(student.id, iteration.id);
    expect(b.hasData).toBe(true);
    expect(b.actual).toEqual([0, 1, null]);
  });

  it("迭代无起止日期 → 空燃尽", async () => {
    const { owner, student, project } = await scene();
    const { iteration } = await createIteration(owner.id, project.id, { name: "未排期" });
    const b = await buildBurndown(student.id, iteration.id);
    expect(b.hasData).toBe(false);
    expect(b.days).toEqual([]);
  });
});

describe("due 本地零点（时区边界）", () => {
  it("parseDay/toDayString 本地往返不跨天", () => {
    const ms = parseDay("2026-10-20")!;
    expect(toDayString(ms)).toBe("2026-10-20");
    expect(toDayString(ms + DAY - 1)).toBe("2026-10-20");
    expect(toDayString(ms + DAY)).toBe("2026-10-21");
  });
});
