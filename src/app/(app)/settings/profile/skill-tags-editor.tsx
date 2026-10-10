"use client";

import { useActionState, useState } from "react";
import { PRESET_SKILL_TAGS, SKILL_TAG_MAX_COUNT, SKILL_TAG_MAX_LEN } from "@/lib/skill-tags";
import { updateSkillTagsAction, type SkillTagsState } from "./actions";

export function SkillTagsEditor({ initialTags }: { initialTags: string[] }) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState("");
  const [state, formAction, pending] = useActionState<SkillTagsState, FormData>(
    updateSkillTagsAction,
    null,
  );
  const saved = state !== null && "ok" in state;
  const error = state !== null && "error" in state ? state.error : null;

  const toggle = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const addDraft = () => {
    const t = draft.trim();
    if (!t) return;
    if (!tags.includes(t)) setTags((prev) => [...prev, t]);
    setDraft("");
  };

  return (
    <form action={formAction} className="ac-card space-y-5 p-5">
      <input type="hidden" name="tags" value={JSON.stringify(tags)} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-ink">预设标签（点击点亮）</h2>
        <div className="flex flex-wrap gap-2">
          {PRESET_SKILL_TAGS.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                aria-pressed={on}
                className={
                  on
                    ? "ac-badge bg-primary-soft text-primary"
                    : "ac-badge bg-sunken text-ink-soft hover:text-ink"
                }
              >
                {tag}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-ink">自定义标签</h2>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDraft();
              }
            }}
            maxLength={40}
            placeholder={`如「3D 打印」，不超过 ${SKILL_TAG_MAX_LEN} 个字`}
            className="ac-field flex-1"
          />
          <button type="button" onClick={addDraft} className="ac-btn-ghost whitespace-nowrap">
            添加
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-ink">
          已点亮 {tags.length}/{SKILL_TAG_MAX_COUNT}
        </h2>
        {tags.length === 0 ? (
          <p className="text-sm text-ink-faint">还没有标签——点亮几个让大家认识你。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                title="点击移除"
                className="ac-badge bg-primary-soft text-primary"
              >
                {tag} ✕
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <p className="text-sm text-high">{error}</p>}
      {saved && !pending && <p className="text-sm text-ink-soft">已保存 ✓</p>}

      <button disabled={pending} className="ac-btn px-3 py-2 text-sm">
        {pending ? "保存中…" : "保存"}
      </button>
    </form>
  );
}
