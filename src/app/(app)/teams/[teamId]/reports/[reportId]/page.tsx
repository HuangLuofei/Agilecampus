import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeamMembership } from "@/lib/team";
import { isTeamLead } from "@/lib/team-permissions";
import { getWeeklyReportForUser } from "@/lib/weekly-report";
import { BackButton } from "@/components/back-button";
import { MarkdownBody } from "@/components/markdown-body";
import { ReportControls } from "./report-controls";
import { ReportEditForm } from "./report-edit-form";

const STATUS_LABEL: Record<string, string> = { draft: "草稿", published: "已发布" };

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ teamId: string; reportId: string }>;
}) {
  const { teamId, reportId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(teamId).success || !z.uuid().safeParse(reportId).success) notFound();

  const { report, draftByName, publishedByName, projectName } = await getWeeklyReportForUser(
    session.user.id,
    reportId,
  );
  if (report.teamId !== teamId) notFound();

  const me = await getTeamMembership(session.user.id, teamId);
  const isLead = me ? isTeamLead(me.role) : false;
  const canEdit = report.status === "draft" && (report.draftBy === session.user.id || isLead);
  const canPublish = report.status === "draft" && isLead;
  const canDelete = report.draftBy === session.user.id || isLead;

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <BackButton fallbackHref={`/teams/${teamId}/reports`} />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">{report.title}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {report.periodStart} ~ {report.periodEnd}
              {projectName ? ` · 项目：${projectName}` : " · 全部项目"}
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              起草：{draftByName ?? "未知"}
              {publishedByName ? ` · 发布：${publishedByName}` : ""}
            </p>
          </div>
          <span
            className={`ac-badge shrink-0 ${
              report.status === "published" ? "bg-primary-soft text-primary" : "bg-low-soft text-low"
            }`}
          >
            {STATUS_LABEL[report.status] ?? report.status}
          </span>
        </div>
      </header>

      {(canPublish || canDelete) && (
        <ReportControls teamId={teamId} reportId={reportId} status={report.status} canPublish={canPublish} />
      )}

      <section className="ac-card p-5">
        <MarkdownBody content={report.content} />
      </section>

      {canEdit && (
        <ReportEditForm
          teamId={teamId}
          reportId={reportId}
          title={report.title}
          content={report.content}
        />
      )}
    </main>
  );
}
