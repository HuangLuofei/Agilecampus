import { NextResponse } from "next/server";
import { scanAndNotifyDue } from "@/lib/notify";
import { syncDueSoonNotificationsForAll } from "@/lib/reminder";

// 定时提醒端点：外部调度每日打一次。CRON_SECRET 为唯一护栏。
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  const provided = header ? /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() : null;
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const result = await scanAndNotifyDue();
    // 同步为站内「临期/逾期」提醒（覆盖未登录用户；按天去重）
    const inApp = await syncDueSoonNotificationsForAll();
    return NextResponse.json({ ...result, inAppUsers: inApp.users });
  } catch (e) {
    console.error("[/api/cron/reminders]", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
