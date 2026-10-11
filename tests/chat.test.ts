import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import {
  getOrCreateDmRoom,
  getOrCreateGroupRoom,
  listRoomMessages,
  listRoomMembers,
  getRoomMeta,
  sendMessage,
  markRoomRead,
  countUnreadChats,
} from "@/lib/chat";
import { listNotifications } from "@/lib/notification";
import { resetDb } from "./helpers";

type Notif = Awaited<ReturnType<typeof listNotifications>>[number];

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

describe("listRoomMembers / getRoomMeta", () => {
  beforeEach(resetDb);

  it("群聊成员 = 团队全员", async () => {
    const { owner, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const members = await listRoomMembers(owner.id, room.id);
    expect(members.map((m) => m.name).sort()).toEqual(["owner", "student", "teacher"]);
  });

  it("私聊成员 = 双方", async () => {
    const { owner, student } = await scene();
    const room = await getOrCreateDmRoom(owner.id, student.id);
    const members = await listRoomMembers(owner.id, room.id);
    expect(members.map((m) => m.name).sort()).toEqual(["owner", "student"]);
  });

  it("getRoomMeta：群聊标题与类型", async () => {
    const { owner, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const meta = await getRoomMeta(owner.id, room.id);
    expect(meta.type).toBe("group");
    expect(meta.title).toBe("项目A-东吴实验室");
  });
});

describe("群聊 @ 艾特通知", () => {
  beforeEach(resetDb);

  it("群聊中 @ 成员 → 该成员收到 chat_mentioned 通知", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    await sendMessage(owner.id, room.id, "@student 请看一下这个任务");

    const hit = await waitForNotif(student.id, (n) => n.type === "chat_mentioned");
    expect(hit.linkUrl).toBe(`/messages?tab=chat&room=${room.id}`);
    expect(hit.content).toContain("@ 了你");
    expect(hit.actorName).toBe("owner");
    expect(hit.isRead).toBe(false);
  });

  it("@ 自己 / @ 不存在的人不发通知", async () => {
    const { owner, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    await sendMessage(owner.id, room.id, "@owner 自我提醒 @nobody 没有这个人");

    // 等 fire-and-forget 完成（若有通知也该落库了）
    await new Promise((r) => setTimeout(r, 300));
    const notifs = await listNotifications(owner.id);
    expect(notifs.filter((n) => n.type === "chat_mentioned")).toHaveLength(0);
  });
});

describe("已读回执", () => {
  beforeEach(resetDb);

  it("私聊：对方标记已读后，发送方看到「已读」", async () => {
    const { owner, student } = await scene();
    const room = await getOrCreateDmRoom(owner.id, student.id);
    await sendMessage(owner.id, room.id, "在吗");

    let msgs = await listRoomMessages(owner.id, room.id);
    expect(msgs[0].readBy).toEqual([]);

    await markRoomRead(student.id, room.id);
    msgs = await listRoomMessages(owner.id, room.id);
    expect(msgs[0].readBy.map((r) => r.name)).toEqual(["student"]);
  });

  it("群聊：各成员已读后计数递增，发送者自己不在其列", async () => {
    const { owner, student, teacher, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    await sendMessage(owner.id, room.id, "大家好");

    let msgs = await listRoomMessages(owner.id, room.id);
    expect(msgs[0].readBy).toEqual([]);

    await markRoomRead(student.id, room.id);
    msgs = await listRoomMessages(owner.id, room.id);
    expect(msgs[0].readBy.map((r) => r.name).sort()).toEqual(["student"]);

    await markRoomRead(teacher.id, room.id);
    msgs = await listRoomMessages(owner.id, room.id);
    expect(msgs[0].readBy.map((r) => r.name).sort()).toEqual(["student", "teacher"]);
  });

  it("读水位判定：标记已读后新消息仍为未读，旧消息为已读", async () => {
    const { owner, student } = await scene();
    const room = await getOrCreateDmRoom(owner.id, student.id);
    await sendMessage(owner.id, room.id, "第一条");
    await markRoomRead(student.id, room.id);
    await new Promise((r) => setTimeout(r, 10)); // 确保读水位早于下一条消息
    await sendMessage(owner.id, room.id, "第二条");

    const msgs = await listRoomMessages(owner.id, room.id);
    const first = msgs.find((m) => m.content === "第一条");
    const second = msgs.find((m) => m.content === "第二条");
    expect(first!.readBy.map((r) => r.name)).toEqual(["student"]);
    expect(second!.readBy).toEqual([]);
  });
});
