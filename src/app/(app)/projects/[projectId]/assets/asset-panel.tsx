"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AssetItem } from "./asset-types";
import { formatSize } from "./asset-types";

// 资产管理主面板：新建资产（上传文件 / 外部链接）+ 列表（预览 / 下载 / 重命名 / 删除）。
// 项目归档后（projectArchived）上传、重命名、删除按钮一律置灰禁用。
export function AssetPanel({
  projectId,
  projectArchived,
}: {
  projectId: string;
  projectArchived: boolean;
}) {
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 新建资产表单
  const [mode, setMode] = useState<"file" | "link">("file");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/assets?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "加载资产失败");
        setAssets([]);
        return;
      }
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch {
      setError("网络异常，请重试");
      setAssets([]);
    }
  }, [projectId]);

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
        setAssets(Array.isArray(data.assets) ? data.assets : []);
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
  }, [projectId]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (projectArchived || creating) return;
    setError(null);

    if (!name.trim()) return setError("请填写资产名");
    if (mode === "link" && !linkUrl.trim()) return setError("请填写链接地址");
    if (mode === "file" && !file) return setError("请选择要上传的文件");

    setCreating(true);
    try {
      const fd = new FormData();
      fd.append("projectId", projectId);
      fd.append("name", name.trim());
      fd.append("assetType", mode);
      if (description.trim()) fd.append("description", description.trim());
      if (mode === "link") {
        fd.append("url", linkUrl.trim());
      } else {
        fd.append("file", file!);
      }
      const res = await fetch("/api/assets", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "新增资产失败");
        return;
      }
      setName("");
      setDescription("");
      setLinkUrl("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setCreating(false);
    }
  }

  async function rename(assetId: string) {
    const value = renamingName.trim();
    if (!value || saving || projectArchived) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "重命名失败");
        return;
      }
      setRenamingId(null);
      await load();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function remove(assetId: string) {
    if (projectArchived) return;
    if (!confirm("确认删除该资产？此操作不可恢复。")) return;
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "删除失败");
        return;
      }
      await load();
    } catch {
      setError("网络异常，请重试");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-high">{error}</p>}

      {/* 新建资产 */}
      <form onSubmit={create} className="ac-card space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">新建资产</h2>
          {projectArchived && <span className="ac-badge bg-sunken text-ink-faint">项目已归档</span>}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("file")}
            disabled={projectArchived}
            className={`border-b-2 px-2 py-1 text-sm disabled:pointer-events-none disabled:opacity-50 ${
              mode === "file" ? "border-primary text-primary" : "border-transparent text-ink-soft"
            }`}
          >
            上传文件
          </button>
          <button
            type="button"
            onClick={() => setMode("link")}
            disabled={projectArchived}
            className={`border-b-2 px-2 py-1 text-sm disabled:pointer-events-none disabled:opacity-50 ${
              mode === "link" ? "border-primary text-primary" : "border-transparent text-ink-soft"
            }`}
          >
            添加外部链接
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-ink-soft">名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "file" ? "如 需求说明书.pdf" : "如 参考论文"}
              className="ac-field"
              disabled={projectArchived}
            />
          </label>
          {mode === "link" ? (
            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-soft">链接地址</span>
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://…"
                className="ac-field"
                disabled={projectArchived}
              />
            </label>
          ) : (
            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-soft">文件</span>
              <input
                ref={fileRef}
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !name) setName(f.name);
                }}
                className="ac-field"
                disabled={projectArchived}
              />
            </label>
          )}
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-soft">描述（选填）</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="用途、版本说明…"
            className="ac-field"
            disabled={projectArchived}
          />
        </label>

        <button type="submit" disabled={projectArchived || creating} className="ac-btn">
          {creating ? "创建中…" : "创建资产"}
        </button>
      </form>

      {/* 资产列表 */}
      <section className="space-y-2">
        <h2 className="font-medium text-ink">资产列表</h2>
        {assets === null ? (
          <div className="ac-card p-8 text-center text-sm text-ink-soft">加载中…</div>
        ) : assets.length === 0 ? (
          <div className="ac-card p-8 text-center text-sm text-ink-soft">
            暂无资产——用上方表单上传第一个。
          </div>
        ) : (
          <ul className="space-y-2">
            {assets.map((a) => (
              <li key={a.id} className="ac-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {renamingId === a.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={renamingName}
                          onChange={(e) => setRenamingName(e.target.value)}
                          className="ac-field w-auto text-sm"
                          disabled={saving}
                        />
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => rename(a.id)}
                          className="ac-btn text-xs"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="ac-btn-ghost text-xs"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        <span className="break-all">{a.name}</span>
                        <span
                          className={`ac-badge ${
                            a.assetType === "link" ? "bg-primary-soft text-primary" : "bg-sunken text-ink-soft"
                          }`}
                        >
                          {a.assetType === "link" ? "链接" : "文件"}
                        </span>
                      </p>
                    )}
                    <p className="mt-1 text-xs text-ink-soft">
                      {a.assetType === "file" && a.fileSize != null && <span>{formatSize(a.fileSize)} · </span>}
                      {a.uploadUserName ?? "已注销成员"} · {new Date(a.createdAt).toLocaleString("zh-CN")}
                    </p>
                    {a.description && <p className="mt-1 text-xs text-ink-soft">{a.description}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <a href={a.url} target="_blank" rel="noreferrer" className="ac-btn-ghost text-xs">
                      预览
                    </a>
                    {a.assetType === "file" && (
                      <a href={a.url} download={a.name} className="ac-btn-ghost text-xs">
                        下载
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={projectArchived}
                      onClick={() => {
                        setRenamingId(a.id);
                        setRenamingName(a.name);
                      }}
                      className="ac-btn-ghost text-xs disabled:pointer-events-none disabled:opacity-50"
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      disabled={projectArchived}
                      onClick={() => remove(a.id)}
                      className="ac-btn-ghost text-xs text-high hover:border-high hover:text-high disabled:pointer-events-none disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* TODO(资产导出)：后续实现完整 UI —— 批量导出本项目资产清单（csv / zip 打包）。
          本期按约束不做搜索、批量下载，仅留占位。 */}
    </div>
  );
}
