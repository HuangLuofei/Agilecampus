// 成员技能标签：纯常量与纯函数（无 db 依赖，可安全进入客户端 bundle）。
// 自报制——标签由成员本人点亮/填写，仅供分工参考，不构成任何权限。
import { AppError } from "./errors";

export const SKILL_TAG_MAX_COUNT = 10;
export const SKILL_TAG_MAX_LEN = 12;

// 预设标签库（编辑器一键点亮；也允许自造）
export const PRESET_SKILL_TAGS = [
  "前端开发",
  "后端开发",
  "算法",
  "数据分析",
  "机器学习",
  "UI 设计",
  "文档写作",
  "测试",
  "运维部署",
  "嵌入式",
  "硬件",
  "调研分析",
  "项目管理",
  "答辩汇报",
];

// 规范化：trim → 去空 → 去重（保序）→ 限量限长。超限抛 AppError，由 action 层转文案。
export function normalizeSkillTags(tags: string[]): string[] {
  const cleaned = tags.map((t) => t.trim()).filter(Boolean);
  for (const t of cleaned) {
    if (t.length > SKILL_TAG_MAX_LEN) {
      throw new AppError(`单个标签「${t}」超过 ${SKILL_TAG_MAX_LEN} 个字`);
    }
  }
  const unique = [...new Set(cleaned)];
  if (unique.length > SKILL_TAG_MAX_COUNT) {
    throw new AppError(`技能标签最多 ${SKILL_TAG_MAX_COUNT} 个`);
  }
  return unique;
}
