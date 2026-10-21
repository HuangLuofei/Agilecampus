"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { TeamReminderSummary } from "@/lib/workbench-reminders";
import { scopedHref } from "@/lib/workbench-navigation";

export function DueReminderBanner({ summaries, teamIds }: { summaries: TeamReminderSummary[]; teamIds: string[] }) {
  const params = useSearchParams();
  const requestedTeam = params.get("team");
  const teamId = requestedTeam && teamIds.includes(requestedTeam) ? requestedTeam : null;
  const selected = summaries.filter((item) => !teamId || item.teamId === teamId);
  const overdue = selected.reduce((n, item) => n + item.overdue, 0);
  const dueSoon = selected.reduce((n, item) => n + item.dueSoon, 0);
  const projectIds = [...new Set(selected.flatMap((item) => item.projectIds ?? []))];
  // Preserve the existing shortcut when every selected reminder belongs to one project.
  const hasProjectScope = selected.every((item) => item.projectIds && item.projectIds.length > 0);
  const dueHref = hasProjectScope && projectIds.length === 1
    ? `/projects/${projectIds[0]}`
    : "/projects?attention=due";
  const outsideUrgent = teamId
    ? summaries.filter((item) => item.teamId !== teamId).reduce((n, item) => n + item.urgent, 0)
    : 0;
  if (overdue + dueSoon + outsideUrgent === 0) return null;

  return (
    <div className="border-b border-line bg-alert-soft" role="status">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 py-2 text-sm text-alert">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-alert" />
        <span className="font-medium">{teamId ? "当前小组提醒" : "到期提醒"}</span>
        {overdue + dueSoon > 0 ? (
          <>
            <span>{overdue} 个逾期 · {dueSoon} 个临期</span>
            <Link href={scopedHref(dueHref, teamId)} className="underline hover:no-underline">查看任务</Link>
          </>
        ) : <span>当前小组暂无到期任务</span>}
        {outsideUrgent > 0 && (
          <Link href="/projects?attention=urgent" className="ml-auto font-medium underline hover:no-underline">
            其他小组 {outsideUrgent} 个强提醒 · 查看全部
          </Link>
        )}
      </div>
    </div>
  );
}
