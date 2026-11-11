import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { bindTaskToAsset, unbindTaskFromAsset } from "@/lib/asset";
import { AppError, ForbiddenError } from "@/lib/errors";

// taskId 传 uuid=绑定；传 null=解除关联（资产保留）。
// deliverableKind 可顺带指定交付物类型（presentation/survey/code，null=普通文件），不传则沿用原值。
const schema = z.object({
  taskId: z.uuid("taskId 无效").nullable(),
  deliverableKind: z.enum(["presentation", "survey", "code"]).nullish(),
});

// 资产绑定/解绑任务：任务须属于资产所在项目；归档资产 403
export async function POST(
  req: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { assetId } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const { taskId, deliverableKind } = parsed.data;
    const asset =
      taskId === null
        ? await unbindTaskFromAsset(session.user.id, assetId, deliverableKind)
        : await bindTaskToAsset(session.user.id, assetId, taskId, deliverableKind);
    return NextResponse.json({ asset });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/assets/[assetId]/bind-task] 绑定任务失败:", e);
    return NextResponse.json({ error: "绑定失败，请重试" }, { status: 500 });
  }
}
