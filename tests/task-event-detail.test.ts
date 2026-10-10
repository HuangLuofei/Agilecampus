import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { listNotifications } from "@/lib/notification";
import {
  createTaskEventComment,
  deleteTaskEventComment,
  describeTaskEvent,
  getTaskEventForUser,
  listTaskEventComments,
  listTaskEvents,
  markTaskEventNotificationRead,
  updateTaskEventComment,
} from "@/lib/activity";
import { resetDb } from "./helpers";

type Notif = Awaited<ReturnType<typeof listNotifications>>[number];

// 通知是 fire-and-forget（游离 Promise），轮询等它落库再断言
async function waitForNotif(
  userId: string,
  predicate: (n: Notif) => boolean,
  maxMs = 2000,
): Promise<Notif> {
  const start = Date.now();
  for (;;) {
    const hit = (await listNotifications(userId)).find(predicate);
    if (hit) return hit;
    if (Date.now() - start > maxMs) throw new Error("通知未在预期时间内出现");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com"); // 创建者
  const team = await createTeam(owner.id, "变更团队");
  const student = await makeUser("student@example.com"); // 负责人
  await joinTeam(student.id, team.inviteCode);
  const editor = await makeUser("editor@example.com"); // 操作者（≠创建者/负责人）
  await joinTeam(editor.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "项目A" });
  const task = await createTask(owner.id, project.id, { title: "登录页", assigneeId: student.id });
  return { owner, student, editor, outsider, project, task };
}

describe("变更通知 → 详情页链接", () => {
  beforeEach(resetDb);

  it("创建任务的通知 linkUrl 指向 created 事件详情页", async () => {
    const { owner, student, task } = await scene();
    const created = (await listTaskEvents(owner.id, task.id)).find((e) => e.action === "created")!;

    const n = await waitForNotif(student.id, (i) => i.type === "task_assigned");
    expect(n.linkUrl).toBe(`/messages/changes/${created.id}`);
    const [row] = await db.select().from(notifications).where(eq(notifications.id, n.id));
    expect(row.taskEventId).toBe(created.id);
  });

  it("改状态的通知 linkUrl 指向 status_changed 事件，广播给创建者与负责人", async () => {
    const { owner, student, editor, task } = await scene();
    await updateTask(editor.id, task.id, { status: "doing" });

    const statusEvent = (await listTaskEvents(owner.id, task.id)).find(
      (e) => e.action === "status_changed",
    )!;
    const url = `/messages/changes/${statusEvent.id}`;

    const ownerNotif = await waitForNotif(owner.id, (i) => i.linkUrl === url);
    const studentNotif = await waitForNotif(student.id, (i) => i.linkUrl === url);
    expect(ownerNotif.type).toBe("task_updated");
    expect(studentNotif).toBeTruthy();
    expect(ownerNotif.isRead).toBe(false);

    // 操作者本人也进列表，但直接算已读（与公告一致）
    const editorNotif = await waitForNotif(editor.id, (i) => i.linkUrl === url);
    expect(editorNotif.isRead).toBe(true);
  });
});

describe("describeTaskEvent", () => {
  it("状态 / 负责人 / 优先级翻成人话", () => {
    expect(
      describeTaskEvent({
        action: "status_changed",
        oldValue: { status: "todo" },
        newValue: { status: "done" },
      }).summary,
    ).toBe("将任务状态从「待办」改为「已完成」");

    expect(
      describeTaskEvent(
        { action: "assignee_changed", oldValue: { assigneeId: "u1" }, newValue: { assigneeId: "u2" } },
        { u1: "张三", u2: "李四" },
      ).summary,
    ).toBe("将负责人从「张三」改为「李四」");

    // 取消指派
    expect(
      describeTaskEvent(
        { action: "assignee_changed", oldValue: { assigneeId: "u1" }, newValue: { assigneeId: null } },
        { u1: "张三" },
      ).summary,
    ).toBe("将负责人从「张三」改为「未指派」");

    expect(
      describeTaskEvent({
        action: "priority_changed",
        oldValue: { priority: "low" },
        newValue: { priority: "high" },
      }).fields[0],
    ).toEqual({ label: "优先级", before: "低", after: "高" });
  });
});

describe("getTaskEventForUser", () => {
  beforeEach(resetDb);

  it("成员可读，返回任务标题 / 项目名 / 操作者 / 摘要", async () => {
    const { owner, editor, task } = await scene();
    await updateTask(editor.id, task.id, { status: "doing" });
    const statusEvent = (await listTaskEvents(owner.id, task.id)).find(
      (e) => e.action === "status_changed",
    )!;

    const detail = await getTaskEventForUser(owner.id, statusEvent.id);
    expect(detail.task.title).toBe("登录页");
    expect(detail.projectName).toBe("项目A");
    expect(detail.actorName).toBe("editor");
    expect(detail.summary).toBe("将任务状态从「待办」改为「进行中」");
    expect(detail.fields[0]).toEqual({ label: "状态", before: "待办", after: "进行中" });
  });

  it("非成员被拒；不存在抛可展示错误", async () => {
    const { owner, outsider, task } = await scene();
    const created = (await listTaskEvents(owner.id, task.id)).find((e) => e.action === "created")!;
    await expect(getTaskEventForUser(outsider.id, created.id)).rejects.toThrow("没有权限");
    await expect(
      getTaskEventForUser(owner.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow("变更记录不存在");
  });
});

describe("打开详情即标读", () => {
  beforeEach(resetDb);

  it("只标读本人的行、幂等，不影响其他收件人", async () => {
    const { owner, student, editor, task } = await scene();
    await updateTask(editor.id, task.id, { status: "doing" });

    const statusEvent = (await listTaskEvents(owner.id, task.id)).find(
      (e) => e.action === "status_changed",
    )!;
    const url = `/messages/changes/${statusEvent.id}`;
    const studentNotif = await waitForNotif(student.id, (i) => i.linkUrl === url);
    expect(studentNotif.isRead).toBe(false);

    await markTaskEventNotificationRead(owner.id, statusEvent.id);
    const ownerNotif = (await listNotifications(owner.id)).find((i) => i.linkUrl === url)!;
    expect(ownerNotif.isRead).toBe(true);

    // 幂等：再次调用不报错，别人仍为未读
    await markTaskEventNotificationRead(owner.id, statusEvent.id);
    expect((await listNotifications(owner.id)).find((i) => i.linkUrl === url)?.isRead).toBe(true);
    expect((await listNotifications(student.id)).find((i) => i.linkUrl === url)?.isRead).toBe(false);
  });
});

describe("变更评论", () => {
  beforeEach(resetDb);

  // 造一条 status_changed 变更作为评论挂载点
  async function eventScene() {
    const { owner, student, editor, outsider, task } = await scene();
    await updateTask(editor.id, task.id, { status: "doing" });
    const eventId = (await listTaskEvents(owner.id, task.id)).find(
      (e) => e.action === "status_changed",
    )!.id;
    return { owner, student, editor, outsider, task, eventId };
  }

  it("项目成员可评论，列表可读（trim 生效）", async () => {
    const { owner, student, eventId } = await eventScene();
    const c = await createTaskEventComment(student.id, eventId, "  收到！  ");
    expect(c.content).toBe("收到！");

    const list = await listTaskEventComments(owner.id, eventId);
    expect(list).toHaveLength(1);
    expect(list[0].authorName).toBe("student");
    expect(list[0].content).toBe("收到！");
  });

  it("空评论 / 超长评论被拒", async () => {
    const { student, eventId } = await eventScene();
    await expect(createTaskEventComment(student.id, eventId, "   ")).rejects.toThrow("不能为空");
    await expect(createTaskEventComment(student.id, eventId, "x".repeat(2001))).rejects.toThrow(
      "2000",
    );
  });

  it("非作者不能编辑，作者可编辑", async () => {
    const { owner, student, eventId } = await eventScene();
    const c = await createTaskEventComment(student.id, eventId, "初稿");
    await expect(updateTaskEventComment(owner.id, c.id, "改")).rejects.toThrow("没有权限");
    const updated = await updateTaskEventComment(student.id, c.id, "改后");
    expect(updated.content).toBe("改后");
  });

  it("作者可删；管理员可删；软删后不再出现在列表", async () => {
    const { owner, student, editor, eventId } = await eventScene();
    const c1 = await createTaskEventComment(student.id, eventId, "a");
    const c2 = await createTaskEventComment(editor.id, eventId, "b");
    await deleteTaskEventComment(student.id, c1.id); // 作者删自己的
    await deleteTaskEventComment(owner.id, c2.id); // owner 是 admin
    expect(await listTaskEventComments(student.id, eventId)).toHaveLength(0);
  });

  it("非成员不能评论、不能看评论", async () => {
    const { outsider, eventId } = await eventScene();
    await expect(createTaskEventComment(outsider.id, eventId, "x")).rejects.toThrow("没有权限");
    await expect(listTaskEventComments(outsider.id, eventId)).rejects.toThrow("没有权限");
  });
});
