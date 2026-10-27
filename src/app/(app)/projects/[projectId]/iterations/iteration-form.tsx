"use client";

import { useActionState } from "react";
import { createIterationAction, type IterationFormState } from "./actions";

export function IterationForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<IterationFormState, FormData>(
    createIterationAction,
    null,
  );

  return (
    <form action={formAction} className="ac-card space-y-2 p-4">
      <h2 className="font-medium text-ink">新建迭代</h2>
      <input type="hidden" name="projectId" value={projectId} />
      <input name="name" placeholder="迭代名称，如 Sprint 1" className="ac-field" />
      <div className="flex gap-2">
        <label className="flex-1 text-sm text-ink-soft">
          开始日期
          <input type="date" name="startDate" className="ac-field" />
        </label>
        <label className="flex-1 text-sm text-ink-soft">
          结束日期
          <input type="date" name="endDate" className="ac-field" />
        </label>
      </div>
      <select name="status" defaultValue="planned" className="ac-field w-auto text-sm">
        <option value="planned">未开始</option>
        <option value="active">进行中</option>
        <option value="done">已完成</option>
      </select>
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      {state && "ok" in state && state.warning && (
        <p className="text-sm text-medium">{state.warning}</p>
      )}
      <button disabled={pending} className="ac-btn px-3 py-2 text-sm">
        {pending ? "创建中…" : "创建迭代"}
      </button>
    </form>
  );
}
