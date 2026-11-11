// 交付物类型（演示文稿 / 问卷 / 代码包）纯模块：无 db、无客户端依赖，
// 服务端（lib/asset.ts）与客户端（asset-types.ts re-export）共用。
export type DeliverableKind = "presentation" | "survey" | "code";

export const DELIVERABLE_KINDS: readonly DeliverableKind[] = ["presentation", "survey", "code"];

export const DELIVERABLE_KIND_LABELS: Record<DeliverableKind, string> = {
  presentation: "演示文稿",
  survey: "问卷",
  code: "代码包",
};

export const DELIVERABLE_KIND_ICONS: Record<DeliverableKind, string> = {
  presentation: "📊",
  survey: "📝",
  code: "📦",
};

const SURVEY_RE = /(wenjuan|wj\.qq|questionnaire|survey|问卷)/i;
const PRESENTATION_EXT = new Set(["ppt", "pptx", "pps", "ppsx", "key"]);
const CODE_EXT = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"]);

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

// 交付物类型自动预判（上传/绑定时的默认值，用户可改）：
// - 任何型：名称或 URL 含问卷特征 → survey
// - file 型：优先 MIME，回退扩展名；ppt 系 → presentation，压缩包系 → code
// - 无法判断 → null（普通文件）。问卷多为外链，仅按链接/名称特征识别。
export function inferDeliverableKind(
  fileMime: string | null | undefined,
  name: string,
  assetType: "file" | "link" | null = "file",
  url?: string | null,
): DeliverableKind | null {
  const text = `${name} ${url ?? ""}`;
  if (SURVEY_RE.test(text)) return "survey";
  // link 型不走文件 MIME / 扩展名推断（问卷链接已由特征识别，其余视为普通链接）
  if (assetType === "link") return null;
  const mime = (fileMime ?? "").toLowerCase().trim();
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation";
  if (
    mime === "application/zip" ||
    mime.includes("x-rar") ||
    mime.includes("x-7z") ||
    mime.includes("x-tar") ||
    mime.includes("gzip") ||
    mime.includes("x-compress")
  ) {
    return "code";
  }
  const ext = extOf(name);
  if (PRESENTATION_EXT.has(ext)) return "presentation";
  if (CODE_EXT.has(ext)) return "code";
  return null;
}
