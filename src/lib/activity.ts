import { desc, eq } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  taskEvents,
  tasks,
  users,
  type ActorType,
  type TaskEventAction,
} from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";

export async function recordTaskEvent(input: {
  taskId: string;
  action: TaskEventAction;
  actorId?: string | null;
  actorType?: ActorType;
  oldValue?: unknown;
  newValue?: unknown;
  tx?: DbTx;
}) {
  const exec = input.tx ?? db;
  const [event] = await exec
    .insert(taskEvents)
    .values({
      taskId: input.taskId,
      actorType: input.actorType ?? "human",
      actorId: input.actorId ?? null,
      action: input.action,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
    })
    .returning();
  return event;
}

export async function listTaskEvents(actorId: string, taskId: string) {
  const [task] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new AppError("任务不存在");
  const access = await getProjectForUser(actorId, task.projectId);
  if (!access) throw new ForbiddenError();

  return db
    .select({
      id: taskEvents.id,
      taskId: taskEvents.taskId,
      actorType: taskEvents.actorType,
      actorId: taskEvents.actorId,
      actorName: users.name,
      action: taskEvents.action,
      oldValue: taskEvents.oldValue,
      newValue: taskEvents.newValue,
      createdAt: taskEvents.createdAt,
    })
    .from(taskEvents)
    .leftJoin(users, eq(taskEvents.actorId, users.id))
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(desc(taskEvents.createdAt));
}

export function taskChangeEvents(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const fields: Array<[string, TaskEventAction]> = [
    ["status", "status_changed"],
    ["assigneeId", "assignee_changed"],
    ["dueDate", "due_date_changed"],
    ["priority", "priority_changed"],
    ["completionNote", "completion_note_changed"],
  ];
  return fields
    .filter(([field]) => before[field] !== after[field])
    .map(([field, action]) => ({
      action,
      oldValue: { [field]: before[field] ?? null },
      newValue: { [field]: after[field] ?? null },
    }));
}
