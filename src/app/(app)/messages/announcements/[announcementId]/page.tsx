import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getAnnouncementForUser,
  getAnnouncementReadStats,
  listAnnouncementComments,
} from "@/lib/announcement";
import { AppError } from "@/lib/errors";
import { BackButton } from "@/components/back-button";
import { AnnouncementComments } from "./announcement-comments";
import { MarkAnnouncementRead } from "./mark-read";

function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ announcementId: string }>;
}) {
  const { announcementId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(announcementId).success) notFound();

  // 非成员 / 不存在统一 404，不泄露公告是否存在
  const { announcement, authorName, projectName } = await getAnnouncementForUser(
    session.user.id,
    announcementId,
  ).catch((e: unknown): never => {
    if (e instanceof AppError) notFound();
    throw e;
  });

  const [comments, readStats] = await Promise.all([
    listAnnouncementComments(session.user.id, announcementId),
    getAnnouncementReadStats(session.user.id, announcementId),
  ]);
  const readNames = readStats.readers.filter((r) => r.isRead).map((r) => r.name);

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <MarkAnnouncementRead announcementId={announcementId} />
      <header className="space-y-3">
        <BackButton fallbackHref="/messages?tab=notifications" label="返回通知" />
        <h1 className="font-display text-2xl font-semibold text-ink">{announcement.title}</h1>
        <p className="text-xs text-ink-faint">
          发布者：{authorName} · 项目：{projectName} · {fmtTime(announcement.createdAt)}
        </p>
        <p className="text-xs text-ink-faint">
          已读 {readStats.readCount}/{readStats.total} 人
          {readNames.length > 0 && <> · 已读：{readNames.join("、")}</>}
        </p>
      </header>

      <article className="ac-card whitespace-pre-wrap p-6 text-sm leading-relaxed text-ink-soft">
        {announcement.content}
      </article>

      <AnnouncementComments
        announcementId={announcementId}
        currentUserId={session.user.id}
        initialComments={comments}
      />
    </main>
  );
}
