"use client";

import { useActionState, useState } from "react";
import { createProjectAction, type FormState } from "../teams/[teamId]/projects/actions";

export function NewProjectForm({ teams }: { teams: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createProjectAction,
    null,
  );

  if (!open) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen(true)} className="ac-btn">
          ＋ 新建项目
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="ac-card space-y-2 p-4">
      <h2 className="font-medium text-ink">新建项目</h2>
      <label className="block space-y-1">
        <span className="text-sm text-ink-soft">所属团队</span>
        <select name="teamId" className="ac-field">
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <input name="name" placeholder="项目名称" className="ac-field" />
      <textarea
        name="description"
        placeholder="项目描述（可选）"
        className="ac-field"
        rows={2}
      />
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
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ac-btn-ghost"
        >
          取消
        </button>
        <button disabled={pending} className="ac-btn">
          {pending ? "创建中…" : "创建"}
        </button>
      </div>
    </form>
  );
}
