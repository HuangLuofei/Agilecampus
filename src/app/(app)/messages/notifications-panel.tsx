import Link from "next/link";
import { listNotifications } from "@/lib/notification";
import { sortNotifications } from "@/lib/message-sort";
import type { MessageSortMode } from "@/lib/message-sort";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "../projects/[projectId]/actions";
import { AnnouncementForm } from "./announcement-form";
import { NotificationSortToggle } from "./notification-sort-toggle";

const TYPE_LABEL: Record<string, string> = {
  task_assigned: "任务指派",
  task_reassigned: "任务改派",
  task_completed: "任务完成",
  task_commented: "任务评论",
  task_updated: "任务变更",
  ai_committed: "AI 操作",
  system: "系统通知",
  announcement: "公告",
  document_created: "新文档",
  document_updated: "文档更新",
  document_deleted: "文档删除",
  resource_logged: "资源登记",
  resource_ended: "资源结束",
  task_due_soon: "到期提醒",
  asset_created: "新资产",
  chat_mentioned: "群聊提及",
};

// 这些类型的通知在副标题里展示操作者（公告另走「发布者」）
const SHOW_ACTOR = new Set([
  "document_created",
  "document_updated",
  "document_deleted",
  "resource_logged",
  "resource_ended",
  "asset_created",
  "chat_mentioned",
]);

type Items = Awaited<ReturnType<typeof listNotifications>>;

export function NotificationsPanel({
  items,
  projects,
  initialSortMode,
}: {
  items: Items;
  projects: { id: string; name: string }[];
  initialSortMode: MessageSortMode;
}) {
  // 通知排序：time=按时间倒序（未读不置顶）；unread=未读优先。聊天与通知各自独立设置。
  const sorted = sortNotifications(items, initialSortMode);

  return (
    <div className="space-y-4">
      <AnnouncementForm projects={projects} />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink-soft">{items.filter((item) => !item.isRead).length} 条未读</p>
          <NotificationSortToggle initialMode={initialSortMode} />
        </div>
        <form action={markAllNotificationsReadAction}>
          <button className="ac-btn-ghost" disabled={items.every((item) => item.isRead)}>
            全部标为已读
          </button>
        </form>
      </div>

      {sorted.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">暂时没有通知</div>
      ) : (
        <ul className="divide-y divide-line border-y border-line ac-card">
          {sorted.map((item) => (
            <li key={item.id} className={`flex gap-3 px-4 py-4 ${item.isRead ? "" : "bg-primary-soft/40"}`}>
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.isRead ? "bg-line-strong" : "bg-accent"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="text-sm font-semibold text-ink">{item.title}</h2>
                  <span className="text-xs text-ink-faint">{TYPE_LABEL[item.type] ?? "通知"}</span>
                </div>
                {item.type === "announcement" && (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    发布者：{item.actorName ?? "未知"} · 项目：{item.projectName ?? "—"}
                  </p>
                )}
                {SHOW_ACTOR.has(item.type) && (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    操作者：{item.actorName ?? "未知"}
                    {item.projectName && <> · 项目：{item.projectName}</>}
                  </p>
                )}
                <p className="mt-1 text-sm text-ink-soft">{item.content}</p>
                <time className="mt-1 block text-xs text-ink-faint">
                  {item.createdAt.toLocaleString("zh-CN")}
                </time>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!item.isRead && (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="notificationId" value={item.id} />
                    <button className="text-xs text-ink-soft hover:text-primary">标为已读</button>
                  </form>
                )}
                {item.linkUrl && (
                  <Link href={item.linkUrl} className="ac-btn-ghost text-xs">
                    {item.linkUrl.startsWith("/messages/changes/") ? "查看变更" : "查看"}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
