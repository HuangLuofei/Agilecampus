import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { deleteAsset, updateAsset } from "@/lib/asset";
import { AppError, ForbiddenError } from "@/lib/errors";

const patchSchema = z.object({
  name: z.string().trim().min(1, "资产名不能为空").optional(),
  description: z.string().trim().optional().nullable(),
  url: z.string().trim().min(1, "url 不能为空").optional(),
  isArchived: z.boolean().optional(),
});

// 编辑资产：归档中仅允许「取消归档」，其余变更 403
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { assetId } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const asset = await updateAsset(session.user.id, assetId, parsed.data);
    return NextResponse.json({ asset });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/assets/[assetId]] 编辑资产失败:", e);
    return NextResponse.json({ error: "编辑失败，请重试" }, { status: 500 });
  }
}

// 删除资产：归档资产 403；同步清理本地上传文件
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { assetId } = await params;

  try {
    await deleteAsset(session.user.id, assetId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/assets/[assetId]] 删除资产失败:", e);
    return NextResponse.json({ error: "删除失败，请重试" }, { status: 500 });
  }
}
