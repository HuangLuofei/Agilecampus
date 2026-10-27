"use client";

import { useActionState } from "react";
import { deleteReportAction, publishReportAction, type ReportFormState } from "../actions";

export function ReportControls({
  teamId,
  reportId,
  status,
  canPublish,
}: {
  teamId: string;
  reportId: string;
  status: string;
  canPublish: boolean;
}) {
  const [pubState, pubAction, pubPending] = useActionState<ReportFormState, FormData>(
    publishReportAction,
    null,
  );
  const [delState, delAction, delPending] = useActionState<ReportFormState, FormData>(
    deleteReportAction,
    null,
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status !== "published" && canPublish && (
        <form action={pubAction}>
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="reportId" value={reportId} />
          <button
            disabled={pubPending}
            className="ac-btn"
            onClick={(e) => {
              if (!confirm("确认正式发布该周报？发布后将通知全体成员。")) e.preventDefault();
            }}
          >
            {pubPending ? "发布中…" : "发布周报"}
          </button>
        </form>
      )}

      <form action={delAction}>
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="reportId" value={reportId} />
        <button
          disabled={delPending}
          className="ac-btn-ghost text-high"
          onClick={(e) => {
            if (!confirm("确认删除该周报？")) e.preventDefault();
          }}
        >
          {delPending ? "删除中…" : "删除"}
        </button>
      </form>

      {pubState && "error" in pubState && <p className="text-sm text-high">{pubState.error}</p>}
      {delState && "error" in delState && <p className="text-sm text-high">{delState.error}</p>}
    </div>
  );
}
