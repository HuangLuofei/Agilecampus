import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import {
  getOrCreateDmRoom,
  getOrCreateGroupRoom,
  listRoomMessages,
  sendMessage,
  markRoomRead,
  countUnreadChats,
} from "@/lib/chat";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "项目A" });
  return { owner, team, project, student, teacher, outsider };
}

describe("getOrCreateDmRoom", () => {
  beforeEach(resetDb);

  it("私聊幂等：反序获取同一会话", async () => {
    const { owner, student } = await scene();
    const a = await getOrCreateDmRoom(owner.id, student.id);
    const b = await getOrCreateDmRoom(student.id, owner.id);
    expect(b.id).toBe(a.id);
  });

  it("不能与自己私聊", async () => {
    const { owner } = await scene();
    await expect(getOrCreateDmRoom(owner.id, owner.id)).rejects.toThrow("不能与自己私聊");
  });
});

describe("getOrCreateGroupRoom", () => {
  beforeEach(resetDb);

  it("项目群聊：成员可获取且幂等（每项目一条）", async () => {
    const { owner, student, project } = await scene();
    const a = await getOrCreateGroupRoom(owner.id, project.id);
    const b = await getOrCreateGroupRoom(student.id, project.id);
    expect(b.id).toBe(a.id);
  });

  it("非成员获取群聊被拒", async () => {
    const { outsider, project } = await scene();
    await expect(getOrCreateGroupRoom(outsider.id, project.id)).rejects.toThrow("没有权限");
  });
});

describe("sendMessage / listRoomMessages", () => {
  beforeEach(resetDb);

  it("私聊：参与者可发，非参与者被拒", async () => {
    const { owner, student, outsider } = await scene();
    const room = await getOrCreateDmRoom(owner.id, student.id);
    const msg = await sendMessage(student.id, room.id, "你好");
    expect(msg.content).toBe("你好");
    await expect(sendMessage(outsider.id, room.id, "越权")).rejects.toThrow("没有权限");
  });

  it("群聊：成员可发，非成员被拒", async () => {
    const { owner, student, outsider, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    await sendMessage(student.id, room.id, "大家好");
    await expect(sendMessage(outsider.id, room.id, "越权")).rejects.toThrow("没有权限");
  });

  it("空消息被拒", async () => {
    const { owner, student } = await scene();
    const room = await getOrCreateDmRoom(owner.id, student.id);
    await expect(sendMessage(student.id, room.id, "   ")).rejects.toThrow("消息不能为空");
  });

  it("列出消息：含姓名与 mine 标记，非参与者被拒", async () => {
    const { owner, student, outsider } = await scene();
    const room = await getOrCreateDmRoom(owner.id, student.id);
    await sendMessage(student.id, room.id, "第一条");

    const msgs = await listRoomMessages(owner.id, room.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].senderName).toBe("student");
    expect(msgs[0].mine).toBe(false);
    await expect(listRoomMessages(outsider.id, room.id)).rejects.toThrow("没有权限");
  });
});

describe("markRoomRead / countUnreadChats", () => {
  beforeEach(resetDb);

  it("未读只计他人消息，标记已读后归零", async () => {
    const { owner, student } = await scene();
    const room = await getOrCreateDmRoom(owner.id, student.id);
    await sendMessage(student.id, room.id, "你好");

    expect(await countUnreadChats(owner.id)).toBe(1);
    expect(await countUnreadChats(student.id)).toBe(0); // 自己发的不算未读

    await markRoomRead(owner.id, room.id);
    expect(await countUnreadChats(owner.id)).toBe(0);
  });

  it("未读跨会话汇总", async () => {
    const { owner, student, teacher } = await scene();
    const r1 = await getOrCreateDmRoom(owner.id, student.id);
    const r2 = await getOrCreateDmRoom(owner.id, teacher.id);
    await sendMessage(student.id, r1.id, "A");
    await sendMessage(teacher.id, r2.id, "B");
    await sendMessage(teacher.id, r2.id, "C");
    await sendMessage(owner.id, r2.id, "我的回复"); // 自己的不计
    expect(await countUnreadChats(owner.id)).toBe(3);
  });
});
