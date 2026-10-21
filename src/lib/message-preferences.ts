import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  userMessagePreferences,
  userPinnedRooms,
  type MessageFilterMode,
  type MessageSortMode,
} from "@/db/schema";
import { AppError } from "./errors";

// 排序纯函数拆在 message-sort.ts（无 db 依赖，客户端可复用）；此处 re-export 方便服务端统一引用
export { sortRooms, sortNotifications } from "./message-sort";
export type { SortableRoom, SortableNotification } from "./message-sort";

// ── 消息中心偏好（聊天排序 / 通知排序 / 消息过滤，每人一行） ──────────────

export type MessagePreferences = {
  chatSortMode: MessageSortMode;
  notificationSortMode: MessageSortMode;
  chatFilterMode: MessageFilterMode;
};

const DEFAULT_PREFS: MessagePreferences = {
  chatSortMode: "time",
  notificationSortMode: "time",
  chatFilterMode: "all",
};

const SORT_MODES: readonly string[] = ["time", "unread"];
const FILTER_MODES: readonly string[] = ["all", "important"];

// 读取用户偏好；无记录时返回默认值（不写库）
export async function getMessagePreferences(userId: string): Promise<MessagePreferences> {
  const [row] = await db
    .select()
    .from(userMessagePreferences)
    .where(eq(userMessagePreferences.userId, userId));
  if (!row) return { ...DEFAULT_PREFS };
  return {
    chatSortMode: row.chatSortMode,
    notificationSortMode: row.notificationSortMode,
    chatFilterMode: row.chatFilterMode,
  };
}

// 部分更新偏好（upsert，未传字段保持原样/默认）；新消息不覆盖用户选择，只由用户主动设置
export async function setMessagePreferences(
  userId: string,
  patch: Partial<MessagePreferences>,
): Promise<MessagePreferences> {
  if (patch.chatSortMode !== undefined && !SORT_MODES.includes(patch.chatSortMode)) {
    throw new AppError("无效的聊天排序模式");
  }
  if (patch.notificationSortMode !== undefined && !SORT_MODES.includes(patch.notificationSortMode)) {
    throw new AppError("无效的通知排序模式");
  }
  if (patch.chatFilterMode !== undefined && !FILTER_MODES.includes(patch.chatFilterMode)) {
    throw new AppError("无效的消息过滤模式");
  }

  await db
    .insert(userMessagePreferences)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      target: userMessagePreferences.userId,
      set: { ...patch, updatedAt: new Date() },
    });
  return getMessagePreferences(userId);
}

// ── 个人会话置顶（只影响本人视图） ────────────────────────────────────────

export async function setRoomPinned(userId: string, roomId: string, pinned: boolean) {
  if (pinned) {
    await db.insert(userPinnedRooms).values({ userId, roomId }).onConflictDoNothing();
  } else {
    await db
      .delete(userPinnedRooms)
      .where(and(eq(userPinnedRooms.userId, userId), eq(userPinnedRooms.roomId, roomId)));
  }
  return { roomId, pinned };
}

export async function listPinnedRoomIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ roomId: userPinnedRooms.roomId })
    .from(userPinnedRooms)
    .where(eq(userPinnedRooms.userId, userId));
  return new Set(rows.map((r) => r.roomId));
}

// 供批量读取（如成员 2 周报）一次取多用户偏好
export async function getMessagePreferencesFor(
  userIds: string[],
): Promise<Map<string, MessagePreferences>> {
  const result = new Map<string, MessagePreferences>();
  if (userIds.length === 0) return result;
  const rows = await db
    .select()
    .from(userMessagePreferences)
    .where(inArray(userMessagePreferences.userId, userIds));
  for (const id of userIds) result.set(id, { ...DEFAULT_PREFS });
  for (const row of rows) {
    result.set(row.userId, {
      chatSortMode: row.chatSortMode,
      notificationSortMode: row.notificationSortMode,
      chatFilterMode: row.chatFilterMode,
    });
  }
  return result;
}
