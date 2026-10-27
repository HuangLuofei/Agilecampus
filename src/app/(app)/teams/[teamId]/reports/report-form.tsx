"use client";

import { useActionState } from "react";
import { generateReportAction, type ReportFormState } from "./actions";

export function ReportForm({
  teamId,
  projects,
  defaultProjectId,
}: {
  teamId: string;
  projects: { id: string; name: string }[];
  defaultProjectId?: string | null;
}) {
  const [state, formAction, pending] = useActionState<ReportFormState, FormData>(
    generateReportAction,
    null,
  );

  const today = new Date().toLocaleDateString("sv-SE");
  const defaultStart = new Date(Date.now() - 6 * 86_400_000).toLocaleDateString("sv-SE");

  return (
    <form action={formAction} className="ac-card space-y-3 p-4">
      <h2 className="font-medium text-ink">生成周报</h2>
      <input type="hidden" name="teamId" value={teamId} />

      <label className="block text-sm text-ink-soft">
        项目范围
        <select name="projectId" defaultValue={defaultProjectId ?? ""} className="ac-field">
          <option value="">全部项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <label className="flex-1 text-sm text-ink-soft">
          起始日期
          <input type="date" name="startDate" defaultValue={defaultStart} className="ac-field" />
        </label>
        <label className="flex-1 text-sm text-ink-soft">
          结束日期
          <input type="date" name="endDate" defaultValue={today} className="ac-field" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" name="includeRisks" defaultChecked />
        包含风险与下周计划
      </label>

      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <button disabled={pending} className="ac-btn">
        {pending ? "生成中…" : "生成并保存草稿"}
      </button>
    </form>
  );
}
