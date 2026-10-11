import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { countUnreadNotifications } from "@/lib/notification";
import { countUnreadChats } from "@/lib/chat";
import { syncDueSoonNotifications } from "@/lib/reminder";
import { listMyTeamsWithProjects } from "@/lib/project";
import { AppSidebar } from "./app-sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // 进入应用即生成临期/逾期提醒（按天去重），再统计未读，使角标即时反映
  const due = await syncDueSoonNotifications(session.user.id);
  const [unreadCount, unreadChats, teams] = await Promise.all([
    countUnreadNotifications(session.user.id),
    countUnreadChats(session.user.id),
    listMyTeamsWithProjects(session.user.id),
  ]);

  const dueParts: string[] = [];
  if (due.overdue > 0) dueParts.push(`${due.overdue} 个任务已逾期`);
  if (due.dueSoon > 0) dueParts.push(`${due.dueSoon} 个任务即将到期`);

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        userName={session.user.name}
        teams={teams}
        unread={unreadCount + unreadChats}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {dueParts.length > 0 && (
          <div className="border-b border-line bg-high-soft">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-6 py-2 text-sm text-high">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-high" />
              <span className="font-medium">到期提醒</span>
              <span>{dueParts.join("，")}</span>
              <Link href="/messages?tab=notifications" className="underline hover:no-underline">
                查看提醒
              </Link>
            </div>
          </div>
        )}
        <div className="mx-auto w-full max-w-6xl p-6">{children}</div>
      </div>
    </div>
  );
}
