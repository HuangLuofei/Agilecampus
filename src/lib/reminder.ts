import { and, eq, gte, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { notifications, tasks } from "@/db/schema";
import { classifyDue, DUE_SOON_DAYS, toDayString, todayStartMs } from "./due";
import { createNotification } from "./notification";

const DAY = 86_400_000;

// 为某人尚未完成的临期/逾期任务生成站内提醒。按「同一任务每天至多一条」去重，重复调用无副作用。
export async function syncDueSoonNotifications(
  userId: string,
): Promise<{ dueSoon: number; overdue: number }> {
  const todayMs = todayStartMs();
  const horizon = toDayString(todayMs + DUE_SOON_DAYS * DAY);

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      dueDate: tasks.dueDate,
      status: tasks.status,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.assigneeId, userId),
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        lte(tasks.dueDate, horizon),
      ),
    );

  const items = rows
    .map((r) => ({ ...r, state: classifyDue(r.dueDate, r.status, todayMs) }))
    .filter((r) => r.state !== "ok");

  const dueSoon = items.filter((r) => r.state === "soon").length;
  const overdue = items.filter((r) => r.state === "overdue").length;
  if (items.length === 0) return { dueSoon: 0, overdue: 0 };

  // 当日去重：今天已经提醒过的同一任务不再重复
  const existing = await db
    .select({ linkUrl: notifications.linkUrl })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "task_due_soon"),
        gte(notifications.createdAt, new Date(todayMs)),
      ),
    );
  const seen = new Set(existing.map((e) => e.linkUrl));

  for (const r of items) {
    const linkUrl = `/projects/${r.projectId}?task=${r.id}`;
    if (seen.has(linkUrl)) continue;
    try {
      await createNotification({
        userId,
        type: "task_due_soon",
        title: r.state === "overdue" ? "任务已逾期" : "任务即将到期",
        content:
          r.state === "overdue"
            ? `任务《${r.title}》已逾期（截止 ${r.dueDate}）`
            : `任务《${r.title}》将于 ${r.dueDate} 到期`,
        linkUrl,
        projectId: r.projectId,
      });
    } catch (e) {
      console.error("[reminder] 到期提醒写入失败", e);
    }
  }

  return { dueSoon, overdue };
}

// 给所有负责人各跑一遍（供 cron 调用：覆盖尚未登录的用户）
export async function syncDueSoonNotificationsForAll(): Promise<{ users: number }> {
  const todayMs = todayStartMs();
  const horizon = toDayString(todayMs + DUE_SOON_DAYS * DAY);
  const rows = await db
    .selectDistinct({ assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.assigneeId),
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        lte(tasks.dueDate, horizon),
      ),
    );
  let users = 0;
  for (const r of rows) {
    if (!r.assigneeId) continue;
    await syncDueSoonNotifications(r.assigneeId);
    users++;
  }
  return { users };
}
