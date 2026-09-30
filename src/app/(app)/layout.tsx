import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { countUnreadNotifications } from "@/lib/notification";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const unreadCount = await countUnreadNotifications(session.user.id);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/85 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link href="/projects" className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-md bg-primary font-display text-sm font-bold text-white shadow-sm"
            >
              A
            </span>
            <span className="font-display text-lg font-semibold text-ink">AgileCampus</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link
              href="/projects"
              className="rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              所有项目
            </Link>
            <Link
              href="/teams"
              className="rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              我的团队
            </Link>
            <Link
              href="/notifications"
              className="relative rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
              aria-label={`通知${unreadCount ? `，${unreadCount} 条未读` : ""}`}
            >
              通知
              {unreadCount > 0 && (
                <span className="ml-1 inline-grid min-h-4 min-w-4 place-items-center rounded-full bg-high px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
            <Link
              href="/settings/tokens"
              className="rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              设置
            </Link>
          </nav>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          className="flex items-center gap-3"
        >
          <span className="hidden text-sm text-ink-soft sm:inline">{session.user.name}</span>
          <button className="ac-btn-ghost">退出</button>
        </form>
      </header>
      <div className="mx-auto max-w-5xl p-6">{children}</div>
    </div>
  );
}
