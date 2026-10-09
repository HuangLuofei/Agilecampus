import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getOrCreateDmRoom, getOrCreateGroupRoom } from "@/lib/chat";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dm"), userId: z.uuid() }),
  z.object({ type: z.literal("group"), projectId: z.uuid() }),
]);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const room =
      parsed.data.type === "dm"
        ? await getOrCreateDmRoom(session.user.id, parsed.data.userId)
        : await getOrCreateGroupRoom(session.user.id, parsed.data.projectId);
    return NextResponse.json({ roomId: room.id });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/messages/room] 创建会话失败:", e);
    return NextResponse.json({ error: "操作失败，请重试" }, { status: 500 });
  }
}
