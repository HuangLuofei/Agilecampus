"use client";

import { useState } from "react";

export type PickerMember = { id: string; name: string; skillTags?: string[] };

// 负责人多选：芯片式复选。
// 不用 <select multiple>（需按住 Ctrl 点选，不直观）；每个选中项渲染一个同名隐藏字段，
// 服务端用 formData.getAll("assigneeIds") 收集，空选即「未分配」。
export function MemberPicker({
  members,
  name,
  defaultSelected = [],
  emptyHint = "不选即未分配",
}: {
  members: PickerMember[];
  name: string;
  defaultSelected?: string[];
  emptyHint?: string;
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedMembers = members.filter((m) => selected.includes(m.id));
  const skills = [...new Set(selectedMembers.flatMap((m) => m.skillTags ?? []))];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const on = selected.includes(m.id);
          return (
            <button
              type="button"
              key={m.id}
              onClick={() => toggle(m.id)}
              aria-pressed={on}
              title={on ? `取消指派 ${m.name}` : `指派给 ${m.name}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                on
                  ? "border-primary bg-primary font-medium text-white"
                  : "border-line-strong bg-surface text-ink-soft hover:border-primary hover:text-primary"
              }`}
            >
              <span aria-hidden>{on ? "✓" : "+"}</span>
              {m.name}
              {m.skillTags && m.skillTags.length > 0 ? (
                <span className={on ? "opacity-80" : "opacity-60"}>（{m.skillTags.join("/")}）</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* 表单提交用：每个选中项一个同名隐藏字段 */}
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}

      <p className="text-xs text-ink-faint">
        {selectedMembers.length === 0
          ? emptyHint
          : `已选 ${selectedMembers.length} 人：${selectedMembers.map((m) => m.name).join("、")}`}
      </p>

      {selectedMembers.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-ink-soft">
          <span>技能：</span>
          {skills.length > 0 ? (
            skills.map((t) => (
              <span key={t} className="ac-badge bg-primary-soft text-primary">
                {t}
              </span>
            ))
          ) : (
            <span className="text-ink-faint">所选成员暂未填写技能标签</span>
          )}
        </p>
      )}
    </div>
  );
}
