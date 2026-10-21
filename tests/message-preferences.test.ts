import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { getOrCreateDmRoom, getOrCreateGroupRoom, sendMessage, listMyConversationSummaries } from "@/lib/chat";
import {
  getMessagePreferences,
  setMessagePreferences,
  setRoomPinned,
  listPinnedRoomIds,
  getMessagePreferencesFor,
} from "@/lib/message-preferences";
import { sortRooms, sortNotifications } from "@/lib/message-sort";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "项目A" });
  return { owner, team, student, project };
}

describe("消息中心偏好", () => {
  beforeEach(resetDb);

  it("默认偏好：time / time / all", async () => {
    const { owner } = await scene();
    const prefs = await getMessagePreferences(owner.id);
    expect(prefs).toEqual({
      chatSortMode: "time",
      notificationSortMode: "time",
      chatFilterMode: "all",
    });
  });

  it("部分更新只改传入字段，其余保持", async () => {
    const { owner } = await scene();
    await setMessagePreferences(owner.id, { chatSortMode: "unread" });
    let prefs = await getMessagePreferences(owner.id);
    expect(prefs.chatSortMode).toBe("unread");
    expect(prefs.notificationSortMode).toBe("time");

    await setMessagePreferences(owner.id, { notificationSortMode: "unread", chatFilterMode: "important" });
    prefs = await getMessagePreferences(owner.id);
    expect(prefs.chatSortMode).toBe("unread"); // 未传，保持
    expect(prefs.notificationSortMode).toBe("unread");
    expect(prefs.chatFilterMode).toBe("important");
  });

  it("聊天与通知排序可分别设置、互不影响", async () => {
    const { owner } = await scene();
    await setMessagePreferences(owner.id, { chatSortMode: "unread" });
    const prefs = await getMessagePreferences(owner.id);
    expect(prefs.chatSortMode).toBe("unread");
    expect(prefs.notificationSortMode).toBe("time");
  });

  it("新消息不覆盖用户选择，只更新最近活动和未读数", async () => {
    const { owner, student } = await scene();
    await setMessagePreferences(owner.id, { chatSortMode: "unread", chatFilterMode: "important" });
    const room = await getOrCreateDmRoom(owner.id, student.id);
    await sendMessage(student.id, room.id, "新消息");

    const prefs = await getMessagePreferences(owner.id);
    expect(prefs.chatSortMode).toBe("unread");
    expect(prefs.chatFilterMode).toBe("important");

    // createProject 自动建了群聊房，所以是 2 条：群聊（无未读）+ 私聊（1 未读）
    const summaries = await listMyConversationSummaries(owner.id);
    expect(summaries).toHaveLength(2);
    const dm = summaries.find((s) => s.roomId === room.id);
    expect(dm?.unread).toBe(1); // 未读数更新
    expect(summaries.find((s) => s.roomId !== room.id)?.unread).toBe(0); // 群聊未读不变
  });

  it("无效值被拒", async () => {
    const { owner } = await scene();
    await expect(
      setMessagePreferences(owner.id, { chatSortMode: "nonsense" as never }),
    ).rejects.toThrow("无效的聊天排序模式");
    await expect(
      setMessagePreferences(owner.id, { chatFilterMode: "nonsense" as never }),
    ).rejects.toThrow("无效的消息过滤模式");
  });

  it("批量读取：无记录用户回默认值", async () => {
    const { owner, student } = await scene();
    await setMessagePreferences(owner.id, { chatSortMode: "unread" });
    const map = await getMessagePreferencesFor([owner.id, student.id]);
    expect(map.get(owner.id)?.chatSortMode).toBe("unread");
    expect(map.get(student.id)?.chatSortMode).toBe("time");
  });
});

describe("个人会话置顶", () => {
  beforeEach(resetDb);

  it("置顶只影响当前用户，取消后恢复", async () => {
    const { owner, student, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);

    await setRoomPinned(owner.id, room.id, true);
    expect([...(await listPinnedRoomIds(owner.id))]).toEqual([room.id]);
    expect([...(await listPinnedRoomIds(student.id))]).toEqual([]); // 不影响别人

    await setRoomPinned(owner.id, room.id, false);
    expect([...(await listPinnedRoomIds(owner.id))]).toEqual([]);
  });

  it("置顶幂等，重复置顶不报错", async () => {
    const { owner, project } = await scene();
    const room = await getOrCreateGroupRoom(owner.id, project.id);
    await setRoomPinned(owner.id, room.id, true);
    await setRoomPinned(owner.id, room.id, true);
    expect([...(await listPinnedRoomIds(owner.id))]).toEqual([room.id]);
  });
});

describe("sortRooms 排序键", () => {
  const t = (offsetSec: number) => new Date(1700000000000 + offsetSec * 1000);

  it("时间排序下未读不强行置顶", () => {
    const rooms = [
      { roomId: "a", lastActivityAt: t(100), unread: 5 }, // 新但未读
      { roomId: "b", lastActivityAt: t(200), unread: 0 }, // 最新且已读
      { roomId: "c", lastActivityAt: t(50), unread: 9 },
    ];
    const sorted = sortRooms(rooms, "time", []);
    expect(sorted.map((r) => r.roomId)).toEqual(["b", "a", "c"]);
  });

  it("未读优先：未读在前，同组内按最近活动倒序", () => {
    const rooms = [
      { roomId: "a", lastActivityAt: t(100), unread: 0 },
      { roomId: "b", lastActivityAt: t(50), unread: 1 },
      { roomId: "c", lastActivityAt: t(200), unread: 0 },
      { roomId: "d", lastActivityAt: t(150), unread: 3 },
    ];
    const sorted = sortRooms(rooms, "unread", []);
    // 未读组（d 新于 b）→ 已读组（c 新于 a）
    expect(sorted.map((r) => r.roomId)).toEqual(["d", "b", "c", "a"]);
  });

  it("置顶优先于未读与时间", () => {
    const rooms = [
      { roomId: "a", lastActivityAt: t(300), unread: 5 },
      { roomId: "b", lastActivityAt: t(10), unread: 0 },
      { roomId: "c", lastActivityAt: t(200), unread: 0 },
    ];
    const sorted = sortRooms(rooms, "unread", ["b"]);
    expect(sorted.map((r) => r.roomId)).toEqual(["b", "a", "c"]);
  });

  it("排序稳定：同键按 roomId 兜底", () => {
    const rooms = [
      { roomId: "z", lastActivityAt: t(100), unread: 0 },
      { roomId: "a", lastActivityAt: t(100), unread: 0 },
    ];
    const sorted = sortRooms(rooms, "time", []);
    expect(sorted.map((r) => r.roomId)).toEqual(["a", "z"]);
  });

  it("空列表与单元素", () => {
    expect(sortRooms([], "time", [])).toEqual([]);
    const one = [{ roomId: "x", lastActivityAt: t(1), unread: 2 }];
    expect(sortRooms(one, "unread", ["x"])).toEqual(one);
  });
});

describe("sortNotifications 排序键", () => {
  const t = (offsetSec: number) => new Date(1700000000000 + offsetSec * 1000);

  it("时间模式：纯按时间倒序，未读不置顶", () => {
    const items = [
      { id: "1", isRead: true, createdAt: t(300) },
      { id: "2", isRead: false, createdAt: t(100) },
      { id: "3", isRead: false, createdAt: t(200) },
    ];
    expect(sortNotifications(items, "time").map((x) => x.id)).toEqual(["1", "3", "2"]);
  });

  it("未读优先：未读在前，同组内按时间倒序", () => {
    const items = [
      { id: "1", isRead: true, createdAt: t(300) },
      { id: "2", isRead: false, createdAt: t(100) },
      { id: "3", isRead: false, createdAt: t(200) },
    ];
    expect(sortNotifications(items, "unread").map((x) => x.id)).toEqual(["3", "2", "1"]);
  });
});

describe("会话摘要排序联调", () => {
  beforeEach(resetDb);

  it("未读优先下未读会话在前；取消置顶恢复原排序", async () => {
    const { owner, student, project } = await scene();
    // 两个会话：群聊与私聊
    const group = await getOrCreateGroupRoom(owner.id, project.id);
    const dm = await getOrCreateDmRoom(owner.id, student.id);

    // 群聊有 2 条未读，私聊 1 条未读（群聊活动更早）
    await sendMessage(student.id, group.id, "群1");
    await sendMessage(student.id, group.id, "群2");
    await new Promise((r) => setTimeout(r, 10));
    await sendMessage(student.id, dm.id, "私1");

    const summaries = await listMyConversationSummaries(owner.id);
    expect(summaries).toHaveLength(2);

    // 未读优先：私聊（活动更新）… 两个都未读，按活动倒序 → dm 在前
    let sorted = sortRooms(summaries, "unread", []);
    expect(sorted[0].roomId).toBe(dm.id);

    // 置顶群聊 → 群聊浮到最前
    await setRoomPinned(owner.id, group.id, true);
    const pinned = await listPinnedRoomIds(owner.id);
    sorted = sortRooms(summaries, "unread", pinned);
    expect(sorted[0].roomId).toBe(group.id);

    // 取消置顶 → 恢复
    await setRoomPinned(owner.id, group.id, false);
    const unpinned = await listPinnedRoomIds(owner.id);
    sorted = sortRooms(summaries, "unread", unpinned);
    expect(sorted[0].roomId).toBe(dm.id);
  });
});
