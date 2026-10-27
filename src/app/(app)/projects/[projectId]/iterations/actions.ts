"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createIteration, updateIteration, deleteIteration } from "@/lib/iteration";
import { AppError, ForbiddenError } from "@/lib/errors";

export type IterationFormState = { error: string } | { ok: true; warning?: string } | null;

const iterationSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1, "请填写迭代名称"),
  startDate: z.iso.date("日期格式不正确").optional(),
  endDate: z.iso.date("日期格式不正确").optional(),
  status: z.enum(["planned", "active", "done"]).optional(),
});

function conflictWarning(names: string[]): string | undefined {
  if (names.length === 0) return undefined;
  return `日期与已有迭代重叠：${names.join("、")}`;
}

export async function createIterationAction(
  _prev: IterationFormState,
  formData: FormData,
): Promise<IterationFormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = iterationSchema.safeParse({
    ...raw,
    startDate: raw.startDate || undefined,
    endDate: raw.endDate || undefined,
    status: raw.status || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { projectId, ...input } = parsed.data;
  try {
    const { conflicts } = await createIteration(session.user.id, projectId, input);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/iterations`);
    return { ok: true, warning: conflictWarning(conflicts.map((c) => c.name)) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "只有组长能创建迭代" };
    if (e instanceof AppError) return { error: e.message };
    return { error: "创建失败，请重试" };
  }
}

export async function updateIterationAction(
  _prev: IterationFormState,
  formData: FormData,
): Promise<IterationFormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const projectId = String(formData.get("projectId") ?? "");
  const iterationId = String(formData.get("iterationId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(iterationId).success) {
    return { error: "参数无效" };
  }
  const statusParsed = z.enum(["planned", "active", "done"]).safeParse(status);
  if (!statusParsed.success) return { error: "状态无效" };

  try {
    const { conflicts } = await updateIteration(session.user.id, iterationId, {
      status: statusParsed.data,
    });
    revalidatePath(`/projects/${projectId}/iterations/${iterationId}`);
    return { ok: true, warning: conflictWarning(conflicts.map((c) => c.name)) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "只有组长能修改迭代" };
    if (e instanceof AppError) return { error: e.message };
    return { error: "修改失败，请重试" };
  }
}

export async function deleteIterationAction(
  _prev: IterationFormState,
  formData: FormData,
): Promise<IterationFormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const projectId = String(formData.get("projectId") ?? "");
  const iterationId = String(formData.get("iterationId") ?? "");
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(iterationId).success) {
    return { error: "参数无效" };
  }

  try {
    await deleteIteration(session.user.id, iterationId);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/iterations`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "只有组长能删除迭代" };
    if (e instanceof AppError) return { error: e.message };
    return { error: "删除失败，请重试" };
  }
}
