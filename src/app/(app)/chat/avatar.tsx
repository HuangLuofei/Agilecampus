// 首字母头像：无头像字段，颜色按姓名哈希从语义色板取色
const PALETTE = [
  "bg-primary-soft text-primary",
  "bg-accent-soft text-accent",
  "bg-high-soft text-high",
  "bg-medium-soft text-medium",
  "bg-low-soft text-low",
];

function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const cls = PALETTE[hash(name) % PALETTE.length];
  const dim = size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-semibold ${dim} ${cls}`}>
      {initial}
    </span>
  );
}
