import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { listNotifications } from "@/lib/notification";
import { classifyDue, todayStartMs, toDayString } from "@/lib/due";
import { syncDueSoonNotifications, syncDueSoonNotificationsForAll } from "@/lib/reminder";
import { resetDb } from "./helpers";

const DAY = 86_400_000;
const day = (n: number) => toDayString(todayStartMs() + n * DAY);

describe("classifyDue", () => {
  const today = todayStartMs();

  it("已完成 / 无截止日 → ok", () => {
    expect(classifyDue(null, "todo", today)).toBe("ok");
    expect(classifyDue(day(1), "done", today)).toBe("ok");
  });

  it("早于今天 → overdue；今天 ~ +3 天 → soon；更远 → ok", () => {
    expect(classifyDue(day(-1), "todo", today)).toBe("overdue");
    expect(classifyDue(day(0), "doing", today)).toBe("soon");
    expect(classifyDue(day(3), "todo", today)).toBe("soon");
    expect(classifyDue(day(4), "todo", today)).toBe("ok");
  });
});

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "到期团队");
  const member = await makeUser("member@example.com");
  await joinTeam(member.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "项目A" });
  return { owner, member, team, project };
}

describe("syncDueSoonNotifications", () => {
  beforeEach(resetDb);

  it("为逾期 / 临期任务各生成一条提醒；远期与已完成不提醒", async () => {
    const { owner, member, project } = await scene();
    const overdue = await createTask(owner.id, project.id, {
      title: "逾期任务",
      assigneeId: member.id,
      dueDate: day(-1),
    });
    await createTask(owner.id, project.id, {
      title: "临期任务",
      assigneeId: member.id,
      dueDate: day(1),
    });
    await createTask(owner.id, project.id, {
      title: "远期任务",
      assigneeId: member.id,
      dueDate: day(10),
    });
    const done = await createTask(owner.id, project.id, {
      title: "已完成临期",
      assigneeId: member.id,
      dueDate: day(0),
    });
    await updateTask(owner.id, done.id, { status: "done" });

    const res = await syncDueSoonNotifications(member.id);
    // managed=0：这两条都是本人负责的任务，不是「管理员兜底」口径进来的
    expect(res).toEqual({ dueSoon: 1, overdue: 1, managed: 0, projectIds: [project.id] });

    const items = (await listNotifications(member.id)).filter((i) => i.type === "task_due_soon");
    expect(items).toHaveLength(2);

    const overdueNotif = items.find((i) => i.title === "任务已逾期")!;
    expect(overdueNotif.content).toBe(`任务《逾期任务》已逾期（截止 ${day(-1)}）`);
    expect(overdueNotif.linkUrl).toBe(`/projects/${project.id}?task=${overdue.id}`);

    const soonNotif = items.find((i) => i.title === "任务即将到期")!;
    expect(soonNotif.content).toBe(`任务《临期任务》将于 ${day(1)} 到期`);
  });

  it("跨项目时 projectIds 去重列出全部涉及的项目", async () => {
    const { owner, member, team, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "项目B" });
    await createTask(owner.id, project.id, {
      title: "A 逾期",
      assigneeId: member.id,
      dueDate: day(-1),
    });
    await createTask(owner.id, other.id, {
      title: "B 临期",
      assigneeId: member.id,
      dueDate: day(1),
    });

    const res = await syncDueSoonNotifications(member.id);
    expect(new Set(res.projectIds)).toEqual(new Set([project.id, other.id]));
  });

  it("按天幂等：重复调用不重复生成；只发给负责人本人", async () => {
    const { owner, member, project } = await scene();
    await createTask(owner.id, project.id, {
      title: "临期任务",
      assigneeId: member.id,
      dueDate: day(2),
    });

    await syncDueSoonNotifications(member.id);
    await syncDueSoonNotifications(member.id);
    const items = (await listNotifications(member.id)).filter((i) => i.type === "task_due_soon");
    expect(items).toHaveLength(1);

    // 创建者（非负责人）不收提醒
    expect((await listNotifications(owner.id)).filter((i) => i.type === "task_due_soon")).toHaveLength(
      0,
    );
  });

  it("syncDueSoonNotificationsForAll 为所有负责人补齐提醒（并含管理该项目的管理员兜底）", async () => {
    const { owner, member, project } = await scene();
    await createTask(owner.id, project.id, {
      title: "临期任务",
      assigneeId: member.id,
      dueDate: day(1),
    });

    const res = await syncDueSoonNotificationsForAll();
    // 负责人 member + 该项目所属团队的管理员 owner（兜底口径）→ 2 人
    expect(res.users).toBe(2);
    expect((await listNotifications(member.id)).filter((i) => i.type === "task_due_soon")).toHaveLength(
      1,
    );
    // 管理员不是负责人，提醒正文须标注来源（项目 + 负责人），多负责人以「、」连接
    const ownerNotifs = (await listNotifications(owner.id)).filter((i) => i.type === "task_due_soon");
    expect(ownerNotifs).toHaveLength(1);
    expect(ownerNotifs[0].content).toContain("（项目：项目A｜负责人：member）");
  });
});
