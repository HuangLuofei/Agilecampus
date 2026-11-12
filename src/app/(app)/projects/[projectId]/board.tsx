"use client";

import { useOptimistic, useState, useTransition, useMemo } from "react";
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { deriveColumns, type BoardColumn, type ColumnPatch } from "@/lib/board-columns";
import type { GroupBy } from "@/lib/board-filters";
import { moveTaskAction } from "./actions";
import { TaskCard, type Option } from "./task-card";

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  completionNote: string | null;
  status: "todo" | "doing" | "done";
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  // 多负责人：assigneeIds 为完整集合，assignees 带姓名（主负责人字段保留作兼容）
  assigneeIds: string[];
  assignees: { id: string; name: string }[];
  milestoneId: string | null;
  labels: { id: string; name: string; color: string }[];
};

function Column({
  column,
  tasks,
  projectId,
  canWrite,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
}: {
  column: BoardColumn;
  tasks: BoardTask[];
  projectId: string;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-40 w-72 shrink-0 space-y-2 rounded-xl border border-line p-3 transition-colors ${
        isOver ? "bg-primary-soft" : "bg-sunken"
      }`}
    >
      <h3 className={`flex items-center gap-2 text-sm font-semibold ${column.tone}`}>
        {column.label}
        <span className="ac-badge bg-surface text-ink-soft">{tasks.length}</span>
      </h3>
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          projectId={projectId}
          canWrite={canWrite}
          members={members}
          milestones={milestones}
          allTasks={allTasks}
          allLabels={allLabels}
          dependencies={dependencies}
        />
      ))}
    </div>
  );
}

export function Board({
  projectId,
  tasks,
  groupBy,
  canWrite,
  members,
  milestones,
  allTasks,
  allLabels,
  dependencies,
}: {
  projectId: string;
  tasks: BoardTask[];
  groupBy: GroupBy;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  allLabels: Option[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"manual" | "priority" | "dueDate">("manual");
  const [optimisticTasks, moveOptimistic] = useOptimistic(
    tasks,
    (current, move: { taskId: string; patch: ColumnPatch }) =>
      current.map((t) => {
        if (t.id !== move.taskId) return t;
        // 非负责人维度的落列：直接合并即可
        if (move.patch.assigneeId === undefined) return { ...t, ...move.patch };
        // 拖到某人列 = 改派给该人；同步多负责人集合，卡片才能立即显示新负责人
        const id = move.patch.assigneeId;
        return {
          ...t,
          ...move.patch,
          assigneeIds: id ? [id] : [],
          assignees: id ? [{ id, name: members.find((m) => m.id === id)?.name ?? "" }] : [],
        };
      }),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  // ★ 新增：根据下拉框的选择对任务进行排序
  const sortedTasks = useMemo(() => {
    const list = [...optimisticTasks];
    const priorityWeight = { high: 3, medium: 2, low: 1 };

    return list.sort((a, b) => {
      if (sortBy === "priority") {
        const wA = priorityWeight[a.priority as keyof typeof priorityWeight] || 0;
        const wB = priorityWeight[b.priority as keyof typeof priorityWeight] || 0;
        if (wA !== wB) return wB - wA;
      } else if (sortBy === "dueDate") {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      return 0;
    });
  }, [optimisticTasks, sortBy]);
  const columns = deriveColumns(groupBy, { members, milestones });

  function handleDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id);
    const over = event.over?.id;
    if (!over) return;
    const column = columns.find((c) => c.key === String(over));
    const task = optimisticTasks.find((t) => t.id === taskId);
    // 已在目标列则无须提交
    if (!column || !task || column.matches(task)) return;

    startTransition(async () => {
      setError(null);
      moveOptimistic({ taskId, patch: column.patch });
      const res = await moveTaskAction({ taskId, projectId, patch: column.patch });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <DndContext id={`board-${projectId}`} sensors={sensors} onDragEnd={handleDragEnd}>
      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      {/* 列数随分组维度而变，故横向滚动而非固定三栏 */}
            {/* ★ 新增的排序下拉框 */}
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="sort-select" className="text-sm font-medium text-ink-soft">排序：</label>
        <select
          id="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="ac-input h-8 px-2 text-sm"
        >
          <option value="manual">手动排序</option>
          <option value="priority">紧急优先</option>
          <option value="dueDate">截止日期优先</option>
        </select>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((col) => (
          <Column
            key={col.key}
            column={col}
            tasks={sortedTasks.filter((t) => col.matches(t))}
            projectId={projectId}
            canWrite={canWrite}
            members={members}
            milestones={milestones}
            allTasks={allTasks}
            allLabels={allLabels}
            dependencies={dependencies}
          />
        ))}
      </div>
    </DndContext>
  );
}
