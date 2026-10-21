"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MessageSortMode } from "@/lib/message-sort";

// 通知排序开关：time=按时间；unread=未读优先。选择写入用户偏好后刷新列表。
export function NotificationSortToggle({ initialMode }: { initialMode: MessageSortMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<MessageSortMode>(initialMode);
  const [pending, startTransition] = useTransition();

  function switchTo(next: MessageSortMode) {
    if (next === mode) return;
    setMode(next); // 乐观更新
    startTransition(async () => {
      try {
        await fetch("/api/messages/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationSortMode: next }),
        });
        router.refresh();
      } catch {
        setMode(initialMode); // 失败回滚
      }
    });
  }

  return (
    <div className="flex items-center gap-1 rounded-field border border-line p-0.5">
      {(
        [
          ["time", "按时间"],
          ["unread", "未读优先"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          disabled={pending}
          onClick={() => switchTo(value)}
          className={`rounded-[calc(var(--radius-field)-2px)] px-2 py-0.5 text-xs transition-colors ${
            mode === value
              ? "bg-primary-soft font-medium text-primary"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
