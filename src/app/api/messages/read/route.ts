import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { markRoomRead } from "@/lib/chat";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({ roomId: z.uuid() });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    await markRoomRead(session.user.id, parsed.data.roomId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/messages/read] 标记已读失败:", e);
    return NextResponse.json({ error: "操作失败，请重试" }, { status: 500 });
  }
}
