"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createTeam, requestJoinTeam, reviewJoinRequest } from "@/lib/team";
import { AppError } from "@/lib/errors";

export type FormState = { error: string; success?: string } | null;

const nameSchema = z.string().trim().min(1, "请填写团队名称");
const inviteCodeSchema = z.string().trim().min(1, "请填写邀请码");

export async function createTeamAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = nameSchema.safeParse(formData.get("name") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await createTeam(session.user.id, parsed.data);
  revalidatePath("/teams");
  return null;
}

// 凭邀请码申请加入：不再直接入团，生成待审申请等组长审核
export async function joinTeamAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = inviteCodeSchema.safeParse(formData.get("inviteCode") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let teamName: string;
  try {
    const team = await requestJoinTeam(session.user.id, parsed.data);
    teamName = team.name;
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath("/teams");
  return { error: "", success: `申请已提交，等待「${teamName}」的组长审核` };
}

export async function reviewJoinRequestAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const requestId = z.uuid().safeParse(formData.get("requestId"));
  const decision = formData.get("decision") === "approved" ? "approved" : "rejected";
  if (!requestId.success) return;

  try {
    await reviewJoinRequest(session.user.id, requestId.data, decision);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    // 权限/状态类错误静默吞掉：页面上该申请本就不该出现，revalidate 后消失
  }
  revalidatePath(`/teams/${formData.get("teamId") ?? ""}/members`);
}
