"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { publishAnnouncement } from "@/lib/notification";
import { AppError, ForbiddenError } from "@/lib/errors";

export type FormState = { error: string } | null;

const schema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1, "请填写公告标题"),
  content: z.string().trim().min(1, "请填写公告内容"),
});

export async function publishAnnouncementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await publishAnnouncement(session.user.id, parsed.data.projectId, {
      title: parsed.data.title,
      content: parsed.data.content,
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限发布公告" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }

  revalidatePath("/messages");
  revalidatePath("/notifications");
  return null;
}
