"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetItem } from "./asset-types";
import { formatSize } from "./asset-types";
import { AssetPicker } from "./asset-picker";

// 任务详情弹窗内的「挂载资产」区域：展示已绑定资产，支持绑定已有资产 / 上传新资产。
// 后端按 project → team 收敛权限，团队内成员均可操作；资产绑定任务即写入 assets.taskId。
export function TaskAssets({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/assets?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "加载资产失败");
        setAssets([]);
        return;
      }
      const all: AssetItem[] = Array.isArray(data.assets) ? data.assets : [];
      setAssets(all.filter((a) => a.taskId === taskId));
    } catch {
      setError("网络异常，请重试");
      setAssets([]);
    }
  }, [projectId, taskId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/assets?projectId=${encodeURIComponent(projectId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "加载资产失败");
          setAssets([]);
          return;
        }
        const all: AssetItem[] = Array.isArray(data.assets) ? data.assets : [];
        setAssets(all.filter((a) => a.taskId === taskId));
      } catch {
        if (!cancelled) {
          setError("网络异常，请重试");
          setAssets([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId]);

  async function bind(asset: AssetItem) {
    setPickerOpen(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${asset.id}/bind-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "绑定失败");
        return;
      }
      await load();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("projectId", projectId);
      fd.append("name", file.name);
      fd.append("assetType", "file");
      fd.append("taskId", taskId);
      fd.append("file", file);
      const res = await fetch("/api/assets", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "上传失败");
        return;
      }
      await load();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const bound = assets ?? [];

  return (
    <section className="border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">挂载资产</h4>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setPickerOpen(true)}
            className="ac-btn-ghost text-xs"
          >
            绑定已有资产
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="ac-btn-ghost text-xs"
          >
            上传新资产
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
        </div>
      </div>

      {error && <p className="mt-1 text-xs text-high">{error}</p>}
      {assets === null && !error && <p className="mt-2 text-xs text-ink-faint">加载中…</p>}
      {assets !== null && bound.length === 0 && (
        <p className="mt-2 text-xs text-ink-faint">暂无挂载资产。</p>
      )}
      {bound.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {bound.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-field bg-sunken px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate text-ink">{a.name}</span>
              <span className="shrink-0 text-xs text-ink-faint">
                {a.assetType === "link" ? "链接" : "文件"}
                {a.fileSize != null && ` · ${formatSize(a.fileSize)}`}
                <a href={a.url} target="_blank" rel="noreferrer" className="ml-2 text-primary hover:underline">
                  预览
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}

      <AssetPicker
        projectId={projectId}
        open={pickerOpen}
        excludeIds={bound.map((a) => a.id)}
        onClose={() => setPickerOpen(false)}
        onSelect={bind}
      />
    </section>
  );
}
