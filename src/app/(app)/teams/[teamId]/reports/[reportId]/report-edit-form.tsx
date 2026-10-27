"use client";

import { useActionState } from "react";
import { updateReportAction, type ReportFormState } from "../actions";

export function ReportEditForm({
  teamId,
  reportId,
  title,
  content,
}: {
  teamId: string;
  reportId: string;
  title: string;
  content: string;
}) {
  const [state, formAction, pending] = useActionState<ReportFormState, FormData>(
    updateReportAction,
    null,
  );

  return (
    <form action={formAction} className="ac-card space-y-3 p-4">
      <h2 className="font-medium text-ink">编辑草稿</h2>
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="reportId" value={reportId} />
      <input name="title" defaultValue={title} className="ac-field" />
      <textarea
        name="content"
        defaultValue={content}
        rows={18}
        className="ac-field font-mono text-xs leading-relaxed"
      />
      {state && "error" in state && <p className="text-sm text-high">{state.error}</p>}
      {state && "ok" in state && <p className="text-sm text-medium">已保存</p>}
      <button disabled={pending} className="ac-btn">
        {pending ? "保存中…" : "保存草稿"}
      </button>
    </form>
  );
}
