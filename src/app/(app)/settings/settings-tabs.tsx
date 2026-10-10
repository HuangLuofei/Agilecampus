"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/profile", label: "我的技能标签" },
  { href: "/settings/tokens", label: "个人访问令牌" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-line">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? "border-primary font-medium text-primary"
                : "border-transparent text-ink-soft hover:text-primary"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
