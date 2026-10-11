"use client";

import { useRef, useState } from "react";
import { AssetPicker } from "./asset-picker";
import { assetMarkdown } from "./asset-types";

// 文档编辑器资产工具栏：
// - 「上传文件」直接经 /api/assets 上传并绑定当前文档（docId），再以 Markdown 片段插入正文；
// - 「插入已有资产」弹窗选择项目内资产，插入其 Markdown 链接/图片。
export function DocAssetToolbar({
  projectId,
  documentId,
  onInsert,
}: {
  projectId: string;
  documentId: string;
  onInsert: (snippet: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("projectId", projectId);
      fd.append("name", file.name);
      fd.append("assetType", "file");
      fd.append("docId", documentId);
      fd.append("file", file);
      const res = await fetch("/api/assets", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "上传失败");
        return;
      }
      onInsert(assetMarkdown(data.asset));
    } catch {
      setError("网络异常，请重试");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="ac-btn-ghost text-xs"
      >
        {uploading ? "上传中…" : "上传文件"}
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <button type="button" onClick={() => setPickerOpen(true)} className="ac-btn-ghost text-xs">
        插入已有资产
      </button>
      {error && <span className="text-xs text-high">{error}</span>}

      <AssetPicker
        projectId={projectId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(a) => {
          onInsert(assetMarkdown(a));
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
