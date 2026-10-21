"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { scopedHref } from "@/lib/workbench-navigation";
import {
  parseFilters,
  serializeFilters,
  type BoardFilters,
  type GroupBy,
} from "@/lib/board-filters";

type Option = { id: string; name: string };

const GROUP_LABEL: Record<GroupBy, string> = {
  status: "状态",
  assignee: "指派人",
  priority: "优先级",
  milestone: "里程碑",
};

const PRIORITY_OPTIONS: Option[] = [
  { id: "high", name: "高" },
  { id: "medium", name: "中" },
  { id: "low", name: "低" },
];

export function FilterBar({
  members,
  milestones,
  labels,
  visible,
  total,
}: {
  members: Option[];
  milestones: Option[];
  labels: Option[];
  visible: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseFilters(new URLSearchParams(searchParams.toString()));

  // 筛选态写入 URL：可分享、可刷新保持、可后退。scroll:false 免得跳回页首。
  function push(next: BoardFilters) {
    const qs = serializeFilters(next);
    const href = scopedHref(qs ? `${pathname}?${qs}` : pathname, searchParams.get("team"));
    router.replace(href, { scroll: false });
  }

  // 关键词：本地即时回显 + 防抖写入 URL，免得每敲一个字就打一次 replace。
  const [term, setTerm] = useState(filters.q);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 记下最近一次由本组件写入 URL 的关键词，用于区分外部变化（前进/后退）与自身输入。
  const pushedRef = useRef(filters.q);
  // 定时器回调必须用「最新」筛选态：若防抖等待期间用户点了别的 chip，
  // 沿用闭包里的旧 filters 会把那次点击覆盖掉。
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  });

  function stopTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function commitTerm(value: string) {
    const q = value.trim();
    pushedRef.current = q;
    push({ ...filtersRef.current, q });
  }

  function changeTerm(value: string) {
    setTerm(value);
    stopTimer();
    timerRef.current = setTimeout(() => commitTerm(value), 250);
  }

  useEffect(() => {
    if (filters.q === pushedRef.current) return;
    stopTimer();
    pushedRef.current = filters.q;
    setTerm(filters.q);
  }, [filters.q]);

  useEffect(() => stopTimer, []);

  function toggle(key: "assignee" | "priority" | "label" | "milestone", id: string) {
    const cur = filters[key];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    push({ ...filters, [key]: next });
  }

  const dirty =
    filters.assignee.length > 0 ||
    filters.priority.length > 0 ||
    filters.label.length > 0 ||
    filters.milestone.length > 0 ||
    filters.q.length > 0 ||
    filters.overdue;

  return (
    <div className="space-y-2 rounded-xl border border-line bg-sunken p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Group name="指派人">
          {[...members, { id: "none", name: "未指派" }].map((m) => (
            <Chip
              key={m.id}
              on={filters.assignee.includes(m.id)}
              onClick={() => toggle("assignee", m.id)}
            >
              {m.name}
            </Chip>
          ))}
        </Group>

        <Group name="优先级">
          {PRIORITY_OPTIONS.map((p) => (
            <Chip
              key={p.id}
              on={filters.priority.includes(p.id)}
              onClick={() => toggle("priority", p.id)}
            >
              {p.name}
            </Chip>
          ))}
        </Group>

        {labels.length > 0 && (
          <Group name="标签">
            {labels.map((l) => (
              <Chip
                key={l.id}
                on={filters.label.includes(l.id)}
                onClick={() => toggle("label", l.id)}
              >
                {l.name}
              </Chip>
            ))}
          </Group>
        )}

        {milestones.length > 0 && (
          <Group name="里程碑">
            {[...milestones, { id: "none", name: "无里程碑" }].map((m) => (
              <Chip
                key={m.id}
                on={filters.milestone.includes(m.id)}
                onClick={() => toggle("milestone", m.id)}
              >
                {m.name}
              </Chip>
            ))}
          </Group>
        )}

        <Chip on={filters.overdue} onClick={() => push({ ...filters, overdue: !filters.overdue })}>
          仅看逾期
        </Chip>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <input
          type="search"
          value={term}
          onChange={(e) => changeTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              stopTimer();
              commitTerm(term);
            }
          }}
          placeholder="搜索标题或描述…"
          aria-label="搜索任务标题或描述"
          className="ac-field w-56 py-1 text-sm"
        />
        <span className="text-xs font-medium text-ink-soft">分组依据</span>
        <select
          value={filters.group}
          onChange={(e) => push({ ...filters, group: e.target.value as GroupBy })}
          className="ac-field w-auto py-1 text-sm"
        >
          {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
            <option key={g} value={g}>
              {GROUP_LABEL[g]}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-faint">
          显示 {visible} / {total} 个任务
        </span>
        {dirty && (
          <button
            type="button"
            onClick={() => {
              stopTimer();
              setTerm("");
              pushedRef.current = "";
              push({
                ...filters,
                assignee: [],
                priority: [],
                label: [],
                milestone: [],
                overdue: false,
                q: "",
              });
            }}
            className="text-xs text-ink-faint underline hover:text-primary"
          >
            清空筛选
          </button>
        )}
      </div>
    </div>
  );
}

function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-xs font-medium text-ink-soft">{name}</span>
      {children}
    </span>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`ac-badge transition ${
        on ? "bg-primary text-white" : "bg-surface text-ink-soft hover:bg-primary-soft"
      }`}
    >
      {children}
    </button>
  );
}
