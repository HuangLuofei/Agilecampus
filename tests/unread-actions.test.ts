import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  markAnnouncementRead: vi.fn(),
  markTaskEventRead: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

// 本测试只验证已读操作与共享 layout 的联动，不连接或清理数据库。
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/announcement", () => ({ markAnnouncementRead: mocks.markAnnouncementRead }));
vi.mock("@/lib/activity", () => ({ markTaskEventNotificationRead: mocks.markTaskEventRead }));
vi.mock("@/lib/notification", () => ({
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
}));

import {
  markAnnouncementReadAction,
  markTaskEventReadAction,
} from "@/app/(app)/messages/actions";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(app)/projects/[projectId]/actions";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

function notificationForm(id = ITEM_ID) {
  const data = new FormData();
  data.set("notificationId", id);
  return data;
}

const cases = [
  { name: "公告", run: () => markAnnouncementReadAction(ITEM_ID), read: mocks.markAnnouncementRead },
  { name: "任务变更", run: () => markTaskEventReadAction(ITEM_ID), read: mocks.markTaskEventRead },
  { name: "单条通知", run: () => markNotificationReadAction(notificationForm()), read: mocks.markNotificationRead },
  { name: "全部通知", run: () => markAllNotificationsReadAction(), read: mocks.markAllNotificationsRead },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
});

describe("已读后同步侧栏角标", () => {
  it.each(cases)("$name：等待已读成功后刷新共享 layout", async ({ run, read }) => {
    let finishRead!: () => void;
    read.mockImplementation(() => new Promise<void>((resolve) => { finishRead = resolve; }));
    const action = run();
    await vi.waitFor(() => expect(read).toHaveBeenCalled());

    expect(read.mock.calls[0][0]).toBe(USER_ID);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    finishRead();
    await action;

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each(cases)("$name：未登录时不标读或更新角标", async ({ run, read }) => {
    mocks.auth.mockResolvedValue(null);
    await run();
    expect(read).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(cases)("$name：标读失败时不刷新为已读状态", async ({ run, read }) => {
    read.mockRejectedValue(new Error("网络失败"));
    await expect(run()).rejects.toThrow("网络失败");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("无效通知 ID 不更新数据库或角标", async () => {
    await markNotificationReadAction(notificationForm("invalid"));
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
