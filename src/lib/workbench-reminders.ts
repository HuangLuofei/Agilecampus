import { cache } from "react";
import { and, asc, eq, isNotNull, lte, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks, teamMembers, teams } from "@/db/schema";
import { classifyDue, DUE_SOON_DAYS, toDayString, todayStartMs } from "./due";
import { isAssigneeOf } from "./task";

export type TeamReminderSummary = {
  teamId: string;
  overdue: number;
  dueSoon: number;
  urgent: number;
  projectIds?: string[];
};

// Same audience as existing reminders: assignees plus the team's leader.
// Recheck membership so a historical assignment never exposes a former team's tasks.
export const getWorkbenchReminders = cache(async (actorId: string) => {
  const todayMs = todayStartMs();
  const horizon = toDayString(todayMs + DUE_SOON_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      status: tasks.status,
      projectId: projects.id,
      projectName: projects.name,
      teamId: teams.id,
      teamName: teams.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(teams, eq(projects.teamId, teams.id))
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, actorId)))
    .where(and(
      or(isAssigneeOf(actorId), eq(teamMembers.role, "admin")),
      ne(tasks.status, "done"),
      isNotNull(tasks.dueDate),
      lte(tasks.dueDate, horizon),
    ))
    .orderBy(asc(tasks.dueDate), asc(tasks.id));

  const byTeam = new Map<string, TeamReminderSummary>();
  const items = rows.flatMap((row) => {
    const state = classifyDue(row.dueDate, row.status, todayMs);
    if (state === "ok") return [];
    const urgent = state === "overdue" || row.priority === "high";
    const summary = byTeam.get(row.teamId) ?? { teamId: row.teamId, overdue: 0, dueSoon: 0, urgent: 0, projectIds: [] };
    const projectIds = summary.projectIds ??= [];
    if (!projectIds.includes(row.projectId)) projectIds.push(row.projectId);
    if (state === "overdue") summary.overdue++;
    else summary.dueSoon++;
    if (urgent) summary.urgent++;
    byTeam.set(row.teamId, summary);
    return [{ ...row, state, urgent }];
  });
  return { byTeam: [...byTeam.values()], items };
});
