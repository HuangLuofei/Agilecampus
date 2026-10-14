"use client";

import { useRouter } from "next/navigation";

// 返回上一级：优先走浏览器历史（能保留来源页的筛选、滚动位置等状态）；
// 直接打开/新标签页进入时没有可回退的历史，则跳到 fallbackHref。
export function BackButton({
  fallbackHref = "/projects",
  label = "返回上一级",
}: {
  fallbackHref?: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className="ac-btn-ghost px-2.5 py-1 text-xs"
    >
      <span aria-hidden>←</span>
      {label}
    </button>
  );
}
