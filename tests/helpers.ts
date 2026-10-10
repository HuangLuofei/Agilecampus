import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function resetDb() {
  await db.execute(
    sql`TRUNCATE announcement_comments, announcements, notifications, task_comments, task_events, task_labels, labels, resource_usages, api_tokens, task_dependencies, messages, conversations, documents, chat_messages, chat_room_members, chat_rooms, tasks, milestones, projects, team_members, teams, users RESTART IDENTITY CASCADE`,
  );
}
