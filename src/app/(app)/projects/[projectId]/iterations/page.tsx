import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { listIterationsWithStats } from "@/lib/iteration";
import { BackButton } from "@/components/back-button";
import Link from "next/link";
import { scopedHref } from "@/lib/workbench-navigation";
import { IterationForm } from "./iteration-form";

export default async function IterationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const sp = await searchParams;
  const teamId = sp.team === access.project.teamId ? access.project.teamId : null;
  const href = (path: string) => scopedHref(path, teamId);

  const iterations = await listIterationsWithStats(session.user.id, projectId);
  const isAdmin = access.role === "admin";

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-3">
        <BackButton fallbackHref={href(`/projects/${projectId}`)} />
        <h1 className="font-display text-2xl font-semibold text-ink">
          {access.project.name} · 迭代
        </h1>
        <p className="text-sm text-ink-soft">
          迭代统计与燃尽图入口；日期与已有迭代重叠时会提示。
        </p>
      </header>

      {isAdmin && <IterationForm projectId={projectId} />}

      {iterations.length === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-soft">暂无迭代。</div>
      ) : (
        <ul className="space-y-3">
          {iterations.map((it) => (
            <li key={it.id}>
              <Link
                href={href(`/projects/${projectId}/iterations/${it.id}`)}
                className="ac-card block p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{it.name}</span>
                  <span className="text-xs text-ink-faint">
                    {it.startDate ?? "?"} ~ {it.endDate ?? "?"} · {it.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
                  <span>总 {it.total}</span>
                  <span>已完成 {it.done}</span>
                  <span>进行中 {it.doing}</span>
                  <span>待办 {it.todo}</span>
                  <span>阻塞 {it.blocked}</span>
                  <span>逾期 {it.overdue}</span>
                  <span>完成率 {it.completionRate}%</span>
                  <span>剩余 {it.remaining}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
