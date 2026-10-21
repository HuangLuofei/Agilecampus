import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getMessagePreferences, setMessagePreferences } from "@/lib/message-preferences";
import { AppError } from "@/lib/errors";

const patchSchema = z.object({
  chatSortMode: z.enum(["time", "unread"]).optional(),
  notificationSortMode: z.enum(["time", "unread"]).optional(),
  chatFilterMode: z.enum(["all", "important"]).optional(),
});

// 读取当前用户的消息中心偏好
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const prefs = await getMessagePreferences(session.user.id);
  return NextResponse.json({ preferences: prefs });
}

// 更新偏好（部分更新；只写本人记录）
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  try {
    const preferences = await setMessagePreferences(session.user.id, parsed.data);
    return NextResponse.json({ preferences });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/messages/preferences] 更新失败:", e);
    return NextResponse.json({ error: "保存失败，请重试" }, { status: 500 });
  }
}
