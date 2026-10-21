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

// ── 文件类型图标 / 标签 ────────────────────────────────────────────────
// 分类：PDF、表格、文档、演示、图片、压缩包、音频、视频、其他、链接。
// 判定优先 MIME，缺失/无法识别时回退文件扩展名；两者都大小写不敏感。

export type AssetIconKind =
  | "pdf"
  | "sheet"
  | "doc"
  | "slides"
  | "image"
  | "archive"
  | "audio"
  | "video"
  | "link"
  | "other";

const ICON_BY_KIND: Record<AssetIconKind, string> = {
  pdf: "📕",
  sheet: "📊",
  doc: "📄",
  slides: "📽️",
  image: "🖼️",
  archive: "📦",
  audio: "🎵",
  video: "🎬",
  link: "🔗",
  other: "📎",
};

const LABEL_BY_KIND: Record<AssetIconKind, string> = {
  pdf: "PDF",
  sheet: "表格",
  doc: "文档",
  slides: "演示",
  image: "图片",
  archive: "压缩包",
  audio: "音频",
  video: "视频",
  link: "链接",
  other: "其他",
};

// MIME → 分类（键一律小写）
const MIME_RULES: [RegExp, AssetIconKind][] = [
  [/^application\/pdf$/, "pdf"],
  [/^application\/vnd\.ms-excel$/, "sheet"],
  [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/, "sheet"],
  [/^application\/vnd\.oasis\.opendocument\.spreadsheet$/, "sheet"],
  [/^text\/csv$/, "sheet"],
  [/^application\/msword$/, "doc"],
  [/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/, "doc"],
  [/^application\/vnd\.oasis\.opendocument\.text$/, "doc"],
  [/^application\/vnd\.ms-powerpoint$/, "slides"],
  [/^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/, "slides"],
  [/^application\/vnd\.oasis\.opendocument\.presentation$/, "slides"],
  [/^image\//, "image"],
  [/^audio\//, "audio"],
  [/^video\//, "video"],
  [/^application\/zip$/, "archive"],
  [/^application\/x-rar-compressed$/, "archive"],
  [/^application\/vnd\.rar$/, "archive"],
  [/^application\/x-7z-compressed$/, "archive"],
  [/^application\/gzip$/, "archive"],
  [/^application\/x-tar$/, "archive"],
];

// 扩展名 → 分类（键一律小写、不含点）
const EXT_KINDS: Record<string, AssetIconKind> = {
  pdf: "pdf",
  xls: "sheet",
  xlsx: "sheet",
  xlsm: "sheet",
  csv: "sheet",
  doc: "doc",
  docx: "doc",
  rtf: "doc",
  ppt: "slides",
  pptx: "slides",
  pps: "slides",
  ppsx: "slides",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  gz: "archive",
  tar: "archive",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  m4a: "audio",
  ogg: "audio",
  mp4: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  webm: "video",
};

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

// 分类判定：link 型直接归「链接」；file 型优先 MIME，回退扩展名
export function getAssetKind(
  fileMime: string | null | undefined,
  name: string,
  assetType: "file" | "link" | null,
): AssetIconKind {
  if (assetType === "link") return "link";
  const mime = (fileMime ?? "").toLowerCase().trim();
  if (mime) {
    for (const [re, kind] of MIME_RULES) if (re.test(mime)) return kind;
  }
  const ext = extOf(name);
  return EXT_KINDS[ext] ?? "other";
}

// 文件类型图标（emoji）。优先 MIME，缺失按扩展名；大小写不影响判断。
export function getAssetIcon(
  fileMime: string | null | undefined,
  name: string,
  assetType: "file" | "link" | null = "file",
): string {
  return ICON_BY_KIND[getAssetKind(fileMime, name, assetType)];
}

// 文件类型标签：PDF / 表格 / 文档 / 演示 / 图片 / 压缩包 / 音频 / 视频 / 链接 / 其他
export function getAssetTypeLabel(
  fileMime: string | null | undefined,
  name: string,
  assetType: "file" | "link" | null = "file",
): string {
  return LABEL_BY_KIND[getAssetKind(fileMime, name, assetType)];
}
