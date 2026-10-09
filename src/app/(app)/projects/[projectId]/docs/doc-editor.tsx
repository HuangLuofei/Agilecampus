"use client";

import { useActionState } from "react";
import { updateDocumentAction, type FormState } from "./actions";

export function DocEditor({
  projectId,
  documentId,
  initialTitle,
  initialCategory,
  initialContent,
}: {
  projectId: string;
  documentId: string;
  initialTitle: string;
  initialCategory: string;
  initialContent: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateDocumentAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="documentId" value={documentId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">标题</span>
          <input name="title" defaultValue={initialTitle} className="ac-field" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">分类（选填）</span>
          <input name="category" defaultValue={initialCategory} className="ac-field" />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-soft">正文（支持 Markdown）</span>
        <textarea
          name="content"
          defaultValue={initialContent}
          rows={16}
          className="ac-field font-mono text-sm leading-relaxed"
        />
      </label>

      {state?.error && <p className="text-sm text-high">{state.error}</p>}

      <div className="flex gap-2">
        <button disabled={pending} className="ac-btn">
          {pending ? "保存中…" : "保存"}
        </button>
        <a href={`/projects/${projectId}/docs/${documentId}`} className="ac-btn-ghost">
          取消
        </a>
      </div>
    </form>
  );
}
