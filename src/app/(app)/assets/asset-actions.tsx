"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// 「我的资产」页的跨项目新增/删除能力：复用 /api/assets 接口
//（权限校验、文件白名单、站内通知均在服务端完成），成功后 router.refresh() 重取列表。

export type CreatorProject = {
  id: string;
  name: string;
  teamName: string;
  archived: boolean;
};

export function AssetCreator({ projects }: { projects: CreatorProject[] }) {
  const router = useRouter();
  const active = projects.filter((p) => !p.archived);

  const [projectId, setProjectId] = useState(active[0]?.id ?? "");
  const [mode, setMode] = useState<"file" | "link">("file");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (projects.length === 0) return null;

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (creating) return;
    setError(null);

    if (!projectId) return setError("请选择要归属的项目");
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
      if (mode === "link") fd.append("url", linkUrl.trim());
      else fd.append("file", file!);

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
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={create} className="ac-card space-y-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-ink">新增资产</h2>
        <span className="text-xs text-ink-faint">归属到所选项目，项目成员可见</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("file")}
          className={`border-b-2 px-2 py-1 text-sm ${
            mode === "file" ? "border-primary text-primary" : "border-transparent text-ink-soft"
          }`}
        >
          上传文件
        </button>
        <button
          type="button"
          onClick={() => setMode("link")}
          className={`border-b-2 px-2 py-1 text-sm ${
            mode === "link" ? "border-primary text-primary" : "border-transparent text-ink-soft"
          }`}
        >
          添加外部链接
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">归属项目</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="ac-field"
          >
            {active.length === 0 && <option value="">无可选项目（均已归档）</option>}
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.teamName}）
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">名称</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={mode === "file" ? "如 需求说明书.pdf" : "如 参考论文"}
            className="ac-field"
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
            />
          </label>
        )}
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-soft">描述（选填）</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="用途、版本说明…"
            className="ac-field"
          />
        </label>
      </div>

      {error && <p className="text-sm text-high">{error}</p>}

      <button type="submit" disabled={creating || active.length === 0} className="ac-btn">
        {creating ? "创建中…" : "创建资产"}
      </button>
    </form>
  );
}

export function AssetDeleteButton({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (deleting || !confirm("确认删除该资产？此操作不可恢复。")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/assets/${assetId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "删除失败");
        return;
      }
      router.refresh();
    } catch {
      alert("网络异常，请重试");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      disabled={deleting}
      onClick={remove}
      className="shrink-0 text-xs text-high hover:underline disabled:opacity-50"
    >
      {deleting ? "删除中…" : "删除"}
    </button>
  );
}
