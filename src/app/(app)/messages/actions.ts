"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createAnnouncementComment,
  deleteAnnouncementComment,
  markAnnouncementRead,
  publishAnnouncement,
  updateAnnouncementComment,
} from "@/lib/announcement";
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

const commentSchema = z.object({
  announcementId: z.uuid(),
  content: z.string().trim().min(1, "评论不能为空").max(2000, "评论不能超过 2000 字"),
});

export async function createAnnouncementCommentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = commentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await createAnnouncementComment(session.user.id, parsed.data.announcementId, parsed.data.content);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限发表评论" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/messages/announcements/${parsed.data.announcementId}`);
  return null;
}

const updateCommentSchema = z.object({
  announcementId: z.uuid(),
  commentId: z.uuid(),
  content: z.string().trim().min(1, "评论不能为空").max(2000, "评论不能超过 2000 字"),
});

export async function updateAnnouncementCommentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = updateCommentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await updateAnnouncementComment(session.user.id, parsed.data.commentId, parsed.data.content);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限编辑该评论" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/messages/announcements/${parsed.data.announcementId}`);
  return null;
}

const deleteCommentSchema = z.object({
  announcementId: z.uuid(),
  commentId: z.uuid(),
});

export async function deleteAnnouncementCommentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = deleteCommentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await deleteAnnouncementComment(session.user.id, parsed.data.commentId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "没有权限删除该评论" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/messages/announcements/${parsed.data.announcementId}`);
  return null;
}

export async function markAnnouncementReadAction(announcementId: string): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  if (!z.uuid().safeParse(announcementId).success) return { error: "参数无效" };

  await markAnnouncementRead(session.user.id, announcementId);
  revalidatePath("/messages");
  revalidatePath(`/messages/announcements/${announcementId}`);
  return null;
}
