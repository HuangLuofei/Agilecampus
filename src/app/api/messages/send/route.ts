import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { sendMessage } from "@/lib/chat";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  roomId: z.uuid(),
  content: z.string().trim().min(1, "消息不能为空"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const message = await sendMessage(session.user.id, parsed.data.roomId, parsed.data.content);
    return NextResponse.json({
      message: { ...message, mine: true, senderName: session.user.name ?? "" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/messages/send] 发送失败:", e);
    return NextResponse.json({ error: "发送失败，请重试" }, { status: 500 });
  }
}
