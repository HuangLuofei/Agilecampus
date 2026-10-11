import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";
import { toDayString, todayStartMs } from "@/lib/due";
import { NewProjectForm } from "./new-project-form";

const AVATAR_COLORS = ["#3370ff", "#2ea121", "#ff8800", "#8b5cf6", "#f54a45", "#00b0b9"];

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const teamFilter = typeof sp.team === "string" ? sp.team : null;

  const { teams, projects, stats, activity, todos } = await getDashboardData(session.user.id);
  const adminTeams = teams
    .filter((t) => t.role === "admin")
    .map(({ id, name }) => ({ id, name }));

  const membersByTeam = new Map(teams.map((t) => [t.id, t.members]));
  const visibleTeams = teamFilter ? teams.filter((t) => t.id === teamFilter) : teams;
  const today = toDayString(todayStartMs());

  const groups = visibleTeams.map((team) => ({
    team,
    projects: projects.filter((p) => p.teamId === team.id),
  }));

  return (
    <main className="space-y-6 py-8">
      {/* 标题 + 新建 */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">工作台</h1>
          <p className="mt-1 text-sm text-ink-faint">团队与项目，一个入口浏览</p>
        </div>
        {adminTeams.length > 0 && <NewProjectForm teams={adminTeams} />}
      </div>

      {projects.length === 0 ? (
        <div className="ac-card p-10 text-center text-sm text-ink-soft">
          {adminTeams.length > 0
            ? "暂无项目——点右上角「新建项目」创建第一个。"
            : "暂无项目——加入团队后即可在此查看项目。"}
        </div>
      ) : (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard href="/projects" icon="📁" value={stats.projectCount} label="我的项目" tone="blue" />
            <KpiCard href="/tasks?status=doing" icon="✓" value={stats.doingCount} label="进行中任务" tone="green" />
            <KpiCard href="/tasks?status=todo" icon="⏰" value={stats.todoCount} label="待我处理" tone="orange" />
            <KpiCard href="/tasks?status=overdue" icon="!" value={stats.overdueCount} label="已逾期" tone="red" />
          </div>

          {/* 团队筛选 */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip href="/projects" active={teamFilter === null}>
              全部项目 <span className="opacity-60">{projects.length}</span>
            </FilterChip>
            {teams.map((t) => (
              <FilterChip key={t.id} href={`/projects?team=${t.id}`} active={teamFilter === t.id}>
                {t.name} <span className="opacity-60">{t.projects.length}</span>
              </FilterChip>
            ))}
          </div>

          {/* 主区 + 右侧栏 */}
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
            {/* 左：按团队分组的项目 */}
            <div className="space-y-8">
              {groups.map(({ team, projects: teamProjects }) =>
                teamProjects.length === 0 ? null : (
                  <section key={team.id} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="h-4 w-1 rounded-full bg-primary" />
                      <h2 className="font-display text-base font-semibold text-ink">{team.name}</h2>
                      <RoleBadge role={team.role} />
                      <span className="text-xs text-ink-faint">成员 {team.members.length}</span>
                      <Link
                        href={`/teams/${team.id}/members`}
                        className="ml-auto text-sm text-ink-faint hover:text-primary"
                      >
                        管理 ▾
                      </Link>
                    </div>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {teamProjects.map((p) => (
                        <ProjectCard
                          key={p.id}
                          project={p}
                          members={membersByTeam.get(team.id) ?? []}
                          today={today}
                        />
                      ))}
                    </ul>
                  </section>
                ),
              )}
            </div>

            {/* 右：最近动态 + 我的待办 */}
            <aside className="space-y-6">
              <Panel title="最近动态" link="/messages?tab=notifications">
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
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="我的待办" link="/messages?tab=notifications">
                {todos.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-faint">没有待办任务</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {todos.map((t) => (
                      <li key={t.id} className="flex items-center gap-2.5 py-2.5">
                        <span className="h-4 w-4 shrink-0 rounded border border-line-strong" />
                        <Link
                          href={t.linkUrl}
                          className="min-w-0 flex-1 truncate text-[13px] text-ink-soft hover:text-primary"
                        >
                          {t.title}
                        </Link>
                        <span
                          className={`shrink-0 text-[11px] ${t.overdue ? "text-high" : "text-ink-faint"}`}
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
    red: "bg-high-soft text-high",
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
  };
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
          href={`/projects/${p.id}`}
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

      {p.description && (
        <p className="mt-1 line-clamp-1 text-xs text-ink-soft">{p.description}</p>
      )}

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-ink-soft">
          <span>任务进度</span>
          <span className="tabular-nums">
            {p.doneCount}/{p.taskTotal}
            {p.taskTotal > 0 ? ` · ${pct}%` : ""}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-done transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-3 flex items-center border-t border-line pt-3">
        <div className="flex">
          {members.slice(0, 4).map((m, i) => (
            <span
              key={m.id}
              title={m.name}
              className="-ml-1.5 grid h-5 w-5 place-items-center rounded-full border-2 border-surface text-[9px] font-semibold text-white first:ml-0"
              style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
            >
              {m.name.trim()?.[0] ?? "?"}
            </span>
          ))}
        </div>
        <span className={`ml-auto text-xs ${overdue ? "text-high" : "text-ink-faint"}`}>
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
  link: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ac-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
        <Link href={link} className="text-xs text-primary hover:underline">
          全部
        </Link>
      </div>
      {children}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { admin: "管理员", teacher: "导师", student: "成员" };

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === "admin"
      ? "bg-primary-soft text-primary"
      : role === "teacher"
        ? "bg-accent-soft text-accent"
        : "bg-low-soft text-low";
  return <span className={`ac-badge ${cls}`}>{ROLE_LABEL[role] ?? role}</span>;
}
