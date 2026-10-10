// 到期状态判定：纯函数、无 DB 依赖，服务端与客户端组件皆可引用。
export const DUE_SOON_DAYS = 3;
const DAY = 86_400_000;

// "YYYY-MM-DD" → 本地零点毫秒；无值或非法返回 null
export function parseDay(s: string | null): number | null {
  if (!s) return null;
  const t = new Date(`${s}T00:00:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

// 今日本地零点毫秒
export function todayStartMs(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 本地零点毫秒 → "YYYY-MM-DD"
export function toDayString(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type DueState = "overdue" | "soon" | "ok";

// 已完成 / 无截止日 → ok；早于今天 → overdue；今天起 ≤ DUE_SOON_DAYS 天 → soon
export function classifyDue(
  dueDate: string | null,
  status: string,
  todayMs: number,
): DueState {
  if (!dueDate || status === "done") return "ok";
  const d = parseDay(dueDate);
  if (d === null) return "ok";
  if (d < todayMs) return "overdue";
  if (d <= todayMs + DUE_SOON_DAYS * DAY) return "soon";
  return "ok";
}
