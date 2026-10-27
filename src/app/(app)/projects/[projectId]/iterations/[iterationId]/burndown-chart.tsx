import type { Burndown } from "@/lib/burndown";

// 纯 SVG 燃尽图（服务端组件，无交互），配色沿用设计系统的 CSS 变量。
export function BurndownChart({ burndown }: { burndown: Burndown }) {
  const { days, ideal, actual, totalAtStart, hasData } = burndown;

  if (!hasData || days.length === 0) {
    return (
      <div className="rounded-md bg-sunken/60 p-8 text-center text-sm text-ink-soft">
        历史数据不足，无法绘制燃尽曲线。
      </div>
    );
  }

  const n = days.length;
  const maxV = Math.max(1, totalAtStart, ...actual.filter((v): v is number => v !== null));
  const W = 720;
  const H = 280;
  const padL = 48;
  const padR = 20;
  const padT = 20;
  const padB = 40;

  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / maxV) * (H - padT - padB);

  const idealPath = ideal.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const actualPath = actual
    .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
    .filter((p): p is string => p !== null)
    .join(" ");

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const tickIndices = n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[560px]"
        role="img"
        aria-label="迭代燃尽图"
      >
        {/* 横向网格 + y 轴刻度 */}
        {ticks.map((t) => {
          const val = maxV * t;
          const yy = y(val);
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yy}
                y2={yy}
                stroke="var(--color-line)"
                strokeWidth={1}
              />
              <text
                x={padL - 8}
                y={yy + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--color-ink-faint)"
              >
                {Math.round(val)}
              </text>
            </g>
          );
        })}

        {/* 理想曲线（虚线） */}
        {idealPath && (
          <path
            d={idealPath}
            fill="none"
            stroke="var(--color-ink-faint)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}

        {/* 实际剩余曲线 + 数据点 */}
        {actualPath && (
          <path
            d={actualPath}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={2}
          />
        )}
        {actual.map((v, i) =>
          v === null ? null : (
            <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill="var(--color-primary)" />
          ),
        )}

        {/* x 轴日期刻度 */}
        {tickIndices.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - padB + 18}
            textAnchor="middle"
            fontSize={11}
            fill="var(--color-ink-soft)"
          >
            {days[i].slice(5)}
          </text>
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: "var(--color-primary)" }} />
          实际剩余
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4" style={{ borderTop: "1px dashed var(--color-ink-faint)" }} />
          理想曲线
        </span>
      </div>
    </div>
  );
}
