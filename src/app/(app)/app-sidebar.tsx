"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "./logout-action";

export type SidebarTeam = {
  id: string;
  name: string;
  role: string;
  projects: { id: string; name: string }[];
};

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  teacher: "导师",
  student: "成员",
};

export function AppSidebar({
  userName,
  teams,
  unreadChats,
  unreadNotifications,
}: {
  userName: string | null | undefined;
  teams: SidebarTeam[];
  unreadChats: number;
  unreadNotifications: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [messagesOpen, setMessagesOpen] = useState(true);
  const totalUnread = unreadChats + unreadNotifications;
  // 默认展开第一个团队，其余折叠
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    teams.forEach((t, i) => (init[t.id] = i === 0));
    return init;
  });

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-[linear-gradient(180deg,var(--color-navy-bright)_0%,var(--color-navy)_45%,var(--color-navy-deep)_100%)] text-white">
      {/* 品牌 */}
      <Link href="/projects" className="flex items-center gap-2.5 border-b border-white/15 px-4 py-4">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-white font-display text-sm font-bold text-navy">
          A
        </span>
        <span className="leading-tight">
          <span className="block font-display text-[15px] font-semibold">AgileCampus</span>
          <span className="block text-[11px] text-white/60">敏捷校园 · 团队协作</span>
        </span>
      </Link>

      {/* 导航 */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        <NavItem href="/projects" label="工作台" icon="▦" active={isActive("/projects")} />
        {/* 消息：展开为「对话」与「通知」 */}
        <div>
          <div
            className={`flex items-center gap-1 rounded-field px-1.5 py-1.5 ${
              isActive("/messages") ? "bg-white/10" : "hover:bg-white/10"
            }`}
          >
            <button
              type="button"
              onClick={() => setMessagesOpen((v) => !v)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/70 hover:bg-white/10"
              aria-label={messagesOpen ? "折叠消息" : "展开消息"}
            >
              {messagesOpen ? "▾" : "▸"}
            </button>
            <span className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-sm text-white/85">
              <span className="w-4 text-center">✉</span>
              <span>消息</span>
              {totalUnread > 0 && (
                <span className="ml-auto grid min-h-4 min-w-4 place-items-center rounded-full bg-high px-1 text-[10px] font-semibold text-white">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
            </span>
          </div>
          {messagesOpen && (
            <>
              <MessageSubLink
                href="/messages"
                label="对话"
                active={pathname === "/messages" && searchParams.get("tab") !== "notifications"}
                badge={unreadChats}
              />
              <MessageSubLink
                href="/messages?tab=notifications"
                label="通知"
                active={pathname === "/messages" && searchParams.get("tab") === "notifications"}
                badge={unreadNotifications}
              />
            </>
          )}
        </div>
        <NavItem href="/settings" label="设置" icon="⚙" active={isActive("/settings")} />

        {teams.length > 0 && (
          <p className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-white/50">
            我的团队
          </p>
        )}

        {teams.map((t) => {
          const expanded = open[t.id] ?? false;
          return (
            <div key={t.id}>
              <div className="flex items-center gap-1 rounded-field px-1.5 py-1.5">
                <button
                  type="button"
                  onClick={() => setOpen((s) => ({ ...s, [t.id]: !expanded }))}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/70 hover:bg-white/10"
                  aria-label={expanded ? "折叠团队" : "展开团队"}
                >
                  {expanded ? "▾" : "▸"}
                </button>
                <Link
                  href={`/teams/${t.id}/members`}
                  className="min-w-0 flex-1 truncate text-sm text-white/85 hover:text-white"
                >
                  {t.name}
                </Link>
                <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                  {ROLE_LABEL[t.role] ?? t.role}
                </span>
              </div>
              {expanded &&
                t.projects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className={`flex items-center gap-2 rounded-field py-1.5 pl-9 pr-2 text-[13px] ${
                      pathname === `/projects/${p.id}`
                        ? "bg-white/15 text-white"
                        : "text-white/60 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span className="h-1 w-1 shrink-0 rounded-full bg-white/40" />
                    <span className="truncate">{p.name}</span>
                  </Link>
                ))}
            </div>
          );
        })}

        <Link
          href="/teams"
          className={`mt-2 flex items-center gap-2 rounded-field px-2.5 py-1.5 text-sm ${
            isActive("/teams")
              ? "bg-white font-medium text-navy"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <span className="w-4 text-center">＋</span> 加入 / 创建团队
        </Link>
      </nav>

      {/* 用户 */}
      <div className="flex items-center gap-2.5 border-t border-white/15 px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-sm font-semibold text-navy">
          {userName?.trim()?.[0] ?? "我"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-white/90">{userName ?? "未登录"}</span>
        <form action={logoutAction}>
          <button className="text-xs text-white/60 hover:text-white">退出</button>
        </form>
      </div>
    </aside>
  );
}

function NavItem({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-field px-2.5 py-2 text-sm ${
        active
          ? "bg-white font-medium text-navy"
          : "text-white/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      <span className="w-4 text-center">{icon}</span>
      <span>{label}</span>
      {badge !== undefined && (
        <span className="ml-auto grid min-h-4 min-w-4 place-items-center rounded-full bg-high px-1 text-[10px] font-semibold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function MessageSubLink({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge: number;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-field py-1.5 pl-9 pr-2 text-[13px] ${
        active ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
      }`}
    >
      <span className="h-1 w-1 shrink-0 rounded-full bg-white/40" />
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 && (
        <span className="grid min-h-4 min-w-4 place-items-center rounded-full bg-high px-1 text-[10px] font-semibold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
