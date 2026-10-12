import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask, listProjectTasks, getTaskDetail } from "@/lib/task";
import { listMyTasks } from "@/lib/dashboard";
import { listTaskEvents } from "@/lib/activity";
import { listNotifications } from "@/lib/notification";
import { syncDueSoonNotifications } from "@/lib/reminder";
import { toDayString, todayStartMs } from "@/lib/due";
import { resetDb } from "./helpers";

const DAY = 86_400_000;
const day = (n: number) => toDayString(todayStartMs() + n * DAY);

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "多负责人团队");
  const a = await makeUser("a@example.com");
  const b = await makeUser("b@example.com");
  const c = await makeUser("c@example.com");
  const outsider = await makeUser("outsider@example.com");
  await joinTeam(a.id, team.inviteCode);
  await joinTeam(b.id, team.inviteCode);
  await joinTeam(c.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁" });
  return { owner, team, a, b, c, outsider, project };
}

describe("任务多负责人", () => {
  beforeEach(resetDb);

  it("createTask 收 assigneeIds：全员入库，首位即主负责人", async () => {
    const { owner, a, b, project } = await scene();
    const t = await createTask(owner.id, project.id, {
      title: "双人任务",
      assigneeIds: [a.id, b.id],
    });

    expect(t.assigneeId).toBe(a.id); // 主负责人 = 集合首位
    const detail = await getTaskDetail(owner.id, t.id);
    expect(detail.assigneeIds).toEqual([a.id, b.id]);
    expect(detail.assignees.map((x) => x.name)).toEqual(["a", "b"]);
  });

  it("createTask 兼容旧的单值 assigneeId 写法", async () => {
    const { owner, a, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "单人任务", assigneeId: a.id });
    const detail = await getTaskDetail(owner.id, t.id);
    expect(detail.assigneeIds).toEqual([a.id]);
    expect(detail.assigneeId).toBe(a.id);
  });

  it("assigneeIds 优先于 assigneeId，且按传入顺序去重", async () => {
    const { owner, a, b, project } = await scene();
    const t = await createTask(owner.id, project.id, {
      title: "优先",
      assigneeId: a.id,
      assigneeIds: [b.id, a.id, b.id],
    });
    const detail = await getTaskDetail(owner.id, t.id);
    expect(detail.assigneeIds).toEqual([b.id, a.id]);
    expect(detail.assigneeId).toBe(b.id);
  });

  it("updateTask 用 assigneeIds 覆写集合；空数组即清空为未指派", async () => {
    const { owner, a, b, c, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "改派", assigneeIds: [a.id, b.id] });

    await updateTask(owner.id, t.id, { assigneeIds: [b.id, c.id] });
    let detail = await getTaskDetail(owner.id, t.id);
    expect(detail.assigneeIds).toEqual([b.id, c.id]);
    expect(detail.assigneeId).toBe(b.id);

    await updateTask(owner.id, t.id, { assigneeIds: [] });
    detail = await getTaskDetail(owner.id, t.id);
    expect(detail.assigneeIds).toEqual([]);
    expect(detail.assigneeId).toBeNull();
  });

  it("updateTask 单值 assigneeId 仍可用（拖拽落列场景：改派为仅该人）", async () => {
    const { owner, a, b, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "拖拽", assigneeIds: [a.id, b.id] });
    await updateTask(owner.id, t.id, { assigneeId: b.id });
    const detail = await getTaskDetail(owner.id, t.id);
    expect(detail.assigneeIds).toEqual([b.id]);
  });

  it("多负责人里任一人不是团队成员即拒绝", async () => {
    const { owner, a, outsider, project } = await scene();
    await expect(
      createTask(owner.id, project.id, { title: "越权", assigneeIds: [a.id, outsider.id] }),
    ).rejects.toThrow("负责人不是团队成员");
  });

  it("「我的任务」对每一位负责人均可见", async () => {
    const { owner, a, b, project } = await scene();
    await createTask(owner.id, project.id, { title: "共享任务", assigneeIds: [a.id, b.id] });
    expect((await listMyTasks(a.id)).map((t) => t.title)).toEqual(["共享任务"]);
    expect((await listMyTasks(b.id)).map((t) => t.title)).toEqual(["共享任务"]);
    // 仅创建者、未被指派 → 不进「我的任务」
    expect(await listMyTasks(owner.id)).toHaveLength(0);
  });

  it("到期提醒发给全部负责人（含非主负责人）", async () => {
    const { owner, a, b, project } = await scene();
    await createTask(owner.id, project.id, {
      title: "临期共享",
      assigneeIds: [a.id, b.id],
      dueDate: day(1),
    });

    await syncDueSoonNotifications(b.id); // b 是次要负责人
    const items = (await listNotifications(b.id)).filter((i) => i.type === "task_due_soon");
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe(`任务《临期共享》将于 ${day(1)} 到期`);

    await syncDueSoonNotifications(a.id);
    expect(
      (await listNotifications(a.id)).filter((i) => i.type === "task_due_soon"),
    ).toHaveLength(1);
  });

  it("变更留痕记录负责人集合（前后都是数组）", async () => {
    const { owner, a, b, c, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "留痕", assigneeIds: [a.id] });
    await updateTask(owner.id, t.id, { assigneeIds: [a.id, b.id, c.id] });

    const events = await listTaskEvents(owner.id, t.id);
    const ev = events.find((e) => e.action === "assignee_changed");
    expect(ev).toBeTruthy();
    expect((ev!.oldValue as { assigneeIds: string[] }).assigneeIds).toEqual([a.id]);
    expect((ev!.newValue as { assigneeIds: string[] }).assigneeIds).toEqual([a.id, b.id, c.id]);
  });

  it("listProjectTasks 同时给出主负责人字段与完整集合", async () => {
    const { owner, a, b, project } = await scene();
    await createTask(owner.id, project.id, { title: "列表", assigneeIds: [a.id, b.id] });
    const [row] = await listProjectTasks(owner.id, project.id);
    expect(row.assigneeId).toBe(a.id);
    expect(row.assigneeName).toBe("a");
    expect(row.assigneeIds).toEqual([a.id, b.id]);
    expect(row.assignees.map((x) => x.name)).toEqual(["a", "b"]);
  });
});
