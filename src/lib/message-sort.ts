// 排序纯函数（无 db 依赖，客户端组件可安全复用）
// 排序键：pinned DESC →（unread 模式时）hasUnread DESC → lastActivityAt DESC。
// time 模式跳过未读键（未读不自动置顶）；同键按 id 保证稳定。

export type MessageSortMode = "time" | "unread";

export type SortableRoom = {
  roomId: string;
  lastActivityAt: Date | string | number;
  unread: number;
};

function toMs(t: Date | string | number): number {
  return t instanceof Date ? t.getTime() : new Date(t).getTime();
}

export function sortRooms<T extends SortableRoom>(
  rooms: T[],
  mode: MessageSortMode,
  pinnedRoomIds: Iterable<string>,
): T[] {
  const pinned = pinnedRoomIds instanceof Set ? pinnedRoomIds : new Set(pinnedRoomIds);
  return [...rooms].sort((a, b) => {
    const pinDiff = (pinned.has(b.roomId) ? 1 : 0) - (pinned.has(a.roomId) ? 1 : 0);
    if (pinDiff !== 0) return pinDiff;
    if (mode === "unread") {
      const unreadDiff = (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0);
      if (unreadDiff !== 0) return unreadDiff;
    }
    const timeDiff = toMs(b.lastActivityAt) - toMs(a.lastActivityAt);
    if (timeDiff !== 0) return timeDiff;
    return a.roomId.localeCompare(b.roomId);
  });
}

export type SortableNotification = {
  id: string;
  isRead: boolean;
  createdAt: Date | string | number;
};

export function sortNotifications<T extends SortableNotification>(
  items: T[],
  mode: MessageSortMode,
): T[] {
  return [...items].sort((a, b) => {
    if (mode === "unread") {
      const unreadDiff = (a.isRead ? 1 : 0) - (b.isRead ? 1 : 0);
      if (unreadDiff !== 0) return unreadDiff;
    }
    const timeDiff = toMs(b.createdAt) - toMs(a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}
