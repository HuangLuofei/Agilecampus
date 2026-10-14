import Link from "next/link";
import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTaskEventForUser, listTaskEventComments } from "@/lib/activity";
import { AppError } from "@/lib/errors";
import { BackButton } from "@/components/back-button";
import { ChangeComments } from "./change-comments";
import { MarkTaskEventRead } from "./mark-read";

function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function ChangeDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(eventId).success) notFound();

  // 非成员 / 不存在统一 404，不泄露变更是否存在
  const { event, task, projectName, actorName, summary, fields } = await getTaskEventForUser(
    session.user.id,
    eventId,
  ).catch((e: unknown): never => {
    if (e instanceof AppError) notFound();
    throw e;
  });

  const taskHref = `/projects/${task.projectId}?task=${task.id}`;
  const comments = await listTaskEventComments(session.user.id, eventId);

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <MarkTaskEventRead eventId={eventId} />

      <header className="space-y-3">
        <BackButton fallbackHref="/messages?tab=notifications" label="返回通知" />
        <h1 className="font-display text-2xl font-semibold text-ink">变更详情</h1>
        <p className="text-xs text-ink-faint">
          {actorName} · 项目：{projectName} · {fmtTime(event.createdAt)}
        </p>
      </header>

      <section className="ac-card space-y-4 p-6">
        <p className="text-sm text-ink-soft">
          {actorName} {summary}：
          <Link href={taskHref} className="font-medium text-primary hover:underline">
            {task.title}
          </Link>
        </p>

        {fields.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-faint">
                <th className="py-1 pr-3 font-medium">字段</th>
                <th className="py-1 pr-3 font-medium">变更前</th>
                <th className="py-1 font-medium">变更后</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.label} className="border-t border-line">
                  <td className="py-2 pr-3 text-ink-soft">{f.label}</td>
                  <td className="py-2 pr-3 text-ink-faint">{f.before}</td>
                  <td className="py-2 text-ink">{f.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div>
          <Link href={taskHref} className="ac-btn-ghost text-xs">
            查看任务
          </Link>
        </div>
      </section>

      <ChangeComments
        eventId={eventId}
        currentUserId={session.user.id}
        initialComments={comments}
      />
    </main>
  );
}
