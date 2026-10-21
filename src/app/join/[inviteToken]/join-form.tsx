"use client";

import { useActionState } from "react";
import { applyJoinAction, type FormState } from "./actions";

export type JoinProjectOption = { id: string; name: string };

export function JoinForm({
  teamId,
  defaultProjectId,
  projects,
}: {
  teamId: string;
  defaultProjectId: string | null;
  projects: JoinProjectOption[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    applyJoinAction,
    null,
  );

  if (state?.success) {
    return (
      <p className="rounded-lg bg-done/12 px-4 py-3 text-sm text-done">{state.success}</p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="teamId" value={teamId} />
      <label className="block space-y-1 text-sm">
        <span className="block text-ink-soft">加入方式</span>
        <select
          name="projectId"
          defaultValue={defaultProjectId ?? ""}
          className="ac-field w-full py-2 text-sm"
        >
          <option value="">只加入小组</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              加入小组并关注「{p.name}」
            </option>
          ))}
        </select>
      </label>
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <button disabled={pending} className="ac-btn w-full">
        {pending ? "提交中…" : "申请加入（需组长审核）"}
      </button>
    </form>
  );
}
