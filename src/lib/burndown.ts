import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taskEvents, tasks } from "@/db/schema";
import { parseDay, toDayString } from "./due";
import { getIteration } from "./iteration";

const DAY = 86_400_000;

type Event = {
  taskId: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
};

// 某任务「迭代归属 + 完成态」随时间的变化点（按事件时间升序）
type TimelinePoint = { at: string; inIteration: boolean; done: boolean };

export type Burndown = {
  startDate: string;
  endDate: string;
  days: string[]; // [start .. end]，含首尾
  ideal: number[]; // 计划线，长度 = days
  actual: (number | null)[]; // 实际线，未来日为 null
  totalAtStart: number;
  hasData: boolean;
};

function enumerateDays(startDate: string, endDate: string): string[] {
  const start = parseDay(startDate);
  const end = parseDay(endDate);
  if (start === null || end === null || end < start) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += DAY) out.push(toDayString(t));
  return out;
}

// 从一条任务的事件流重建「是否在本迭代 / 是否已完成」随时间的变化。
// created 决定初始迭代归属（newValue.iterationId）；status_changed 决定完成态；
// updated 承载 iterationId 迁移（移入/移出迭代）；deleted 视为移出（不再计入剩余）。
function buildTimeline(events: Event[], iterationId: string): TimelinePoint[] {
  let inIteration = false;
  let done = false;
  const points: TimelinePoint[] = [];
  for (const ev of events) {
    const ov = (ev.oldValue ?? {}) as Record<string, unknown>;
    const nv = (ev.newValue ?? {}) as Record<string, unknown>;
    if (ev.action === "created") {
      inIteration = nv.iterationId === iterationId;
      done = false;
    } else if (ev.action === "status_changed") {
      done = nv.status === "done";
    } else if (ev.action === "updated") {
      if ("iterationId" in ov || "iterationId" in nv) inIteration = nv.iterationId === iterationId;
    } else if (ev.action === "deleted") {
      inIteration = false;
    }
    points.push({ at: toDayString(ev.createdAt.getTime()), inIteration, done });
  }
  return points;
}

// 某日结束时的状态：取「不晚于该日」的最后一条变化点；无则视为从未进入迭代。
function stateAtDay(tl: TimelinePoint[], day: string): { inIteration: boolean; done: boolean } {
  let state = { inIteration: false, done: false };
  for (const p of tl) {
    if (p.at <= day) state = { inIteration: p.inIteration, done: p.done };
    else break;
  }
  return state;
}

export async function buildBurndown(actorId: string, iterationId: string): Promise<Burndown> {
  const iteration = await getIteration(actorId, iterationId);
  const { startDate, endDate, projectId } = iteration;

  const empty: Burndown = {
    startDate: startDate ?? "",
    endDate: endDate ?? "",
    days: [],
    ideal: [],
    actual: [],
    totalAtStart: 0,
    hasData: false,
  };
  if (!startDate || !endDate) return empty;

  const [taskRows, eventRows] = await Promise.all([
    db
      .select({ id: tasks.id, iterationId: tasks.iterationId })
      .from(tasks)
      .where(eq(tasks.projectId, projectId)),
    db
      .select({
        taskId: taskEvents.taskId,
        action: taskEvents.action,
        oldValue: taskEvents.oldValue,
        newValue: taskEvents.newValue,
        createdAt: taskEvents.createdAt,
      })
      .from(taskEvents)
      .innerJoin(tasks, eq(taskEvents.taskId, tasks.id))
      .where(eq(tasks.projectId, projectId))
      .orderBy(taskEvents.createdAt),
  ]);

  const eventsByTask = new Map<string, Event[]>();
  for (const ev of eventRows) {
    const list = eventsByTask.get(ev.taskId) ?? [];
    list.push(ev);
    eventsByTask.set(ev.taskId, list);
  }

  // 相关任务：当前归属本迭代，或历史事件里曾归属本迭代（涵盖「中途加入 / 移出」）
  const relevant = new Set<string>();
  for (const t of taskRows) if (t.iterationId === iterationId) relevant.add(t.id);
  for (const ev of eventRows) {
    const ov = (ev.oldValue ?? {}) as Record<string, unknown>;
    const nv = (ev.newValue ?? {}) as Record<string, unknown>;
    const mentions =
      (ev.action === "created" && nv.iterationId === iterationId) ||
      (ev.action === "updated" && (ov.iterationId === iterationId || nv.iterationId === iterationId));
    if (mentions) relevant.add(ev.taskId);
  }
  if (relevant.size === 0) return empty;

  const days = enumerateDays(startDate, endDate);
  if (days.length === 0) return empty;

  const timelines = new Map<string, TimelinePoint[]>();
  for (const taskId of relevant) {
    timelines.set(taskId, buildTimeline(eventsByTask.get(taskId) ?? [], iterationId));
  }

  const today = new Date().toLocaleDateString("sv-SE");

  // 实际剩余：仅统计已流逝的日子（含今天），未来日置 null
  const actual: (number | null)[] = days.map((d) => {
    if (d > today) return null;
    let remaining = 0;
    for (const tl of timelines.values()) {
      const st = stateAtDay(tl, d);
      if (st.inIteration && !st.done) remaining++;
    }
    return remaining;
  });

  // 计划总量：迭代开始那一刻的剩余任务数（取「开始前一天结束」时的状态，避免把当日完成的任务提前扣掉）
  const dayBeforeStart = toDayString(parseDay(startDate)! - DAY);
  let totalAtStart = 0;
  for (const tl of timelines.values()) {
    const st = stateAtDay(tl, dayBeforeStart);
    if (st.inIteration && !st.done) totalAtStart++;
  }

  const n = days.length;
  const ideal = days.map((_, i) =>
    n <= 1 ? totalAtStart : Math.round((totalAtStart * (n - 1 - i)) / (n - 1)),
  );

  return { startDate, endDate, days, ideal, actual, totalAtStart, hasData: true };
}
