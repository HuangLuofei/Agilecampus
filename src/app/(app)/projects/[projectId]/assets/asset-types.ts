// 资产相关的共享类型与纯函数（供资产列表 / 选择器 / 任务挂载 / 文档编辑器复用）
export type AssetItem = {
  id: string;
  projectId: string;
  taskId: string | null;
  docId: string | null;
  uploadUserId: string | null;
  uploadUserName: string | null;
  name: string;
  description: string | null;
  assetType: "file" | "link";
  url: string;
  fileMime: string | null;
  fileSize: number | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

// 是否为图片资产：优先看 MIME，其次看 url 后缀（图片以 ![]() 内联，其余以 []() 链接）
export function isImageAsset(a: AssetItem): boolean {
  if (a.assetType !== "file") return false;
  if (a.fileMime?.startsWith("image/")) return true;
  return IMAGE_RE.test(a.url);
}

// 生成可插入 Markdown 的片段：图片用 ![]()，其余用 []()
export function assetMarkdown(a: AssetItem): string {
  const label = a.name.replace(/[[\]]/g, "");
  return isImageAsset(a) ? `![${label}](${a.url})` : `[${label}](${a.url})`;
}

// 字节数 → 可读大小（B/KB/MB/GB）
export function formatSize(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}
