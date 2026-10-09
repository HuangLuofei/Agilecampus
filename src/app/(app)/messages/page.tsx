import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyChatOverview } from "@/lib/chat";
import { listNotifications } from "@/lib/notification";
import { listMyProjects } from "@/lib/project";
import { ChatApp } from "../chat/chat-app";
import { NotificationsPanel } from "./notifications-panel";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const tab = (await searchParams).tab === "notifications" ? "notifications" : "chat";

  return (
    <main className="mx-auto max-w-5xl py-8">
      <TabBar active={tab} />

      {tab === "chat" ? (
        <ChatTab userId={session.user.id} userName={session.user.name ?? ""} />
      ) : (
        <NotificationsTab userId={session.user.id} />
      )}
    </main>
  );
}

function TabBar({ active }: { active: "chat" | "notifications" }) {
  const tabs = [
    { key: "chat", label: "对话", href: "/messages" },
    { key: "notifications", label: "通知", href: "/messages?tab=notifications" },
  ] as const;

  return (
    <div className="mb-6 flex items-center gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            active === t.key
              ? "border-primary text-primary"
              : "border-transparent text-ink-soft hover:text-primary"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

async function ChatTab({ userId, userName }: { userId: string; userName: string }) {
  const overview = await listMyChatOverview(userId);
  return <ChatApp userId={userId} userName={userName} initial={overview} />;
}

async function NotificationsTab({ userId }: { userId: string }) {
  const [items, myProjects] = await Promise.all([
    listNotifications(userId, 100),
    listMyProjects(userId),
  ]);
  const projects = myProjects
    .filter((p) => p.status === "active")
    .map((p) => ({ id: p.id, name: p.name }));
  return <NotificationsPanel items={items} projects={projects} />;
}
