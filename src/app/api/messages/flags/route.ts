import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { setMessageImportant, setMessageSaved } from "@/lib/message-flags";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  messageId: z.uuid(),
  kind: z.enum(["important", "saved"]),
  value: z.boolean(),
});

// 消息标记：important=小组级重要（组长设置）；saved=个人收藏（本人设置）
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  try {
    const { messageId, kind, value } = parsed.data;
    const result =
      kind === "important"
        ? await setMessageImportant(session.user.id, messageId, value)
        : await setMessageSaved(session.user.id, messageId, value);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message || "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/messages/flags] 操作失败:", e);
    return NextResponse.json({ error: "操作失败，请重试" }, { status: 500 });
  }
}
