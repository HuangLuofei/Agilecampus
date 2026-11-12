import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createAsset, listProjectAssets } from "@/lib/asset";
import { AppError, ForbiddenError } from "@/lib/errors";

const createSchema = z.object({
  projectId: z.uuid("projectId 无效"),
  name: z.string().trim().min(1, "请填写资产名"),
  assetType: z.enum(["file", "link"]),
  description: z.string().trim().optional(),
  url: z.string().trim().optional(),
  taskId: z.uuid().optional(),
  docId: z.uuid().optional(),
});

// 新增资产（multipart）：assetType=link 传 url；assetType=file 传 file（内嵌上传）或 url（引用已上传）
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  try {
    const formData = await req.formData();
    const get = (k: string) => {
      const v = formData.get(k);
      return typeof v === "string" && v.trim() !== "" ? v : undefined;
    };

    const parsed = createSchema.safeParse({
      projectId: get("projectId"),
      name: get("name"),
      assetType: get("assetType"),
      description: get("description"),
      url: get("url"),
      taskId: get("taskId"),
      docId: get("docId"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const fileEntry = formData.get("file");
    const file = fileEntry instanceof File ? fileEntry : null;

    const asset = await createAsset(session.user.id, {
      ...parsed.data,
      file: file ?? undefined,
    });
    return NextResponse.json({ asset });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/assets] 新增资产失败:", e);
    return NextResponse.json({ error: "新增资产失败，请重试" }, { status: 500 });
  }
}

// 按项目查询资产列表：默认不含已归档，?includeArchived=1 时全量
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const projectId = new URL(req.url).searchParams.get("projectId");
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";

  const parsed = z.object({ projectId: z.uuid("projectId 无效") }).safeParse({ projectId });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const list = await listProjectAssets(session.user.id, parsed.data.projectId, { includeArchived });
    return NextResponse.json({ assets: list });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/assets] 查询资产失败:", e);
    return NextResponse.json({ error: "查询失败，请重试" }, { status: 500 });
  }
}
