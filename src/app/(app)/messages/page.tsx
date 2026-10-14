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

  const params = await searchParams;
  const tab = params.tab === "notifications" ? "notifications" : "chat";
  const roomId = typeof params.room === "string" ? params.room : null;

  return (
    <main className="mx-auto max-w-5xl">
      {tab === "chat" ? (
        <ChatTab
          userId={session.user.id}
          userName={session.user.name ?? ""}
          initialRoomId={roomId}
        />
      ) : (
        <NotificationsTab userId={session.user.id} />
      )}
    </main>
  );
}

async function ChatTab({
  userId,
  userName,
  initialRoomId,
}: {
  userId: string;
  userName: string;
  initialRoomId?: string | null;
}) {
  const overview = await listMyChatOverview(userId);
  return (
    <ChatApp userId={userId} userName={userName} initial={overview} initialRoomId={initialRoomId} />
  );
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
