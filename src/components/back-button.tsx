"use client";

import { useRouter } from "next/navigation";

// 返回上一级：优先走浏览器历史（能保留来源页的筛选、滚动位置等状态）；
// 直接打开/新标签页进入时没有可回退的历史，则跳到 fallbackHref。
// 视觉：圆形箭头钮 + 文字标签，尺寸与页面 h1 协调；悬停时箭头微移、描边转主色。
export function BackButton({
  fallbackHref = "/projects",
  label = "返回",
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
      className="group -ml-1 inline-flex items-center gap-2 rounded-full px-1 py-0.5 text-[13px] font-medium text-ink-soft outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary-ring focus-visible:text-primary"
    >
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-surface shadow-[0_1px_2px_rgba(15,31,58,0.05)] transition-all duration-150 group-hover:-translate-x-0.5 group-hover:border-primary group-hover:bg-primary-soft"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      </span>
      <span className="border-b border-transparent pb-px transition-colors group-hover:border-primary/40">
        {label}
      </span>
    </button>
  );
}
