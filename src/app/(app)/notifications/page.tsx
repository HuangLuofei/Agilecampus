import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listNotifications } from "@/lib/notification";
import { markAllNotificationsReadAction, markNotificationReadAction } from "../projects/[projectId]/actions";

const TYPE_LABEL: Record<string, string> = {
  task_assigned: "任务指派",
  task_reassigned: "任务改派",
  task_completed: "任务完成",
  task_commented: "任务评论",
  task_updated: "任务变更",
  ai_committed: "AI 操作",
  system: "系统通知",
};

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const items = await listNotifications(session.user.id, 100);

  return (
    <main className="mx-auto max-w-3xl space-y-5 py-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">通知中心</h1>
          <p className="mt-1 text-sm text-ink-soft">{items.filter((item) => !item.isRead).length} 条未读</p>
        </div>
        <form action={markAllNotificationsReadAction}>
          <button className="ac-btn-ghost" disabled={items.every((item) => item.isRead)}>
            全部标为已读
          </button>
        </form>
      </header>

      {items.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">暂时没有通知</div>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {items.map((item) => (
            <li key={item.id} className={`flex gap-3 py-4 ${item.isRead ? "" : "bg-primary-soft/40"}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.isRead ? "bg-line-strong" : "bg-accent"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="text-sm font-semibold text-ink">{item.title}</h2>
                  <span className="text-xs text-ink-faint">{TYPE_LABEL[item.type] ?? "通知"}</span>
                </div>
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
                    查看
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
