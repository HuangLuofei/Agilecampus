import { eq } from "drizzle-orm";
import { db } from "@/db";
import { iterations, tasks, type IterationStatus } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { listProjectDependencies } from "./task";
import { isTeamLead } from "./team-permissions";

// 迭代写操作口径：与项目/里程碑一致，仅组长（admin）
async function requireProjectLead(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access || !isTeamLead(access.role)) throw new ForbiddenError();
  return access;
}

// 迭代读取访问收敛点：迭代不存在或访问者非项目成员一律拒绝
async function requireIterationAccess(actorId: string, iterationId: string) {
  const [iteration] = await db.select().from(iterations).where(eq(iterations.id, iterationId));
  if (!iteration) throw new AppError("迭代不存在");
  const access = await getProjectForUser(actorId, iteration.projectId);
  if (!access) throw new ForbiddenError();
  return { iteration, access };
}

// 日期重叠判定：任一端缺日期则无法判定、不提示（保守）。YYYY-MM-DD 字典序等价日期先后。
function overlaps(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null,
): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && aEnd >= bStart;
}

// 同项目内与给定区间重叠的迭代（供「至少要提示」用，不硬拦截）
export async function findIterationDateConflicts(
  projectId: string,
  startDate: string | null,
  endDate: string | null,
  excludeId?: string,
) {
  const rows = await db.select().from(iterations).where(eq(iterations.projectId, projectId));
  return rows.filter(
    (it) => it.id !== excludeId && overlaps(it.startDate, it.endDate, startDate, endDate),
  );
}

export async function createIteration(
  actorId: string,
  projectId: string,
  input: {
    name: string;
    startDate?: string | null;
    endDate?: string | null;
    status?: IterationStatus;
  },
) {
  await requireProjectLead(actorId, projectId);
  const conflicts = await findIterationDateConflicts(
    projectId,
    input.startDate ?? null,
    input.endDate ?? null,
  );
  const [iteration] = await db
    .insert(iterations)
    .values({
      projectId,
      name: input.name,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      status: input.status ?? "planned",
      createdById: actorId,
    })
    .returning();
  return { iteration, conflicts };
}

export async function listIterations(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return db
    .select()
    .from(iterations)
    .where(eq(iterations.projectId, projectId))
    .orderBy(iterations.startDate);
}

export async function getIteration(actorId: string, iterationId: string) {
  const { iteration } = await requireIterationAccess(actorId, iterationId);
  return iteration;
}

export async function updateIteration(
  actorId: string,
  iterationId: string,
  patch: {
    name?: string;
    startDate?: string | null;
    endDate?: string | null;
    status?: IterationStatus;
  },
) {
  const { iteration } = await requireIterationAccess(actorId, iterationId);
  await requireProjectLead(actorId, iteration.projectId);

  const nextStart = patch.startDate !== undefined ? patch.startDate : iteration.startDate;
  const nextEnd = patch.endDate !== undefined ? patch.endDate : iteration.endDate;
  const conflicts = await findIterationDateConflicts(
    iteration.projectId,
    nextStart,
    nextEnd,
    iterationId,
  );

  const [updated] = await db
    .update(iterations)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.startDate !== undefined && { startDate: patch.startDate }),
      ...(patch.endDate !== undefined && { endDate: patch.endDate }),
      ...(patch.status !== undefined && { status: patch.status }),
    })
    .where(eq(iterations.id, iterationId))
    .returning();
  if (!updated) throw new AppError("迭代不存在");
  return { iteration: updated, conflicts };
}

export async function deleteIteration(actorId: string, iterationId: string) {
  const { iteration } = await requireIterationAccess(actorId, iterationId);
  await requireProjectLead(actorId, iteration.projectId);
  await db.delete(iterations).where(eq(iterations.id, iterationId));
}

type StatTask = { id: string; status: string; dueDate: string | null };

// 纯函数：统计某迭代内的任务分布。阻塞＝有未完成前置任务（派生，不落 status）；逾期＝截止日已过且未完成。
export function computeIterationStats(
  tasksInIteration: StatTask[],
  statusById: Map<string, string>,
  predecessorsBy: Map<string, string[]>,
  todayStr: string,
) {
  let total = 0;
  let done = 0;
  let doing = 0;
  let todo = 0;
  let blocked = 0;
  let overdue = 0;
  for (const t of tasksInIteration) {
    total++;
    if (t.status === "done") done++;
    else if (t.status === "doing") doing++;
    else todo++;
    if ((predecessorsBy.get(t.id) ?? []).some((p) => statusById.get(p) !== "done")) blocked++;
    if (t.status !== "done" && t.dueDate && t.dueDate < todayStr) overdue++;
  }
  return {
    total,
    done,
    doing,
    todo,
    blocked,
    overdue,
    completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
    remaining: total - done,
  };
}

// 前置任务 → 后置任务映射 + 全项目任务状态表（统计与燃尽图复用）
async function dependencyMaps(actorId: string, projectId: string) {
  const [taskRows, deps] = await Promise.all([
    db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.projectId, projectId)),
    listProjectDependencies(actorId, projectId),
  ]);
  const statusById = new Map(taskRows.map((r) => [r.id, r.status]));
  const predecessorsBy = new Map<string, string[]>();
  for (const d of deps) {
    const list = predecessorsBy.get(d.successorId) ?? [];
    list.push(d.predecessorId);
    predecessorsBy.set(d.successorId, list);
  }
  return { statusById, predecessorsBy };
}

export async function listIterationsWithStats(actorId: string, projectId: string) {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [rows, taskRows, { statusById, predecessorsBy }] = await Promise.all([
    db
      .select()
      .from(iterations)
      .where(eq(iterations.projectId, projectId))
      .orderBy(iterations.startDate),
    db
      .select({ id: tasks.id, iterationId: tasks.iterationId, status: tasks.status, dueDate: tasks.dueDate })
      .from(tasks)
      .where(eq(tasks.projectId, projectId)),
    dependencyMaps(actorId, projectId),
  ]);

  const todayStr = new Date().toLocaleDateString("sv-SE");
  return rows.map((it) => ({
    ...it,
    ...computeIterationStats(
      taskRows.filter((t) => t.iterationId === it.id),
      statusById,
      predecessorsBy,
      todayStr,
    ),
  }));
}

export async function getIterationStats(actorId: string, iterationId: string) {
  const { iteration } = await requireIterationAccess(actorId, iterationId);
  const [iterationTasks, { statusById, predecessorsBy }] = await Promise.all([
    db
      .select({ id: tasks.id, status: tasks.status, dueDate: tasks.dueDate })
      .from(tasks)
      .where(eq(tasks.iterationId, iterationId)),
    dependencyMaps(actorId, iteration.projectId),
  ]);
  const todayStr = new Date().toLocaleDateString("sv-SE");
  return {
    iterationId,
    ...computeIterationStats(iterationTasks, statusById, predecessorsBy, todayStr),
  };
}
