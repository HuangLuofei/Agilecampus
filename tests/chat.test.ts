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
import {
  setMessageImportant,
  setMessageSaved,
  listImportantRoomMessages,
} from "@/lib/message-flags";
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

describe("消息标记：小组级重要 / 个人收藏", () => {
  beforeEach(resetDb);

  it("组长可标重要，标记后全员可见", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const msg = await sendMessage(student.id, room.id, "重要通知");

    await setMessageImportant(owner.id, msg.id, true);
    const ownerView = await listRoomMessages(owner.id, room.id);
    expect(ownerView[0].flags.isImportant).toBe(true);

    // 普通成员视角也可见小组级重要
    const studentView = await listRoomMessages(student.id, room.id);
    expect(studentView[0].flags.isImportant).toBe(true);
  });

  it("普通成员不能标重要", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const msg = await sendMessage(owner.id, room.id, "内容");

    await expect(setMessageImportant(student.id, msg.id, true)).rejects.toThrow("只有组长");
  });

  it("私聊不支持小组级重要", async () => {
    const { owner, student } = await scene();
    const room = await getOrCreateDmRoom(owner.id, student.id);
    const msg = await sendMessage(owner.id, room.id, "私聊内容");

    await expect(setMessageImportant(owner.id, msg.id, true)).rejects.toThrow("仅项目群聊");
  });

  it("取消重要后全员不再显示", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const msg = await sendMessage(student.id, room.id, "内容");

    await setMessageImportant(owner.id, msg.id, true);
    await setMessageImportant(owner.id, msg.id, false);
    const view = await listRoomMessages(student.id, room.id);
    expect(view[0].flags.isImportant).toBe(false);
  });

  it("个人收藏只影响自己", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const msg = await sendMessage(owner.id, room.id, "内容");

    await setMessageSaved(student.id, msg.id, true);
    const studentView = await listRoomMessages(student.id, room.id);
    expect(studentView[0].flags.savedByMe).toBe(true);

    const ownerView = await listRoomMessages(owner.id, room.id);
    expect(ownerView[0].flags.savedByMe).toBe(false); // 别人的收藏不串
  });

  it("收藏任意会话可用（私聊也可）", async () => {
    const { owner, student } = await scene();
    const room = await getOrCreateDmRoom(owner.id, student.id);
    const msg = await sendMessage(owner.id, room.id, "私聊内容");
    await setMessageSaved(student.id, msg.id, true);
    const view = await listRoomMessages(student.id, room.id);
    expect(view[0].flags.savedByMe).toBe(true);
  });

  it("取消收藏后恢复", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const msg = await sendMessage(owner.id, room.id, "内容");
    await setMessageSaved(student.id, msg.id, true);
    await setMessageSaved(student.id, msg.id, false);
    const view = await listRoomMessages(student.id, room.id);
    expect(view[0].flags.savedByMe).toBe(false);
  });
});

describe("仅重要过滤 / listImportantRoomMessages", () => {
  beforeEach(resetDb);

  it("filter=important 只返回小组级重要 + 我收藏的", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const normal = await sendMessage(student.id, room.id, "普通消息");
    const important = await sendMessage(student.id, room.id, "组长觉得重要");
    const saved = await sendMessage(student.id, room.id, "我要收藏");

    await setMessageImportant(owner.id, important.id, true);
    await setMessageSaved(owner.id, saved.id, true);

    const filtered = await listRoomMessages(owner.id, room.id, "important");
    expect(filtered.map((m) => m.content).sort()).toEqual(["我要收藏", "组长觉得重要"].sort());
    expect(filtered.some((m) => m.id === normal.id)).toBe(false);

    // 全量视图不受影响
    const all = await listRoomMessages(owner.id, room.id, "all");
    expect(all).toHaveLength(3);
  });

  it("过滤在重新进入会话后保持正确（数据持久）", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const msg = await sendMessage(student.id, room.id, "重要消息");
    await setMessageImportant(owner.id, msg.id, true);

    // 模拟重新进入：再次拉取
    const again = await listRoomMessages(owner.id, room.id, "important");
    expect(again).toHaveLength(1);
    expect(again[0].content).toBe("重要消息");
  });

  it("listImportantRoomMessages：普通消息不进结果（成员 2 周报接口）", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    await sendMessage(student.id, room.id, "普通1");
    await sendMessage(student.id, room.id, "普通2");
    const flagged = await sendMessage(student.id, room.id, "重要");
    await sendMessage(student.id, room.id, "普通3");

    await setMessageImportant(owner.id, flagged.id, true);
    const rows = await listImportantRoomMessages(owner.id, room.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("重要");
  });

  it("listImportantRoomMessages：我收藏的也计入", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    const saved = await sendMessage(student.id, room.id, "收藏的");
    await sendMessage(student.id, room.id, "普通的");

    await setMessageSaved(owner.id, saved.id, true);
    const rows = await listImportantRoomMessages(owner.id, room.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("收藏的");
  });

  it("没有标记时返回空", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    await sendMessage(student.id, room.id, "普通消息");
    const rows = await listImportantRoomMessages(owner.id, room.id);
    expect(rows).toEqual([]);
  });
});

describe("getRoomMeta.canManageImportant", () => {
  beforeEach(resetDb);

  it("群聊：组长 true、普通成员 false；私聊恒 false", async () => {
    const { owner, student, project } = await scene();
    const group = await getOrCreateGroupRoom(owner.id, project.id);
    expect((await getRoomMeta(owner.id, group.id)).canManageImportant).toBe(true);
    expect((await getRoomMeta(student.id, group.id)).canManageImportant).toBe(false);

    const dm = await getOrCreateDmRoom(owner.id, student.id);
    expect((await getRoomMeta(owner.id, dm.id)).canManageImportant).toBe(false);
  });
});
