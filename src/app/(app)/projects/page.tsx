import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";
import { toDayString, todayStartMs } from "@/lib/due";
import { NewProjectForm } from "./new-project-form";
import { ForbiddenError } from "@/lib/errors";
import { displayStudentRole, scopedHref } from "@/lib/workbench-navigation";

const AVATAR_COLORS = ["#3370ff", "#2ea121", "#ff8800", "#8b5cf6", "#f54a45", "#00b0b9"];

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  if (Array.isArray(sp.team)) notFound();
  const teamFilter = typeof sp.team === "string" ? sp.team : null;

  const { teams, selectedTeam, totalProjectCount, projects, stats, activity, todos, reminders } = await getDashboardData(session.user.id, teamFilter).catch((error) => {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  });
  const adminTeams = teams
    .filter((t) => t.role === "admin" && (!teamFilter || t.id === teamFilter))
    .map(({ id, name }) => ({ id, name }));

  const membersByTeam = new Map(teams.map((t) => [t.id, t.members]));
  const visibleTeams = teamFilter ? teams.filter((t) => t.id === teamFilter) : teams;
  const today = toDayString(todayStartMs());

  const groups = visibleTeams.map((team) => ({
    team,
    projects: projects.filter((p) => p.teamId === team.id),
  }));
  const scopeHref = (href: string) => scopedHref(href, teamFilter);
  const dueItems = sp.attention === "urgent" ? reminders.filter((item) => item.urgent) : reminders;

  return (
    <main className="space-y-6">
      {/* 标题 + 新建 */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">工作台</h1>
          <p className="mt-1 text-sm text-ink-faint">{selectedTeam ? `专注于「${selectedTeam.name}」· 统计、待办、动态和提醒均按本组展示` : "按小组查看项目，集中处理当前工作"}</p>
        </div>
        {adminTeams.length > 0 && <NewProjectForm teams={adminTeams} />}
      </div>

      {teams.length === 0 ? (
        <div className="ac-card p-10 text-center text-sm text-ink-soft">
          暂无小组——<Link href="/teams" className="text-primary underline">加入或创建小组</Link>后即可查看项目。
        </div>
      ) : (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard href={scopeHref("/assets")} icon="🗂" value={stats.assetCount} label="小组资产" tone="blue" />
            <KpiCard href={scopeHref("/tasks?status=doing")} icon="✓" value={stats.doingCount} label="我的进行中任务" tone="green" />
            <KpiCard href={scopeHref("/tasks?status=todo")} icon="⏰" value={stats.todoCount} label="待我处理" tone="orange" />
            <KpiCard href={scopeHref("/tasks?status=overdue")} icon="!" value={stats.overdueCount} label="我的逾期任务" tone="red" />
          </div>

          {/* 团队筛选 */}
          <nav aria-label="小组专注筛选" className="flex flex-wrap items-center gap-2">
            <FilterChip href="/projects" active={teamFilter === null}>
              全部小组 <span className="opacity-60">{totalProjectCount} 个项目</span>
            </FilterChip>
            {teams.map((t) => (
              <FilterChip key={t.id} href={`/projects?team=${t.id}`} active={teamFilter === t.id}>
                {t.name} <span className="opacity-60">{t.projects.length}</span>
              </FilterChip>
            ))}
          </nav>

          {(sp.attention === "due" || sp.attention === "urgent") && (
            <section className="ac-card space-y-3 p-4" aria-label="到期任务提醒">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-ink">{sp.attention === "urgent" ? "强提醒：逾期或高优先级临期" : "到期任务提醒"} · {dueItems.length}</h2>
                <Link href={scopeHref("/projects")} className="text-sm text-primary">收起</Link>
              </div>
              <p className="text-xs text-ink-faint">成员查看自己负责的任务；组长同时查看本组项目的到期风险。</p>
              {dueItems.length === 0 ? <p className="text-sm text-ink-soft">当前范围暂无相关提醒。</p> : (
                <ul className="divide-y divide-line">
                  {dueItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <Link href={scopeHref(`/projects/${item.projectId}?task=${item.id}`)} className="font-medium text-ink hover:text-primary">{item.title}</Link>
                        <p className="text-xs text-ink-faint">{item.teamName} / {item.projectName}</p>
                      </div>
                      <span className={`text-xs ${item.state === "overdue" ? "text-alert" : "text-accent"}`}>{item.state === "overdue" ? "已逾期" : "即将到期"} · {item.dueDate}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* 主区 + 右侧栏 */}
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
            {/* 左：按团队分组的项目 */}
            <div className="space-y-8">
              {groups.map(({ team, projects: teamProjects }) => (
                  <section key={team.id} className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span aria-hidden className="h-4 w-1 rounded-full bg-primary" />
                      <h2 className="font-display text-base font-semibold text-ink">{team.name}</h2>
                      <RoleBadge role={team.role} />
                      <span className="text-xs text-ink-faint">{teamProjects.length} 个项目</span>
                      <Link
                        href={`/teams/${team.id}/members`}
                        title="查看团队成员"
                        className="text-xs text-ink-faint hover:text-primary hover:underline"
                      >
                        成员 {team.members.length}
                      </Link>
                      <Link
                        href={`/teams/${team.id}/members`}
                        className="ml-auto text-sm text-ink-faint hover:text-primary"
                      >
                        {team.role === "admin" ? "管理成员" : "查看成员"}
                      </Link>
                    </div>
                    <p className="text-xs text-ink-soft">
                      逾期 {teamProjects.reduce((n, p) => n + p.overdueCount, 0)} · 阻塞 {teamProjects.reduce((n, p) => n + p.blockedCount, 0)}
                    </p>
                    {teamProjects.length === 0 && <div className="ac-card p-6 text-sm text-ink-faint">本小组暂无项目。{team.role === "admin" ? "可以通过右上角创建项目。" : "等待组长创建项目。"}</div>}
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {teamProjects.map((p) => (
                        <ProjectCard
                          key={p.id}
                          project={p}
                          teamId={team.id}
                          focusedTeamId={teamFilter}
                          members={membersByTeam.get(team.id) ?? []}
                          today={today}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
            </div>

            {/* 右：最近动态 + 我的待办 */}
            <aside className="space-y-6">
              <Panel title="最近动态">
                {activity.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-faint">暂无动态</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {activity.map((a) => (
                      <li key={a.id} className="flex gap-2.5 py-2.5 text-[13px] leading-snug">
                        <span
                          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                          style={{ backgroundColor: AVATAR_COLORS[a.actorName.length % AVATAR_COLORS.length] }}
                        >
                          {a.initial}
                        </span>
                        <div className="min-w-0">
                          <Link href={a.linkUrl} className="text-ink-soft hover:text-primary">
                            <span className="font-medium text-ink">{a.actorName}</span>{" "}
                            {a.label}
                            <span className="text-ink">《{a.taskTitle}》</span>
                          </Link>
                          <span className="block text-[11px] text-ink-faint">{a.timeLabel}</span>
                          <span className="block text-[11px] text-ink-faint">{a.teamName} / {a.projectName}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="我的待办" link={scopeHref("/tasks")}>
                {todos.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-faint">没有待办任务</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {todos.map((t) => (
                      <li key={t.id} className="flex items-center gap-2.5 py-2.5">
                        <span className="h-4 w-4 shrink-0 rounded border border-line-strong" />
                        <div className="min-w-0 flex-1">
                        <Link
                          href={t.linkUrl}
                          className="block truncate text-[13px] text-ink-soft hover:text-primary"
                        >
                          {t.title}
                        </Link>
                        <p className="truncate text-[11px] text-ink-faint">{t.teamName} / {t.projectName}</p>
                        </div>
                        <span
                          className={`shrink-0 text-[11px] ${t.overdue ? "text-alert" : "text-ink-faint"}`}
                        >
                          {t.overdue ? "已逾期" : t.dueLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

function KpiCard({
  href,
  icon,
  value,
  label,
  tone,
}: {
  href: string;
  icon: string;
  value: number;
  label: string;
  tone: "blue" | "green" | "orange" | "red";
}) {
  const toneCls = {
    blue: "bg-primary-soft text-primary",
    green: "bg-done/15 text-done",
    orange: "bg-accent-soft text-accent",
    red: "bg-alert-soft text-alert",
  }[tone];
  return (
    <Link
      href={href}
      className="ac-card flex items-center gap-3 p-4 transition-shadow hover:shadow-pop"
    >
      <span className={`grid h-10 w-10 place-items-center rounded-lg text-lg ${toneCls}`}>
        {icon}
      </span>
      <div>
        <div className="font-display text-xl font-bold leading-tight text-ink">{value}</div>
        <div className="text-xs text-ink-faint">{label}</div>
      </div>
    </Link>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] ${
        active
          ? "border-primary bg-primary font-medium text-white"
          : "border-line-strong bg-surface text-ink-soft hover:border-primary hover:text-primary"
      }`}
    >
      {children}
    </Link>
  );
}

function ProjectCard({
  project: p,
  teamId,
  focusedTeamId,
  members,
  today,
}: {
  project: {
    id: string;
    name: string;
    status: string;
    description: string | null;
    endDate: string | null;
    taskTotal: number;
    doneCount: number;
    teamName: string;
    todoCount: number;
    doingCount: number;
    overdueCount: number;
    blockedCount: number;
  };
  teamId: string;
  focusedTeamId: string | null;
  members: { id: string; name: string }[];
  today: string;
}) {
  const pct = p.taskTotal > 0 ? Math.round((p.doneCount / p.taskTotal) * 100) : 0;
  const overdue = p.status === "active" && !!p.endDate && p.endDate < today;
  const dueLabel = p.status === "archived" ? "已归档" : p.endDate ? `截止 ${p.endDate.slice(5)}` : "";

  return (
    <li className="ac-card group p-4 transition-shadow hover:shadow-pop">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={scopedHref(`/projects/${p.id}`, focusedTeamId)}
          className="min-w-0 truncate font-display text-base font-semibold text-ink group-hover:text-primary"
        >
          {p.name}
        </Link>
        {p.status === "archived" ? (
          <span className="ac-badge bg-low-soft text-low">已归档</span>
        ) : (
          <span className="ac-badge bg-done/12 text-done">进行中</span>
        )}
      </div>

      <p className="mt-1 truncate text-xs text-ink-faint">{p.teamName}</p>

      {p.description && (
        <p className="mt-1 line-clamp-1 text-xs text-ink-soft">{p.description}</p>
      )}

      <div className="mt-3">
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span>待办 {p.todoCount}</span><span>进行中 {p.doingCount}</span><span>已完成 {p.doneCount}</span>
        </div>
        <div className="mb-1 flex items-center justify-between text-xs text-ink-soft">
          <span>任务进度</span>
          <span className="tabular-nums">
            {p.doneCount}/{p.taskTotal}
            {p.taskTotal > 0 ? ` · ${pct}%` : ""}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label={`${p.name} 完成率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full rounded-full bg-done transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-2 flex gap-3 text-xs">
        <span className={p.overdueCount ? "text-alert" : "text-ink-faint"}>逾期 {p.overdueCount}</span>
        <span className={p.blockedCount ? "text-accent" : "text-ink-faint"}>前置阻塞 {p.blockedCount}</span>
      </div>

      <div className="mt-3 flex items-center border-t border-line pt-3">
        <div className="flex">
          {members.slice(0, 4).map((m, i) => (
            <Link
              key={m.id}
              href={`/teams/${teamId}/members`}
              title={`${m.name} · 查看团队成员`}
              aria-label={`查看团队成员：${m.name}`}
              className="relative -ml-1.5 grid h-5 w-5 place-items-center rounded-full border-2 border-surface text-[9px] font-semibold text-white transition-transform first:ml-0 hover:z-10 hover:-translate-y-0.5 hover:border-primary"
              style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
            >
              {m.name.trim()?.[0] ?? "?"}
            </Link>
          ))}
        </div>
        <span className={`ml-auto text-xs ${overdue ? "text-alert" : "text-ink-faint"}`}>
          {overdue ? "已逾期" : dueLabel}
        </span>
      </div>
    </li>
  );
}

function Panel({
  title,
  link,
  children,
}: {
  title: string;
  link?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ac-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
        {link && <Link href={link} className="text-xs text-primary hover:underline">
          全部
        </Link>}
      </div>
      {children}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === "admin"
      ? "bg-primary-soft text-primary"
      : role === "teacher"
        ? "bg-accent-soft text-accent"
        : "bg-low-soft text-low";
  return <span className={`ac-badge ${cls}`}>{displayStudentRole(role)}</span>;
}
