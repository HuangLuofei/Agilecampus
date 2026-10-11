import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { uploadAssetFile } from "@/lib/asset";
import { AppError, ForbiddenError } from "@/lib/errors";

// 独立上传：先传文件拿 url，再经 POST /api/assets 建资产（或后续「文档上传归入资产库」复用）
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  try {
    const formData = await req.formData();
    const projectId = formData.get("projectId");
    const parsed = z.object({ projectId: z.uuid("projectId 无效") }).safeParse({
      projectId: typeof projectId === "string" ? projectId : undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: "请选择要上传的文件" }, { status: 400 });
    }

    const url = await uploadAssetFile(session.user.id, parsed.data.projectId, fileEntry);
    return NextResponse.json({ url });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/assets/upload] 上传失败:", e);
    return NextResponse.json({ error: "上传失败，请重试" }, { status: 500 });
  }
}
