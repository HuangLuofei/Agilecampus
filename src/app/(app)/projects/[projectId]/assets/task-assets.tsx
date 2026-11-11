"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetItem, DeliverableKind } from "./asset-types";
import { formatSize, getAssetIcon, DELIVERABLE_KIND_ICONS, DELIVERABLE_KIND_LABELS } from "./asset-types";
import { AssetPicker } from "./asset-picker";

// 任务详情内的「交付物 / 挂载资产」区域：按交付物类型分组展示（演示文稿/问卷/代码包/其他），
// 支持绑定已有资产、上传新资产、改类型、解绑。资产绑定任务即写入 assets.taskId。
// 后端按 project → team 收敛权限，团队内成员均可操作。

const GROUP_ORDER: (DeliverableKind | "other")[] = ["presentation", "survey", "code", "other"];
const GROUP_TITLES: Record<DeliverableKind | "other", string> = {
  presentation: DELIVERABLE_KIND_LABELS.presentation,
  survey: DELIVERABLE_KIND_LABELS.survey,
  code: DELIVERABLE_KIND_LABELS.code,
  other: "其他文件",
};
const GROUP_ICONS: Record<DeliverableKind | "other", string> = {
  presentation: DELIVERABLE_KIND_ICONS.presentation,
  survey: DELIVERABLE_KIND_ICONS.survey,
  code: DELIVERABLE_KIND_ICONS.code,
  other: "📎",
};

type KindChoice = "auto" | DeliverableKind;

export function TaskAssets({
  projectId,
  taskId,
  canWrite = true,
}: {
  projectId: string;
  taskId: string;
  canWrite?: boolean;
}) {
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadKind, setUploadKind] = useState<KindChoice>("auto");
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

  async function bind(asset: AssetItem, kind?: DeliverableKind | null) {
    setPickerOpen(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${asset.id}/bind-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          ...(kind !== undefined ? { deliverableKind: kind } : {}),
        }),
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

  async function unbind(asset: AssetItem) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${asset.id}/bind-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "解绑失败");
        return;
      }
      await load();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function changeKind(asset: AssetItem, kind: DeliverableKind | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliverableKind: kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "修改类型失败");
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
      // 「自动」不传值，交给后端按扩展名/MIME 预判
      if (uploadKind !== "auto") fd.append("deliverableKind", uploadKind);
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
  const grouped: Record<DeliverableKind | "other", AssetItem[]> = {
    presentation: [],
    survey: [],
    code: [],
    other: [],
  };
  for (const a of bound) grouped[a.deliverableKind ?? "other"].push(a);

  return (
    <section className="border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">
          交付物 / 挂载资产
          {bound.length > 0 && <span className="ml-1 text-xs font-normal text-ink-faint">({bound.length})</span>}
        </h4>
        {canWrite && (
          <div className="flex items-center gap-2">
            <select
              value={uploadKind}
              onChange={(e) => setUploadKind(e.target.value as KindChoice)}
              disabled={busy}
              className="ac-field w-auto py-1 text-xs"
              title="上传时的交付物类型"
            >
              <option value="auto">自动识别</option>
              <option value="presentation">演示文稿</option>
              <option value="survey">问卷</option>
              <option value="code">代码包</option>
            </select>
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
        )}
      </div>

      {error && <p className="mt-1 text-xs text-high">{error}</p>}
      {assets === null && !error && <p className="mt-2 text-xs text-ink-faint">加载中…</p>}
      {assets !== null && bound.length === 0 && (
        <p className="mt-2 text-xs text-ink-faint">暂无挂载资产。</p>
      )}

      {bound.length > 0 && (
        <div className="mt-2 space-y-3">
          {GROUP_ORDER.filter((g) => grouped[g].length > 0).map((g) => (
            <div key={g}>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-soft">
                <span aria-hidden>{GROUP_ICONS[g]}</span>
                {GROUP_TITLES[g]}
                <span className="text-ink-faint">({grouped[g].length})</span>
              </p>
              <ul className="space-y-1.5">
                {grouped[g].map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-field bg-sunken px-3 py-2 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden>{getAssetIcon(a.fileMime, a.name, a.assetType)}</span>
                      <span className="min-w-0 truncate text-ink">{a.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-ink-faint">
                      {a.assetType === "link" ? "链接" : "文件"}
                      {a.fileSize != null && ` · ${formatSize(a.fileSize)}`}
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        预览
                      </a>
                      {canWrite && (
                        <>
                          <select
                            value={a.deliverableKind ?? ""}
                            disabled={busy}
                            onChange={(e) =>
                              changeKind(a, e.target.value === "" ? null : (e.target.value as DeliverableKind))
                            }
                            className="ac-field w-auto py-0.5 text-xs"
                            title="交付物类型"
                          >
                            <option value="">普通文件</option>
                            <option value="presentation">演示文稿</option>
                            <option value="survey">问卷</option>
                            <option value="code">代码包</option>
                          </select>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => unbind(a)}
                            className="text-high hover:underline disabled:opacity-50"
                          >
                            解绑
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <AssetPicker
        projectId={projectId}
        open={pickerOpen}
        excludeIds={bound.map((a) => a.id)}
        onClose={() => setPickerOpen(false)}
        onSelect={(a) => bind(a)}
      />
    </section>
  );
}
