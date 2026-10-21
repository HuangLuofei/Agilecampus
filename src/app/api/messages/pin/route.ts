import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getRoomMeta } from "@/lib/chat";
import { setRoomPinned } from "@/lib/message-preferences";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  roomId: z.uuid(),
  pinned: z.boolean(),
});

// 个人会话置顶/取消置顶（只影响本人视图；校验会话访问权）
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  try {
    // 校验访问权：非参与者不能给会话置顶
    await getRoomMeta(session.user.id, parsed.data.roomId);
    await setRoomPinned(session.user.id, parsed.data.roomId, parsed.data.pinned);
    return NextResponse.json({ ok: true, pinned: parsed.data.pinned });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/messages/pin] 操作失败:", e);
    return NextResponse.json({ error: "操作失败，请重试" }, { status: 500 });
  }
}
