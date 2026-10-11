import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listRoomMessages, listRoomMembers, listMyRooms, getRoomMeta, markRoomRead } from "@/lib/chat";
import { AppError, ForbiddenError } from "@/lib/errors";

// 轮询：拉取某会话消息 + 全量未读（供侧栏红点）
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const roomId = new URL(req.url).searchParams.get("roomId");
  if (!roomId || !z.uuid().safeParse(roomId).success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  try {
    // 拉取即视为「正在查看该会话」：推进读水位，让发消息方实时看到已读回执
    await markRoomRead(session.user.id, roomId);
    const [messages, room, members, { groupRooms, dmRooms, unreadTotal }] = await Promise.all([
      listRoomMessages(session.user.id, roomId),
      getRoomMeta(session.user.id, roomId),
      listRoomMembers(session.user.id, roomId),
      listMyRooms(session.user.id),
    ]);
    return NextResponse.json({ messages, room, members, groupRooms, dmRooms, unreadTotal });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "没有权限" }, { status: 403 });
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[/api/messages] 拉取失败:", e);
    return NextResponse.json({ error: "加载失败，请重试" }, { status: 500 });
  }
}
