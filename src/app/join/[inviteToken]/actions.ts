"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { applyToJoinTeam } from "@/lib/team";
import { AppError } from "@/lib/errors";

export type FormState = { error: string; success: string } | null;

const schema = z.object({
  teamId: z.uuid(),
  projectId: z.union([z.literal(""), z.uuid()]).optional(),
});

export async function applyJoinAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录", success: "" };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message, success: "" };

  try {
    await applyToJoinTeam(
      session.user.id,
      parsed.data.teamId,
      parsed.data.projectId ? parsed.data.projectId : null,
    );
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, success: "" };
    throw e;
  }
  revalidatePath("/teams");
  return { error: "", success: "申请已提交，请等待组长审核。" };
}
