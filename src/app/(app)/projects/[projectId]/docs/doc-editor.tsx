"use client";

import { useActionState, useRef } from "react";
import { updateDocumentAction, type FormState } from "./actions";
import { DocAssetToolbar } from "../assets/doc-assets";
import { scopedHref } from "@/lib/workbench-navigation";

// 资产联动：编辑器内上传的文件经 /api/assets 自动存入项目资产库（绑定 docId）；
// 删除文档仅解除 assets.docId 关联（外键 onDelete: set null），不删除资产文件。

export function DocEditor({
  projectId,
  documentId,
  teamId,
  initialTitle,
  initialCategory,
  initialContent,
}: {
  projectId: string;
  documentId: string;
  teamId?: string | null;
  initialTitle: string;
  initialCategory: string;
  initialContent: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateDocumentAction,
    null,
  );
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // 在光标处插入 Markdown 片段（上传成功 / 选择资产后调用）
  function insertSnippet(snippet: string) {
    const el = contentRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + snippet + el.value.slice(end);
    const pos = start + snippet.length;
    el.setSelectionRange(pos, pos);
    el.focus();
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="documentId" value={documentId} />
      {teamId && <input type="hidden" name="team" value={teamId} />}

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
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-soft">正文（支持 Markdown）</span>
          <DocAssetToolbar
            projectId={projectId}
            documentId={documentId}
            onInsert={insertSnippet}
          />
        </div>
        <textarea
          ref={contentRef}
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
        <a href={scopedHref(`/projects/${projectId}/docs/${documentId}`, teamId)} className="ac-btn-ghost">
          取消
        </a>
      </div>
    </form>
  );
}
