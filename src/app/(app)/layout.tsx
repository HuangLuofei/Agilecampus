import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { countUnreadNotifications } from "@/lib/notification";
import { countUnreadChats } from "@/lib/chat";
import { syncDueSoonNotifications } from "@/lib/reminder";
import { listMyTeamsWithProjects } from "@/lib/project";
import { AppSidebar } from "./app-sidebar";
import { DueReminderBanner } from "./due-reminder-banner";
import { getWorkbenchReminders } from "@/lib/workbench-reminders";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // 进入应用即生成临期/逾期提醒（按天去重），再统计未读，使角标即时反映
  await syncDueSoonNotifications(session.user.id);
  const [unreadCount, unreadChats, teams, reminders] = await Promise.all([
    countUnreadNotifications(session.user.id),
    countUnreadChats(session.user.id),
    listMyTeamsWithProjects(session.user.id),
    getWorkbenchReminders(session.user.id),
  ]);

  return (
    <div className="flex min-h-screen">
      <Suspense>
        <AppSidebar
          userName={session.user.name}
          teams={teams}
          unreadChats={unreadChats}
          unreadNotifications={unreadCount}
        />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense>
          <DueReminderBanner summaries={reminders.byTeam} teamIds={teams.map((team) => team.id)} />
        </Suspense>
        <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
      </div>
    </div>
  );
}
