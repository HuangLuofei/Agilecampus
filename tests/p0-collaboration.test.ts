import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taskComments } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import {
  createTaskComment,
  deleteTaskComment,
  listTaskComments,
  updateTaskComment,
} from "@/lib/comment";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notification";
import { listTaskEvents } from "@/lib/activity";
import { resetDb } from "./helpers";

async function user(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await user("p0-owner@example.com");
  const team = await createTeam(owner.id, "P0 团队");
  const student = await user("p0-student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await user("p0-teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await user("p0-outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "P0 项目" });
  const task = await createTask(student.id, project.id, {
    title: "实现协作闭环",
    assigneeId: owner.id,
  });
  return { owner, student, teacher, outsider, project, task };
}

describe("P0 collaboration", () => {
  beforeEach(resetDb);

  it("records task creation and field changes with before/after values", async () => {
    const { student, task } = await scene();
    await updateTask(student.id, task.id, { status: "doing", dueDate: "2026-10-10" });
    const events = await listTaskEvents(student.id, task.id);
    expect(events.map((event) => event.action)).toContain("created");
    expect(events.find((event) => event.action === "status_changed")?.oldValue).toEqual({ status: "todo" });
    expect(events.find((event) => event.action === "status_changed")?.newValue).toEqual({ status: "doing" });
    expect(events.map((event) => event.action)).toContain("due_date_changed");
  });

  it("supports task discussion, editing, soft deletion, and audit history", async () => {
    const { owner, student, teacher, task } = await scene();
    const comment = await createTaskComment(student.id, task.id, "  已完成接口草稿  ");
    expect(comment.content).toBe("已完成接口草稿");
    await expect(updateTaskComment(owner.id, comment.id, "越权编辑")).rejects.toThrow("没有权限");
    await updateTaskComment(student.id, comment.id, "补充了验收条件");

    let comments = await listTaskComments(teacher.id, task.id);
    expect(comments[0].content).toBe("补充了验收条件");
    await deleteTaskComment(teacher.id, comment.id);
    comments = await listTaskComments(owner.id, task.id);
    expect(comments).toHaveLength(0);
    const history = await listTaskEvents(owner.id, task.id);
    expect(history.map((event) => event.action)).toEqual(
      expect.arrayContaining(["comment_created", "comment_updated", "comment_deleted"]),
    );
    const [stored] = await db.select().from(taskComments).where(eq(taskComments.id, comment.id));
    expect(stored.deletedAt).toBeInstanceOf(Date);
  });

  it("creates private notifications for participants and limits read actions to the recipient", async () => {
    const { owner, student, outsider, task } = await scene();
    await createTaskComment(student.id, task.id, "需要确认接口格式");
    const items = await listNotifications(owner.id);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("task_commented");
    expect(items[0].linkUrl).toContain(`task=${task.id}`);
    expect(await countUnreadNotifications(owner.id)).toBe(1);
    await expect(markNotificationRead(outsider.id, items[0].id)).rejects.toThrow("通知不存在");
    await markNotificationRead(owner.id, items[0].id);
    expect(await countUnreadNotifications(owner.id)).toBe(0);

    await createTaskComment(student.id, task.id, "第二条");
    await markAllNotificationsRead(owner.id);
    expect(await countUnreadNotifications(owner.id)).toBe(0);
    expect(await listNotifications(student.id)).toHaveLength(0);
  });

  it("does not reveal task data across teams", async () => {
    const { outsider, task } = await scene();
    await expect(listTaskComments(outsider.id, task.id)).rejects.toThrow("没有权限");
    await expect(listTaskEvents(outsider.id, task.id)).rejects.toThrow("没有权限");
  });
});
