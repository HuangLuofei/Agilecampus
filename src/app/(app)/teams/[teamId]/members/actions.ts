"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createInviteLink, revokeInviteLink, updateMemberRole } from "@/lib/team";
import { AppError } from "@/lib/errors";

const schema = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  // teacher 为库内遗留角色，界面不再发放；仅保留枚举以兼容存量 teacher 成员的展示
  role: z.enum(["admin", "teacher", "student"]),
});

export async function updateRoleAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = schema.parse(Object.fromEntries(formData));
  await updateMemberRole(session.user.id, parsed.teamId, parsed.userId, parsed.role);
  revalidatePath(`/teams/${parsed.teamId}/members`);
}

const createLinkSchema = z.object({
  teamId: z.uuid(),
  projectId: z.union([z.literal(""), z.uuid()]).optional(),
  expiresInDays: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(1).max(365).nullable(),
  ),
});

export type CreateLinkState = { error: string; url?: string } | null;

export async function createInviteLinkAction(
  _prev: CreateLinkState,
  formData: FormData,
): Promise<CreateLinkState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = createLinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const { url } = await createInviteLink(session.user.id, parsed.data.teamId, {
      projectId: parsed.data.projectId ? parsed.data.projectId : null,
      expiresInDays: parsed.data.expiresInDays,
    });
    revalidatePath(`/teams/${parsed.data.teamId}/members`);
    return { error: "", url };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}

export async function revokeInviteLinkAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = z
    .object({ teamId: z.uuid(), linkId: z.uuid() })
    .parse(Object.fromEntries(formData));
  await revokeInviteLink(session.user.id, parsed.linkId);
  revalidatePath(`/teams/${parsed.teamId}/members`);
}
