"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createWeeklyReport,
  deleteWeeklyReport,
  generateWeeklyReport,
  publishWeeklyReport,
  updateWeeklyReport,
} from "@/lib/weekly-report";
import { notifyTeamMembers } from "@/lib/notification";

export type ReportFormState = { error: string } | { ok: true } | null;

const message = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

export async function generateReportAction(
  _prev: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const session = await auth();
  if (!session?.user) return { error: "未登录" };

  const parsed = z
    .object({
      teamId: z.uuid(),
      projectId: z.string().optional(),
      startDate: z.iso.date(),
      endDate: z.iso.date(),
    })
    .safeParse({
      teamId: formData.get("teamId"),
      projectId: formData.get("projectId") || undefined,
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
    });
  if (!parsed.success) return { error: "请填写完整且合法的日期范围" };
  const { teamId, projectId, startDate, endDate } = parsed.data;
  if (startDate > endDate) return { error: "开始日期不能晚于结束日期" };

  let reportId: string;
  try {
    const { title, content } = await generateWeeklyReport(session.user.id, {
      teamId,
      projectId: projectId ?? null,
      startDate,
      endDate,
      includeRisks: formData.get("includeRisks") === "on",
    });
    const report = await createWeeklyReport(session.user.id, {
      teamId,
      projectId: projectId ?? null,
      periodStart: startDate,
      periodEnd: endDate,
      title,
      content,
    });
    reportId = report.id;
  } catch (e) {
    return { error: message(e) };
  }
  redirect(`/teams/${teamId}/reports/${reportId}`);
}

export async function updateReportAction(
  _prev: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const session = await auth();
  if (!session?.user) return { error: "未登录" };

  const parsed = z
    .object({ teamId: z.uuid(), reportId: z.uuid(), title: z.string().min(1), content: z.string() })
    .safeParse({
      teamId: formData.get("teamId"),
      reportId: formData.get("reportId"),
      title: formData.get("title"),
      content: formData.get("content"),
    });
  if (!parsed.success) return { error: "标题不能为空" };

  try {
    await updateWeeklyReport(session.user.id, parsed.data.reportId, {
      title: parsed.data.title,
      content: parsed.data.content,
    });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath(`/teams/${parsed.data.teamId}/reports/${parsed.data.reportId}`);
  return { ok: true };
}

export async function publishReportAction(
  _prev: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const session = await auth();
  if (!session?.user) return { error: "未登录" };

  const parsed = z
    .object({ teamId: z.uuid(), reportId: z.uuid() })
    .safeParse({ teamId: formData.get("teamId"), reportId: formData.get("reportId") });
  if (!parsed.success) return { error: "参数不合法" };

  try {
    const report = await publishWeeklyReport(session.user.id, parsed.data.reportId);
    void notifyTeamMembers({
      teamId: parsed.data.teamId,
      actorId: session.user.id,
      title: "周报已发布",
      content: `《${report.title}》已正式发布`,
      type: "weekly_report_published",
      linkUrl: `/teams/${parsed.data.teamId}/reports/${parsed.data.reportId}`,
    });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath(`/teams/${parsed.data.teamId}/reports`);
  revalidatePath(`/teams/${parsed.data.teamId}/reports/${parsed.data.reportId}`);
  return { ok: true };
}

export async function deleteReportAction(
  _prev: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const session = await auth();
  if (!session?.user) return { error: "未登录" };

  const parsed = z
    .object({ teamId: z.uuid(), reportId: z.uuid() })
    .safeParse({ teamId: formData.get("teamId"), reportId: formData.get("reportId") });
  if (!parsed.success) return { error: "参数不合法" };

  try {
    await deleteWeeklyReport(session.user.id, parsed.data.reportId);
  } catch (e) {
    return { error: message(e) };
  }
  redirect(`/teams/${parsed.data.teamId}/reports`);
}
