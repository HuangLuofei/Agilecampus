"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateMySkillTags, updateMyStudentId } from "@/lib/user";
import { AppError } from "@/lib/errors";

export type SkillTagsState = { error: string } | { ok: true } | null;
export type StudentIdState = { error: string } | { ok: true } | null;

const studentIdSchema = z.string().trim().regex(/^\d{14}$/, "学号须为 14 位数字");

// 补填/修改登录学号（老账号注册时没有学号，从个人资料页补）
export async function updateStudentIdAction(
  _prev: StudentIdState,
  formData: FormData,
): Promise<StudentIdState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = studentIdSchema.safeParse(formData.get("studentId") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await updateMyStudentId(session.user.id, parsed.data);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings/profile");
  return { ok: true };
}

// 编辑器把所选标签序列化为 JSON 塞进 hidden input，这里解包后再走 lib 清洗校验
const payloadSchema = z.object({ tags: z.string() });
const listSchema = z.array(z.string());

export async function updateSkillTagsAction(
  _prev: SkillTagsState,
  formData: FormData,
): Promise<SkillTagsState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = payloadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "参数无效" };

  let tags: unknown;
  try {
    tags = JSON.parse(parsed.data.tags);
  } catch {
    return { error: "参数无效" };
  }
  const parsedList = listSchema.safeParse(tags);
  if (!parsedList.success) return { error: "参数无效" };

  try {
    await updateMySkillTags(session.user.id, parsedList.data);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings/profile");
  return { ok: true };
}
