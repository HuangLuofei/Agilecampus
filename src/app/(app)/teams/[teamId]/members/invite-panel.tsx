"use client";

import { useActionState, useState } from "react";
import {
  createInviteLinkAction,
  revokeInviteLinkAction,
  type CreateLinkState,
} from "./actions";

export type InviteLinkRow = {
  id: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  projectName: string | null;
};

export type ProjectOption = { id: string; name: string };

export function InvitePanel({
  teamId,
  links,
  projects,
}: {
  teamId: string;
  links: InviteLinkRow[];
  projects: ProjectOption[];
}) {
  const [state, formAction, creating] = useActionState<CreateLinkState, FormData>(
    createInviteLinkAction,
    null,
  );
  const [copied, setCopied] = useState(false);

  async function copyLink(url: string) {
    const abs = `${window.location.origin}${url}`;
    await navigator.clipboard.writeText(abs);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-4 w-1 rounded-full bg-primary" />
        <h2 className="font-display text-base font-semibold text-ink">邀请链接</h2>
      </div>

      <form action={formAction} className="ac-card flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="teamId" value={teamId} />
        <label className="space-y-1 text-sm">
          <span className="block text-ink-soft">关联项目（可选）</span>
          <select name="projectId" className="ac-field w-auto py-1 text-sm" defaultValue="">
            <option value="">只加入小组</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                加入并关注「{p.name}」
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-ink-soft">有效期（天，留空长期）</span>
          <input
            name="expiresInDays"
            type="number"
            min={1}
            max={365}
            placeholder="长期"
            className="ac-field w-28 py-1 text-sm"
          />
        </label>
        <button disabled={creating} className="ac-btn px-3 py-1.5 text-sm">
          {creating ? "生成中…" : "生成新链接"}
        </button>
        {state?.error && <p className="w-full text-sm text-high">{state.error}</p>}
      </form>

      {state?.url && (
        <div className="ac-card flex flex-wrap items-center gap-2 p-4">
          <span className="text-sm text-done">✓ 新链接已生成（明文仅此一次展示，请立即复制）：</span>
          <code className="min-w-0 flex-1 truncate rounded bg-sunken px-2 py-1 text-xs text-ink">
            {state.url}
          </code>
          <button onClick={() => copyLink(state.url!)} className="ac-btn px-2 py-1 text-xs">
            {copied ? "已复制" : "复制链接"}
          </button>
        </div>
      )}

      {links.length === 0 ? (
        <div className="ac-card p-4 text-center text-sm text-ink-faint">
          还没有邀请链接——生成一条分享给待加入的同学。
        </div>
      ) : (
        <ul className="space-y-2">
          {links.map((l) => (
            <li key={l.id} className="ac-card flex items-center gap-3 p-4 text-sm">
              <span className="text-ink">
                {l.projectName ? `关注「${l.projectName}」` : "只加入小组"}
              </span>
              <span className="text-xs text-ink-faint">
                {l.expiresAt
                  ? `过期于 ${l.expiresAt.toLocaleDateString("zh-CN")}`
                  : "长期有效"}
              </span>
              <span className="ml-auto text-xs">
                {l.revokedAt ? (
                  <span className="ac-badge bg-low-soft text-low">已撤销</span>
                ) : (
                  <form action={revokeInviteLinkAction}>
                    <input type="hidden" name="teamId" value={teamId} />
                    <input type="hidden" name="linkId" value={l.id} />
                    <button className="ac-btn-ghost px-2 py-1 text-xs text-high">
                      撤销
                    </button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
