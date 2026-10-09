"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createDocument, updateDocument, deleteDocument } from "@/lib/document";
import { AppError } from "@/lib/errors";

export type FormState = { error: string } | null;

const titleField = z.string().trim().min(1, "请填写文档标题");
const categoryField = z.string().trim().optional();

const createSchema = z.object({
  projectId: z.uuid(),
  title: titleField,
  category: categoryField,
  content: z.string().optional(),
});

export async function createDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let docId: string;
  try {
    const doc = await createDocument(session.user.id, parsed.data.projectId, {
      title: parsed.data.title,
      content: parsed.data.content,
      category: parsed.data.category,
    });
    docId = doc.id;
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/projects/${parsed.data.projectId}/docs`);
  redirect(`/projects/${parsed.data.projectId}/docs/${docId}`);
}

const updateSchema = z.object({
  projectId: z.uuid(),
  documentId: z.uuid(),
  title: titleField,
  category: categoryField,
  content: z.string().optional(),
});

export async function updateDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await updateDocument(session.user.id, parsed.data.documentId, {
      title: parsed.data.title,
      content: parsed.data.content,
      category: parsed.data.category,
    });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/projects/${parsed.data.projectId}/docs/${parsed.data.documentId}`);
  redirect(`/projects/${parsed.data.projectId}/docs/${parsed.data.documentId}`);
}

const deleteSchema = z.object({ projectId: z.uuid(), documentId: z.uuid() });

export async function deleteDocumentAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new AppError("参数无效");

  await deleteDocument(session.user.id, parsed.data.documentId);
  revalidatePath(`/projects/${parsed.data.projectId}/docs`);
  redirect(`/projects/${parsed.data.projectId}/docs`);
}
