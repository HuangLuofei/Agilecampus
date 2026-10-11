"use client";

import { useEffect, useState } from "react";
import type { AssetItem } from "./asset-types";
import { formatSize } from "./asset-types";

// 通用「选择已有资产」弹窗：任务挂载 / 文档插入共用。
// 打开时拉取本项目资产（接口默认排除已归档），选中即回调 onSelect。
export function AssetPicker({
  projectId,
  title = "选择资产",
  open,
  excludeIds = [],
  onClose,
  onSelect,
}: {
  projectId: string;
  title?: string;
  open: boolean;
  excludeIds?: string[];
  onClose: () => void;
  onSelect: (asset: AssetItem) => void;
}) {
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setAssets(null);
      setError(null);
      try {
        const res = await fetch(`/api/assets?projectId=${encodeURIComponent(projectId)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setError(data.error ?? "加载资产失败");
          return;
        }
        if (!cancelled) setAssets(Array.isArray(data.assets) ? data.assets : []);
      } catch {
        if (!cancelled) setError("网络异常，请重试");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  if (!open) return null;

  const list = (assets ?? []).filter((a) => !excludeIds.includes(a.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-ink/45 backdrop-blur-sm"
      />
      <div className="relative z-10 my-auto w-full max-w-md ac-card p-5 shadow-pop">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center rounded-field text-ink-faint hover:bg-sunken hover:text-ink"
          >
            ✕
          </button>
        </header>

        {assets === null && <p className="py-6 text-center text-sm text-ink-faint">加载中…</p>}
        {error && <p className="text-sm text-high">{error}</p>}
        {assets !== null && !error && list.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-soft">
            暂无可用资产，请先在「资产管理」页上传。
          </p>
        )}
        {assets !== null && !error && list.length > 0 && (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {list.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onSelect(a)}
                  className="flex w-full items-center justify-between gap-3 rounded-field border border-line px-3 py-2 text-left hover:border-primary"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{a.name}</span>
                    <span className="text-xs text-ink-faint">
                      {a.assetType === "link" ? "外部链接" : "文件"}
                      {a.fileSize != null && ` · ${formatSize(a.fileSize)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-primary">选择</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
