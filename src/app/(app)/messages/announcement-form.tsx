"use client";

import { useActionState } from "react";
import { publishAnnouncementAction, type FormState } from "./actions";

export function AnnouncementForm({ projects }: { projects: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    publishAnnouncementAction,
    null,
  );

  if (projects.length === 0) return null;

  return (
    <form action={formAction} className="ac-card space-y-3 p-4">
      <h2 className="font-display text-base font-semibold text-ink">发布公告</h2>
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">对应项目</span>
          <select name="projectId" className="ac-field">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">标题</span>
          <input name="title" placeholder="如 本周组会安排" className="ac-field" />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">内容</span>
        <textarea name="content" rows={3} placeholder="公告正文…" className="ac-field" />
      </label>
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">发布后通知项目所在团队的所有成员</span>
        <button disabled={pending} className="ac-btn whitespace-nowrap">
          {pending ? "发布中…" : "发布公告"}
        </button>
      </div>
    </form>
  );
}
