import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { bindDocToAsset } from "@/lib/asset";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({ docId: z.uuid("docId 无效") });

// 资产绑定文档：文档须属于资产所在项目；归档资产 403
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
    const asset = await bindDocToAsset(session.user.id, assetId, parsed.data.docId);
    return NextResponse.json({ asset });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/assets/[assetId]/bind-doc] 绑定文档失败:", e);
    return NextResponse.json({ error: "绑定失败，请重试" }, { status: 500 });
  }
}
