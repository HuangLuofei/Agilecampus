"use client";

import { useActionState } from "react";
import { createDocumentAction, type FormState } from "./actions";

export function NewDocForm({ projectId, teamId }: { projectId: string; teamId?: string | null }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createDocumentAction,
    null,
  );

  return (
    <form action={formAction} className="ac-card space-y-3 p-5">
      <input type="hidden" name="projectId" value={projectId} />
      {teamId && <input type="hidden" name="team" value={teamId} />}
      <h2 className="font-display text-base font-semibold text-ink">新建文档</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="title" placeholder="文档标题，如 需求文档 / 会议纪要" className="ac-field" />
        <input name="category" placeholder="分类（选填），如 需求 / 教程" className="ac-field" />
      </div>
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <button disabled={pending} className="ac-btn">
        {pending ? "创建中…" : "创建文档"}
      </button>
    </form>
  );
}
