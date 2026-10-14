import { db } from "@/db";
import { sql } from "drizzle-orm";

// 测试库为多文件共享。业务里的站内通知是 fire-and-forget（`void notify…`），
// 某条游离的 INSERT 可能正与本次 TRUNCATE 争锁，偶发 Postgres 死锁（40P01）。
// 这里对死锁重试几次，避免这种与本用例无关的偶发失败污染套件。
// drizzle 会把底层 PostgresError 包进 DrizzleQueryError，code 在其 .cause 上
function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code ?? err?.cause?.code;
}

async function truncateAll(attempts = 8) {
  for (let i = 0; ; i++) {
    try {
      await db.execute(
        sql`TRUNCATE announcement_comments, task_event_comments, announcements, notifications, task_comments, task_events, task_assignees, task_labels, labels, resource_usages, api_tokens, task_dependencies, messages, conversations, documents, chat_messages, chat_room_members, chat_rooms, tasks, milestones, projects, team_members, teams, users RESTART IDENTITY CASCADE`,
      );
      return;
    } catch (e) {
      // 40P01=死锁，40001=序列化失败：均属与本次 TRUNCATE 抢锁的游离写入所致，重试即可
      const code = pgCode(e);
      if ((code === "40P01" || code === "40001") && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 150));
        continue;
      }
      throw e;
    }
  }
}

export async function resetDb() {
  await truncateAll();
}
