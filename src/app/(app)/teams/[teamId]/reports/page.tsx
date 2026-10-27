import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects, teams } from "@/db/schema";
import { getTeamMembership } from "@/lib/team";
import { listWeeklyReports } from "@/lib/weekly-report";
import { BackButton } from "@/components/back-button";
import Link from "next/link";
import { ReportForm } from "./report-form";

const STATUS_LABEL: Record<string, string> = { draft: "草稿", published: "已发布" };

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(teamId).success) notFound();

  const me = await getTeamMembership(session.user.id, teamId);
  if (!me) notFound();

  const [team, projectRows, reports] = await Promise.all([
    db.select().from(teams).where(eq(teams.id, teamId)),
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.teamId, teamId))
      .orderBy(projects.createdAt),
    listWeeklyReports(session.user.id, teamId),
  ]);
  if (!team[0]) notFound();

  const sp = await searchParams;
  const defaultProjectId =
    typeof sp.project === "string" && z.uuid().safeParse(sp.project).success ? sp.project : null;

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <BackButton fallbackHref={`/teams/${teamId}`} />
        <h1 className="font-display text-2xl font-semibold text-ink">{team[0].name} · 周报</h1>
        <p className="text-sm text-ink-soft">
          基于真实工作记录生成结构化周报；草稿人人可存，正式发布需组长权限。
        </p>
      </header>

      <ReportForm teamId={teamId} projects={projectRows} defaultProjectId={defaultProjectId} />

      <section className="space-y-3">
        <h2 className="font-medium text-ink">历史周报（{reports.length}）</h2>
        {reports.length === 0 ? (
          <div className="ac-card p-8 text-center text-sm text-ink-soft">暂无周报。</div>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/teams/${teamId}/reports/${r.id}`} className="ac-card block p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-ink">{r.title}</span>
                    <span
                      className={`ac-badge shrink-0 ${
                        r.status === "published" ? "bg-primary-soft text-primary" : "bg-low-soft text-low"
                      }`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
                    <span>{r.periodStart} ~ {r.periodEnd}</span>
                    {r.projectName && <span>项目：{r.projectName}</span>}
                    <span>起草：{r.draftByName ?? "未知"}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
