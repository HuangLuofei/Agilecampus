"use client";

import { useActionState } from "react";
import { updateIterationAction, deleteIterationAction, type IterationFormState } from "./actions";

export function IterationControls({
  projectId,
  iterationId,
  status,
}: {
  projectId: string;
  iterationId: string;
  status: string;
}) {
  const [updateState, updateAction, updatePending] = useActionState<IterationFormState, FormData>(
    updateIterationAction,
    null,
  );
  const [deleteState, deleteAction, deletePending] = useActionState<IterationFormState, FormData>(
    deleteIterationAction,
    null,
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={updateAction} className="flex items-center gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="iterationId" value={iterationId} />
        <select name="status" defaultValue={status} className="ac-field w-auto text-sm">
          <option value="planned">未开始</option>
          <option value="active">进行中</option>
          <option value="done">已完成</option>
        </select>
        <button disabled={updatePending} className="ac-btn px-3 py-2 text-sm">
          {updatePending ? "保存中…" : "更新状态"}
        </button>
      </form>

      <form action={deleteAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="iterationId" value={iterationId} />
        <button
          disabled={deletePending}
          className="ac-btn-ghost px-3 py-2 text-sm text-high"
          onClick={(e) => {
            if (!confirm("确认删除该迭代？任务会解除迭代归属但保留。")) e.preventDefault();
          }}
        >
          {deletePending ? "删除中…" : "删除"}
        </button>
      </form>

      {updateState?.error && <p className="text-sm text-high">{updateState.error}</p>}
      {updateState && "ok" in updateState && updateState.warning && (
        <p className="text-sm text-medium">{updateState.warning}</p>
      )}
      {deleteState?.error && <p className="text-sm text-high">{deleteState.error}</p>}
    </div>
  );
}
