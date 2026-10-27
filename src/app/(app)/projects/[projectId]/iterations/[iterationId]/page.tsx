import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { getIteration, getIterationStats } from "@/lib/iteration";
import { listProjectTasks } from "@/lib/task";
import { buildBurndown } from "@/lib/burndown";
import { BackButton } from "@/components/back-button";
import Link from "next/link";
import { scopedHref } from "@/lib/workbench-navigation";
import { IterationControls } from "./iteration-controls";
import { BurndownChart } from "./burndown-chart";

const STATUS_LABEL: Record<string, string> = { planned: "未开始", active: "进行中", done: "已完成" };

export default async function IterationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; iterationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId, iterationId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(iterationId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  const iteration = await getIteration(session.user.id, iterationId);
  if (iteration.projectId !== projectId) notFound();

  const sp = await searchParams;
  const teamId = sp.team === access.project.teamId ? access.project.teamId : null;
  const href = (path: string) => scopedHref(path, teamId);

  const [stats, allTasks, burndown] = await Promise.all([
    getIterationStats(session.user.id, iterationId),
    listProjectTasks(session.user.id, projectId),
    buildBurndown(session.user.id, iterationId),
  ]);
  const tasks = allTasks.filter((t) => t.iterationId === iterationId);
  const isAdmin = access.role === "admin";

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-3">
        <BackButton fallbackHref={href(`/projects/${projectId}/iterations`)} />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">{iteration.name}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {iteration.startDate ?? "?"} ~ {iteration.endDate ?? "?"} ·{" "}
              {STATUS_LABEL[iteration.status] ?? iteration.status}
            </p>
          </div>
          {isAdmin && (
            <IterationControls
              projectId={projectId}
              iterationId={iterationId}
              status={iteration.status}
            />
          )}
        </div>
      </header>

      <section className="ac-card p-4">
        <h2 className="mb-3 font-medium text-ink">统计</h2>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          <Stat label="总任务" value={stats.total} />
          <Stat label="已完成" value={stats.done} />
          <Stat label="进行中" value={stats.doing} />
          <Stat label="待办" value={stats.todo} />
          <Stat label="阻塞" value={stats.blocked} />
          <Stat label="逾期" value={stats.overdue} />
          <Stat label="完成率" value={`${stats.completionRate}%`} />
          <Stat label="剩余" value={stats.remaining} />
        </div>
      </section>

      <section className="ac-card p-4">
        <h2 className="mb-3 font-medium text-ink">燃尽图</h2>
        <BurndownChart burndown={burndown} />
      </section>

      <section className="ac-card p-4">
        <h2 className="mb-3 font-medium text-ink">任务（{tasks.length}）</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-ink-soft">本迭代暂无任务。给任务填上迭代归属后即可在此统计。</p>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-ink">{t.title}</span>
                <span className="shrink-0 text-xs text-ink-faint">
                  [{t.status}] · {t.dueDate ?? "无截止"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-sunken/60 p-2 text-center">
      <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  );
}
